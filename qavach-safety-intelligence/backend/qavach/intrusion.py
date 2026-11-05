"""The intrusion rule: a tracked person stays inside a restricted zone long enough.

Zones arrive as polygons in percent of the frame (the console's zone editor stores them that way). A person is
"inside" a zone when the bottom centre of their box (the feet) is inside the polygon. The rule is set by the
user in the console; every field below maps to one of its settings:

  dwell_seconds   inside the same zone without leaving for this long (video time) before an alert
  min_frames      and for at least this many analysed frames in a row (guards very low frame rates)
  min_confidence  the track needs at least one detection this confident (noise at the detector's floor is ignored)
  repeat_seconds  after an alert, the same track raises no new alert for this long (repeat suppression)
  min_motion_px   the track's feet must have moved at least this many pixels (see motion.py), which keeps a flag
                  pole or other static object that the detector now and then calls a person from alerting; 0 turns
                  the check off, which also lets a person who was standing still from the first frame alert
  leave_seconds   the person counts as having left after this long outside every zone
"""
from dataclasses import dataclass, field

import cv2
import numpy as np

from qavach.motion import Movement

DEFAULT_MOTION_PX = 10.0       # the rule editor's default; used for a rule that does not say
FORGET_AFTER_SECONDS = 60.0    # a track not seen for this long (and not flagged) is dropped


@dataclass
class Rule:
    dwell_seconds: float = 3.0
    min_frames: int = 3
    min_confidence: float = 0.25
    repeat_seconds: float = 120.0
    leave_seconds: float = 2.0
    min_motion_px: float = DEFAULT_MOTION_PX
    motion_window_seconds: float = 4.0

    @classmethod
    def from_dict(cls, data):
        known = {k: data[k] for k in ('dwell_seconds', 'min_frames', 'min_confidence', 'repeat_seconds', 'leave_seconds',
                                      'min_motion_px', 'motion_window_seconds') if data.get(k) is not None}
        rule = cls(**known)
        if (rule.dwell_seconds < 0 or rule.min_frames < 1 or not 0 <= rule.min_confidence <= 1 or rule.repeat_seconds < 0
                or rule.min_motion_px < 0 or rule.motion_window_seconds <= 0):
            raise ValueError('Rule values out of range')
        return rule


@dataclass
class ZonePx:
    id: str
    name: str
    points: np.ndarray            # Nx2 int32, pixels
    points_pct: list              # the polygon as it came in, percent of the frame


def zones_to_pixels(zones, width, height):
    """Polygon zones from the console (percent) to pixels. Lines and degenerate shapes are ignored."""
    out = []
    for zone in zones:
        pts = zone.get('points') or []
        if zone.get('kind', 'polygon') != 'polygon' or len(pts) < 3:
            continue
        px = np.array([[p[0] / 100 * width, p[1] / 100 * height] for p in pts], dtype=np.float32)
        out.append(ZonePx(id=str(zone['id']), name=str(zone.get('name') or zone['id']), points=px.astype(np.int32),
                          points_pct=[[float(p[0]), float(p[1])] for p in pts]))
    return out


def locate(zones, point):
    """The first zone containing the point, or None."""
    for zone in zones:
        if cv2.pointPolygonTest(zone.points.astype(np.float32), (float(point[0]), float(point[1])), False) >= 0:
            return zone
    return None


@dataclass
class _Track:
    zone_id: str = None
    entered: float = None
    frames: int = 0
    peak: float = 0.0
    flagged: bool = False
    last_in: float = -1e9
    last_alert: float = None
    alerts: int = 0
    last_seen: float = 0.0
    move: Movement = None


@dataclass
class IntrusionRule:
    zones: list
    rule: Rule
    scale: float = 1.0             # frame width over 1280: what "30 pixels" means is the same on any camera
    state: dict = field(default_factory=dict)
    alert_count: int = 0
    suppressed_count: int = 0

    def update(self, seconds, tracks):
        """tracks: iterable of (track_id, x1, y1, x2, y2, confidence).

        Returns (info, events). info[id] = dict(zone, inside, flagged, moved, waiting); `flagged` is true while the
        person is flagged and still inside a zone, `waiting` while a track in a zone has not yet moved enough to count.
        Events: 'alert', 'suppressed' (would have alerted but repeat suppression
        held it back) and 'left'."""
        info, events = {}, []
        rule = self.rule
        for track_id, x1, y1, x2, y2, confidence in tracks:
            track_id = int(track_id)
            zone = locate(self.zones, ((x1 + x2) / 2, y2))
            st = self.state.get(track_id)
            if st is None:
                st = self.state[track_id] = _Track(move=Movement(rule.motion_window_seconds, self.scale))
            st.peak, st.last_seen = max(st.peak, float(confidence)), seconds
            moved = st.move.update(seconds, ((x1 + x2) / 2, y2), rule.min_motion_px) or rule.min_motion_px <= 0
            if zone is not None:
                if st.zone_id != zone.id or st.entered is None:
                    st.zone_id, st.entered, st.frames = zone.id, seconds, 0
                st.frames += 1
                st.last_in = seconds
                ready = (seconds - st.entered >= rule.dwell_seconds and st.frames >= rule.min_frames
                         and st.peak >= rule.min_confidence)
                ready = ready and moved
                if ready and not st.flagged:
                    st.flagged = True
                    held_back = st.last_alert is not None and seconds - st.last_alert < rule.repeat_seconds
                    if held_back:
                        self.suppressed_count += 1
                        events.append(dict(type='suppressed', id=track_id, seconds=seconds, zone_id=zone.id,
                                           zone_name=zone.name))
                    else:
                        st.alerts += 1
                        st.last_alert = seconds
                        self.alert_count += 1
                        events.append(dict(type='alert', id=track_id, seconds=seconds, zone_id=zone.id,
                                           zone_name=zone.name, confidence=round(st.peak, 3), reentry=st.alerts > 1,
                                           dwell=round(seconds - st.entered, 2), frames=st.frames,
                                           moved=round(st.move.most, 1), zone_pct=zone.points_pct))
            else:
                st.zone_id, st.entered, st.frames = None, None, 0
            waiting = zone is not None and not moved       # in a zone, but not yet shown to be moving
            info[track_id] = dict(zone=zone.id if zone else None, inside=zone is not None,
                                  flagged=st.flagged and zone is not None, moved=moved, waiting=waiting)
        for track_id, st in list(self.state.items()):
            if st.flagged and seconds - st.last_in > rule.leave_seconds:
                st.flagged = False
                events.append(dict(type='left', id=track_id, seconds=seconds))
            if not st.flagged and seconds - st.last_seen > FORGET_AFTER_SECONDS:
                del self.state[track_id]
        return info, events

    @property
    def flagged_now(self):
        return sorted(i for i, st in self.state.items() if st.flagged)
