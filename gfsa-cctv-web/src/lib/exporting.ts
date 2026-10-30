import { useCallback, useMemo } from 'react';
import { useApp } from '../state/AppState';
import { createStore } from './persist';
import { downloadCsv, downloadPdf, downloadWatermarkedImage, type PdfDoc, type PdfWatermark } from './download';
import { fmtDayTime, scenarioNow } from './time';

// One hook for every download in the console (REP-03, ALM-08, ADM-03):
// it produces the real file, stamps a watermark ID with the user and time,
// writes the download to the audit log and confirms with a toast.
//
//   const ex = useExporter();
//   ex.csv('voyages.csv', rows, { action: 'Exported voyages', target: 'All convoys' });
//   ex.pdf('daily-summary.pdf', { title, blocks }, { action: 'Downloaded report', target: 'Daily summary · F 501' });
//   ex.image(cam.image, 'F503-CAM-02.svg', { action: 'Exported snapshot', target: alarm.id, box });

const wmStore = createStore<number>('watermark.seq', 1187);

export interface ExportMeta {
  /** Audit log action, e.g. "Exported clip". */
  action: string;
  /** Audit log object, e.g. "ALM-26-0318". */
  target: string;
  details?: string;
  convoyId?: string;
  /** Overrides the default toast (English, Spanish). */
  toast?: [string, string];
  /** Printed on the watermark, e.g. "Faces blurred". */
  note?: string;
  /** Skip the toast (e.g. when "Export all" shows one summary toast itself). */
  silent?: boolean;
}

export function useExporter() {
  const { state, log, toast } = useApp();
  const es = state.lang === 'es';
  const user = state.user.name;

  const nextWatermark = useCallback(
    (note?: string): PdfWatermark => {
      wmStore.set((n) => n + 1);
      return { id: `WM-26-${wmStore.get()}`, user, at: `${fmtDayTime(scenarioNow())} Asunción`, note };
    },
    [user],
  );

  const done = useCallback(
    (file: string, wm: PdfWatermark | undefined, meta: ExportMeta) => {
      log(meta.action, meta.target, [meta.details, wm ? `Watermark ${wm.id}` : undefined, file].filter(Boolean).join(' · '), meta.convoyId, 'export');
      if (meta.silent) return;
      const [en, sp] = meta.toast ?? [
        `${file} downloaded${wm ? `, watermark ${wm.id}` : ''}. The download is in the audit log.`,
        `${file} descargado${wm ? `, marca de agua ${wm.id}` : ''}. La descarga queda en el registro de auditoría.`,
      ];
      toast(es ? sp : en);
    },
    [log, toast, es],
  );

  return useMemo(
    () => ({
      nextWatermark,
      csv(filename: string, rows: (string | number | boolean | undefined | null)[][], meta: ExportMeta) {
        downloadCsv(filename, rows);
        done(filename, undefined, meta);
      },
      pdf(filename: string, doc: Omit<PdfDoc, 'watermark'>, meta: ExportMeta) {
        const wm = nextWatermark(meta.note);
        downloadPdf(filename, { ...doc, watermark: wm });
        done(filename, wm, meta);
        return wm;
      },
      async image(src: string, filename: string, meta: ExportMeta & { box?: { x: number; y: number; w: number; h: number; label?: string } }) {
        const wm = nextWatermark(meta.note);
        await downloadWatermarkedImage(src, filename, wm, meta.box);
        done(filename, wm, meta);
        return wm;
      },
      /**
       * For files built elsewhere (a JSON record, an animated SVG clip): logs and toasts only.
       * Pass the watermark burned into the file (from nextWatermark()) so the log matches it;
       * `true` creates a new one.
       */
      logged(filename: string, meta: ExportMeta, watermark: boolean | PdfWatermark = false) {
        const wm = watermark === true ? nextWatermark(meta.note) : watermark || undefined;
        done(filename, wm, meta);
        return wm;
      },
    }),
    [nextWatermark, done],
  );
}
