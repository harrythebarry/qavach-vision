"""People detection (YOLO11s, this process) and tracking (BoxMOT BoT-SORT with OSNet ReID, a worker process).

The settings are the ones the port-safety project settled on for small, distant pedestrians (docs/FINAL_APPROACH.md in
barge-intrusion): person class only, a very low confidence floor so nobody is lost, and the rule decides what is
confident enough to alert on."""
import struct
import subprocess
import threading

import numpy as np

from qavach import config


class Detector:
    """One model shared by every camera; calls are serialised because the GPU is shared too."""

    def __init__(self):
        import torch
        from ultralytics import YOLO
        if not config.YOLO_WEIGHTS.exists():
            raise FileNotFoundError(f'{config.YOLO_WEIGHTS} is missing; set QAVACH_YOLO_WEIGHTS or see README.md')
        self.device = 'mps' if torch.backends.mps.is_available() else 'cpu'
        self.model = YOLO(str(config.YOLO_WEIGHTS))
        self.lock = threading.Lock()
        self.detect(np.zeros((360, 640, 3), dtype=np.uint8), 640)        # warm up the GPU kernels

    def detect(self, frame, size):
        """Person boxes in `frame` as an (n, 6) float32 array: x1 y1 x2 y2 confidence class."""
        with self.lock:
            result = self.model.predict(frame, conf=0.05, iou=0.45, imgsz=size, device=self.device, classes=[0],
                                        verbose=False)[0]
        boxes = result.boxes
        if len(boxes) == 0:
            return np.zeros((0, 6), dtype=np.float32)
        xyxy = boxes.xyxy.cpu().numpy()
        conf = boxes.conf.cpu().numpy()[:, None]
        return np.concatenate([xyxy, conf, np.zeros_like(conf)], axis=1).astype(np.float32)


class TrackerClient:
    """Talks to tracker_worker.py, which runs in the BoxMOT environment. One instance per running camera."""

    def __init__(self):
        for path in (config.TRACKER_PYTHON, config.REID_WEIGHTS):
            if not path.exists():
                raise FileNotFoundError(f'{path} is missing; set QAVACH_TRACKER_PYTHON / QAVACH_REID_WEIGHTS or see README.md')
        self.process = subprocess.Popen([str(config.TRACKER_PYTHON), str(config.TRACKER_WORKER), str(config.REID_WEIGHTS)],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def reset(self, fps):
        self.process.stdin.write(b'R' + struct.pack('<f', fps))
        self.process.stdin.flush()
        if self._read(1) != b'K':
            raise RuntimeError('tracker worker did not acknowledge reset')

    def update(self, frame, dets):
        """Tracks as an (m, 8) array: x1 y1 x2 y2 track_id confidence class detection_index."""
        height, width = frame.shape[:2]
        dets = np.ascontiguousarray(dets, dtype='<f4').reshape(-1, 6)
        self.process.stdin.write(b'U' + struct.pack('<iii', height, width, len(dets)) + dets.tobytes())
        self.process.stdin.write(np.ascontiguousarray(frame).data)
        self.process.stdin.flush()
        count = struct.unpack('<i', self._read(4))[0]
        return np.frombuffer(self._read(count * 32), dtype='<f4').reshape(count, 8)

    def _read(self, count):
        data = self.process.stdout.read(count)
        if len(data) != count:
            raise RuntimeError('tracker worker exited; check the back-end console')
        return data

    def close(self):
        try:
            self.process.stdin.write(b'Q')
            self.process.stdin.flush()
            self.process.wait(timeout=3)
        except Exception:
            self.process.kill()
