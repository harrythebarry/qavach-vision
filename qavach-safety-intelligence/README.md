# Qavach Safety Intelligence · CCTV prototype

A clickable prototype of the CCTV module for Qavach. It is the general version of the GFSA console in `../gfsa-cctv-web`, built around the four modules agreed on the 30 Oct 2026 call:

1. **Cameras and zones.** Add a camera, then the safety admin draws its zones by hand: walkways, deck and quay edges, exclusion areas, lines to cross. Nothing is detected automatically.
2. **Rules.** Pick cameras and zones, say what to look for and for how long, and set the alert level. Example: *alert me when a person moves away from the deck walkway for at least 5 seconds.* Rules can be typed in plain words; QAI drafts the fields in blue and a person checks them before saving.
3. **Video wall.** Each team watches its own wall, so no single person looks at all ~100 cameras. High-operational areas are pinned (70% by default) and the rest roll (30%). An alert takes over a tile until someone acknowledges it. A wall can also auto-pin the busiest camera.
4. **Alerts and notifications.** Each alert level (P1 to P4) sets the channels, who is told first, how long they have to acknowledge, and who it escalates to. Supervisors acknowledge on the phone, and the alert becomes an incident, near miss or observation in Qavach.

It runs entirely in the browser on sample data for a fictional container terminal (96 cameras, 8 areas, 3 teams). A live engine raises a new alert about every minute and follows the notification rules, escalating if nobody acknowledges in time. Everything you change is saved in the browser.

## Run it

```bash
npm install
npm run dev            # http://localhost:5175
npm run build:single   # one file to email: dist/qavach-safety-intelligence.html
```

The single HTML file opens straight from disk with no server. Fonts load from Google Fonts when online and fall back to system fonts offline.

## Run it with Docker (no installs)

For anyone who just wants to use the site: Docker Desktop is the only thing needed. The image contains the console, the detection service, CPU PyTorch, the YOLO11s and OSNet weights, BoxMOT and yt-dlp.

```bash
git clone -b intrusion-end-to-end https://github.com/ShravaniAWanjari/qavach-vision.git
cd qavach-vision
./start.sh                  # Windows: double-click start.cmd, or run it in a terminal
```

It picks a free port (8830, or the next one if that is taken), starts everything and prints the address, for example `Ready. Open:  http://localhost:8830`. The choice is remembered in `.env`, so the address stays the same next time. The first start builds the image (about 5 GB on disk; it took about 8 minutes on a fast connection); after that it starts in a few seconds. The page is served by the same container, so there is nothing else to start. (Once the pull request is merged, clone the `qavach-safety-intelligence` branch of `harrythebarry/qavach-vision` instead.)

`docker compose up -d` also works on its own while port 8830 is free; if it is not, Docker says "address already in use", and `./start.sh` is the fix.

```bash
docker compose logs -f      # what the service is doing
docker compose down         # stop (cameras, rules, uploads and alert pictures are kept)
docker compose down -v      # stop and forget everything
docker compose build --no-cache && ./start.sh     # pick up a newer yt-dlp if YouTube links stop working
```

- **Needs:** Docker Desktop with at least 6 GB of memory and about 10 GB of free disk. The port is published to this PC only. To choose the port yourself, set `QAVACH_PORT=9000` in `.env` before running `./start.sh`.
- **Speed:** Docker on Windows and macOS cannot use the GPU, so detection runs on the CPU. On an Apple-silicon Mac the detector took about 0.13 s per frame at the default size (about 7 frames a second per camera, measured outside Docker); expect slower on an ordinary PC. Lower `QAVACH_DETECT_SIZE` (for example `960`) under `environment:` in `docker-compose.yml` to trade accuracy on small, distant people for speed.
- **Sources:** YouTube links, `rtsp://` / http / HLS addresses and uploaded videos all work from inside the container. A camera on the PC's own network is reachable by its address; a webcam is not.
- **Licence:** Ultralytics (YOLO11) is AGPL-3.0; check that before anything beyond a demo.

## Real cameras and real detection, without Docker

The sample data above needs nothing else. To run a **real** camera and the **intrusion** rule end to end, also start the detection service in `backend/`:

```bash
cd backend && ./run.sh        # http://127.0.0.1:8830, then reload the console: the top bar says "Detection on"
```

It uses the Python environment and BoxMOT tracker of the `port-safety/barge-intrusion` project, and the weights in `backend/weights/` (override with `QAVACH_PYTHON`, `QAVACH_YOLO_WEIGHTS`, `QAVACH_REID_WEIGHTS`, `QAVACH_TRACKER_PYTHON`; see `backend/qavach/config.py`).

The flow, as the safety admin:

1. **Cameras → Add camera → Connect.** Choose *Live link or address* (a YouTube live link such as `https://www.youtube.com/live/QO-hO_kwwmY`, or an `rtsp://` / http / HLS address, with a user name and password for RTSP) or *Upload a video*. **Test connection** reads one real frame from the source.
2. **Draw zones.** The zone editor now draws on that real frame. Nothing is pre-drawn. Detection only runs inside the zones.
3. **Rules → New rule.** Pick the camera and zone, *A person* *enters*, and set *For at least*, **Frames in a row**, **Detector at least (%) sure**, **Don't repeat for** and **Must have moved (pixels)**. *Test* mode logs matches on the rule page without telling anyone; *Live* raises alerts.
4. **Alerts.** Detections arrive as ordinary alerts with the snapshot, zone and box, and follow the notification policy for their level (who is told, escalation, Qavach record).

How a person triggers an alert: the bottom centre of their box (their feet) is inside a zone for the whole *For at least* time and for the *frames in a row*, the track has had one detection at least as sure as the setting, and its feet have moved at least *Must have moved (pixels)*. After an alert the same tracked person raises no new one for *Don't repeat for*. They count as having left after 2 s outside every zone. Frames are the frames the detector actually analysed (about 10 a second on a live feed on this Mac), and seconds are video seconds.

**Why "must have moved".** A fixed object that the detector sometimes calls a person (a flag pole, a lamp post with signs, a bollard) gets a track, and when traffic passes and the detector flickers, that track would alert. On the ferry camera, one such pole was tracked as a person for 200 seconds and its feet moved 3 pixels in total; workers walking moved 19 to 142. A track counts as moving once its feet are at least that many pixels away from where they were a few seconds earlier (the same test as `WalkingFilter` in `barge-intrusion/src/motion_filter.py`); after that it stays confirmed, so someone who walks in and then stands still still alerts. A track that has sat within 20 pixels of one spot for 8 seconds is held to a higher bar: it only counts as moving once it leaves that spot by 20 pixels (scaled with the frame), because a board that the detector called a person for five minutes and then shifted 13 pixels would otherwise pass a small setting for good. A sudden jump of the foot point (the id latching onto a passing vehicle or another person) is not counted as movement. Pixels are in the camera's own frame: raise the number on a 4K camera and lower it on a small one. The default is 10 pixels.

Choosing the number, from a replay of 247 seconds of the live ferry camera (rule: 3 s, 12 % sure, tracks recorded in the parking grid):

| Must have moved | Tracks that alert |
|---|---|
| 0 (off) | 7: the pole, 2 workers who were walking, and 4 workers standing still |
| 5 px | 4: the walkers and 2 of the standing workers; the pole (3 px) is blocked |
| **10 px (default)** | 3: the walkers and a pair of workers shifting their feet; the pole is blocked |
| 15 px | 2: only the walkers |
| 25 px | none, not even a worker who walked 22 px |

The pole moved 3 px in the whole recording; workers standing about moved 5 to 12 px; walkers 22 to 47 px. A movement check cannot tell a person standing perfectly still from a fixed object, so **someone who stands still without ever moving more than the setting will not alert**, and a walker who mostly stands may alert late (one worker was confirmed after 99 s). That is the price of ignoring the pole; raise the number to be stricter, lower it to catch people who barely move, or **set 0 to turn the check off**, which lets someone who was already standing still when the camera first saw them alert, and also lets a pole through. The camera preview draws tracks in a zone that have not moved yet with a thin, light box and no label.

Things to know:

- **Only "a person enters the zone" runs for real.** The other conditions in the rule editor (no PPE, crowd, smoke, vehicle stopped, outside, line crossing) stay demo-only, and the editor says so on real cameras. The sample cameras and their rules still run on the simulator; real cameras never do.
- **Pictures on the wall and elsewhere follow the camera.** A live view (wall tiles, the click-through view, "Live now") plays the service's live preview, with boxes on the people it sees. Still thumbnails (Cameras list, busy walls, rule preview) fetch a fresh frame every few seconds. Only the zone editor and the connection test keep the frame taken at connection, so zones can be drawn on a steady picture, and an alert opened as a snapshot shows the moment it was raised.
- **An uploaded video plays in real time and starts over when it ends**, with fresh tracking, like a camera that is always on. Use it when the live feed has nothing happening. It also takes about 40 s for a clip of that length to show its first alert.
- **The ferry camera shows pedestrians about 20 px tall**, so detections near the 25 % default are borderline and can change with a few pixels of zone or crop. Lower *Detector at least (%) sure* to see more; raise it to see fewer. A rule with no zone watches the whole view and is noisy on a busy camera.
- **A live YouTube feed arrives in bursts** (about 5 seconds of video at once) and is behind real time by the stream's own delay, so alert times are video time, not wall-clock time.
- **Passwords** for stream cameras are typed once, kept by the console in memory and by the service in memory, and never saved. After a service restart an RTSP camera needs its password again (re-test it in the camera editor).
- **One console per service.** A console adds and updates its cameras and rules on the service when it connects and removes only what it deletes itself (removals made while the service was down are sent when it is back). It never removes anyone else's, so a second console (another browser, or `localhost` and `127.0.0.1`, which keep separate data) does not wipe the first one's cameras, but cameras and rules share one namespace on the service, so two consoles using the same ids (`DCK-09`, `R-12`) overwrite each other. Give a second console its own service: `./run.sh --port 8831` (with its own `QAVACH_DATA` folder) and `QAVACH_BACKEND=http://127.0.0.1:8831 npm run dev -- --port 5176`.
- The service keeps cameras and rules in `backend/data/state.json`. `backend/data/` is git-ignored.
- `npm run build:single` still opens from disk; the real-camera features need the service on `http://127.0.0.1:8830`, otherwise the top bar says "Detection offline" and the sample flow is used.

Back-end tests: `backend/run.sh` uses the same Python; run `"$QAVACH_PYTHON" -m pytest backend/tests`.

## Five-minute demo

1. **Overview.** The flow from camera to Qavach record, with live numbers.
2. **Video wall → Quay and deck.** Show the 70/30 split, then change it to 80/20 or *All rolling*. Change the pinned grid and the rotation time. Use **Choose cameras** to drag a camera onto a pinned slot. When an alert arrives (about once a minute), it takes over a tile. Press **Acknowledge** and the QAI-drafted Qavach incident is in the same dialog.
3. **Phone** (in the dock). This is what the shift supervisor sees. Acknowledge an alert and report it to Qavach.
4. **Alerts.** Open an alert to show the snapshot with its zone and detection box, the rule that fired, who was told on which channel, the escalation countdown and the Qavach record.
5. **Cameras → Add camera.** Test the connection, then draw an area and a line on the picture.
6. **Rules → New rule.** Click an example sentence and show what QAI understood, what it assumed and the blue fields. Use *Try it on the last 24 hours*.
7. **Notify.** Change P2's acknowledgement time or escalation and show the timeline preview underneath.

To try another role, use the profile menu (bottom of the dock). Operators only see their own team's walls, and only the safety admin can change set-up. **Reset sample data** starts over, and the live clock in the top bar pauses or resumes new alerts.

## Code layout

```
src/
  App.tsx               hash routes (so the single file works from disk)
  components/           Shell (dock, top bar, notifications), ui (CameraView, badges, modal…), AlertDialogs, Icon
  scenes/               drawn camera scenes with moving workers and vehicles, and their default zones
  data/                 types and sample data (site, cameras, rules, walls, policies, alerts)
  state/store.ts        shared stores and actions, saved to localStorage
  state/engine.ts       stands in for the event and notification services
  state/bridge.ts       connects to the detection service in backend/ and turns its detections into alerts
  lib/backend.ts        client for the detection service
  lib/qai.ts            stand-in for QAI: plain words → rule draft, alert → Qavach record draft
  pages/                overview, wall, alerts, cameras (zone editor), rules, notifications, phone
```

The look follows the Qavach AI-native design tokens (Instrument Sans, navy dock, blue for anything QAI drafted).

## Mocked here

- **Video:** the sample cameras show drawn scenes, with simulated detection boxes. Real cameras (a link or an uploaded video, see above) show real pictures with real detections.
- **Alerts and escalation:** the sample alerts are produced by `state/engine.ts`; alerts for real cameras come from the detection service (`state/bridge.ts`). Escalation, reminders and notification delivery are still simulated for both. In production they come from the edge units and the notification service.
- **Messages:** SMS, WhatsApp, calls and push notifications are recorded with a delivery state, but nothing is actually sent.
- **QAI:** rule drafting and record drafting run in the browser with simple rules. In production they call the QAI service.
- **Qavach records:** raising one shows a reference number but does not call the Qavach API.
