import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { useLang, useTr } from '../../lib/i18n';
import { newZoneId, type Pt, type Zone } from '../../state/configStore';
import { zoneNoteText } from './useCaseSetup';
import './ZoneEditor.css';

// UC-03 / CAM-03: draw polygon zones and lines on a camera's reference view.
// Coordinates are kept in % of the image so they survive any display size.
// Works with a mouse, touch or the keyboard: while drawing, a crosshair moves
// with the arrow keys and Enter or Space places a point.

export type ZoneTool = 'polygon' | 'line' | 'move';

const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 100) / 100;

export const zoneSummary = (z: Zone, es = false) =>
  z.kind === 'polygon' ? (es ? `Polígono · ${z.points.length} puntos` : `Polygon · ${z.points.length} points`) : es ? 'Línea' : 'Line';

function anchor(z: Zone): Pt {
  if (z.kind === 'line' && z.points.length >= 2) {
    const [a, b] = z.points;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  const n = z.points.length || 1;
  return [z.points.reduce((s, p) => s + p[0], 0) / n, z.points.reduce((s, p) => s + p[1], 0) / n];
}

const ptsAttr = (pts: Pt[]) => pts.map((p) => `${p[0]},${p[1]}`).join(' ');
const near = (a: Pt, b: Pt, pct = 2.5) => Math.abs(a[0] - b[0]) <= pct && Math.abs(a[1] - b[1]) <= pct;
const round = (v: number) => Math.round(v);

export function ZoneEditor({
  image,
  alt,
  tag,
  zones,
  onChange,
  selectedId,
  onSelect,
  extraTools,
  degraded = false,
}: {
  image: string;
  alt: string;
  tag?: ReactNode;
  zones: Zone[];
  /** Leave out for a read-only view. */
  onChange?: (zones: Zone[]) => void;
  selectedId?: string;
  onSelect?: (id: string | undefined) => void;
  extraTools?: ReactNode;
  degraded?: boolean;
}) {
  const tr = useTr();
  const editable = !!onChange;
  const [tool, setTool] = useState<ZoneTool>('move');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt>([50, 50]);
  const [keyboard, setKeyboard] = useState(false);
  const [focused, setFocused] = useState(false);
  const [said, setSaid] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ zoneId: string; index: number } | null>(null);
  const focusCanvas = useRef(false);
  const focusHandle = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const keysId = useId();

  const drawing = editable && tool !== 'move';
  const selected = zones.find((z) => z.id === selectedId);
  const showCross = drawing && focused && keyboard;

  // After choosing a drawing tool, the reference view takes the focus so the keys work at once.
  useEffect(() => {
    if (drawing && focusCanvas.current) {
      focusCanvas.current = false;
      boxRef.current?.focus();
    }
  }, [drawing, tool]);

  // After a zone is finished from the keyboard, its first point takes the focus so it can be adjusted.
  useEffect(() => {
    if (!focusHandle.current || drawing) return;
    focusHandle.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>('.ze__handle')?.focus();
  }, [drawing, selectedId]);

  const toPct = (e: { clientX: number; clientY: number }): Pt => {
    const r = boxRef.current!.getBoundingClientRect();
    return [clamp(((e.clientX - r.left) / r.width) * 100), clamp(((e.clientY - r.top) / r.height) * 100)];
  };

  const pickTool = (t: ZoneTool, e?: MouseEvent) => {
    focusHandle.current = false;
    setTool(t);
    setDraft([]);
    setHover(null);
    if (t !== 'move') {
      focusCanvas.current = true;
      // A keyboard press on the tool button (no pointer position) starts keyboard drawing.
      setKeyboard(!!e && e.detail === 0);
      setCursor([50, 50]);
    }
  };

  const finish = (pts: Pt[] = draft, kind: 'polygon' | 'line' = tool === 'line' ? 'line' : 'polygon') => {
    if (!onChange) return;
    if (kind === 'polygon' && pts.length < 3) return;
    if (kind === 'line' && pts.length < 2) return;
    const n = zones.filter((z) => z.kind === kind).length + 1;
    const zone: Zone = { id: newZoneId(), name: kind === 'line' ? tr(`New line ${n}`, `Nueva línea ${n}`) : tr(`New zone ${n}`, `Nueva zona ${n}`), kind, points: pts };
    onChange([...zones, zone]);
    onSelect?.(zone.id);
    setDraft([]);
    setHover(null);
    setTool('move');
    setSaid(tr(`${zone.name} added with ${pts.length} points.`, `${zone.name} agregada con ${pts.length} puntos.`));
  };

  /** Adds a point where the pointer or the crosshair is; closes the shape when it is done. */
  const place = (p: Pt, closeDistance: (a: Pt, b: Pt) => boolean) => {
    if (tool === 'polygon' && draft.length >= 3 && closeDistance(p, draft[0])) {
      finish(draft, 'polygon');
      return;
    }
    const next = [...draft, p];
    if (tool === 'line' && next.length === 2) {
      finish(next, 'line');
      return;
    }
    setDraft(next);
    setSaid(tr(`Point ${next.length} at ${round(p[0])}%, ${round(p[1])}%.`, `Punto ${next.length} en ${round(p[0])} %, ${round(p[1])} %.`));
  };

  const onCanvasDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setKeyboard(false);
    if (!drawing) {
      onSelect?.(undefined);
      return;
    }
    const p = toPct(e);
    setCursor(p);
    const r = boxRef.current!.getBoundingClientRect();
    place(p, (a, b) => Math.hypot(((a[0] - b[0]) / 100) * r.width, ((a[1] - b[1]) / 100) * r.height) < 14);
  };

  const movePoint = (zoneId: string, index: number, p: Pt) => {
    onChange?.(zones.map((z) => (z.id === zoneId ? { ...z, points: z.points.map((q, i) => (i === index ? p : q)) } : z)));
  };

  const removePoint = (z: Zone, index: number) => {
    if (z.kind !== 'polygon' || z.points.length <= 3) return;
    onChange?.(zones.map((x) => (x.id === z.id ? { ...x, points: x.points.filter((_, i) => i !== index) } : x)));
  };

  const onHandleKey = (z: Zone, i: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 5 : 1;
    const [x, y] = z.points[i];
    const moves: Record<string, Pt> = {
      ArrowLeft: [clamp(x - step), y],
      ArrowRight: [clamp(x + step), y],
      ArrowUp: [x, clamp(y - step)],
      ArrowDown: [x, clamp(y + step)],
    };
    if (moves[e.key]) {
      e.preventDefault();
      movePoint(z.id, i, moves[e.key]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removePoint(z, i);
    }
  };

  const onCanvasKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!drawing || e.target !== boxRef.current) return;
    const step = e.shiftKey ? 5 : 1;
    const [x, y] = cursor;
    const moves: Record<string, Pt> = {
      ArrowLeft: [clamp(x - step), y],
      ArrowRight: [clamp(x + step), y],
      ArrowUp: [x, clamp(y - step)],
      ArrowDown: [x, clamp(y + step)],
    };
    if (moves[e.key]) {
      e.preventDefault();
      setKeyboard(true);
      setCursor(moves[e.key]);
      setHover(null);
      setSaid(tr(`Crosshair at ${round(moves[e.key][0])}%, ${round(moves[e.key][1])}%.`, `Cruz en ${round(moves[e.key][0])} %, ${round(moves[e.key][1])} %.`));
      return;
    }
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        setKeyboard(true);
        focusHandle.current = true;
        place(cursor, (a, b) => near(a, b));
        break;
      case 'Home':
        if (draft.length) {
          e.preventDefault();
          setKeyboard(true);
          setCursor(draft[0]);
          setSaid(tr('Crosshair on the first point. Enter closes the zone.', 'Cruz en el primer punto. Enter cierra la zona.'));
        }
        break;
      case 'Backspace':
      case 'Delete':
        if (draft.length) {
          e.preventDefault();
          setDraft(draft.slice(0, -1));
          setSaid(tr(`Point ${draft.length} removed.`, `Punto ${draft.length} quitado.`));
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (draft.length) {
          setDraft([]);
          setHover(null);
          setSaid(tr('Points cleared.', 'Puntos borrados.'));
        } else pickTool('move');
        break;
    }
  };

  const deleteSelected = () => {
    if (!selected || !onChange) return;
    onChange(zones.filter((z) => z.id !== selected.id));
    onSelect?.(undefined);
  };

  const canFinish = tool === 'polygon' && draft.length >= 3;
  const tip = hover ?? (showCross ? cursor : null);
  const closing = tool === 'polygon' && draft.length >= 3 && showCross && near(cursor, draft[0]);

  return (
    <div className="ze" ref={rootRef}>
      {editable && (
        <div role="toolbar" aria-label={tr('Zone tools', 'Herramientas de zona')} className="ze__tools">
          <button type="button" className="ze__tool" aria-pressed={tool === 'polygon'} onClick={(e) => pickTool('polygon', e)}>
            <Icon name="edit" size={15} /> {tr('Draw zone', 'Dibujar zona')}
          </button>
          <button type="button" className="ze__tool" aria-pressed={tool === 'line'} onClick={(e) => pickTool('line', e)}>
            <Icon name="minus" size={15} /> {tr('Draw line', 'Dibujar línea')}
          </button>
          <button type="button" className="ze__tool" aria-pressed={tool === 'move'} onClick={() => pickTool('move')}>
            <Icon name="maximize" size={15} /> {tr('Move points', 'Mover puntos')}
          </button>
          <button type="button" className="ze__tool" disabled={!selected} title={selected ? undefined : tr('Select a zone first, on the image or in the list', 'Primero seleccione una zona, en la imagen o en la lista')} onClick={deleteSelected}>
            <Icon name="trash" size={15} /> {tr('Delete zone', 'Eliminar zona')}
          </button>
          {extraTools}
        </div>
      )}

      {drawing && (
        <div className="ze__hint">
          <span role="status">
            {tool === 'polygon'
              ? draft.length === 0
                ? tr('Click on the image to place the first point of the zone.', 'Haga clic en la imagen para poner el primer punto de la zona.')
                : tr(
                    `${draft.length} point${draft.length === 1 ? '' : 's'}. Keep clicking, then click the first point or Finish to close the zone.`,
                    `${draft.length} punto${draft.length === 1 ? '' : 's'}. Siga marcando y luego haga clic en el primer punto o en Terminar para cerrar la zona.`,
                  )
              : draft.length === 0
                ? tr('Click where the line starts.', 'Haga clic donde empieza la línea.')
                : tr('Click where the line ends.', 'Haga clic donde termina la línea.')}
          </span>
          <span className="ze__hint-actions">
            {tool === 'polygon' && (
              <button type="button" className="btn btn--sm btn--primary" disabled={!canFinish} title={canFinish ? undefined : tr('A zone needs at least 3 points', 'Una zona necesita al menos 3 puntos')} onClick={() => finish()}>
                {tr('Finish zone', 'Terminar zona')}
              </button>
            )}
            <button type="button" className="btn btn--sm" onClick={() => pickTool('move')}>
              {tr('Cancel', 'Cancelar')}
            </button>
          </span>
          <span id={keysId} className="ze__keys">
            {tr(
              'Keyboard: arrow keys move the crosshair (Shift for bigger steps), Enter or Space places a point, Home jumps to the first point, Backspace removes the last one, Escape cancels.',
              'Teclado: las flechas mueven la cruz (Mayús para pasos más grandes), Enter o Espacio ponen un punto, Inicio salta al primer punto, Retroceso quita el último, Escape cancela.',
            )}
          </span>
        </div>
      )}

      <div
        ref={boxRef}
        className={`ze__canvas${drawing ? ' ze__canvas--draw' : ''}`}
        tabIndex={drawing ? 0 : undefined}
        role={drawing ? 'application' : undefined}
        aria-roledescription={drawing ? tr('drawing area', 'área de dibujo') : undefined}
        aria-label={
          drawing
            ? tr(
                `Reference view, ${tool === 'line' ? 'drawing a line' : 'drawing a zone'}. ${draft.length} point${draft.length === 1 ? '' : 's'} placed.`,
                `Vista de referencia, ${tool === 'line' ? 'dibujando una línea' : 'dibujando una zona'}. ${draft.length} punto${draft.length === 1 ? '' : 's'} marcado${draft.length === 1 ? '' : 's'}.`,
              )
            : undefined
        }
        aria-describedby={drawing ? keysId : undefined}
        onKeyDown={onCanvasKey}
        onFocus={(e) => e.target === boxRef.current && setFocused(true)}
        onBlur={(e) => e.target === boxRef.current && setFocused(false)}
        onPointerDown={onCanvasDown}
        onPointerMove={(e) => {
          if (!drawing) return;
          const p = toPct(e);
          if (draft.length) setHover(p);
          setCursor(p);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <img src={image} alt={alt} draggable={false} className={degraded ? 'ze__img ze__img--degraded' : 'ze__img'} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`ze__svg${!drawing ? ' ze__svg--select' : ''}`} aria-hidden="true">
          {zones.map((z) => {
            const isSel = z.id === selectedId;
            const select = (e: PointerEvent<SVGElement>) => {
              if (drawing) return;
              e.stopPropagation();
              onSelect?.(z.id);
            };
            return z.kind === 'polygon' ? (
              <polygon key={z.id} points={ptsAttr(z.points)} className={`ze__poly${isSel ? ' is-selected' : ''}`} vectorEffect="non-scaling-stroke" onPointerDown={select} />
            ) : (
              <g key={z.id} onPointerDown={select}>
                <polyline points={ptsAttr(z.points)} className="ze__line-hit" vectorEffect="non-scaling-stroke" />
                <polyline points={ptsAttr(z.points)} className={`ze__line${isSel ? ' is-selected' : ''}`} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {drawing && draft.length > 0 && (
            <polyline points={ptsAttr(tip ? [...draft, tip] : draft)} className={tool === 'line' ? 'ze__draft ze__draft--line' : 'ze__draft'} vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {zones.map((z) => {
          const [x, y] = anchor(z);
          return (
            <span
              key={`l-${z.id}`}
              className={`ze__label${z.kind === 'line' ? ' ze__label--line' : ''}`}
              style={{ left: `${Math.min(78, Math.max(1, x - 8))}%`, top: `${Math.min(90, Math.max(4, y + (z.kind === 'line' ? 4 : 0)))}%` }}
            >
              {z.name}
            </span>
          );
        })}

        {drawing &&
          draft.map((p, i) => (
            <span key={i} className={`ze__dot${i === 0 && tool === 'polygon' && draft.length >= 3 ? ' ze__dot--close' : ''}`} style={{ left: `${p[0]}%`, top: `${p[1]}%` }} />
          ))}

        {showCross && (
          <span className={`ze__cross${closing ? ' ze__cross--close' : ''}`} style={{ left: `${cursor[0]}%`, top: `${cursor[1]}%` }} aria-hidden="true">
            <span className="ze__cross-pos">
              {round(cursor[0])}, {round(cursor[1])}
            </span>
          </span>
        )}

        {editable &&
          !drawing &&
          selected &&
          selected.points.map((p, i) => (
            <button
              key={`${selected.id}-${i}`}
              type="button"
              className="ze__handle"
              style={{ left: `${p[0]}%`, top: `${p[1]}%` }}
              aria-label={tr(
                `${selected.name}, point ${i + 1} of ${selected.points.length}. Drag, or use the arrow keys to move it${selected.kind === 'polygon' && selected.points.length > 3 ? '; Delete removes it' : ''}.`,
                `${selected.name}, punto ${i + 1} de ${selected.points.length}. Arrástrelo o use las flechas para moverlo${selected.kind === 'polygon' && selected.points.length > 3 ? '; Suprimir lo quita' : ''}.`,
              )}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                dragRef.current = { zoneId: selected.id, index: i };
              }}
              onPointerMove={(e) => {
                const dr = dragRef.current;
                if (dr) movePoint(dr.zoneId, dr.index, toPct(e));
              }}
              onPointerUp={(e) => {
                dragRef.current = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onKeyDown={(e) => onHandleKey(selected, i, e)}
            />
          ))}

        {tag && <span className="ze__tag">{tag}</span>}
      </div>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
      {editable && !drawing && zones.length > 0 && (
        <p className="ze__foot">
          {selected
            ? tr('Drag the square handles, or Tab to one and move it with the arrow keys.', 'Arrastre los cuadrados, o llegue a uno con Tab y muévalo con las flechas.')
            : tr('Select a zone on the image or in the list to move its points.', 'Seleccione una zona en la imagen o en la lista para mover sus puntos.')}
        </p>
      )}
    </div>
  );
}

/** Zones listed beside the reference view; the selected one can be renamed or removed. */
export function ZoneList({
  zones,
  selectedId,
  onSelect,
  onRename,
  onDelete,
  describe,
}: {
  zones: Zone[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
  describe?: (z: Zone) => string;
}) {
  const tr = useTr();
  const es = useLang() === 'es';
  const text = describe ?? ((z: Zone) => [zoneSummary(z, es), zoneNoteText(z.note, es)].filter(Boolean).join(' · '));
  if (!zones.length) return <p className="ze-list__empty">{tr('No zones on this camera yet.', 'Esta cámara todavía no tiene zonas.')}</p>;
  return (
    <ul className="ze-list">
      {zones.map((z) => {
        const isSel = z.id === selectedId;
        return (
          <li key={z.id} className={`ze-list__item${isSel ? ' is-selected' : ''}`}>
            <button type="button" className="ze-list__pick" aria-pressed={onSelect ? isSel : undefined} onClick={() => onSelect?.(z.id)} disabled={!onSelect}>
              <span className="ze-list__name">
                <span className={`ze-list__swatch${z.kind === 'line' ? ' ze-list__swatch--line' : ''}`} aria-hidden="true" />
                {z.name}
              </span>
              <span className="ze-list__desc">{text(z)}</span>
            </button>
            {isSel && (onRename || onDelete) && (
              <div className="ze-list__edit">
                {onRename && (
                  <label className="field">
                    <span className="field__label">{tr('Name', 'Nombre')}</span>
                    <input className="input" value={z.name} onChange={(e) => onRename(z.id, e.target.value)} />
                  </label>
                )}
                {onDelete && (
                  <button type="button" className="btn btn--sm" onClick={() => onDelete(z.id)}>
                    <Icon name="trash" size={14} /> {tr('Delete', 'Eliminar')}
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
