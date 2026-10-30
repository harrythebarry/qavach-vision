import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useTr } from '../lib/i18n';
import { Icon } from './Icon';
import { PriorityBadge } from './ui';

// The header's help button (and the "?" key): shortcuts, what the colours mean,
// the glossary from the PRD and how to reach support.

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const keys: [string, string, string][] = [
    ['Ctrl K', 'Search vessels, cameras, alarms and screens', 'Buscar embarcaciones, cámaras, alarmas y pantallas'],
    ['?', 'Open this help', 'Abrir esta ayuda'],
    ['A', 'Accept the event (alarm console, review queue)', 'Aceptar el evento (consola de alarmas, cola de revisión)'],
    ['R', 'Reject: it happened, no action needed', 'Rechazar: ocurrió, no requiere acción'],
    ['F', 'False alert, then 1–4 to pick the reason', 'Falsa alerta, luego 1–4 para elegir el motivo'],
    ['J', 'Next item in the queue', 'Siguiente elemento de la cola'],
    ['Esc', 'Close a dialog or cancel', 'Cerrar un diálogo o cancelar'],
  ];

  const glossary: [string, string, string, string][] = [
    ['Convoy', 'Convoy', 'A tug pushing one or more barges on one voyage', 'Un remolcador que empuja una o más barcazas en un viaje'],
    ['Edge unit', 'Unidad de borde', 'The rugged computer on each tug and barge that runs the models on the camera feeds', 'El equipo robusto en cada remolcador y barcaza que ejecuta los modelos sobre las cámaras'],
    ['Event', 'Evento', 'Anything a use case detects, logged with time, vessel, camera, clip and voyage', 'Todo lo que detecta un caso de uso, registrado con hora, embarcación, cámara, clip y viaje'],
    ['Alarm', 'Alarma', 'An event at alert level that is routed to people and must be acknowledged', 'Un evento de nivel alerta que se envía a personas y debe confirmarse'],
    ['Shadow run', 'Ejecución en sombra', '14 days of logging and review with alerts off, before a use case goes live', '14 días de registro y revisión con alertas apagadas antes de activar un caso de uso'],
    ['Scene check', 'Control de escena', 'An hourly test of each camera for blur, glare, a wet lens, movement or no image', 'Una prueba horaria de cada cámara: desenfoque, reflejos, lente mojada, movimiento o sin imagen'],
    ['Store and forward', 'Almacenar y reenviar', 'Events wait on board and go ashore in priority order when the link returns', 'Los eventos esperan a bordo y llegan a tierra por prioridad cuando vuelve el enlace'],
    ['Connect', 'Connect', "GFSA's operational system for voyages, schedules and cargo", 'El sistema operativo de GFSA para viajes, horarios y carga'],
  ];

  return (
    <div className="help-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="help"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="help__head">
          <h2 id="help-title">{tr('Help', 'Ayuda')}</h2>
          <button type="button" className="btn btn--ghost btn--icon" aria-label={tr('Close help', 'Cerrar ayuda')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <section>
          <h3>{tr('Keyboard shortcuts', 'Atajos de teclado')}</h3>
          <dl className="help__keys">
            {keys.map(([k, en, es]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{tr(en, es)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3>{tr('Alarm priorities', 'Prioridades de alarma')}</h3>
          <ul className="help__list">
            <li>
              <PriorityBadge p="P1" /> {tr('Wheelhouse at once; duty officer by WhatsApp, SMS and call; escalates in 2 min', 'Puente de inmediato; oficial de guardia por WhatsApp, SMS y llamada; escala en 2 min')}
            </li>
            <li>
              <PriorityBadge p="P2" /> {tr('Wheelhouse at once; duty officer by WhatsApp and SMS; escalates in 5 min', 'Puente de inmediato; oficial de guardia por WhatsApp y SMS; escala en 5 min')}
            </li>
            <li>
              <PriorityBadge p="P3" /> {tr('Listed on the wheelhouse; in the console queue; digest after 60 min', 'En la lista del puente; en la cola de la consola; resumen a los 60 min')}
            </li>
            <li>
              <PriorityBadge p="P4" /> {tr('Console only; in the daily summary', 'Solo consola; en el resumen diario')}
            </li>
          </ul>
          <p className="help__note">{tr('The ladder for each priority is set on Alert routing.', 'La escala de cada prioridad se define en Enrutamiento de alertas.')}</p>
        </section>

        <section>
          <h3>{tr('Glossary', 'Glosario')}</h3>
          <dl className="help__gloss">
            {glossary.map(([en, es, den, des]) => (
              <div key={en}>
                <dt>{tr(en, es)}</dt>
                <dd>{tr(den, des)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3>{tr('Support', 'Soporte')}</h3>
          <p className="help__note">
            {tr(
              '24/7 support desk in Spanish and English. First response: P1 in 15 minutes, P2 in 1 hour.',
              'Mesa de soporte 24/7 en español e inglés. Primera respuesta: P1 en 15 minutos, P2 en 1 hora.',
            )}
          </p>
          <div className="help__links">
            <Link to="/support" className="btn btn--sm" onClick={onClose}>
              <Icon name="message" size={16} /> {tr('Contact support', 'Contactar soporte')}
            </Link>
            <Link to="/status" className="btn btn--sm btn--ghost" onClick={onClose}>
              <Icon name="activity" size={16} /> {tr('Service status', 'Estado del servicio')}
            </Link>
            <Link to="/privacy" className="btn btn--sm btn--ghost" onClick={onClose}>
              <Icon name="shield" size={16} /> {tr('Privacy', 'Privacidad')}
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
