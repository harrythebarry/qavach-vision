from qavach.motion import Movement


def feed(movement, points, fps=10.0, min_pixels=15.0):
    return [movement.update(i / fps, p, min_pixels) for i, p in enumerate(points)]


def test_a_track_that_stays_put_is_never_confirmed():
    assert not any(feed(Movement(), [(300.0, 400.0)] * 100))


def test_a_walking_track_is_confirmed_and_stays_confirmed_after_it_stops():
    path = [(300.0 + 5 * i, 400.0) for i in range(10)] + [(350.0, 400.0)] * 50
    result = feed(Movement(), path)
    assert not result[0] and result[9] and result[-1]


def test_a_leap_restarts_the_window_instead_of_counting_as_movement():
    path = [(300.0, 400.0)] * 10 + [(800.0, 400.0)] * 10
    assert not any(feed(Movement(), path))


def test_a_long_gap_without_observations_restarts_the_window():
    movement = Movement(window_seconds=4.0)
    for i in range(5):
        movement.update(i * 0.1, (300.0, 400.0), 15.0)
    assert not movement.update(30.0, (340.0, 400.0), 15.0)           # 40 px away, but nothing to compare it with
    assert movement.most < 15


def test_the_jump_limit_scales_with_the_frame():
    # 40 px in one 0.1 s step: a leap on a 1280 px wide frame, an ordinary stride on a 4K one
    assert not Movement(scale=1.0).update(0.0, (300.0, 400.0), 15.0)
    big = Movement(scale=3.0)
    big.update(0.0, (300.0, 400.0), 15.0)
    big.update(0.1, (340.0, 400.0), 15.0)
    assert len(big.points) == 2


def test_a_track_that_sat_still_for_minutes_is_not_confirmed_by_a_small_shift():
    # a board labelled as a person: still for 60 s, then its box shifts 13 px and stays there
    path = [(300.0, 400.0)] * 600 + [(313.0, 400.0)] * 100
    assert not any(feed(Movement(), path, min_pixels=6.0))


def test_a_track_that_sat_still_then_walks_off_is_confirmed():
    path = [(300.0, 400.0)] * 100 + [(300.0 + 4 * i, 400.0) for i in range(1, 20)]
    result = feed(Movement(), path, min_pixels=6.0)
    assert not result[99] and result[-1]


def test_a_small_shift_early_in_a_track_still_counts():
    path = [(300.0, 400.0)] * 5 + [(300.0 + 3 * i, 400.0) for i in range(1, 6)]
    assert feed(Movement(), path, min_pixels=6.0)[-1]


def test_the_still_bar_scales_with_the_frame():
    path = [(300.0, 400.0)] * 100 + [(330.0, 400.0)] * 20          # 30 px: past 20 on 1280 wide, short of 60 on 2560
    assert feed(Movement(scale=1.0), path, min_pixels=6.0)[-1]
    assert not any(feed(Movement(scale=3.0), path, min_pixels=6.0)[50:])
