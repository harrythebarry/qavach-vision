import { Link } from 'react-router';
import { Card } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useTr } from '../../lib/i18n';
import { PublicLayout } from './PublicLayout';

// The PRD's privacy and data rules in plain language (design rule 7, non-goals,
// NFR Privacy, Data ownership, Retention, Audit), for crew, GFSA staff and visitors.

type Block = { h: [string, string]; p?: [string, string][]; list?: [string, string][] };

const FACTS: { icon: IconName; t: [string, string]; s: [string, string] }[] = [
  { icon: 'eye', t: ['Behaviours, not identities', 'Conductas, no identidades'], s: ['It detects acts and conditions, not who someone is.', 'Detecta actos y situaciones, no quién es una persona.'] },
  { icon: 'shield', t: ['No face recognition', 'Sin reconocimiento facial'], s: ['Crew members are never identified by the system.', 'El sistema nunca identifica a los tripulantes.'] },
  { icon: 'users', t: ['Faces blurred outside GFSA', 'Rostros difuminados fuera de GFSA'], s: ['Every clip that leaves GFSA has faces blurred.', 'Todo clip que sale de GFSA lleva los rostros difuminados.'] },
  { icon: 'calendar', t: ['12 months and 90 days', '12 meses y 90 días'], s: ['Events are kept 12 months, clips 90 days.', 'Los eventos se guardan 12 meses; los clips, 90 días.'] },
  { icon: 'lock', t: ['GFSA owns the footage', 'Las imágenes son de GFSA'], s: ['Training uses it only with GFSA’s written consent.', 'Solo se usan para entrenar con consentimiento escrito de GFSA.'] },
  { icon: 'list', t: ['Every view is logged', 'Cada vista queda registrada'], s: ['Live views, clips and downloads go in the audit log.', 'Vistas en vivo, clips y descargas quedan en el registro de auditoría.'] },
];

const SECTIONS: Block[] = [
  {
    h: ['What the cameras look for', 'Qué buscan las cámaras'],
    p: [
      [
        'The AI units on board watch GFSA’s existing cameras for safety and operational events: a missing life jacket near the water, a hard hat or vest not worn, smoke, a container door left open, a reefer round not done. It detects acts and conditions. It does not recognise faces and does not identify crew members.',
        'Las unidades de IA a bordo observan las cámaras que GFSA ya tiene en busca de eventos de seguridad y de operación: falta de chaleco salvavidas cerca del agua, casco o chaleco sin usar, humo, una puerta de contenedor abierta, una ronda de reefers no hecha. Detecta actos y situaciones. No reconoce rostros ni identifica a los tripulantes.',
      ],
      [
        'People confirm every event. A reviewer ashore accepts or rejects it, and an alarm is handled by the wheelhouse and the duty officer. The system takes no automatic action.',
        'Una persona confirma cada evento. Un revisor en tierra lo acepta o lo rechaza, y el puente y el oficial de guardia atienden las alarmas. El sistema no toma ninguna acción automática.',
      ],
    ],
  },
  {
    h: ['What it does not do', 'Lo que no hace'],
    list: [
      ['No face recognition and no identification of crew members.', 'Sin reconocimiento facial ni identificación de tripulantes.'],
      ['No continuous video ashore. Full video stays on the vessel recorders.', 'Sin video continuo hacia tierra. El video completo se queda en los grabadores del buque.'],
      ['No automatic actions and no navigation decisions.', 'Sin acciones automáticas ni decisiones de navegación.'],
      [
        'Person overboard and person down on deck stay off until thermal cameras or consented drill footage exist.',
        'Hombre al agua y persona caída en cubierta siguen apagados hasta que haya cámaras térmicas o imágenes de simulacros con consentimiento.',
      ],
    ],
  },
  {
    h: ['Where the video goes', 'A dónde va el video'],
    p: [
      [
        'Video is processed on board. Only events, thumbnails, short clips (15 seconds) and health messages cross the river link. Live viewing ashore stays inside a small share of each convoy’s link, and stops when the convoy is out of coverage.',
        'El video se procesa a bordo. Solo cruzan el enlace fluvial los eventos, las miniaturas, los clips cortos (15 segundos) y los mensajes de estado. La vista en vivo desde tierra usa una parte pequeña del enlace de cada convoy y se detiene cuando el convoy no tiene cobertura.',
      ],
      [
        'Each edge unit opens an outbound-only encrypted connection with its own certificate. No port is opened on the vessel.',
        'Cada unidad de borde abre una conexión cifrada solo de salida, con su propio certificado. No se abre ningún puerto en el buque.',
      ],
    ],
  },
  {
    h: ['Who can see it', 'Quién puede verlo'],
    p: [
      [
        'Access follows the role, not the person, and everyone signs in with the GFSA directory. Shore roles use a second factor. A master sees their own convoy only, on a display bound to the wheelhouse, and cannot export. Exports are limited to the roles that need them and always carry a watermark with the person’s name and the time.',
        'El acceso depende del rol, no de la persona, y todos inician sesión con el directorio de GFSA. Los roles de tierra usan un segundo factor. Un capitán ve solo su convoy, en una pantalla ligada al puente, y no puede exportar. Las exportaciones se limitan a los roles que las necesitan y siempre llevan una marca de agua con el nombre de la persona y la hora.',
      ],
      [
        'When a clip is shared outside GFSA, for example with an insurer or an authority, faces are blurred before it leaves.',
        'Cuando un clip se comparte fuera de GFSA, por ejemplo con una aseguradora o una autoridad, los rostros se difuminan antes de que salga.',
      ],
    ],
  },
  {
    h: ['Who owns it, and training', 'De quién es, y el entrenamiento'],
    p: [
      [
        'GFSA owns its footage and its events. Footage and labelled clips train the models only with GFSA’s written consent. Without that consent, false alerts are counted to measure accuracy but never leave GFSA.',
        'GFSA es dueña de sus imágenes y de sus eventos. Las imágenes y los clips etiquetados solo entrenan los modelos con consentimiento escrito de GFSA. Sin ese consentimiento, las falsas alertas se cuentan para medir la precisión, pero nunca salen de GFSA.',
      ],
    ],
  },
  {
    h: ['Every view is logged', 'Cada vista queda registrada'],
    p: [
      [
        'Every live view, clip played, download, phone alert page opened and change is written to an append-only, hash-chained audit log, kept 12 months. GFSA’s tenant administrator can read it and export it.',
        'Cada vista en vivo, clip reproducido, descarga, página de alerta abierta en el teléfono y cambio queda en un registro de auditoría de solo agregado, encadenado por hash, que se guarda 12 meses. El administrador del inquilino de GFSA puede leerlo y exportarlo.',
      ],
    ],
  },
  {
    h: ['Crew information', 'Información para la tripulación'],
    p: [
      [
        'Crew are told what is monitored and why, under GFSA’s policy, before the cameras are used. A camera that is covered or turned away raises a camera health alert, so the wheelhouse knows it has stopped watching.',
        'La tripulación sabe qué se monitorea y por qué, según la política de GFSA, antes de usar las cámaras. Una cámara tapada o girada genera una alerta de estado de cámara, para que el puente sepa que dejó de vigilar.',
      ],
    ],
  },
];

const RETENTION: [string, string, string, string][] = [
  ['Events and their records', 'Eventos y sus registros', '12 months', '12 meses'],
  ['Clips and snapshots', 'Clips y fotos', '90 days', '90 días'],
  ['Audit log', 'Registro de auditoría', '12 months', '12 meses'],
  ['Full video', 'Video completo', 'On the vessel recorders, under GFSA’s recorder settings', 'En los grabadores del buque, según la configuración de GFSA'],
];

export function PrivacyPage() {
  const { state } = useApp();
  const tr = useTr();
  const t = (x: [string, string]) => tr(x[0], x[1]);
  return (
    <PublicLayout
      title={tr('Privacy and your data', 'Privacidad y sus datos')}
      sub={tr(
        'How CCTV Monitoring uses GFSA’s cameras, what it keeps, for how long, and who can see it.',
        'Cómo CCTV Monitoring usa las cámaras de GFSA, qué guarda, por cuánto tiempo y quién puede verlo.',
      )}
      meta={<span>{tr('Last reviewed 1 Oct 2026', 'Revisado por última vez el 1 oct 2026')}</span>}
    >
      <section aria-label={tr('At a glance', 'En resumen')} className="pv-facts">
        {FACTS.map((f) => (
          <div key={f.t[0]} className="pv-fact">
            <span className="pv-fact__icon" aria-hidden="true">
              <Icon name={f.icon} size={18} />
            </span>
            <span>
              <strong>{t(f.t)}</strong>
              <span>{t(f.s)}</span>
            </span>
          </div>
        ))}
      </section>

      <Card id="pv-doc" title={tr('The rules in plain language', 'Las reglas en lenguaje claro')}>
        <div className="pv-doc" lang={state.lang}>
          {SECTIONS.slice(0, 3).map((s) => (
            <Section key={s.h[0]} s={s} />
          ))}

          <h2>{tr('How long it is kept', 'Cuánto tiempo se guarda')}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr('What', 'Qué')}</th>
                  <th scope="col">{tr('Kept for', 'Se guarda')}</th>
                </tr>
              </thead>
              <tbody>
                {RETENTION.map((r) => (
                  <tr key={r[0]}>
                    <td>{tr(r[0], r[1])}</td>
                    <td>{tr(r[2], r[3])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pv-note">
            {tr(
              'Retention periods are proposed and still to be agreed with GFSA. After them, records are deleted.',
              'Los plazos de conservación son una propuesta y todavía deben acordarse con GFSA. Al vencer, los registros se eliminan.',
            )}
          </p>

          {SECTIONS.slice(3).map((s) => (
            <Section key={s.h[0]} s={s} />
          ))}

          <h2>{tr('Questions', 'Preguntas')}</h2>
          <p>
            {tr('Questions about monitoring on board go to GFSA’s privacy contact at', 'Las preguntas sobre el monitoreo a bordo van al contacto de privacidad de GFSA en')}{' '}
            <a href="mailto:privacidad@gfsa.example?subject=CCTV%20Monitoring">privacidad@gfsa.example</a>.{' '}
            {tr('For help with the product, see', 'Para ayuda con el producto, vea')} <Link to="/support">{tr('Support', 'Soporte')}</Link>.
          </p>
        </div>
      </Card>
    </PublicLayout>
  );
}

function Section({ s }: { s: Block }) {
  const tr = useTr();
  return (
    <>
      <h2>{tr(s.h[0], s.h[1])}</h2>
      {s.p?.map((p) => <p key={p[0]}>{tr(p[0], p[1])}</p>)}
      {s.list && (
        <ul>
          {s.list.map((l) => (
            <li key={l[0]}>{tr(l[0], l[1])}</li>
          ))}
        </ul>
      )}
    </>
  );
}
