"""One running camera: keeps its stream open, finds and tracks people inside the drawn zones, applies the rules and
publishes a live preview plus alert events.

A camera with no usable rule still runs as a preview, so the video wall and the zone editor have a picture."""
import math
import threading
import time
import uuid
from collections import deque
from datetime import datetime

import cv2
import numpy as np

from qavach import config, sources
from qavach.detector import TrackerClient
from qavach.intrusion import IntrusionRule, Rule, zones_to_pixels

RED, AMBER, GREY = (60, 60, 235), (30, 170, 245), (190, 190, 190)
STATIC = (200, 175, 130)        # in a zone, but not (yet) shown to be moving: a light, thin box with no label
WHOLE_VIEW = dict(id='__view__', name='the camera view', kind='polygon', points=[[0, 0], [100, 0], [100, 100], [0, 100]])
STALL_SECONDS = 20          # a live stream that sends nothing for this long is treated as dropped
PREVIEW_ONLY_FPS = 12       # preview rate of a camera that has no rule to run


def schedule_active(schedule, now=None):
    """The rule editor's "When" setting. Night is 18:00 to 06:00 local time."""
    hour = (now or datetime.now()).hour
    if schedule == 'night':
        return hour >= 18 or hour < 6
    if schedule == 'day':
        return 6 <= hour < 18
    return True


def intrusion_rule(data):
    """The detection settings of a front-end rule as an intrusion Rule. Raises ValueError when out of range."""
    return Rule.from_dict(dict(dwell_seconds=data.get('durationSec'), min_frames=data.get('minFrames'),
                               min_confidence=data.get('minConfidence'), repeat_seconds=data.get('repeatSec'),
                               min_motion_px=data.get('minMovePx')))


def detection_region(engines, width, height):
    """The part of the frame to run the detector on: the drawn zones plus a margin, because people stand partly
    outside a zone (their head is above the feet that decide) and the tracker needs a little context."""
    points = np.concatenate([zone.points for engine, _ in engines for zone in engine.zones])
    x1, y1 = points.min(axis=0)
    x2, y2 = points.max(axis=0)
    margin = int(0.15 * max(x2 - x1, y2 - y1)) + 48
    x1, y1, x2, y2 = x1 - margin, y1 - margin, x2 + margin, y2 + margin
    min_w, min_h = min(width, 320), min(height, 180)           # never a sliver the detector cannot use
    if x2 - x1 < min_w:
        x1, x2 = (x1 + x2 - min_w) / 2, (x1 + x2 + min_w) / 2
    if y2 - y1 < min_h:
        y1, y2 = (y1 + y2 - min_h) / 2, (y1 + y2 + min_h) / 2
    return (int(max(0, x1)), int(max(0, y1)), int(min(width, x2)), int(min(height, y2)))


def detect_size(region):
    long_side = max(region[2] - region[0], region[3] - region[1])
    return min(config.DETECT_SIZE, int(math.ceil(long_side / 32) * 32))


class LiveReader(threading.Thread):
    """Reads a live stream flat out into a short buffer of JPEG-compressed frames.

    Live streams (YouTube's HLS in particular) arrive in bursts, for example 150 frames at once every 5 seconds and
    nothing in between, so keeping only the newest frame would discard almost everything. The buffer holds the last
    few seconds and the processor picks frames from it evenly in stream time. Frames are compressed so a 4K camera
    does not need gigabytes of memory.

    It owns the capture and releases it itself when it stops: releasing a capture while another thread is inside
    read() crashes OpenCV's FFmpeg and takes the whole service down."""

    def __init__(self, capture, fps, keep_seconds=12):
        super().__init__(daemon=True)
        self.capture = capture
        self.buffer = deque(maxlen=max(30, int(fps * keep_seconds)))      # (frame index, JPEG bytes)
        self.count = 0                                                      # frames read so far
        self.failed = False
        self.stop_flag = threading.Event()
        self.lock = threading.Lock()

    def run(self):
        try:
            while not self.stop_flag.is_set():
                ok, frame = self.capture.read()
                if not ok:
                    self.failed = True
                    return
                ok, data = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                with self.lock:
                    self.buffer.append((self.count, data.tobytes()))
                    self.count += 1
        finally:
            self.capture.release()

    def take(self, wanted):
        """The first buffered frame at or after index `wanted` as (index, jpeg), or None if it has not arrived yet.
        If `wanted` has already fallen out of the buffer, the oldest frame is returned."""
        with self.lock:
            for index, data in self.buffer:
                if index >= wanted:
                    return index, data
        return None


class CameraRunner:
    def __init__(self, camera, rules, get_detector, emit):
        """camera: dict(id, name, source, zones). rules: front-end rules this camera runs. get_detector: callable that
        returns the shared Detector. emit: called with each alert event dict."""
        self.camera, self.rules, self.get_detector, self.emit = camera, rules, get_detector, emit
        self.state = 'starting'          # starting | running | reconnecting | error | stopped
        self.error = None
        self.stats = dict(fps=0.0, source_fps=0.0, stream_fps=0.0, people=0, frames=0, detecting=False, alerts=0, width=0, height=0)
        self.jpeg = None
        self.seq = 0
        self.full = None                 # latest full-size frame
        self.stop_flag = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_flag.set()
        self.thread.join(timeout=10)
        self.state = 'stopped'

    # ── the outer loop: connect, run, and start again when the stream drops or a file ends ──────────────────────
    def _run(self):
        backoff = 2.0
        while not self.stop_flag.is_set():
            started = time.time()
            try:
                self._session()
                backoff = 2.0
                if time.time() - started < 1.0:
                    self.stop_flag.wait(1.0)            # a file that ends at once must not spin
            except Exception as error:      # shown to the user next to the camera; the loop keeps trying
                text = str(error) or type(error).__name__
                self.error = text if isinstance(error, (sources.SourceError, FileNotFoundError)) else f'{type(error).__name__}: {text}'
                self.state = 'reconnecting' if self.camera['source'].live else 'error'
                print(f'camera {self.camera["id"]}: {self.error}', flush=True)
                if self.stop_flag.wait(backoff):
                    break
                backoff = min(30.0, backoff * 2)

    def _build_engines(self, width, height):
        engines = []
        for rule in self.rules:
            wanted = set(rule.get('zoneIds') or [])
            zones = [z for z in self.camera['zones'] if z['id'] in wanted] if wanted else [WHOLE_VIEW]
            pixels = zones_to_pixels(zones, width, height)
            if pixels:          # a rule whose zones were deleted or are only lines has nothing to watch
                engines.append((IntrusionRule(pixels, intrusion_rule(rule), scale=width / 1280), rule))
        return engines

    def _session(self):
        source = self.camera['source']
        address, _ = sources.stream_address(source)
        capture = sources.open_capture(address)
        fps = capture.get(cv2.CAP_PROP_FPS) or 0
        fps = fps if 1 <= fps <= 120 else 25.0
        width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        engines = self._build_engines(width, height)
        tracker = detector = region = None
        reader = None
        try:
            if engines:
                detector = self.get_detector()
                tracker = TrackerClient()
                tracker.reset(fps)
                region = detection_region(engines, width, height)
            self.stats.update(source_fps=round(fps, 1), width=width, height=height, detecting=bool(engines))
            self.state, self.error = 'running', None
            if source.live:
                reader = LiveReader(capture, fps)
                reader.start()
            done, busy, opened = 0, 0.0, time.time()
            for frame, seconds in (self._live_frames(reader, fps) if reader else self._file_frames(capture, fps, bool(engines))):
                tick = time.time()
                rows = self._process(frame, seconds, engines, tracker, detector, region, width, height)
                done += 1
                busy += time.time() - tick
                self.stats.update(fps=round(done / max(busy, 1e-6), 1), people=len(rows), frames=self.stats['frames'] + 1)
                if reader:      # how fast the stream itself delivers, to tell a slow stream from a slow detector
                    self.stats['stream_fps'] = round(reader.count / max(time.time() - opened, 1e-6), 1)
        finally:
            if reader:
                reader.stop_flag.set()          # the reader releases the capture when its current read returns
            else:
                capture.release()
            if tracker:
                tracker.close()

    # ── frame sources ───────────────────────────────────────────────────────────────────────────────────────────
    def _file_frames(self, capture, fps, detecting):
        """A video file plays in real time, like a camera that is always on; frames are skipped when the detector
        falls behind. The caller starts it again when the file ends, with fresh tracking."""
        started, number = time.time(), 0
        while not self.stop_flag.is_set():
            if time.time() - (started + number / fps) > 1.5 / fps:
                if not capture.grab():
                    return
                number += 1
                continue
            ok, frame = capture.read()
            if not ok:
                return
            yield frame, number / fps
            number += 1
            self.stop_flag.wait(max(0.0, started + number / fps - time.time()))

    def _live_frames(self, reader, fps):
        """Frames of a live stream, spaced evenly in stream time at whatever rate the detector can sustain. The time
        of a frame is its position in the stream (index / fps), not when it happened to arrive, so a rule's seconds
        mean video seconds even though the stream delivers in bursts."""
        wanted, last_count, last_new = 0, 0, time.time()
        while not self.stop_flag.is_set():
            if reader.count != last_count:
                last_count, last_new = reader.count, time.time()
            got = reader.take(wanted)
            if got is None:
                if reader.failed:
                    raise sources.SourceError('The stream stopped; reconnecting')
                if time.time() - last_new > STALL_SECONDS:
                    raise sources.SourceError('The stream sent nothing for 20 seconds; reconnecting')
                self.stop_flag.wait(0.005)
                continue
            index, data = got
            began = time.time()
            frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
            yield frame, index / fps
            # Skip the frames that went by while this one was being worked on, so the work keeps up with the stream.
            floor = 1 if self.stats['detecting'] else math.ceil(fps / PREVIEW_ONLY_FPS)
            wanted = index + max(floor, math.ceil((time.time() - began) * fps))

    # ── per frame ───────────────────────────────────────────────────────────────────────────────────────────────
    def _process(self, frame, seconds, engines, tracker, detector, region, width, height):
        self.full = frame
        rows, flagged, inside, waiting = [], set(), set(), set()
        if engines:
            x1, y1, x2, y2 = region
            crop = np.ascontiguousarray(frame[y1:y2, x1:x2])
            tracks = tracker.update(crop, detector.detect(crop, detect_size(region)))
            rows = [(int(t[4]), float(t[0]) + x1, float(t[1]) + y1, float(t[2]) + x1, float(t[3]) + y1, float(t[5]))
                    for t in tracks]       # plain floats: they end up in the JSON alert events
            now = datetime.now()
            for engine, rule in engines:
                if not schedule_active(rule.get('schedule', 'always'), now):
                    continue
                info, events = engine.update(seconds, rows)
                for track_id, state in info.items():
                    (flagged if state['flagged'] else inside if state['inside'] else set()).add(track_id)
                    if state['waiting']:
                        waiting.add(track_id)
                for event in events:
                    if event['type'] == 'alert':
                        self._alert(frame, rows, rule, event, width, height)
        self._draw(frame, rows, flagged, inside, waiting - flagged)
        return rows

    def _alert(self, frame, rows, rule, event, width, height):
        row = next((r for r in rows if r[0] == event['id']), None)
        if row is None:
            return
        _, x1, y1, x2, y2, _ = row
        event_id = f'EV-{uuid.uuid4().hex[:8]}'
        config.SNAPSHOTS.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(config.SNAPSHOTS / f'{event_id}.jpg'), frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        self.stats['alerts'] += 1
        self.emit(dict(
            id=event_id, at=int(time.time() * 1000), cameraId=self.camera['id'], ruleId=rule['id'],
            zoneId=None if event['zone_id'] == WHOLE_VIEW['id'] else event['zone_id'], zoneName=event['zone_name'],
            trackId=event['id'], confidence=event['confidence'], dwell=event['dwell'], frames=event['frames'],
            reentry=event['reentry'], moved=event['moved'], mode=rule.get('mode', 'test'),
            box=[round(100 * x1 / width, 1), round(100 * y1 / height, 1), round(100 * (x2 - x1) / width, 1),
                 round(100 * (y2 - y1) / height, 1)]))

    @staticmethod
    def _label(view, text, origin, colour):
        """Small text with a dark outline, so it stays readable on a bright sky or a white road marking."""
        cv2.putText(view, text, origin, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(view, text, origin, cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1, cv2.LINE_AA)

    def _draw(self, frame, rows, flagged, inside, waiting=frozenset()):
        """The live preview: the frame, downscaled, with a box on every tracked person. Zones are drawn by the page."""
        height, width = frame.shape[:2]
        scale = min(1.0, config.PREVIEW_WIDTH / width)
        view = cv2.resize(frame, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else frame.copy()
        for track_id, x1, y1, x2, y2, _ in rows:
            colour = RED if track_id in flagged else STATIC if track_id in waiting else AMBER if track_id in inside else GREY
            p1, p2 = (int(x1 * scale) - 2, int(y1 * scale) - 2), (int(x2 * scale) + 2, int(y2 * scale) + 2)
            cv2.rectangle(view, p1, p2, colour, 2 if track_id in flagged else 1)
            if track_id in flagged:
                self._label(view, f'#{track_id}', (p1[0], max(12, p1[1] - 4)), colour)
        ok, buffer = cv2.imencode('.jpg', view, [cv2.IMWRITE_JPEG_QUALITY, 72])
        self.jpeg = buffer.tobytes()
        self.seq += 1

    def snapshot(self):
        """JPEG bytes of the latest full-size frame, or None before the first one."""
        frame = self.full
        if frame is None:
            return None
        ok, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return buffer.tobytes()
