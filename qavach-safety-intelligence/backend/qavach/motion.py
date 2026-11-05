"""Has a tracked "person" really moved? A static object the detector sometimes labels as a person (a flag pole, a
light, a bollard, a reflection) keeps almost the same foot point however long it is tracked, and a rule that alerts
on "a person is in the zone" would flag it every time a vehicle passes and makes the detector flicker. A person who
walks does not stay put. This is the same test as `WalkingFilter` in the port-safety project (barge-intrusion,
src/motion_filter.py): a track is confirmed as moving once its foot point has been at least `min_pixels` away from
where it was earlier in a short window, and it stays confirmed after that, so someone who walks into a zone and
then stands still is still a person.

A track that has sat still for a while is held to a higher bar. A board or pole that the detector keeps calling a
person stays within a few pixels for minutes, then shifts a little (a wobble of the camera, a box that changes size
as the light changes) and would pass a small threshold and be confirmed for good. So once a track has stayed within
`STATIC_MOVE_PX` of one spot for `STATIC_SECONDS`, it only counts as moving when it leaves that spot by that distance,
which a person walking does within a second or two.

A sudden jump is not movement. When a track's foot point leaps (the id has latched onto a passing vehicle or a
different person), the window starts again instead of counting the leap as walking."""
import math
from collections import deque

MIN_OBSERVATIONS = 3          # positions inside the window before it can confirm anything
JUMP_FLOOR_PX = 30.0          # a step bigger than this per frame, and faster than JUMP_SPEED_PX_S, restarts the window
JUMP_SPEED_PX_S = 300.0
STATIC_SECONDS = 8.0          # still for this long: the track is held to the higher bar
STATIC_MOVE_PX = 20.0         # ...and must leave its spot by this much (at 1280 px wide) to count as moving


class Movement:
    def __init__(self, window_seconds=4.0, scale=1.0):
        """scale is the frame width over 1280, so the jump limits mean the same thing on a 4K camera."""
        self.window, self.scale = window_seconds, scale
        self.points = deque()         # (seconds, (x, y)) inside the window
        self.moved = False
        self.most = 0.0               # the largest displacement seen inside any window, in pixels
        self.anchor = None            # (seconds, (x, y)): where the track has been sitting since it last left that spot

    def update(self, seconds, point, min_pixels):
        """Add one foot-point observation; returns whether the track counts as moving."""
        points = self.points
        point = (float(point[0]), float(point[1]))
        if points:
            gap = max(0.0, seconds - points[-1][0])
            jump = math.dist(point, points[-1][1])
            if gap > self.window or jump > max(JUMP_FLOOR_PX * self.scale, JUMP_SPEED_PX_S * self.scale * gap):
                points.clear()
                self.anchor = None
        if self.anchor is None:
            self.anchor = (seconds, point)
        points.append((seconds, point))
        while points and seconds - points[0][0] > self.window:
            points.popleft()
        anchored_for, spot = seconds - self.anchor[0], self.anchor[1]
        away = math.dist(point, spot)
        static_bar = max(min_pixels, STATIC_MOVE_PX * self.scale)
        if away >= STATIC_MOVE_PX * self.scale:
            self.anchor = (seconds, point)                  # clearly left that spot: sitting there starts again
        if len(points) >= MIN_OBSERVATIONS:
            displacement = max(math.dist(point, p) for _, p in points)
            self.most = max(self.most, displacement)
            if anchored_for >= STATIC_SECONDS:
                if away >= static_bar:
                    self.moved = True
            elif displacement >= min_pixels:
                self.moved = True
        return self.moved
