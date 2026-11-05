"""Where a camera's pictures come from: a YouTube live link, a stream address (RTSP or an http/HLS stream), or a
video file the user uploaded. Everything here is about getting from what the user typed to frames OpenCV can read."""
import os
import re
from dataclasses import dataclass
from urllib.parse import quote, urlsplit, urlunsplit

import cv2

from qavach import config

# TCP is far more reliable than UDP for RTSP over a normal network; must be set before the first capture opens.
os.environ.setdefault('OPENCV_FFMPEG_CAPTURE_OPTIONS', 'rtsp_transport;tcp')

YOUTUBE_HOSTS = ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be')
STREAM_SCHEMES = ('rtsp', 'rtsps', 'http', 'https')
UPLOAD_ID = re.compile(r'^[0-9a-f]{12}$')


class SourceError(ValueError):
    """The source cannot be used; the message is shown to the user as is."""


@dataclass
class Source:
    kind: str                  # 'youtube' | 'stream' | 'upload'
    url: str = ''              # what the user typed (never contains a password)
    upload_id: str = ''
    user: str = ''             # stream credentials: kept in memory only
    password: str = ''

    @property
    def live(self):
        return self.kind != 'upload'


def classify(url):
    """'youtube' or 'stream' for a user-typed address; raises SourceError for anything else.

    Only network addresses are accepted. A local file path would let the page read arbitrary files off this
    machine, so files go through the upload route instead."""
    parts = urlsplit((url or '').strip())
    if parts.scheme.lower() not in STREAM_SCHEMES or not parts.hostname:
        raise SourceError('Use a YouTube live link or a stream address such as rtsp://10.40.1.25:554/stream1')
    if (parts.hostname or '').lower() in YOUTUBE_HOSTS:
        return 'youtube'
    return 'stream'


def source_from_dict(data):
    """Build a Source from the front-end's JSON, validating it."""
    kind = (data or {}).get('kind')
    if kind == 'upload':
        upload_id = str(data.get('uploadId') or '')
        if not UPLOAD_ID.match(upload_id) or not upload_path(upload_id):
            raise SourceError('That uploaded video is no longer on the server; upload it again')
        return Source('upload', upload_id=upload_id)
    if kind == 'link':
        url = str(data.get('url') or '').strip()
        return Source(classify(url), url=url, user=str(data.get('user') or ''), password=str(data.get('password') or ''))
    raise SourceError('Choose a live link or an uploaded video')


def upload_path(upload_id):
    """The stored file of an upload, or None."""
    if not UPLOAD_ID.match(upload_id or ''):
        return None
    for path in config.UPLOADS.glob(f'{upload_id}.*'):
        return path
    return None


def with_credentials(url, user, password):
    """Put stream credentials into the address, URL-encoded. They only live in memory and are never logged."""
    if not user:
        return url
    parts = urlsplit(url)
    host = parts.hostname or ''
    if ':' in host:
        host = f'[{host}]'
    netloc = f'{quote(user, safe="")}:{quote(password, safe="")}@{host}' + (f':{parts.port}' if parts.port else '')
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def resolve_youtube(url):
    """(stream url, title) for a YouTube live or video link, at most MAX_STREAM_HEIGHT tall."""
    import yt_dlp
    options = {'quiet': True, 'no_warnings': True, 'noplaylist': True,
               'format': f'bv*[height<={config.MAX_STREAM_HEIGHT}]/b[height<={config.MAX_STREAM_HEIGHT}]/b'}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as error:      # yt-dlp raises a zoo of exception types; the user needs one readable message
        text = str(error).splitlines()[-1] if str(error) else type(error).__name__
        raise SourceError(f'YouTube would not give a stream for that link: {text[:200]}') from error
    formats = info.get('requested_formats') or [info]
    stream = formats[0].get('url')
    if not stream:
        raise SourceError('That YouTube link has no playable video stream')
    return stream, (info.get('title') or '').strip()


def stream_address(source):
    """The address OpenCV opens for a source, and a title if the source has one."""
    if source.kind == 'upload':
        path = upload_path(source.upload_id)
        if not path:
            raise SourceError('The uploaded video is missing from the server')
        return str(path), ''
    if source.kind == 'youtube':
        return resolve_youtube(source.url)
    return with_credentials(source.url, source.user, source.password), ''


def open_capture(address):
    capture = cv2.VideoCapture(address, cv2.CAP_FFMPEG)
    if not capture.isOpened():
        capture.release()
        raise SourceError('Could not open the stream. Check the address, the camera and the network')
    return capture


def grab_frame(capture, skip_seconds=0.0, attempts=60):
    """One frame. For a file, `skip_seconds` moves past a black first frame; a live stream just returns the next frame."""
    fps = capture.get(cv2.CAP_PROP_FPS) or 0
    if skip_seconds and fps and capture.get(cv2.CAP_PROP_FRAME_COUNT) > 0:
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(skip_seconds * fps))
    for _ in range(attempts):
        ok, frame = capture.read()
        if ok and frame is not None:
            return frame
    raise SourceError('The stream opened but sent no picture')


def probe(source):
    """Open the source and read one frame. Returns (frame, info dict)."""
    address, title = stream_address(source)
    capture = open_capture(address)
    try:
        frame = grab_frame(capture, skip_seconds=1.0)
        fps = capture.get(cv2.CAP_PROP_FPS) or 0
        frames = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        height, width = frame.shape[:2]
        return frame, dict(width=width, height=height, fps=round(fps, 1) if fps else None, live=source.live,
                           seconds=round(frames / fps, 1) if (not source.live and fps and frames > 0) else None,
                           title=title)
    finally:
        capture.release()
