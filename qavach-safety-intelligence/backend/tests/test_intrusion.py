import numpy as np
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qavach.intrusion import DEFAULT_MOTION_PX, IntrusionRule, Rule, zones_to_pixels

W, H = 1000, 1000
ZONE = [dict(id='z1', name='Quay edge', kind='polygon', points=[[40, 40], [90, 40], [90, 90], [40, 90]])]     # % of frame
LINE = dict(id='l1', name='Hull line', kind='line', points=[[0, 0], [10, 10]])


def person(x, y, conf=0.9, h=60, w=20):
    """Box whose feet (bottom centre) are at (x, y) pixels."""
    return (7, x - w / 2, y - h, x + w / 2, y, conf)


def run(rule, frames, fps=10.0, zones=None):
    engine = IntrusionRule(zones_to_pixels(zones or ZONE, W, H), rule)
    out = []
    for i, tracks in enumerate(frames):
        _, events = engine.update(i / fps, tracks)
        out += [(round(i / fps, 2), e['type']) for e in events]
    return engine, out


INSIDE, OUTSIDE = person(600, 600), person(100, 100)


def test_zone_conversion_ignores_lines_and_scales_percent():
    zones = zones_to_pixels(ZONE + [LINE], W, H)
    assert [z.id for z in zones] == ['z1'] and zones[0].points[0].tolist() == [400, 400]


def test_alert_after_the_dwell_time_inside_the_zone():
    _, events = run(Rule(min_motion_px=0, dwell_seconds=1.0), [[INSIDE]] * 30)
    assert events == [(1.0, 'alert')]


def test_passing_through_faster_than_the_dwell_raises_nothing():
    _, events = run(Rule(min_motion_px=0, dwell_seconds=2.0), [[INSIDE]] * 10 + [[OUTSIDE]] * 20)
    assert events == []


def test_feet_decide_not_the_head():
    # head inside the polygon, feet below it
    _, events = run(Rule(min_motion_px=0, dwell_seconds=0.5), [[(7, 590, 380, 610, 920, 0.9)]] * 20)
    assert events == []


def test_low_confidence_track_never_alerts_and_a_confident_detection_unlocks_it():
    _, events = run(Rule(min_motion_px=0, dwell_seconds=0.5, min_confidence=0.5), [[person(600, 600, 0.1)]] * 20)
    assert events == []
    _, events = run(Rule(min_motion_px=0, dwell_seconds=0.5, min_confidence=0.5),
                    [[person(600, 600, 0.1)]] * 10 + [[person(600, 600, 0.8)]] * 10)
    assert [e for _, e in events] == ['alert']


def test_min_frames_holds_back_an_alert_at_zero_dwell():
    _, events = run(Rule(min_motion_px=0, dwell_seconds=0.0, min_frames=3), [[INSIDE]] * 5)
    assert events == [(0.2, 'alert')]


def test_leaving_clears_the_flag_and_returning_within_repeat_window_is_suppressed():
    rule = Rule(min_motion_px=0, dwell_seconds=0.5, repeat_seconds=60, leave_seconds=1.0)
    _, events = run(rule, [[INSIDE]] * 10 + [[OUTSIDE]] * 20 + [[INSIDE]] * 10)
    assert [e for _, e in events] == ['alert', 'left', 'suppressed']


def test_returning_after_the_repeat_window_alerts_again_as_a_reentry():
    rule = Rule(min_motion_px=0, dwell_seconds=0.5, repeat_seconds=1.0, leave_seconds=1.0)
    engine, events = run(rule, [[INSIDE]] * 10 + [[OUTSIDE]] * 20 + [[INSIDE]] * 10)
    assert [e for _, e in events] == ['alert', 'left', 'alert'] and engine.alert_count == 2


def test_two_people_are_tracked_separately():
    a, b = person(600, 600), (9, 590, 540, 610, 600, 0.9)
    engine, events = run(Rule(min_motion_px=0, dwell_seconds=0.5), [[a, b]] * 10)
    assert engine.alert_count == 2 and engine.flagged_now == [7, 9]


def test_rule_values_are_validated():
    import pytest
    with pytest.raises(ValueError):
        Rule.from_dict(dict(min_confidence=1.5))
    assert Rule.from_dict(dict(dwell_seconds=5, repeat_seconds=None)).repeat_seconds == 120.0


# ── the pixels-moved check ────────────────────────────────────────────────────────────────────────────────────────────
def walker(i, fps=10.0, speed=20.0, start=450, y=600):
    """A person walking right at `speed` pixels a second."""
    return person(start + speed * i / fps, y)


def test_a_static_object_never_alerts_when_movement_is_required_but_does_once_the_check_is_off():
    frames = [[INSIDE]] * 60
    assert run(Rule(dwell_seconds=0.5), frames)[1] == []                         # default: 10 px must be covered
    assert [e for _, e in run(Rule(dwell_seconds=0.5, min_motion_px=0), frames)[1]] == ['alert']


def test_jitter_of_a_few_pixels_is_not_movement():
    rng = np.random.default_rng(1)
    frames = [[person(600 + rng.uniform(-3, 3), 600 + rng.uniform(-3, 3))] for _ in range(80)]
    assert run(Rule(dwell_seconds=0.5), frames)[1] == []


def test_a_walker_alerts_and_the_alert_reports_how_far_they_moved():
    engine, events = run(Rule(dwell_seconds=0.5), [[walker(i)] for i in range(60)])
    assert [e for _, e in events] == ['alert']
    assert engine.alert_count == 1 and engine.state[7].move.most >= 10


def test_someone_who_walked_in_and_then_stands_still_is_still_a_person():
    walked_in = [[person(500 + 20 * i / 10, 600)] for i in range(40)]            # 4 s of walking, ends at x=580
    stands = [[person(580, 600)]] * 40
    _, events = run(Rule(dwell_seconds=0.5), walked_in + stands)
    assert [e for _, e in events] == ['alert']


def test_a_sudden_jump_of_the_foot_point_is_not_movement():
    """The id latches onto something else a long way off: a leap, not a walk. It must not confirm the track."""
    frames = [[person(500, 600)]] * 20 + [[person(900, 600)]] * 20 + [[person(500, 600)]] * 20
    assert run(Rule(dwell_seconds=0.5), frames)[1] == []


def test_a_slow_walker_is_confirmed_inside_the_movement_window():
    slow = [[walker(i, speed=6.0)] for i in range(60)]                           # 6 px/s: 10 px takes under 2 s
    assert [e for _, e in run(Rule(dwell_seconds=0.5), slow)[1]] == ['alert']
    assert run(Rule(dwell_seconds=0.5, motion_window_seconds=1.0), slow)[1] == []


def test_the_info_says_which_tracks_are_still_waiting_to_show_movement():
    engine = IntrusionRule(zones_to_pixels(ZONE, W, H), Rule(dwell_seconds=0.5))
    info = {}
    for i in range(30):
        info, _ = engine.update(i / 10.0, [INSIDE, walker(i)])
    assert info[7]['waiting'] and not info[7]['moved']
    assert info[7]['inside'] and not info[7]['flagged']


def test_the_default_matches_what_the_rule_editor_offers():
    assert Rule().min_motion_px == DEFAULT_MOTION_PX == 10.0
    assert Rule.from_dict(dict(min_motion_px=None)).min_motion_px == DEFAULT_MOTION_PX


def test_movement_settings_are_validated():
    import pytest
    for bad in (dict(min_motion_px=-1), dict(motion_window_seconds=0)):
        with pytest.raises(ValueError):
            Rule.from_dict(bad)


def test_tracks_that_vanished_long_ago_are_forgotten():
    engine = IntrusionRule(zones_to_pixels(ZONE, W, H), Rule(min_motion_px=0))
    engine.update(0.0, [(9, 100, 100, 120, 160, 0.9)])       # a track that is then never seen again
    assert set(engine.state) == {9}
    engine.update(100.0, [INSIDE])                           # 100 s later only track 7 is around
    assert set(engine.state) == {7}
