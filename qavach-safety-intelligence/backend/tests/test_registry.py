import pytest

from qavach import config, registry as reg


class FakeRunner:
    """Stands in for CameraRunner so no stream or model is touched."""
    instances = []

    def __init__(self, camera, rules, get_detector, emit):
        self.camera, self.rules, self.emit = camera, rules, emit
        self.stats, self.state, self.error = dict(fps=0), 'running', None
        self.stopped = False
        FakeRunner.instances.append(self)

    def stop(self):
        self.stopped = True


@pytest.fixture
def registry(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'DATA', tmp_path)
    monkeypatch.setattr(config, 'STATE_FILE', tmp_path / 'state.json')
    monkeypatch.setattr(config, 'UPLOADS', tmp_path)
    monkeypatch.setattr(reg, 'CameraRunner', FakeRunner)
    FakeRunner.instances = []
    return reg.Registry()


CAM = dict(id='CAM-1', name='Ferry', source=dict(kind='link', url='https://www.youtube.com/live/QO-hO_kwwmY'),
           zones=[dict(id='Z1', name='Grid', purpose='restricted', kind='polygon', points=[[10, 10], [50, 10], [50, 50]])])
RULE = dict(id='R-1', name='Intrusion', cameraIds=['CAM-1'], zoneIds=['Z1'], subject='person', condition='enters',
            durationSec=3, minFrames=3, minConfidence=0.25, repeatSec=120, minMovePx=15, schedule='always', mode='live', priority='P2')


def test_a_camera_with_a_supported_rule_runs_with_that_rule(registry):
    registry.put_camera(CAM)
    registry.put_rule(RULE)
    runner = registry.runner('CAM-1')
    assert [r['id'] for r in runner.rules] == ['R-1']


def test_only_the_intrusion_condition_runs_for_real(registry):
    registry.put_camera(CAM)
    registry.put_rule(dict(RULE, id='R-2', condition='no-ppe'))
    registry.put_rule(dict(RULE, id='R-3', subject='vehicle'))
    assert registry.runner('CAM-1').rules == []


def test_an_unchanged_camera_is_not_restarted_by_a_sync(registry):
    registry.put_camera(CAM)
    registry.put_rule(RULE)
    first = registry.runner('CAM-1')
    assert registry.sync([CAM], [RULE]) == []
    assert registry.runner('CAM-1') is first and not first.stopped


def test_a_sync_never_removes_what_another_console_added(registry):
    other = dict(CAM, id='PER-11', source=dict(kind='link', url='https://example.com/stream.m3u8'))
    registry.put_camera(other)
    registry.put_rule(dict(RULE, id='R-9', cameraIds=['PER-11']))
    assert registry.sync([CAM], [RULE]) == []
    assert set(registry.cameras) == {'PER-11', 'CAM-1'} and set(registry.rules) == {'R-9', 'R-1'}
    assert registry.runner('PER-11') is not None and not registry.runner('PER-11').stopped


def test_changing_a_rule_restarts_the_camera_and_removing_it_stops_detection(registry):
    registry.put_camera(CAM)
    registry.put_rule(RULE)
    first = registry.runner('CAM-1')
    registry.put_rule(dict(RULE, durationSec=10))
    assert first.stopped and registry.runner('CAM-1').rules[0]['durationSec'] == 10
    registry.delete_rule('R-1')
    assert registry.runner('CAM-1').rules == []


def test_deleting_a_camera_stops_its_runner(registry):
    registry.put_camera(CAM)
    runner = registry.runner('CAM-1')
    registry.delete_camera('CAM-1')
    assert runner.stopped and registry.runner('CAM-1') is None


def test_bad_input_is_rejected_with_a_message(registry):
    with pytest.raises(reg.Invalid):
        registry.put_camera(dict(CAM, id='../x'))
    with pytest.raises(reg.Invalid):
        registry.put_camera(dict(CAM, source=dict(kind='link', url='/etc/passwd')))
    with pytest.raises(reg.Invalid):
        registry.put_rule(dict(RULE, minConfidence=1.7))
    with pytest.raises(reg.Invalid):
        registry.put_camera(dict(CAM, zones=[dict(id='Z', points='nope')]))


def test_the_password_the_page_does_not_keep_is_remembered_but_never_saved(registry, tmp_path):
    cam = dict(CAM, source=dict(kind='link', url='rtsp://10.0.0.5/s1', user='svc', password='pw'))
    registry.put_camera(cam)
    registry.put_camera(dict(cam, source=dict(kind='link', url='rtsp://10.0.0.5/s1', user='svc')))
    assert registry.cameras['CAM-1']['source'].password == 'pw'
    assert 'pw' not in (tmp_path / 'state.json').read_text()


def test_state_survives_a_restart(registry, tmp_path, monkeypatch):
    registry.put_camera(CAM)
    registry.put_rule(RULE)
    again = reg.Registry()
    again.load()
    assert set(again.cameras) == {'CAM-1'} and set(again.rules) == {'R-1'}


def test_events_get_a_sequence_number_and_a_snapshot_address(registry):
    registry.emit(dict(id='EV-aaaaaaaa'))
    registry.emit(dict(id='EV-bbbbbbbb'))
    found, latest = registry.events_since(1)
    assert [e['id'] for e in found] == ['EV-bbbbbbbb'] and latest == 2
    assert found[0]['snapshot'] == '/api/snapshots/EV-bbbbbbbb.jpg'


def test_alert_events_serialise_to_json(tmp_path, monkeypatch):
    """Boxes come from numpy track rows; an np.float32 in an event once made /api/events fail with a 500."""
    import json

    import numpy as np

    monkeypatch.setattr(config, 'SNAPSHOTS', tmp_path)

    from qavach.camera_runner import CameraRunner

    events = []
    runner = CameraRunner.__new__(CameraRunner)
    runner.camera, runner.stats, runner.emit = dict(id='CAM-1'), dict(alerts=0), events.append
    track = np.array([[100, 200, 140, 300, 7, 0.9, 0, 0]], dtype='<f4')[0]
    rows = [(int(track[4]), float(track[0]), float(track[1]), float(track[2]), float(track[3]), float(track[5]))]
    runner._alert(np.zeros((720, 1280, 3), dtype=np.uint8), rows, dict(id='R-1', mode='live'),
                  dict(id=7, zone_id='Z1', zone_name='Grid', confidence=0.9, dwell=1.2, frames=5, reentry=False, moved=22.5), 1280, 720)
    json.dumps(events[0])


def test_the_live_reader_releases_its_own_capture_only_after_its_last_read():
    """Releasing a capture while another thread is inside read() crashed the whole service (SIGBUS in FFmpeg)."""
    import threading
    import time

    import numpy as np

    from qavach.camera_runner import LiveReader

    log = []
    in_read = threading.Event()

    class Capture:
        def read(self):
            log.append('read-start')
            in_read.set()
            time.sleep(0.2)
            log.append('read-end')
            return True, np.zeros((2, 2, 3), dtype=np.uint8)

        def release(self):
            log.append('release')

    reader = LiveReader(Capture(), 25.0)
    reader.start()
    in_read.wait(1)
    reader.stop_flag.set()
    reader.join(2)
    assert log[-1] == 'release' and log.index('release') > log.index('read-end')


def test_a_burst_of_frames_is_sampled_evenly_in_stream_time_not_collapsed_to_the_last_one():
    """A live stream delivering 150 frames at once, then nothing, used to yield one processed frame per burst."""
    import numpy as np

    from qavach.camera_runner import LiveReader

    class Never:
        def read(self):
            raise AssertionError('not started')

        def release(self):
            pass

    reader = LiveReader(Never(), 30.0)
    frame = np.zeros((4, 4, 3), dtype=np.uint8)
    import cv2
    data = cv2.imencode('.jpg', frame)[1].tobytes()
    for i in range(150):
        reader.buffer.append((i, data))
    reader.count = 150
    taken, wanted = [], 0
    while (got := reader.take(wanted)) is not None:
        taken.append(got[0])
        wanted = got[0] + 3                         # the detector needs about 100 ms per frame: skip 3 at 30 fps
    assert taken[:4] == [0, 3, 6, 9] and len(taken) == 50
    assert LiveReader(Never(), 30.0).take(0) is None
    reader.buffer.clear()
    reader.buffer.append((140, data))
    assert reader.take(10)[0] == 140                # a wanted frame that fell out of the buffer gives the oldest left


def test_the_movement_setting_travels_from_the_page_to_the_rule(registry):
    from qavach.camera_runner import intrusion_rule
    assert intrusion_rule(dict(RULE, minMovePx=40)).min_motion_px == 40
    assert intrusion_rule(dict(RULE, minMovePx=0)).min_motion_px == 0
    assert intrusion_rule({k: v for k, v in RULE.items() if k != 'minMovePx'}).min_motion_px == 10      # old rules get it too
    registry.put_camera(CAM)
    registry.put_rule(dict(RULE, minMovePx=40))
    assert registry.runner('CAM-1').rules[0]['minMovePx'] == 40
    with pytest.raises(reg.Invalid):
        registry.put_rule(dict(RULE, minMovePx=-5))
