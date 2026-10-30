# Front-end conventions

How screens in this app keep state, produce files, speak Spanish and English, and avoid stubs. The rules apply to every page under `src/pages`.

## 1. State: what lives where

Domain data lives in shared stores, not in a page's `useState`. Shared stores survive navigation and reloads (saved to localStorage under `gfsa.v1.*`) and stay in step across windows (console, second-screen video wall, wheelhouse display). **Reset demo data** in the user menu clears them all.

| Data | Read | Change |
| --- | --- | --- |
| Session, language, convoy scope, alarms, review queue, audit log | `useApp()` in `state/AppState.tsx` | Actions on `useApp()`: `acknowledgeOnBoard`, `acknowledgeAshore`, `assignToMe`, `escalateNow`, `resolve`, `close`, `classifyAlarm`, `classifyEvent`, `toggleStep`, `addActivity(id, en, es?, actor?)`, `patchAlarm`, `raiseAlarm`, `addReviewEvents`, `log(action, target, details?, convoyId?)`, `logSystem({...})`, `toast` |
| Convoys (link, last position), vessels, cameras, edge units | `useFleet()` in `state/fleetStore.ts` (live) | `updateConvoy`, `updateUnit`, `updateCamera` |
| Cameras, zones, zone holds, scene-check runs; use case records and versions | `camStore`, `ucStore` with `useStore` in `state/configStore.ts` | `camStore.set`, `ucStore.set` |
| Saved alert routing (ladders, recipients, rota, delivery rules, templates) | `useRouting()` in `state/routingStore.ts` | `saveRouting(config)`; the live engine escalates from it |
| User directory | `useUsers()` in `state/usersStore.ts` | `addUser`, `updateUser`, `removeUser`; `demoUserFor(role)` signs in from it |
| Support cases | `useSupportCases()` in `state/supportStore.ts` | `openSupportCase(...)` |
| Anything else a screen owns (report schedules, integrations, model registry, plan requests…) | `usePersistentState('<area>.<thing>', seed)` or `createStore` from `lib/persist.ts` | its setter |

- **Do not** import `convoys`, `cameras`, `edgeUnits`, `cameraById`… from `data/fleet.ts` in components: those are the seed. Use `useFleet()` so cameras added on *Cameras and zones*, and convoys reconnecting, show up everywhere.
- UI-only state (open dialog, hover, a filter) stays in `useState` or in the URL.
- New ids: `uid('prefix')` from `lib/persist.ts`, so ids stay unique across reloads.

### The live engine

`state/engine.tsx` stands in for the event service and alert routing. It escalates unacknowledged alarms on the saved ladder (ALM-03), sends reminders (RT-03), raises new alarms and review events following each use case's saved level, priority and cameras, brings GF Humaitá back into coverage with its queued events, has the wheelhouse acknowledge on board, and sends health messages every minute. It writes to each alarm's activity trail and the audit log. Screens must **react to it**: read alarms and fleet state live, never copy them into local state at mount.

## 2. Files: every download is real

Use `useExporter()` from `lib/exporting.ts`. It produces the file, stamps a watermark ID (`WM-26-####`) with the user and time, writes the audit log and shows the toast.

```ts
const ex = useExporter();
ex.csv('voyages.csv', rows, { action: 'Exported voyages', target: 'All convoys' });
ex.pdf('daily-summary-f501-2026-10-14.pdf', { title, subtitle, blocks }, { action: 'Downloaded report', target: 'Daily summary · Guarán F 501' });
await ex.image(cam.image, 'F503-CAM-02-snapshot.svg', { action: 'Exported snapshot', target: alarm.id, box, note: 'Faces blurred' });
```

PDF content is a list of blocks (`h1`, `h2`, `p`, `meta`, `kv`, `table`, `bars`, `space`) from `lib/download.ts`; the builder paginates and puts the watermark on every page. For other formats (JSON records, animated SVG clips, text bundles) build the content and call `downloadBlob` from `lib/download.ts`, then `ex.logged(filename, meta, true)`.

Never show a "downloaded" or "sent" toast without the real effect behind it.

## 3. Language: Spanish and English

Every visible string goes through `useTr()` from `lib/i18n.ts`, with both languages side by side:

```tsx
const tr = useTr();
<h2>{tr('Active alarms', 'Alarmas activas')}</h2>
<button aria-label={tr('Close', 'Cerrar')} />
toast(tr(`${id} closed.`, `${id} cerrada.`));
```

That covers headings, labels, buttons, `aria-label`, `title`, `placeholder`, `alt`, table headers, empty states, toasts, dialog copy and PDF/CSV headings. Data carries its own Spanish: use cases (`nameEs`, `ruleEs`, `nextStepEs`, `responseStepsEs`, `CATEGORY_ES`), alarms (`titleEs`, `descriptionEs`), activity entries (`textEs`), roles (`nameEs`), navigation (`labelEs`), priorities (`usePriorityName()` / `PriorityBadge`). Dates and times from `lib/time.ts` follow the language automatically.

Audit log `action` and `target` strings stay in English: they are records, stored as written.

Spanish register: neutral Latin American (Paraguay), *usted*. Terms:

| English | Español |
| --- | --- |
| alarm / event | alarma / evento |
| acknowledge | confirmar |
| escalate | escalar |
| use case | caso de uso |
| edge unit | unidad de borde |
| wheelhouse | puente (de mando) |
| duty officer | oficial de guardia |
| operations manager | gerente de operaciones |
| fleet superintendent | superintendente de flota |
| safety administrator | administrador de seguridad |
| reviewer | revisor |
| master | capitán |
| tug / barge / convoy / voyage | remolcador / barcaza / convoy / viaje |
| shadow run | ejecución en sombra |
| scene check | control de escena |
| false alert | falsa alerta |
| watermark | marca de agua |
| audit log | registro de auditoría |
| review queue | cola de revisión |
| video wall | videowall |
| reefer | reefer (contenedor refrigerado) |
| link / coverage | enlace / cobertura |

## 4. No stubs

- Every button and link does the real thing inside the app. When the true target is outside it (Connect, WhatsApp, a phone call), build the in-app part completely: a drawer with what Connect holds, a `tel:` link plus an activity line, a test message with its delivery status.
- A disabled control has a reachable condition that enables it, and says what that is.
- Screens with drafts warn before leaving: `useBlocker` from `react-router` (the app uses a data router) plus `beforeunload`.
- Check your files: `node scripts/audit-stubs.cjs src/pages/<area>` should list nothing you cannot justify.

## 5. Accessibility and layout

Real `<button>`, `<a>`, `<input>` with `<label>`; `aria-label` on icon-only buttons; 44 px touch targets; text contrast at least 4.5:1; layouts that work at 390 px wide (wide tables scroll inside `.table-wrap`).
