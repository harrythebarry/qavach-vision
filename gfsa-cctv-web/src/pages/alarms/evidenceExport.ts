import { useCallback, useState } from 'react';
import type { Alarm, AlarmState, Classification, Detection, Priority, ReviewEvent } from '../../data/types';
import { useCaseById } from '../../data/useCases';
import { downloadBlob, type PdfWatermark } from '../../lib/download';
import { useExporter } from '../../lib/exporting';
import { fakeHash } from '../../lib/hash';
import { usePersistentState, useStore } from '../../lib/persist';
import { fmtTimeSec, scenarioNow } from '../../lib/time';
import { useApp } from '../../state/AppState';
import { liveOf, ucStore } from '../../state/configStore';
import {
  FOOTAGE_LEAD,
  FOOTAGE_SECONDS,
  PEOPLE_USE_CASES,
  segmentLabelFor,
  useAlarmText,
  type EvidenceItem,
  type ExportRecord,
} from './alarmConsoleData';
import { buildClipSvg, frameDataUri } from './evidenceFiles';

// ALM-08: every evidence export is a real file with a watermark ID, written to
// the audit log, and listed on the alarm (saved per alarm or event).

/** What an export needs to know about the alarm or review event it comes from. */
export interface EvidenceTarget {
  id: string;
  kind: 'alarm' | 'event';
  eventId: string;
  alarmId?: string;
  useCaseId: string;
  priority: Priority;
  title: string;
  titleEs?: string;
  convoyId: string;
  vesselId?: string;
  cameraId?: string;
  voyageId?: string;
  /** Time the alarm or event fired (ISO). */
  at: string;
  detection?: Detection;
  classification?: Classification;
  falseReason?: string;
  stateTimes?: Partial<Record<AlarmState, string>>;
  receivedAshore?: string;
  models?: string;
  queued?: boolean;
  shadow?: boolean;
}

export function targetOfAlarm(a: Alarm): EvidenceTarget {
  return {
    id: a.id,
    kind: 'alarm',
    eventId: a.eventId,
    alarmId: a.id,
    useCaseId: a.useCaseId,
    priority: a.priority,
    title: a.title,
    titleEs: a.titleEs,
    convoyId: a.convoyId,
    vesselId: a.vesselId,
    cameraId: a.cameraId,
    voyageId: a.voyageId,
    at: a.raisedAt,
    detection: a.detection,
    classification: a.classification,
    falseReason: a.falseReason,
    stateTimes: a.stateTimes,
    receivedAshore: a.activity.find((x) => x.text.startsWith('Received ashore'))?.at,
    models: a.models,
  };
}

export function targetOfEvent(e: ReviewEvent, voyageId: string | undefined, receivedAshore?: string): EvidenceTarget {
  const uc = useCaseById(e.useCaseId);
  return {
    id: e.id,
    kind: 'event',
    eventId: e.id,
    useCaseId: e.useCaseId,
    priority: uc?.priority ?? 'P3',
    title: uc?.name ?? e.useCaseId,
    titleEs: uc?.nameEs,
    convoyId: e.convoyId,
    vesselId: e.vesselId,
    cameraId: e.cameraId,
    voyageId,
    at: e.at,
    detection: e.detection,
    classification: e.classification,
    falseReason: e.falseReason,
    receivedAshore,
    queued: e.queued,
    shadow: e.shadow,
  };
}

const CLIP_DETECT = 3; // detection starts 3 s into the 15 s clip
const CLIP_MARK = 8; // the rule fires 5 s later

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
/** "143206" in Asunción time */
const hhmmss = (iso: string) => fmtTimeSec(iso).replace(/\D/g, '');

export function useEvidenceExport() {
  const ex = useExporter();
  const { state, toast } = useApp();
  const tx = useAlarmText();
  const { tr, fleet } = tx;
  const ucRecords = useStore(ucStore);
  const [saved, setSaved] = usePersistentState<Record<string, ExportRecord[]>>('alarms.exports', {});
  const [busy, setBusy] = useState<string | null>(null);

  const remember = useCallback(
    (id: string, rec: ExportRecord) => setSaved((m) => ({ ...m, [id]: [rec, ...(m[id] ?? [])] })),
    [setSaved],
  );

  const one = useCallback(
    async (t: EvidenceTarget, item: EvidenceItem, evidence: EvidenceItem[], silent = false) => {
      const cam = fleet.cameraById(t.cameraId);
      const vessel = fleet.vesselById(t.vesselId ?? cam?.vesselId);
      const convoy = fleet.convoyById(t.convoyId);
      const det = t.detection;
      const label = det ? `${tx.detLabel(det.label)} · ${det.confidence.toFixed(2)}` : undefined;
      const note = tr('Faces blurred', 'Rostros difuminados');
      const by = state.user.name;
      const toastFor = (file: string, wm: PdfWatermark): [string, string] => [
        `${file} downloaded, watermark ${wm.id}. Faces blurred; the download is in the audit log.`,
        `${file} descargado, marca de agua ${wm.id}. Rostros difuminados; la descarga queda en el registro de auditoría.`,
      ];

      if (item.kind === 'snapshot') {
        if (!cam) throw new Error('No camera');
        const file = `${t.id}-${cam.id}-snapshot-${hhmmss(t.at)}.svg`;
        const wm = await ex.image(cam.image, file, {
          action: 'Exported snapshot',
          target: t.id,
          details: `${item.name} · Faces blurred`,
          convoyId: t.convoyId,
          note,
          silent,
          box: det ? { ...det.box, label } : undefined,
        });
        remember(t.id, { item: item.name, file, wm: wm.id, at: scenarioNow(), by });
        return;
      }

      if (item.kind === 'clip' || item.kind === 'footage') {
        if (!cam) throw new Error('No camera');
        const footage = item.kind === 'footage';
        const duration = footage ? FOOTAGE_SECONDS : 15;
        const markAt = footage ? FOOTAGE_LEAD : CLIP_MARK;
        const detectAt = markAt - (CLIP_MARK - CLIP_DETECT);
        const file = footage ? `${t.id}-${cam.id}-recorder-2min.svg` : `${t.id}-${cam.id}-clip-15s.svg`;
        const frame = await frameDataUri(cam.image);
        const wm = ex.nextWatermark(note);
        const svg = buildClipSvg({
          title: `${t.id} · ${tx.es && t.titleEs ? t.titleEs : t.title}`,
          cameraId: cam.id,
          cameraLabel: `${vessel?.name ?? ''} · ${cam.name}`,
          frame,
          startMs: new Date(t.at).getTime() - markAt * 1000,
          duration,
          detectAt,
          markAt,
          box: det?.box,
          label,
          zone: det?.zone,
          blurHeads: PEOPLE_USE_CASES.has(t.useCaseId),
          watermark: wm,
          text: {
            raised: t.kind === 'alarm' ? tr('Alarm raised', 'Alarma generada') : tr('Event recorded', 'Evento registrado'),
            segment: tx.p(segmentLabelFor(t.useCaseId)),
            facesBlurred: note,
          },
        });
        downloadBlob(file, svg, 'image/svg+xml');
        ex.logged(file, {
          action: footage ? 'Exported recorder footage' : 'Exported clip',
          target: t.id,
          details: `${item.name} · Faces blurred · Watermark ${wm.id}`,
          convoyId: t.convoyId,
          silent,
          toast: toastFor(file, wm),
        });
        remember(t.id, { item: item.name, file, wm: wm.id, at: scenarioNow(), by });
        return;
      }

      // Detection (or scene check) record: the event as JSON.
      const scene = item.name.startsWith('Scene check');
      const file = `${t.id}-${scene ? 'scene-check' : 'detection'}-record.json`;
      const wm = ex.nextWatermark(note);
      const uc = useCaseById(t.useCaseId);
      const rec = ucRecords[t.useCaseId];
      const body = {
        schema: 'gfsa.cctv.detection-record/1',
        eventId: t.eventId,
        alarmId: t.alarmId ?? null,
        useCase: { id: t.useCaseId, name: uc?.name ?? t.useCaseId, version: rec ? (liveOf(rec)?.version ?? null) : null, status: rec?.status ?? uc?.status ?? null },
        priority: t.priority,
        title: t.title,
        convoy: { id: t.convoyId, name: convoy?.name ?? null },
        vessel: vessel ? { id: vessel.id, name: vessel.name, edgeUnit: vessel.edgeUnitId } : null,
        camera: cam ? { id: cam.id, name: cam.name, position: cam.position, facing: cam.facing } : null,
        voyageId: t.voyageId ?? null,
        times: {
          detectedOnBoard: t.at,
          receivedAshore: t.receivedAshore ?? null,
          states: t.stateTimes ?? null,
          timeZone: 'America/Asuncion',
        },
        storedOnBoard: Boolean(t.queued),
        shadowRun: Boolean(t.shadow),
        detection: det
          ? { label: det.label, confidence: det.confidence, box: { ...det.box, unit: 'percent of frame' }, zone: det.zone ? { name: det.zoneName ?? null, polygon: det.zone } : null }
          : null,
        classification: t.classification ? { value: t.classification, reason: t.falseReason ?? null } : null,
        models: t.models ?? null,
        evidence: evidence.filter((e) => e.kind !== 'record').map((e) => ({ file: e.name, format: e.meta, sha256: e.hash?.replace(/^sha256 /, '') ?? null })),
        export: { watermark: wm.id, by: wm.user, at: wm.at, facesBlurred: true },
      };
      const json = JSON.stringify({ ...body, digest: fakeHash(JSON.stringify(body)) }, null, 2);
      downloadBlob(file, json, 'application/json');
      ex.logged(file, {
        action: scene ? 'Exported scene check record' : 'Exported detection record',
        target: t.id,
        details: `${item.name} · Watermark ${wm.id}`,
        convoyId: t.convoyId,
        silent,
        toast: [
          `${file} downloaded, watermark ${wm.id}. The download is in the audit log.`,
          `${file} descargado, marca de agua ${wm.id}. La descarga queda en el registro de auditoría.`,
        ],
      });
      remember(t.id, { item: item.name, file, wm: wm.id, at: scenarioNow(), by });
    },
    [ex, fleet, remember, state.user.name, tr, tx, ucRecords],
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key);
      try {
        await fn();
      } catch {
        toast(tr('The file could not be built. Try again; nothing was logged.', 'No se pudo generar el archivo. Intente de nuevo; no se registró nada.'));
      } finally {
        setBusy(null);
      }
    },
    [toast, tr],
  );

  return {
    busy,
    exportsFor: (id: string) => saved[id] ?? [],
    exportOne: (t: EvidenceTarget, item: EvidenceItem, evidence: EvidenceItem[]) => run(`${t.id}|${item.name}`, () => one(t, item, evidence)),
    /** "Export all": one file per evidence item, each watermarked and logged. */
    exportAll: (t: EvidenceTarget, evidence: EvidenceItem[]) =>
      run(`${t.id}|all`, async () => {
        for (const [i, item] of evidence.entries()) {
          if (i) await wait(450);
          await one(t, item, evidence, true);
        }
        // One summary instead of a toast per file; each file is still logged with its watermark.
        toast(
          tr(
            `${evidence.length} files from ${t.id} downloaded, each watermarked, faces blurred. Every download is in the audit log.`,
            `${evidence.length} archivos de ${t.id} descargados, cada uno con marca de agua y rostros difuminados. Cada descarga queda en el registro de auditoría.`,
          ),
        );
      }),
  };
}

export type EvidenceExport = ReturnType<typeof useEvidenceExport>;
