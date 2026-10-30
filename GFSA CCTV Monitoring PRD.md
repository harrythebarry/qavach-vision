# GFSA CCTV Monitoring PRD

Oct 16, 2026 · @Srihari

## Summary

CCTV Monitoring turns the cameras already on GFSA's tugs and barges into a fleet safety and operations service, proven first on one convoy in a 12-week pilot.

An AI unit on each vessel watches the existing camera feeds and raises events on board. Urgent alarms reach the wheelhouse within 5 seconds, with or without a shore link. Events and 15-second clips follow to shore, where a console routes alarms, records reviews and ties every event to the voyage in Connect.

- **Who it serves:** shore duty officers and operations managers, masters in the wheelhouse, safety administrators and reviewers, and GFSA management.
- **What ships:** one subscription product with two modules. The operations center covers alarms, review, voyages, configuration, reports and administration; the video wall gives live viewing within each convoy's bandwidth budget.
- **Pilot:** one convoy (one tug, one barge) for 12 weeks on the proposed pilot use cases. Alerts stay off until a 14-day shadow run meets the agreed false-alert limit.
- **Success:** at least 90% precision and 85% recall per use case, 2 or fewer false alerts per camera per day, urgent alerts in the wheelhouse within 5 s and ashore within 60 s when the link is up.
- **Design reference:** every screen named in this PRD is drawn on the [CCTV Monitoring design canvas](https://claude.ai/artifact/WyVtvhAezNmDVAKX8coFmo), with sample data.

The decisions GFSA still needs to make before build are listed under Risks, dependencies and open questions.

## Background and problem

GFSA asked for real-time monitoring of the cameras on its barges, with any issue logged and communicated automatically. The cameras exist, but the river link is weak and intermittent, so streaming every feed ashore for people to watch cannot work.

Three constraints shape the product:

- **Connectivity:** convoys run on 4G or satellite with gaps between coverage areas. The product must work offline and send only events, thumbnails and short clips.
- **Operation:** voyages, convoy make-up, schedules and cargo lists live in Connect, GFSA's operational system. Checks must follow that plan and write their results back to it.
- **Trust:** an alert is only useful if the right person acts within minutes. Crews and shore staff stop trusting a system that raises false alerts.

No supplier sells this for pushed river convoys. The closest product, ShipIn FleetVision, runs AI on a ship's existing cameras, alerts on board first and forwards clips when the link allows. CCTV Monitoring takes the same edge-first approach and adds the Connect link and river-specific use cases (sources in the Appendix).

The product follows seven design rules from the solution design:

1. Use the cameras GFSA already has. Add cameras only where a use case needs a view that does not exist, such as thermal for night overboard detection.
2. Process on board, send events ashore. Full video stays on the vessel.
3. Keep working when the link drops. Events and clips wait on board and go ashore when coverage returns.
4. One pipeline for every use case. A use case is configuration (model, zones, schedule, rule), not a new build.
5. Humans confirm. Reviewers accept or reject each event, and every decision feeds model improvement.
6. Built around GFSA's operation. Schedules, voyages and cargo lists come from Connect.
7. Behaviours, not identities. The system detects acts and conditions; it does not recognise faces or identify crew.

## Goals, non-goals and success metrics

The pilot succeeds when every pilot use case meets 90% precision and 85% recall with 2 or fewer false alerts per camera per day, and urgent alerts land in the wheelhouse within 5 seconds.

**Goals**

1. Detect safety and operational events on GFSA's existing cameras, on board, as they happen.
2. Get each urgent alarm to the right person on board and ashore, and escalate when nobody acknowledges.
3. Keep a reviewed, auditable record of every event, tied to its voyage in Connect.
4. Make a new use case a matter of configuration, not a new build.
5. Lose no event when the river link drops.

**Success metrics**

All targets are proposed in the solution design and still need GFSA's agreement.

| Measure | Target | How it is measured |
| --- | --- | --- |
| Precision per use case | 90% or more | Accepted events over all events, on reviewed events |
| Recall per use case | 85% or more | Held-out GFSA clips, re-checked on reviewed events |
| False alerts | 2 or fewer per camera per day | After the 14-day shadow run, per use case |
| Wheelhouse alert time | 5 s or less | Detection to display on the wheelhouse screen |
| Shore alert time | 60 s or less when the link is up | Detection to message sent to the first recipient |
| Reefer rounds | Every round checked | Each scheduled round in Connect matched against video |
| Camera uptime | Reported daily for every camera | Scene checks and health messages per camera |
| Time to acknowledge | Median 5 min or less (proposed in the design) | Alarm raised to acknowledged ashore, 7-day median |

**Non-goals**

- No face recognition and no identification of crew members.
- No continuous video streaming ashore. Full video stays on the vessel recorders; the product does not replace them.
- No automatic actions in the pilot. The "record and act" level, such as stopping-distance warnings or tasks raised in Connect, opens only after the pilot proves accuracy.
- No navigation decisions. Obstacle detection is advisory and listed, not an alarm, in the first phase.
- Person overboard and person down on deck stay off until thermal cameras or consented drill footage exist. Watchkeeper drowsiness stays out of the pilot for lack of a commercial dataset.

## Users and roles

Seven roles use the product, and permissions follow the role, not the person. Roles come from the GFSA directory through single sign-on, every shore role signs in with a second factor, and every view and download is logged.

| Role | Where they work | What they need | Main rights |
| --- | --- | --- | --- |
| Duty officer | Shore operations, 24-hour rota | See every open alarm at once, act within minutes, call the wheelhouse | Acknowledge, assign, classify, live view |
| Operations manager | Shore | The P2 escalation after 5 minutes, daily and voyage reports | Acknowledge, close alarms, export clips |
| Fleet superintendent | Shore | The P2 escalation after 15 minutes, the fleet view and weekly report | Acknowledge, export clips |
| Safety administrator | Shore, configuration | Set up use cases, zones and routing; ship model updates; watch accuracy | Edit use cases and zones, push models, classify, export clips |
| Reviewer | Shore | Work the review queue fast and label false alerts | Classify events, view and export clips |
| Master | Wheelhouse, own convoy only | See and hear an urgent alarm at once, with or without a link | Acknowledge on board; account bound to the display, no export |
| Tenant administrator | GFSA IT | Users, sign-in policy, integrations, plan and the audit log | Manage users, plan and billing, read the audit log |

GFSA management on call receives P1 escalations and the weekly fleet report by message and email; it needs no console role. Every exported clip is watermarked, with faces blurred when it leaves GFSA.

## Key journeys

Five journeys cover daily use, and the first, one alarm end to end, drives most of the design.

&#91;embedded content: one P2 alarm, end to end · on board, river link, ashore\]

Wheelhouse alerts never wait for the link; ashore, an alarm escalates on a timer until someone acknowledges it, and every event lands on the voyage record.

**Reviewing events** (reviewer)

1. Open the To review queue, filtered by use case or vessel.
2. Play the 15-second clip with its overlays; pull longer footage from the recorder when the link allows.
3. Accept, reject or mark a false alert with a reason, by keyboard (A, R, F, J for next).
4. The decision is logged, counts toward the use case's precision, and false alerts go to training with GFSA's consent.

**Setting up a use case** (safety administrator)

1. Pick the use case from the workbook and set its level and priority.
2. Choose cameras and draw zones on each camera's reference view.
3. Write the rule (object, zone, missing item, duration) and set confidence and repeat suppression.
4. Choose when it runs from the Connect schedule and check who gets the alarm.
5. Run 14 days in shadow with alerts off, reviewing every event.
6. When the accuracy gate is met, push the signed version to the vessels and switch alerts on.

**Following a voyage** (operations manager)

1. Connect sends the voyage, convoy make-up, schedule, cargo lists and reefer round times.
2. Under way, the voyage record shows alarms, reefer round exceptions and the link on one timeline.
3. Container counts at departure are compared with the cargo list, and differences go back to Connect.
4. Actual port times from video go to Connect beside the schedule, and a voyage report goes out at arrival.

**A convoy out of coverage**

1. Detection and wheelhouse alarms carry on as normal on board.
2. Events queue on the unit's SSD in priority order: alerts, routine events, then clips.
3. Ashore, the operations center marks the convoy out of coverage with its last position and a P4 alarm.
4. When coverage returns, queued events arrive with their original times and route as usual.

## Product scope and screen inventory

The product is one subscription with two modules: the operations center, which holds every screen below except the video wall, and the video wall module for live viewing. The design canvas draws 18 product screens plus the market scan.

| Area | Screen | Main users | What it is for |
| --- | --- | --- | --- |
| Access | Sign in | Everyone | Single sign-on with the GFSA directory; wheelhouse displays sign in with a device code |
| Operations | Operations center | Duty officer, managers | Fleet at a glance: open alarms, headline figures, route map with convoy positions, fleet status, events by use case |
| Operations | Video wall | Duty officer | Live tiles within each convoy's bandwidth budget; the alarm camera pinned in HD; AI overlays on or off |
| Operations | Alarms and events (alarm console) | Duty officer, reviewer | The alarm queue and one alarm in full: state bar, clip, classification, response steps, evidence, audit trail |
| Operations | Voyage record | Operations manager | One voyage from Connect: timeline, alarms, reefer round exceptions, cargo check, port times, Connect sync |
| On board | Wheelhouse display | Master | Full-screen urgent alarm with snapshot, next step, acknowledge, show live and silence; camera health |
| Mobile | Phone alert page | Duty officer, escalation recipients | The page behind each WhatsApp or SMS alert: clip, acknowledge, call the wheelhouse, open in the console |
| Configuration | Use case set-up | Safety administrator | Level, priority, cameras and zones, rule, schedule and routing for one use case; accuracy gate; versions |
| Configuration | Cameras and zones | Safety administrator | Camera inventory by convoy and vessel, health, hourly scene checks, zones per camera |
| Configuration | Alert routing | Safety administrator | Escalation ladder per priority, recipients, duty rota, delivery rules, message template |
| Configuration | Edge units | Safety administrator | Unit health, queues, storage and temperature, model rollout, remote diagnostics |
| Insights | Reports | Managers | Report library, schedules and templates |
| Insights | Daily summary | Operations manager, masters | One-page report per tug and barge per day |
| Insights | Model performance | Safety administrator | Precision and recall by week and by use case, false-alert reasons, training set, model registry |
| Administration | Users and roles | Tenant administrator | Users, role permissions, sign-in policy |
| Administration | Audit log | Tenant administrator | Append-only, hash-chained record of every view, download and change |
| Administration | Integrations | Tenant administrator | Connect, messaging, positions, recorders, single sign-on, storage; Connect field mapping and sync log |
| Administration | Plan and usage | Tenant administrator | Entitlements, usage, invoices, service health, support |

## Functional requirements

The product needs 61 requirements across 12 areas. The 51 marked Must make the pilot release; the 9 Should items and 1 Could item follow for fleet rollout.

### Alerting on board and on the phone

| ID | Requirement | Priority |
| --- | --- | --- |
| WH-01 | Show an urgent alarm full screen on the wheelhouse display, with a buzzer, within 5 s of detection and without the shore link | Must |
| WH-02 | Show the snapshot with the detection box and zone, vessel, camera, time, alarm ID and the next step set for the use case | Must |
| WH-03 | Acknowledge on the display; record the acknowledgement and send it ashore | Must |
| WH-04 | Offer live view of the alarm camera, silence for 2 minutes, camera health and the convoy's other open alarms | Should |
| PH-01 | Send each alert by WhatsApp and SMS, and escalations also by email, each with a link to the phone page | Must |
| PH-02 | On the phone page, show priority, alarm ID, vessel and camera, the 15-second clip, the on-board acknowledgement and the time left before escalation | Must |
| PH-03 | Acknowledge in one tap, call the wheelhouse, and log every page open | Must |

### Operations center

| ID | Requirement | Priority |
| --- | --- | --- |
| OPS-01 | Show open alarms by priority, events waiting for review, median time to acknowledge, cameras healthy and convoys connected, for the chosen convoy scope | Must |
| OPS-02 | Show each convoy on a route map with its last position, updated every minute, its link state and open alarms | Must |
| OPS-03 | List active alarms with state, owner and escalation timer, fleet status per convoy, and events by use case | Must |
| OPS-04 | Switch between live, 24 hours and 7 days, and export what is shown | Should |

### Alarm console

| ID | Requirement | Priority |
| --- | --- | --- |
| ALM-01 | Keep a queue of open alarms with priority filters, plus tabs for events to review and closed alarms | Must |
| ALM-02 | Track each alarm through raised, acknowledged on board, acknowledged ashore, resolved and closed, with times | Must |
| ALM-03 | Escalate automatically by the routing rules when an alarm is not acknowledged ashore in time, and show the countdown | Must |
| ALM-04 | Let the user assign an alarm to themselves, escalate it now or acknowledge it | Must |
| ALM-05 | Play the clip with AI overlays (box, zone, label, confidence) and request longer footage from the recorder when the link allows | Must |
| ALM-06 | Classify each event as accepted, rejected or false alert, with a reason for false alerts, using keyboard shortcuts | Must |
| ALM-07 | Show the response steps set for the use case and record who completed each and when | Must |
| ALM-08 | List evidence (clip, snapshot, detection record) with a SHA-256 hash; watermark and log every export | Must |
| ALM-09 | Keep an activity and audit trail on every alarm for 12 months | Must |
| ALM-10 | Show related events and the alarm's voyage | Could |

### Video wall

| ID | Requirement | Priority |
| --- | --- | --- |
| VW-01 | Offer layouts per convoy (focus plus 8, 3 × 3, 4 × 4) and a camera tree by convoy and vessel | Must |
| VW-02 | Keep live viewing inside each convoy's bandwidth budget: the focus tile in HD, the rest in SD or snapshots, with budget use shown | Must |
| VW-03 | Pin the camera of a new P1 or P2 alarm to the focus tile with an alarm banner and a link to the alarm | Must |
| VW-04 | Toggle AI overlays and badge degraded cameras | Should |
| VW-05 | Log every live view in the audit log | Must |

### Voyage record

| ID | Requirement | Priority |
| --- | --- | --- |
| VOY-01 | List voyages from Connect as under way, in port or completed, with convoy, route and status | Must |
| VOY-02 | Draw the voyage timeline: Connect schedule, port times from video, reefer rounds per barge, events, alarms and link state, with a now marker | Must |
| VOY-03 | Check every reefer round against the Connect schedule within a tolerance agreed with GFSA, and flag late, missed and overdue rounds | Must |
| VOY-04 | Compare container counts with the cargo list per barge and send differences to Connect | Must |
| VOY-05 | Record actual port times from video beside the schedule and send them to Connect | Must |
| VOY-06 | Show Connect sync status in both directions and produce a voyage report at arrival | Should |

### Use case set-up

| ID | Requirement | Priority |
| --- | --- | --- |
| UC-01 | Hold the use cases from the GFSA workbook by category, with priority and status (off, shadow run, live) | Must |
| UC-02 | Set the level per use case, record and list or record and alert; keep record and act locked until the pilot proves accuracy | Must |
| UC-03 | Choose cameras and draw zones and lines on a reference view; copy zones between cameras | Must |
| UC-04 | Write the rule as a sentence (object, zone, missing item, duration) with a confidence threshold and repeat suppression per tracked person | Must |
| UC-05 | Run a use case always, while under way or mooring, during cargo operations or at set hours, using the Connect schedule | Must |
| UC-06 | Show the accuracy gate against targets and run a 14-day shadow run before alerts go live | Must |
| UC-07 | Version every change as a draft, push it signed to vessels, show confirmations per unit and allow rollback | Must |

### Cameras and zones

| ID | Requirement | Priority |
| --- | --- | --- |
| CAM-01 | List cameras by convoy and vessel with position, stream, edge unit, health, zones, use cases and last check | Must |
| CAM-02 | Run a scene check every hour on every camera for blur, glare, a wet lens, a moved camera or no image, and raise a camera offline or degraded event | Must |
| CAM-03 | Hold a moved camera's zones for review before they are used again | Should |

### Alert routing

| ID | Requirement | Priority |
| --- | --- | --- |
| RT-01 | Define an escalation ladder per priority (P1 to P4) with steps, channels and timers | Must |
| RT-02 | Keep recipients by role with channels (WhatsApp, SMS, email, voice call), hours, vessel scope and verified contact details | Must |
| RT-03 | Support a duty rota, reminders every 2 minutes until acknowledged (3 at most) and 1 message per person per alarm per channel | Must |
| RT-04 | Send messages in the recipient's language, Spanish by default, from an editable template | Must |
| RT-05 | Report delivery per channel and send test alerts | Should |

### Edge units

| ID | Requirement | Priority |
| --- | --- | --- |
| EU-01 | Show per unit its reporting state, link, queue, model version, storage, temperature and uptime, from a health message every minute | Must |
| EU-02 | Roll out signed model and rule versions in port or on a strong link, track confirmations and allow rollback | Must |
| EU-03 | Request diagnostics and restart the pipeline remotely, with on-board alerts working during a restart | Should |

### Reports

| ID | Requirement | Priority |
| --- | --- | --- |
| REP-01 | Send a daily summary per tug and barge at 06:00 Asunción time: events by use case, review outcomes, reefer rounds, camera uptime and link | Must |
| REP-02 | Schedule weekly fleet, voyage, camera uptime, model performance and audit reports to named recipients | Should |
| REP-03 | Produce reports as PDF in the recipient's language, and watermark and log every download | Must |

### Model performance

| ID | Requirement | Priority |
| --- | --- | --- |
| MP-01 | Show precision, recall and false alerts per camera per day by use case and fleet-wide, against targets, with a weekly trend | Must |
| MP-02 | Show false-alert reasons and send labelled clips to training, only with GFSA's written consent | Must |
| MP-03 | Keep a model registry of versions with rollout state and rollback | Must |

### Administration

| ID | Requirement | Priority |
| --- | --- | --- |
| ADM-01 | Sign in through SAML single sign-on with the GFSA directory, with MFA for every shore role and device-bound wheelhouse accounts | Must |
| ADM-02 | Enforce role permissions; masters see their own convoy only | Must |
| ADM-03 | Keep an append-only, hash-chained audit log of every view, download and change, with verification and CSV export | Must |
| ADM-04 | Manage integrations (Connect, messaging, positions, recorders, single sign-on, storage) with status, last activity, Connect field mapping and a sync log | Must |
| ADM-05 | Show plan entitlements, usage, invoices, service health and support; report usage above the plan without cutting service | Should |

## Use case catalogue

Eight use cases run in the pilot, two follow in rollout and two stay blocked until new cameras or footage exist. They come from the 35 in GFSA's workbook; GFSA's own first-phase marks in the workbook replace this proposal. Linking every event to its voyage in Connect runs across all of them.

| Use case | Category | Rule | Cameras | Level after shadow run | Alarm priority | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| Hard hat and vest | Crew safety | A person on deck without a hard hat or vest | Deck | Record and alert | P3 Medium | Pilot |
| Life jacket near the water | Crew safety | A person in the water-edge zone without a life jacket for 5 s | Barge edge | Record and alert | P2 High | Pilot |
| Smoking | Crew safety | A person smoking in a no-smoking zone | Deck | Record and list | P3 Medium | Rollout |
| Person down on deck | Crew safety | A person lying still on deck; needs consented drill footage to train | Deck | Record and alert | P1 Critical | Blocked |
| Smoke or fire on deck | Fire and smoke | Smoke or flame in view on deck | Deck | Record and alert | P1 Critical | Pilot |
| Smoke in machinery spaces | Fire and smoke | Smoke or haze in the engine room or generator space | Engine room | Record and alert | P1 Critical | Pilot |
| Person overboard | Water and navigation | A person crossing the hull line into the water; needs thermal cameras for night | Barge edge, thermal | Record and alert | P1 Critical | Blocked |
| Obstacle ahead | Water and navigation | Floating debris or a vessel in the forward zone, advisory only | Bow, 10 to 15 frames a second | Record and list | P3 Medium | Rollout |
| Container doors opened | Cargo and operations | A container door open outside cargo operations | Deck | Record and list | P3 Medium | Pilot |
| Reefer inspection rounds | Cargo and operations | Someone seen in the reefer row within the agreed tolerance of each round in Connect | Reefer row | Record and list | P3 Medium | Pilot |
| Person outside planned work | Cargo and operations | A person on the barge outside the work planned in Connect | Deck, barge edge | Record and list | P3 Medium | Pilot |
| Camera offline or degraded | Scene checks | Blur, glare, a wet lens, a moved camera or no image at the hourly scene check | Every camera | Record and alert | P3 Medium | Pilot |

Every use case starts as record and list in a 14-day shadow run; alerts switch on only when it meets the false-alert limit. Most use cases sample 5 frames a second per camera; overboard and obstacle cameras need 10 to 15.

## AI and edge requirements

Each tug and barge runs one AI unit that turns its camera streams into events, and no model goes live before it passes a held-out GFSA test set and a 14-day shadow run.

&#91;embedded content: architecture · on board, river link, ashore, GFSA systems\]

Only events, clips and health cross the link, and signed model updates come back the other way; Connect feeds the schedules that rules depend on.

**Onboard pipeline.** One DeepStream 9.1 pipeline on JetPack 7.2 runs on each unit, in twelve stages:

1. Read RTSP streams from each camera or recorder, reconnect after drops, and add cameras without a restart.
2. Decode H.264 and H.265 on the video engine, leaving the GPU free for the models.
3. Batch frames from all cameras, each model at the frame rate its use cases need.
4. Detect people, boats, vehicles, containers, smoke and flame.
5. Track each object with an ID, a path and a dwell time.
6. Classify each tracked person for hard hat, vest, life jacket, smoking, phone use and posture.
7. Apply each camera's zones and lines: barge edge, reefer rows, no-smoking areas, danger zones.
8. Decide events with rules that combine detections with time of day and Connect schedules.
9. Record a clip from a few seconds before to a few seconds after each event, from a rolling buffer.
10. Publish each event to a local broker that forwards it ashore when the link is up.
11. Report camera health (offline, frozen, degraded) and the unit's load and temperature.
12. Show urgent events in the wheelhouse at once, without waiting for the link.

Three build choices follow from current releases: YOLO runs through the open DeepStream-Yolo parser; engines run in FP16 first, with INT8 later through TensorRT's own quantisation; event logic uses pyservicemaker, since DeepStream 9.x deprecates pyds.

**Models.** Seven model families cover the detection behind the 35 workbook use cases.

| Model family | Detects | Starting point |
| --- | --- | --- |
| Base detector | People, small boats and vessels, trucks, container handlers | YOLO26 pretrained on COCO, fine-tuned on vessel footage |
| Crew safety attributes | Hard hat, vest, life jacket, smoking, phone use, posture | Secondary classifiers on each person crop |
| Fire and smoke | Smoke, haze, flame, welding sparks | YOLO26 fine-tuned on fire and smoke datasets |
| Water and navigation | Person in the water, small craft, floating debris, buoys, bridge piers, objects thrown overboard | YOLO26 on maritime and river datasets; thermal variant where fitted |
| Cargo | Containers, open doors, lashing, container numbers, reefer power cables | YOLO26 plus a text reader for container numbers |
| Machinery thermal | Hot spots on engines and generators | Temperature thresholds on thermal images |
| Scene checks | Covered, moved, blurred or frozen images; lights; spills and objects on walkways | Image-quality rules and change detection against each camera's reference view |

**How a model goes live.**

1. Fine-tune on public datasets that allow commercial use.
2. Fine-tune on 48 to 72 hours of pilot-convoy footage, by day and at night, keeping false detections as hard negatives.
3. Score each use case on a held-out GFSA set for precision, recall and false alerts per camera per day.
4. Run 14 days in shadow with alerts off; switch alerts on once false alerts are within the limit.
5. Turn every review into a label, retrain on a fixed cycle, and push versioned, signed updates with rollback to the last good version.

**Hardware sizing.** The standard unit is a Jetson Orin NX 16GB on each tug and barge, planned for 8 to 12 cameras. Ultralytics measured YOLO11s at 7.91 ms per image in FP16 on that module, enough for the base detector on about 25 cameras at 5 frames a second; the margin covers tracking, secondary models and recording, and the pilot confirms the real figure.

| Option | Module | Video decode, H.265 | Power | Planned cameras | Where it fits |
| --- | --- | --- | --- | --- | --- |
| Standard | Jetson Orin NX 16GB | 18 streams at 1080p30 | 10 to 40 W | 8 to 12 | Each tug and each barge |
| Small | Jetson Orin Nano 8GB | 11 streams at 1080p30 | 7 to 25 W | Up to 6 | A barge with few cameras |
| Convoy hub | Jetson AGX Orin 64GB | 22 streams at 1080p30 | 15 to 60 W | 12 to 20 | One unit per convoy, if barge cameras are networked to the tug |

Beside the module, each vessel needs a rugged fanless enclosure on vessel DC power, a 512 GB to 1 TB NVMe SSD, a connection to the camera switch or recorder, and a small wheelhouse display or buzzer. Thermal cameras are added only at barge edges and facing forward from the tug, where night overboard and obstacle detection are wanted.

## Data, integrations and connectivity

At 50 events a day with clips, one vessel sends about 150 MB a day; everything else stays on board. GFSA's answer on link type and bandwidth (questionnaire item 2.3) will firm this figure up.

**What crosses the link**

| Item | Size (estimate) | When it is sent |
| --- | --- | --- |
| Event record | About 2 KB | At once |
| Thumbnail | About 50 KB | At once, with the event |
| Event clip, 15 s at 720p | About 3 MB | After the alert for events marked Alert; on request for the rest |
| Camera and unit health | Under 1 KB | Every minute |
| Model and rule updates | Tens of MB | Scheduled, in port or on strong coverage |
| Live view, video wall | Per-convoy budget | Only while someone watches; HD for the focus tile, SD or snapshots for the rest |

**Store and forward.** Events wait in a queue on the unit's SSD and leave in priority order: alerts, then routine events, then clips. The queue holds at least 14 days offline. Full video stays on GFSA's recorders; the AI unit keeps only a rolling buffer to cut clips from.

**Event record.** Each event carries its event ID, use case, vessel, camera, start and end time, GPS position, confidence, thumbnail, clip link, voyage and the reviewer's decision.

**Connect, both directions**

- In from Connect: voyages and convoy make-up (which tug pushes which barges), the operational schedule, cargo lists by barge and reefer round times.
- Out to Connect: each event on the voyage record, actual port times from video beside the schedule, container counts that differ from the cargo list, and missed reefer rounds.
- Where reefer monitoring is fitted, its alarms are matched to the video of the affected reefer row.
- The team already knows Connect's data structure from the Connect AI work, so the integration builds on that groundwork.

**Other integrations**

| Integration | Direction | Used for |
| --- | --- | --- |
| WhatsApp messaging | Out | Alerts to shore roles with the phone page link |
| SMS gateway | Out | Fallback and escalation messages |
| Email | Out | Escalations, digests and scheduled reports |
| Voice call | Out | P1 escalations |
| Vessel positions | In | GPS from each edge unit every minute; AIS optional |
| Video recorders | In, on board | RTSP or ONVIF streams from the existing recorders or cameras |
| Single sign-on (SAML) | In | Sign-in and roles from the GFSA directory |
| Object storage | Ashore | Clips for 90 days, events for 12 months, encrypted at rest |

## Non-functional requirements

The hardest constraint is the link: on-board alerting must never wait for shore, and no event may be lost in a coverage gap. Figures marked proposed still need GFSA's agreement.

| Area | Requirement |
| --- | --- |
| Alert latency | Urgent alerts on the wheelhouse display within 5 s of detection; ashore within 60 s when the link is up |
| Offline operation | On-board detection and wheelhouse alerts work with no link; the event queue holds at least 14 days offline; nothing is lost between coverage areas |
| Bandwidth | Only events, thumbnails, clips and health cross the link; live viewing stays inside a per-convoy budget (proposed default: 20% of the link) |
| Availability | Shore services 99.9% a month (proposed); edge units health-checked every minute; one spare unit per convoy |
| Security | Each unit opens an outbound-only encrypted connection, with no port opened on the vessel; each unit has its own certificate; models and rules are signed and verified before install |
| Access | Single sign-on with the GFSA directory, MFA for every shore role, role-based permissions, wheelhouse accounts bound to the display |
| Audit | Every view, download and change is written to an append-only, hash-chained log, kept 12 months |
| Privacy | Behaviours, not identities: no face recognition; faces blurred in clips shared outside GFSA; crew told what is monitored and why, under GFSA's policy |
| Data ownership | GFSA owns its footage and events; footage trains models only with GFSA's written consent |
| Retention | Events 12 months, clips 90 days (proposed, to agree with GFSA) |
| Hosting | Cloud or GFSA's own servers, whichever GFSA's IT policy requires |
| Accessibility | Text contrast of at least 4.5:1, touch targets of at least 44 px, real form controls, keyboard shortcuts for review; a dimmable wheelhouse display for night |
| Language | Spanish and English interface; messages and reports in each recipient's language, Spanish by default |
| Hardware | Rugged, fanless units with wide-range DC input and vibration-rated mounting, chosen with GFSA's electrical team |
| Observability | Health per camera and unit every minute, a scene check per camera every hour, daily uptime per camera, a service health page |
| Support | 24/7 support desk in Spanish and English; P1 response in 15 minutes, P2 in 1 hour (proposed) |

## Release plan

The pilot runs 12 weeks on one convoy and ends in a rollout decision; build starts once the licence question is settled and GFSA answers the discovery questions.

&#91;embedded content: pilot roadmap · 5 phases, 4 gates, 12 weeks\]

Each gate is a go or no-go with GFSA, and alerts switch on only after the shadow-run gate.

| Release | When | Scope | Done when |
| --- | --- | --- | --- |
| Pilot (MVP) | Weeks 1 to 12 | One convoy (one tug, one barge), the eight pilot use cases, every Must requirement | Targets met and GFSA decides on rollout |
| Fleet rollout | After the rollout decision, convoy by convoy | Every tug and barge, the Should requirements, smoking and obstacle ahead | Every convoy reporting; each new use case through its own shadow run |
| Act and expand | After rollout | Record and act (stopping-distance warnings, tasks raised in Connect), person overboard with thermal cameras, person down with consented drill footage, further workbook use cases | To agree with GFSA |

## Risks, dependencies and open questions

The largest risk is commercial, not technical: YOLO's AGPL-3.0 licence must be settled before the build starts.

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Ultralytics AGPL-3.0 licence | A closed commercial service built on YOLO must release its source or buy a licence | Get an Enterprise License quote now; if it does not fit, switch to permissively licensed models, such as NVIDIA's PeopleNet for people, before training starts |
| Public dataset licences | Many maritime and safety datasets forbid commercial use | Train only on datasets that allow commercial use; GFSA footage carries the final models |
| Night, rain, fog and glare on water | Missed or false detections after dark | Ask for night footage first; thermal cameras for overboard and obstacles; thresholds per camera |
| Camera views miss a use case | That use case cannot run on existing cameras | Camera survey in discovery; coverage marked per use case; cameras added only where GFSA wants the use case |
| Link gaps along the river | Late alerts ashore | Wheelhouse alerts on board; store and forward; priority queue |
| False alerts | Trust drops and alerts get ignored | 14-day shadow run before alerts go live; reviewer feedback; thresholds per use case |
| Crew acceptance | Cameras covered or units switched off | No face recognition; crew briefing under GFSA policy; camera tampering alerts |
| Power, heat and vibration on barges | Unit failures | Rugged fanless units; health monitoring; one spare unit per convoy |
| Software stack changes | Rework at upgrades | Pin DeepStream 9.1 and JetPack 7.2 for the pilot; a local message broker instead of direct Kafka, given the reconnect issue in the 9.1 release notes |

**Dependencies.** The build needs recorder or camera access on the pilot vessels, read and write access to Connect, GFSA's messaging and directory set-up for alerts and single sign-on, and the licence decision above.

**Open with GFSA** (questionnaire items in brackets)

- [ ] Camera count, placement and recorder access over RTSP or ONVIF, per tug and barge (2.1, 2.2)
- [ ] Link type, bandwidth and coverage gaps along the river (2.3)
- [ ] Hosting: cloud or GFSA servers, and IT security rules (2.5)
- [ ] Pilot convoy, alert recipients and success targets (3.1 to 3.4)
- [ ] Are barge cameras networked to the tug while pushed? This decides one unit per convoy or one per vessel
- [ ] Do the barges have a reefer monitoring system, and are any cameras thermal?
- [ ] First-phase use cases marked in the workbook
- [ ] Retention periods for events and clips, and the reefer round tolerance

## Appendix

This PRD builds on the solution design "CCTV Footage Framework: Solution Design" (15 Oct 2026) and the [CCTV Monitoring design canvas](https://claude.ai/artifact/WyVtvhAezNmDVAKX8coFmo), whose screens use sample data and placeholder vessel names.

**Glossary**

| Term | Meaning |
| --- | --- |
| Convoy | A tug pushing one or more barges on one voyage |
| Edge unit (AI unit) | The rugged computer on each tug and barge that runs the models on the camera feeds |
| Event | Anything a use case detects, logged with time, vessel, camera, clip and voyage |
| Alarm | An event at alert level that is routed to people and must be acknowledged |
| Use case | One detection set up as configuration: model, cameras, zones, rule, schedule and routing |
| Record and list, alert, act | The three levels: log only; log and alert people; log and trigger an action (after the pilot) |
| Shadow run | 14 days of logging and review with alerts off, before a use case goes live |
| Scene check | An hourly test of each camera for blur, glare, a wet lens, movement or no image |
| Store and forward | Events wait on board and go ashore in priority order when the link returns |
| Connect | GFSA's operational system for voyages, schedules and cargo |
| P1 to P4 | Alarm priorities: Critical, High, Medium, Low |

**Sources: market scan**

- [ShipIn: How FleetVision works](https://shipin.ai/?p=12)
- [ShipIn: Visibility without satellite connectivity](https://shipin.ai/insights/operational-visibility-even-without-satellite-connectivity)
- [Hellenic Shipping News: Zeaborn and ShipIn](https://www.hellenicshippingnews.com/?p=972728)
- [Riviera: Laskaridis Shipping and ShipIn](https://www.rivieramm.com/news-content-hub/laskaridis-shipping-to-roll-out-shipins-fleetvision-across-fleet-75648)
- [Hellenic Shipping News: OneLink and ShipIn](https://www.hellenicshippingnews.com/onelink-signs-deal-with-shipin-systems-for-ai-powered-fleet-management/)
- [Hellenic Shipping News: Seaspan and Orca AI](https://www.hellenicshippingnews.com/?p=1082301)
- [SEA.AI: Technology](https://www.sea.ai/technology/)
- [Axis: Seafar customer story](https://www.axis.com/customer-story/cameras-enable-autonomous-shipping)
- [Container News: Seafar centre in Duisburg](https://container-news.com/seafar-to-launch-germanys-first-remote-operations-centre)
- [Professional Mariner: TugCam](https://professionalmariner.com/tugcams-remote-video-camera-system-allows-pilots-to-see-what-lies-ahead/)
- [Intenseye: Products](https://intenseye.com/products)
- [Protex AI: Company information](https://www.protex.ai/protex-ai-llm-text-file)
- [Verdantix: viAct video analytics](https://atlas.verdantix.com/viact/video-analytics-solution)
- [SDM: Milestone in nautical markets](https://www.sdmmag.com/articles/91454-milestone-systems-set-sails-for-nautical-markets-with-partner-last-mile-communications-at-the-helm)
- [Genetec: Alarms as incident triggers](https://techdocs.genetec.com/r/en-US/Genetec-Mission-ControlTM-Administrator-Guide-3.1.3.0/Alarms-as-incident-triggers)
- [Iridium: Videosoft FireLight](https://www.iridium.com/products/videosoft-firelight/)
- [Maritime Executive: IEC Telecom and AnsuR](https://maritime-executive.com/corporate/iec-telecom-introduces-new-ship-to-shore-surveillance-solution)

Technical sources (DeepStream 9.1 release notes, Ultralytics YOLO on Jetson, Ultralytics licensing, Jetson Orin specifications) are cited in the solution design.
