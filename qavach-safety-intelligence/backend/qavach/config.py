"""Where the back-end finds its models and helper environments.

The detector and tracker weights live in the port-safety project (`barge-intrusion`), so the defaults point there.
Every path can be overridden with an environment variable, so the back-end can run from any machine that has the files.
"""
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent          # backend/
DATA = Path(os.environ.get('QAVACH_DATA', HERE / 'data'))
FRAMES = DATA / 'frames'            # one still per "test connection", shown while the zones are drawn
UPLOADS = DATA / 'uploads'
SNAPSHOTS = DATA / 'snapshots'      # the frame each alert was raised on
STATE_FILE = DATA / 'state.json'    # cameras and rules, so a restart does not forget them

PORT_SAFETY = Path(os.environ.get('QAVACH_PORT_SAFETY', Path.home() / 'Documents' / 'port-safety '))
BARGE = PORT_SAFETY / 'barge-intrusion'

# The two weight files are kept in backend/weights/ (the Docker image uses them); the port-safety copies are the fallback.
BUNDLED = HERE / 'weights'
YOLO_WEIGHTS = Path(os.environ.get('QAVACH_YOLO_WEIGHTS', BUNDLED / 'yolo11s.pt' if (BUNDLED / 'yolo11s.pt').exists() else BARGE / 'yolo11s.pt'))
_REID = 'reid/osnet_ain_x1_0_msmt17.pt'
REID_WEIGHTS = Path(os.environ.get('QAVACH_REID_WEIGHTS', BUNDLED / _REID if (BUNDLED / _REID).exists() else BARGE / 'weights' / _REID))
TRACKER_PYTHON = Path(os.environ.get('QAVACH_TRACKER_PYTHON', BARGE / '.venv-boxmot/bin/python'))
TRACKER_WORKER = Path(__file__).with_name('tracker_worker.py')

# Tallest stream the back-end asks YouTube for. Pedestrians in the ferry camera are about half as tall at 720p.
MAX_STREAM_HEIGHT = int(os.environ.get('QAVACH_MAX_HEIGHT', 1080))
# Detection runs on the area around the drawn zones, resized so its long side is at most this many pixels.
DETECT_SIZE = int(os.environ.get('QAVACH_DETECT_SIZE', 1280))
# The live preview is downscaled to this width before it is JPEG-encoded.
PREVIEW_WIDTH = int(os.environ.get('QAVACH_PREVIEW_WIDTH', 960))

# Folder holding the built console (npm run build). When set and present, the service serves it at / so one address
# gives the whole site; the Docker image does this. Unset when the console runs on its own (npm run dev).
WEB = Path(os.environ['QAVACH_WEB']) if os.environ.get('QAVACH_WEB') else None

MAX_UPLOAD_BYTES = 2 * 1024 ** 3
VIDEO_SUFFIXES = ('.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v')
MAX_EVENTS = 300            # alerts kept in memory for the page to fetch
