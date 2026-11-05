"""The back-end's picture of the site: which cameras exist, which rules apply to them, which camera runners are
active, and the alert events they raised. Consoles push their cameras and rules here (adding and updating, and
deleting only what they explicitly delete); this module keeps the runners in step with what it was last told."""
import json
import re
import threading
import uuid

from qavach import config, sources
from qavach.camera_runner import CameraRunner, intrusion_rule

ID = re.compile(r'^[A-Za-z0-9_-]{1,48}$')


class Invalid(ValueError):
    """The page sent something this service cannot use; the message is shown to the user as is."""


def supported(rule):
    """Rules the back-end runs for real. The rule editor offers more conditions (PPE, smoke, crowd...); those stay
    demo-only for now."""
    return rule.get('condition') == 'enters' and rule.get('subject', 'person') in ('person', 'any') \
        and rule.get('mode', 'test') in ('test', 'live')


def clean_zone(z):
    try:
        points = [[max(0.0, min(100.0, float(x))), max(0.0, min(100.0, float(y)))] for x, y in z['points']]
        return dict(id=str(z['id'])[:80], name=str(z.get('name') or z['id'])[:80], purpose=str(z.get('purpose', 'restricted')),
                    kind='line' if z.get('kind') == 'line' else 'polygon', points=points)
    except (KeyError, TypeError, ValueError) as error:
        raise Invalid('A zone is malformed') from error


class Registry:
    def __init__(self):
        self.lock = threading.RLock()
        self.cameras, self.rules, self.runners = {}, {}, {}
        self.events, self.seq, self.epoch = [], 0, uuid.uuid4().hex[:8]
        self._detector = None
        # Runner threads emit events and ask for the detector while a request holds `lock` and waits for them to stop,
        # so those two use locks of their own.
        self.events_lock = threading.Lock()
        self.detector_lock = threading.Lock()

    # ── the shared detector, loaded on first use because it takes a few seconds ──────────────────────────────────
    def get_detector(self):
        with self.detector_lock:
            if self._detector is None:
                from qavach.detector import Detector
                self._detector = Detector()
            return self._detector

    @property
    def detector_loaded(self):
        return self._detector is not None

    # ── events ───────────────────────────────────────────────────────────────────────────────────────────────────
    def emit(self, event):
        with self.events_lock:
            self.seq += 1
            event['seq'] = self.seq
            event['snapshot'] = f'/api/snapshots/{event["id"]}.jpg'
            self.events.append(event)
            del self.events[:-config.MAX_EVENTS]

    def events_since(self, since):
        with self.events_lock:
            return [e for e in self.events if e['seq'] > since], self.seq

    # ── cameras and rules ────────────────────────────────────────────────────────────────────────────────────────
    def put_camera(self, data, persist=True):
        try:
            cam_id = str(data['id'])
        except (KeyError, TypeError) as error:
            raise Invalid('A camera needs an id') from error
        if not ID.match(cam_id):
            raise Invalid('Camera ids use letters, digits, - and _')
        try:
            source = sources.source_from_dict(data.get('source'))
        except sources.SourceError as error:
            raise Invalid(str(error)) from error
        zones = [clean_zone(z) for z in (data.get('zones') or [])]
        with self.lock:
            old = self.cameras.get(cam_id)
            if old and source.kind != 'upload' and not source.password and old['source'].kind == source.kind \
                    and old['source'].url == source.url and old['source'].user == source.user:
                source.password = old['source'].password           # the page never stores the password; keep ours
            self.cameras[cam_id] = dict(id=cam_id, name=str(data.get('name') or cam_id)[:80], source=source, zones=zones)
            self.reconcile([cam_id])
            if persist:
                self.save()

    def delete_camera(self, cam_id):
        with self.lock:
            self.cameras.pop(cam_id, None)
            self.reconcile([cam_id])
            self.save()

    def put_rule(self, data, persist=True):
        rule_id = str(data.get('id') or '')
        if not ID.match(rule_id):
            raise Invalid('A rule needs an id')
        try:
            intrusion_rule(data)
        except (ValueError, TypeError) as error:
            raise Invalid(f'The rule settings are out of range: {error}') from error
        rule = {k: data.get(k) for k in ('id', 'name', 'cameraIds', 'zoneIds', 'subject', 'condition', 'durationSec',
                                         'minFrames', 'minConfidence', 'repeatSec', 'minMovePx', 'schedule', 'mode', 'priority')}
        rule['cameraIds'] = [str(c) for c in (rule['cameraIds'] or [])]
        rule['zoneIds'] = [str(z) for z in (rule['zoneIds'] or [])]
        with self.lock:
            touched = set(rule['cameraIds']) | set((self.rules.get(rule_id) or {}).get('cameraIds') or [])
            self.rules[rule_id] = rule
            self.reconcile(touched)
            if persist:
                self.save()

    def delete_rule(self, rule_id):
        with self.lock:
            old = self.rules.pop(rule_id, None)
            self.reconcile(set((old or {}).get('cameraIds') or []))
            self.save()

    def sync(self, cameras, rules):
        """Add or update the cameras and rules a console sends. It never removes any: a console deletes its own
        cameras and rules explicitly, and two consoles (another browser, another address) can share one service
        without wiping each other. Unchanged cameras keep running."""
        problems = []
        with self.lock:
            for rule in rules:
                try:
                    self.put_rule(rule, persist=False)
                except Invalid as error:
                    problems.append(f'{rule.get("id")}: {error}')
            for camera in cameras:
                try:
                    self.put_camera(camera, persist=False)
                except Invalid as error:
                    problems.append(f'{camera.get("id")}: {error}')
            self.save()
            return problems

    # ── runners ──────────────────────────────────────────────────────────────────────────────────────────────────
    def rules_for(self, cam_id):
        return [r for r in self.rules.values() if supported(r) and cam_id in (r.get('cameraIds') or [])]

    def reconcile(self, cam_ids):
        """Start, restart or stop camera runners so they match the cameras and rules. A runner is restarted only
        when something it depends on changed."""
        for cam_id in list(cam_ids):
            camera = self.cameras.get(cam_id)
            current = self.runners.get(cam_id)
            if camera is None:
                if current:
                    current[1].stop()
                    del self.runners[cam_id]
                continue
            rules = self.rules_for(cam_id)
            source = camera['source']
            signature = json.dumps([source.kind, source.url, source.upload_id, source.user, source.password,
                                    camera['zones'], rules], sort_keys=True, default=str)
            if current and current[0] == signature:
                continue
            if current:
                current[1].stop()
            self.runners[cam_id] = (signature, CameraRunner(camera, rules, self.get_detector, self.emit))

    def runner(self, cam_id):
        with self.lock:
            entry = self.runners.get(cam_id)
            return entry[1] if entry else None

    def statuses(self):
        with self.lock:
            out = {}
            for cam_id, (_, runner) in self.runners.items():
                out[cam_id] = dict(state=runner.state, error=runner.error, rules=len(runner.rules), **runner.stats)
            return out

    # ── persistence ──────────────────────────────────────────────────────────────────────────────────────────────
    def save(self):
        with self.lock:
            cameras = [dict(id=c['id'], name=c['name'], zones=c['zones'],
                            source=dict(kind='upload' if c['source'].kind == 'upload' else 'link', url=c['source'].url,
                                        uploadId=c['source'].upload_id, user=c['source'].user))
                       for c in self.cameras.values()]
            config.DATA.mkdir(parents=True, exist_ok=True)
            tmp = config.STATE_FILE.with_suffix('.tmp')
            tmp.write_text(json.dumps(dict(cameras=cameras, rules=list(self.rules.values())), indent=1))
            tmp.replace(config.STATE_FILE)

    def load(self):
        if not config.STATE_FILE.exists():
            return
        data = json.loads(config.STATE_FILE.read_text())
        problems = self.sync(data.get('cameras', []), data.get('rules', []))
        for problem in problems:
            print(f'state file: {problem}', flush=True)

    def shutdown(self):
        with self.lock:
            for _, runner in self.runners.values():
                runner.stop()
            self.runners.clear()
