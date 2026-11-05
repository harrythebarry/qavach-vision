"""BoxMOT BoT-SORT + OSNet-AIN tracking worker for the demo server.

Run with .venv-boxmot (the main venv has no BoxMOT). The server sends frames and detections over stdin and
reads tracks from the original stdout; anything the libraries print goes to stderr instead so it cannot corrupt
the binary stream. Messages (little endian):

  b'R' + float32 fps                                  -> b'K'                     (start a fresh tracker)
  b'U' + int32 h, w, n + n*6 float32 + h*w*3 BGR bytes -> int32 m + m*8 float32   (tracks: x1 y1 x2 y2 id conf cls det)
  b'Q'                                                -> exit
"""
import os
import struct
import sys
from pathlib import Path

import numpy as np

# Same thresholds as config/tracker.reappearance-reid.yaml and scripts/boxmot_track.py.
TRACKER_OPTIONS = dict(track_high_thresh=0.05, track_low_thresh=0.01, new_track_thresh=0.05,
                       track_buffer=180, match_thresh=0.8, proximity_thresh=0.5,
                       appearance_thresh=0.25, use_cmc=False)


def read_exact(stream, count):
    data = bytearray()
    while len(data) < count:
        chunk = stream.read(count - len(data))
        if not chunk:
            raise EOFError
        data += chunk
    return bytes(data)


def main():
    reid_weights = Path(sys.argv[1])
    out = os.fdopen(os.dup(1), 'wb', buffering=0)
    os.dup2(2, 1)
    stdin = sys.stdin.buffer

    from boxmot import BotSort
    tracker = None
    while True:
        try:
            kind = read_exact(stdin, 1)
        except EOFError:
            return
        if kind == b'Q':
            return
        if kind == b'R':
            fps = struct.unpack('<f', read_exact(stdin, 4))[0]
            tracker = BotSort(reid_weights=reid_weights, device='cpu', half=False, use_embeddings=True,
                              frame_rate=max(1, int(round(fps))), **TRACKER_OPTIONS)
            out.write(b'K')
        elif kind == b'U':
            height, width, count = struct.unpack('<iii', read_exact(stdin, 12))
            dets = np.frombuffer(read_exact(stdin, count * 24), dtype='<f4').reshape(count, 6).copy()
            frame = np.frombuffer(read_exact(stdin, height * width * 3), dtype=np.uint8).reshape(height, width, 3)
            tracks = np.ascontiguousarray(np.asarray(tracker.update(dets, frame)).reshape(-1, 8), dtype='<f4')
            out.write(struct.pack('<i', len(tracks)) + tracks.tobytes())


if __name__ == '__main__':
    main()
