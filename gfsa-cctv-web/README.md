# CCTV Monitoring · web front-end

The shore console for GFSA CCTV Monitoring, built from `GFSA CCTV Monitoring PRD.md` and the screens on the CCTV Monitoring design canvas. It runs entirely in the browser on sample data: no back-end is needed yet, but every screen works. A live engine stands in for the event service, state is saved, downloads are real files, and the interface is in Spanish and English.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

Sign in with **Continue with GFSA single sign-on** (any 6-digit MFA code works). To try another role, use the role picker on the sign-in page or **Demo: sign in as** in the user menu. Each role sees only the screens its permissions allow (ADM-02).

The user menu also has:

- **Language:** ES / EN.
- **Live events (demo):** pauses or resumes the live engine.
- **Reset demo data:** clears everything saved and starts the scenario again.
- **Other surfaces:** the wheelhouse display and the phone alert page.

## The scenario

The sample data is a snapshot at **15 Oct 2026, 14:36:20 Asunción time**, the moment drawn on the design canvas. The scenario clock starts there the first time the app opens and runs in real time. The start is saved, so a reload carries on where it left off.

Three convoys are in the sample data:

- **GF Tuyutí** (tug and barges Guarán F 501 and F 503) is on voyage VOY-26-041 near Rosario, with an open P2 life jacket alarm.
- **GF Humaitá** is out of coverage, with 12 events queued on board.
- **GF Boquerón** is in port at Buenos Aires.

The live engine (`src/state/engine.tsx`) then plays the scenario forward. Times are from when you first open the app:

| When | What happens |
| --- | --- |
| ~1.5 min | `ALM-26-0318` is not acknowledged ashore in time and escalates to the operations manager on the saved P2 ladder; reminders go to the duty officer every 2 min, 3 at most |
| 1.5 min | A P3 hard hat alarm on Guarán F 501; the wheelhouse acknowledges it on board a few seconds later |
| 3 min | A container door event on GF Boquerón joins the review queue |
| 4 min | GF Humaitá comes back into coverage: its units report again, its 12 queued events arrive with their original times, and its out-of-coverage alarm closes |
| 6 min | A P1 smoke alarm in GF Boquerón's engine room: pinned on the video wall, full screen on that convoy's wheelhouse display |
| 8 min on | A new event or alarm every 2.5 min, following each use case's saved level, priority and cameras |
| 15:00 | The 14:00 reefer round counts as missed and is sent to Connect |
| hh:30 | Hourly scene check on every camera; a new problem raises "Camera offline or degraded" |

Configuration changes take effect in the live engine. A shorter escalation timer on Alert routing changes when open alarms escalate. Pushing a use case live or switching its alerts on changes what new detections become. Turning off a channel on Integrations stops messages on that channel.

## Screens

| Area | Screen | Route | PRD requirements |
| --- | --- | --- | --- |
| Access | Sign in, forgotten password, wheelhouse device code | `/sign-in` | ADM-01 |
| Public | Service status, privacy, support | `/status`, `/privacy`, `/support` | ADM-05, Privacy |
| Operations | Operations center | `/` | OPS-01 to OPS-04 |
| Operations | Video wall, and the wall on a second screen | `/video-wall?convoy=tuy`, `/wall` | VW-01 to VW-05 |
| Operations | Alarm console | `/alarms`, `/alarms/:id`, `/alarms?tab=review` | ALM-01 to ALM-10 |
| Operations | Voyages and voyage record | `/voyages`, `/voyages/:id` | VOY-01 to VOY-06 |
| On board | Wheelhouse display | `/wheelhouse` | WH-01 to WH-04 |
| Mobile | Phone alert page | `/m/alarm/:id` | PH-01 to PH-03 |
| Configuration | Use case set-up | `/config/use-cases`, `/config/use-cases/:id` | UC-01 to UC-07 |
| Configuration | Cameras and zones | `/config/cameras` | CAM-01 to CAM-03 |
| Configuration | Alert routing | `/config/routing` | RT-01 to RT-05 |
| Configuration | Edge units | `/config/edge-units` | EU-01 to EU-03 |
| Insights | Reports | `/reports` | REP-02, REP-03 |
| Insights | Daily summary | `/reports/daily` | REP-01 |
| Insights | Model performance | `/insights/models` | MP-01 to MP-03 |
| Administration | Users and roles | `/admin/users` | ADM-01, ADM-02 |
| Administration | Audit log | `/admin/audit` | ADM-03 |
| Administration | Integrations | `/admin/integrations` | ADM-04 |
| Administration | Plan and usage | `/admin/plan` | ADM-05 |

The wheelhouse display, the second-screen wall and the phone alert page open full screen, outside the console. Windows stay in step: acknowledging on the wheelhouse display or the second screen shows in the console at once.

## Code layout

```
src/
  App.tsx              routes (data router, so screens with drafts can warn before you leave)
  nav.ts               navigation rail and which roles may open each screen
  components/          AppShell (header, rail, notifications, footer), HelpPanel, CommandPalette (Ctrl K), Icon, ui.tsx
  state/
    AppState.tsx       session, language, convoy scope, alarms, review queue, audit log, toasts (saved)
    engine.tsx         the live engine: escalation, reminders, new events, reconnects, health, scene checks
    escalation.ts      escalating along the saved ladder; messages respect channels turned off
    fleetStore.ts      convoys, vessels, cameras, edge units (useFleet)
    configStore.ts     use cases, versions, cameras, zones, scene checks
    routingStore.ts    saved alert routing
    usersStore.ts      user directory
    supportStore.ts    support cases
  lib/
    persist.ts         saved stores shared across screens and windows; Reset demo data
    exporting.ts       useExporter(): real files, watermark, audit log, toast
    download.ts        CSV, multi-page PDF with watermark, watermarked snapshots
    i18n.ts            useTr(): Spanish and English side by side
    time.ts            scenario clock and formatters (follow the language)
    hash.ts            audit chain hash
  data/                domain types and seed data
  pages/               one folder or file per screen, each with its own CSS file
  styles/              design tokens and global classes
design/                the design canvas screens (.dc.html), kept as the visual reference
docs/                  frontend-conventions.md: state, files, language and no-stub rules
scripts/               audit-stubs.cjs: lists buttons without handlers, dead links, toast-only actions
public/media/          camera snapshots and the route map from the design canvas
```

Read [docs/frontend-conventions.md](docs/frontend-conventions.md) before changing a screen. Run `node scripts/audit-stubs.cjs src/pages/<area>` to check for stubs.

## Mocked here, needed from the back-end

- **Data and events:** the stores in `src/state` are the seam to replace with API calls. `engine.tsx` stands in for a live event stream (WebSocket or SSE) carrying alarms, escalations, health messages and positions.
- **Single sign-on:** SAML SSO, MFA and password reset are simulated.
- **Audit hashing:** the chain covers every field of each entry but uses a non-cryptographic demo hash (`lib/hash.ts`). The real log is chained with SHA-256 on the server.
- **Video:** live video and clips are still camera images, with simulated playback and a bandwidth budget. Exported clips are animated SVG files with the watermark burned in.
- **Messages:** WhatsApp, SMS, email and voice calls are recorded with their delivery state; nothing leaves the browser.
- **Connect:** what Connect holds for each voyage is shown in the app, and what the app sends is kept in an outbox; there is no live Connect connection.
- **Invoices:** invoice PDFs list items and quantities without amounts, because the PRD gives no prices.
