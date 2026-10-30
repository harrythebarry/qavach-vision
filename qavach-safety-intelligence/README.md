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
  lib/qai.ts            stand-in for QAI: plain words → rule draft, alert → Qavach record draft
  pages/                overview, wall, alerts, cameras (zone editor), rules, notifications, phone
```

The look follows the Qavach AI-native design tokens (Instrument Sans, navy dock, blue for anything QAI drafted).

## Mocked here

- **Video:** cameras show drawn scenes. Detection boxes and clips are simulated.
- **Alerts and escalation:** produced by `state/engine.ts`. In production they come from the edge units and the notification service.
- **Messages:** SMS, WhatsApp, calls and push notifications are recorded with a delivery state, but nothing is actually sent.
- **QAI:** rule drafting and record drafting run in the browser with simple rules. In production they call the QAI service.
- **Qavach records:** raising one shows a reference number but does not call the Qavach API.
