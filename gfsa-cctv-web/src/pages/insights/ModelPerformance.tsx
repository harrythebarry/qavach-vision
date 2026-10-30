import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CATEGORY_ES, TARGETS, useCaseById } from "../../data/useCases";
import { NoAccess, PageHeader, Segmented, Stat } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { useApp } from "../../state/AppState";
import type { EdgeUnit } from "../../data/types";
import { useUsers } from "../../state/usersStore";
import { allNav, canOpen } from "../../nav";
import { uid, usePersistentState } from "../../lib/persist";
import { useTr, type Lang } from "../../lib/i18n";
import { useExporter } from "../../lib/exporting";
import { slug } from "../../lib/download";
import { fmtDay, fmtDayTime, scenarioNow } from "../../lib/time";
import { useCaseName } from "./dailyData";
import {
  CONSENT,
  FLEET,
  NOT_COVERED,
  PERIOD_TEXT,
  TRAINING_SEED,
  WEEKS,
  fleetPerf,
  fmtFa,
  gateOf,
  isOlder,
  liveVersion,
  perfRows,
  reasonsFor,
  registryStore,
  sendableByUseCase,
  sentByUseCase,
  startRollout,
  trendFor,
  type LiveDelta,
  type ModelVersion,
  type Period,
  type Series,
  type TrainingState,
  type UcPerf,
} from "./modelData";
import { modelDoc } from "./reportContent";
import { isoWeek } from "./reportsData";
import {
  InsightsDialog,
  dayIso,
  docRange,
  fmtInt,
  pct,
  useWidth,
} from "./insightsUtil";
import { useInsightsData } from "./useInsightsData";
import "./ModelPerformance.css";

const modelsNav = allNav.find((n) => n.to === "/insights/models")!;
const useCasesNav = allNav.find((n) => n.to === "/config/use-cases")!;
const edgeNav = allNav.find((n) => n.to === "/config/edge-units")!;

const weekLabel = (w: string, lang: Lang) =>
  lang === "es" ? w.replace("W", "S") : w;

/** MP-01 to MP-03: accuracy against the agreed targets, false alerts and model versions. */
export function ModelPerformancePage() {
  const { state, can, log, toast } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const i = lang === "es" ? 1 : 0;
  const ex = useExporter();
  const users = useUsers();
  const data = useInsightsData();
  const { registry, fleet } = data;
  const [period, setPeriod] = useState<Period>("30d");
  const [ucId, setUcId] = useState("all");
  const [training, setTraining] = usePersistentState<TrainingState>(
    "models.training",
    TRAINING_SEED,
  );
  const [sendOpen, setSendOpen] = useState(false);
  const [rollbackTo, setRollbackTo] = useState<ModelVersion | null>(null);

  const perf = useMemo(() => perfRows(period, data.perf), [period, data.perf]);
  const fleetNow = useMemo(
    () => fleetPerf(period, perf, data.perf),
    [period, perf, data.perf],
  );
  const reasons = useMemo(
    () => reasonsFor(period, ucId, data.deltas),
    [period, ucId, data.deltas],
  );
  const week = useMemo(() => {
    const rows7 = perfRows("7d", data.perf);
    const sum: LiveDelta = {
      accepted: 0,
      falseAlert: 0,
      rejected: 0,
      pending: 0,
      reasons: {},
    };
    for (const u of rows7.filter((x) => x.status === "live")) {
      const d = data.deltas[u.id];
      if (d) {
        sum.accepted += d.accepted;
        sum.falseAlert += d.falseAlert;
      }
    }
    return ucId === "all"
      ? trendFor("all", sum, FLEET["7d"].reviewed)
      : trendFor(
          ucId,
          data.deltas[ucId],
          rows7.find((x) => x.id === ucId)?.events ?? 0,
        );
  }, [ucId, data.perf, data.deltas]);

  if (!canOpen(state.role, modelsNav))
    return (
      <NoAccess what={tr("model performance", "el rendimiento de modelos")} />
    );

  const uc = ucId === "all" ? undefined : perf.find((u) => u.id === ucId);
  const ucName = uc
    ? useCaseName(uc.id, lang)
    : tr("All live use cases", "Todos los casos de uso en vivo");
  const ucNameEn = uc ? useCaseName(uc.id, "en") : "All live use cases";
  const periodLabel = PERIOD_TEXT[period][i];
  const stat = uc
    ? {
        precision: uc.precision,
        recall: uc.recall,
        fa: uc.fa,
        reviewed: uc.events,
        pending: uc.pending,
        live: uc.live,
      }
    : fleetNow;
  const reviewers = users.filter(
    (u) => u.role === "reviewer" && u.status === "active",
  ).length;

  const liveCount = perf.filter((u) => u.status === "live").length;
  const shadowCount = perf.filter((u) => u.status === "shadow").length;
  const offCount = perf.filter((u) => u.status === "off").length;
  const live = liveVersion(registry);
  const units = fleet.edgeUnits;

  // MP-02: clips go to training only with GFSA's written consent.
  const falseTotal = reasons.reduce((s, r) => s + r.count, 0);
  const excluded = reasons.reduce(
    (s, r) =>
      s +
      r.perUseCase
        .filter(([u]) => NOT_COVERED[u])
        .reduce((a, [, n]) => a + n, 0),
    0,
  );
  const eligible = sendableByUseCase(reasons);
  const sent = sentByUseCase(training.sends, period);
  const remainingBy = Object.fromEntries(
    Object.entries(eligible)
      .map(([u, n]) => [u, Math.max(0, n - (sent[u] ?? 0))] as const)
      .filter(([, n]) => n > 0),
  );
  const remaining = Object.values(remainingBy).reduce((s, n) => s + n, 0);
  const sendable = falseTotal - excluded;
  const lastSend = training.sends.find(
    (s) => s.period === period && (ucId === "all" || s.byUseCase[ucId]),
  );
  const canClassify = can("classify");
  const sendDisabledReason = !CONSENT.onFile
    ? tr(
        "No written consent from GFSA on file. Clips cannot leave GFSA's systems.",
        "No hay consentimiento escrito de GFSA. Los clips no pueden salir de los sistemas de GFSA.",
      )
    : !canClassify
      ? tr(
          "Your role cannot send clips to training. Reviewers and the safety administrator can.",
          "Su rol no puede enviar clips a entrenamiento. Pueden hacerlo los revisores y el administrador de seguridad.",
        )
      : falseTotal === 0
        ? tr(
            "No false alerts in this period.",
            "Sin falsas alertas en este período.",
          )
        : sendable === 0
          ? tr(
              `GFSA's written consent does not cover ${Object.values(
                NOT_COVERED,
              )
                .map((x) => x[0])
                .join(", ")}. These clips stay on GFSA systems.`,
              `El consentimiento escrito de GFSA no cubre ${Object.values(
                NOT_COVERED,
              )
                .map((x) => x[1])
                .join(", ")}. Estos clips quedan en los sistemas de GFSA.`,
            )
          : remaining === 0
            ? tr(
                `Sent to training ${lastSend ? fmtDayTime(lastSend.at) : ""}. New false alerts can be sent once reviewers label them.`,
                `Enviados a entrenamiento ${lastSend ? fmtDayTime(lastSend.at) : ""}. Las nuevas falsas alertas se pueden enviar cuando los revisores las etiqueten.`,
              )
            : "";

  const doSend = () => {
    const at = new Date(scenarioNow()).toISOString();
    setTraining((t) => ({
      labels: t.labels + remaining,
      sends: [
        {
          id: uid("train"),
          at,
          by: state.user.name,
          period,
          ucId,
          count: remaining,
          byUseCase: remainingBy,
        },
        ...t.sends,
      ],
    }));
    setSendOpen(false);
    log(
      "Sent clips to training",
      `${remaining} labelled false-alert clips · ${ucNameEn} · ${PERIOD_TEXT[period][0]} · consent 2 Oct 2026`,
    );
    toast(
      tr(
        `${remaining} labelled clips sent to training with faces blurred, under GFSA's written consent of ${fmtDay(dayIso(CONSENT.signed))} 2026.`,
        `${remaining} clips etiquetados enviados a entrenamiento con rostros difuminados, bajo el consentimiento escrito de GFSA del ${fmtDay(dayIso(CONSENT.signed))} 2026.`,
      ),
    );
  };

  const reach = units.filter((u) => u.status === "reporting");
  const outOfReach = units.filter((u) => u.status !== "reporting");
  const outConvoys = [
    ...new Set(
      outOfReach.map((u) => fleet.convoyById(u.convoyId)?.name).filter(Boolean),
    ),
  ].join(", ");

  const doRollback = (target: ModelVersion) => {
    const from = live.v;
    const older = isOlder(registry.versions, target.v, from);
    const at = new Date(scenarioNow()).toISOString();
    registryStore.set((s) => ({
      ...s,
      versions: s.versions.map((m) =>
        m.v === target.v
          ? {
              ...m,
              state: "live",
              pushed: at,
              via: older ? "rollback" : "forward",
              replaced: undefined,
            }
          : m.v === from
            ? { ...m, state: "previous", replaced: at, via: undefined }
            : m,
      ),
    }));
    const rollout = startRollout(target.v, units);
    registryStore.set((s) => ({
      ...s,
      rollbacks: [
        {
          id: uid("rb"),
          at,
          by: state.user.name,
          from,
          to: target.v,
          now: rollout.now.length,
          waiting: rollout.waiting.length,
        },
        ...s.rollbacks,
      ],
    }));
    setRollbackTo(null);
    log(
      older ? "Rolled back model" : "Rolled forward model",
      `${from} to ${target.v} · ${rollout.now.length} edge units now, ${rollout.waiting.length} waiting for link`,
    );
    toast(
      tr(
        `${target.v} is being pushed to ${units.length} edge units. The ${rollout.now.length} reporting switch at their next health check${rollout.waiting.length ? `; ${rollout.waiting.length} out of coverage switch when the link returns` : ""}.`,
        `${target.v} se está enviando a ${units.length} unidades de borde. Las ${rollout.now.length} que reportan cambian en su próximo control de estado${rollout.waiting.length ? `; ${rollout.waiting.length} sin cobertura cambian cuando vuelva el enlace` : ""}.`,
      ),
    );
  };

  const exportPdf = () => {
    const doc = modelDoc(period, ucId, { lang, perf: data.perf, registry });
    ex.pdf(
      `model-performance-${slug(ucNameEn)}-${period}-${lang}.pdf`,
      {
        title: `${tr("Model performance", "Rendimiento de modelos")} · ${ucName}`,
        subtitle: `${periodLabel} · ${fmtDayTime(data.now)} ${tr("Asunción", "hora de Asunción")}`,
        blocks: doc.blocks,
      },
      {
        action: "Exported model performance",
        target: `${ucNameEn} · ${PERIOD_TEXT[period][0]}`,
        details: `PDF ${lang.toUpperCase()}`,
      },
    );
  };

  const canSeeUseCases = canOpen(state.role, useCasesNav);
  const thisWeek = isoWeek(data.today);
  const statusSuffix = (u: UcPerf) =>
    u.status === "shadow"
      ? tr(" · shadow run", " · ejecución en sombra")
      : u.status === "off"
        ? tr(" · off", " · apagado")
        : "";

  return (
    <div className="page mp-page">
      <PageHeader
        crumbs={[{ label: tr("Insights", "Análisis") }]}
        title={tr("Model performance", "Rendimiento de modelos")}
        sub={tr(
          "Accuracy on reviewed events against the targets agreed with GFSA",
          "Exactitud sobre eventos revisados frente a las metas acordadas con GFSA",
        )}
        actions={
          <>
            <label className="mp-ucpick">
              <span>{tr("Use case", "Caso de uso")}</span>
              <select
                className="select"
                value={ucId}
                onChange={(e) => setUcId(e.target.value)}
              >
                <option value="all">
                  {tr(
                    "All live use cases (fleet)",
                    "Todos los casos de uso en vivo (flota)",
                  )}
                </option>
                {perf.map((u) => (
                  <option key={u.id} value={u.id}>
                    {useCaseName(u.id, lang)}
                    {statusSuffix(u)}
                  </option>
                ))}
              </select>
            </label>
            <Segmented<Period>
              label={tr("Period", "Período")}
              value={period}
              onChange={setPeriod}
              options={[
                { value: "7d", label: tr("7 days", "7 días") },
                { value: "30d", label: tr("30 days", "30 días") },
                { value: "all", label: tr("Since go-live", "Desde el inicio") },
              ]}
            />
            <button type="button" className="btn" onClick={exportPdf}>
              <Icon name="download" size={16} />{" "}
              {tr("Export PDF", "Exportar PDF")}
            </button>
          </>
        }
      />

      {uc && (
        <div className="mp-filterbar" role="status">
          <span>
            {tr("Showing", "Mostrando")} <strong>{ucName}</strong>
            {uc.status === "shadow"
              ? tr(
                  " · shadow run, logged only",
                  " · ejecución en sombra, solo registro",
                )
              : uc.status === "off"
                ? tr(" · off, not run", " · apagado, sin ejecutar")
                : ""}
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setUcId("all")}
          >
            <Icon name="x" size={15} /> {tr("Show the fleet", "Ver la flota")}
          </button>
        </div>
      )}

      <div className="stat-grid">
        <TargetStat
          label={
            uc
              ? tr("Precision", "Precisión")
              : tr("Precision, fleet", "Precisión, flota")
          }
          value={stat.precision}
          period={periodLabel}
          target={TARGETS.precision}
        />
        <TargetStat
          label={
            uc
              ? tr("Recall", "Exhaustividad")
              : tr("Recall, fleet", "Exhaustividad, flota")
          }
          value={stat.recall}
          period={periodLabel}
          target={TARGETS.recall}
        />
        <Stat
          label={tr(
            "False alerts per camera per day",
            "Falsas alertas por cámara por día",
          )}
          value={stat.fa === undefined ? "–" : fmtFa(stat.fa)}
          aside={
            uc ? tr("this use case", "este caso de uso") : tr("fleet", "flota")
          }
          foot={
            stat.fa === undefined ? (
              tr("not run", "sin ejecutar")
            ) : (
              <span className="ins-inline-icon">
                <Icon
                  name={
                    stat.fa <= TARGETS.falseAlertsPerCamDay ? "check" : "alert"
                  }
                  size={13}
                  strokeWidth={2.4}
                />
                {tr(
                  `limit ${TARGETS.falseAlertsPerCamDay} or fewer`,
                  `límite ${TARGETS.falseAlertsPerCamDay} o menos`,
                )}
              </span>
            )
          }
          footTone={
            stat.fa === undefined
              ? undefined
              : stat.fa <= TARGETS.falseAlertsPerCamDay
                ? "ok"
                : "bad"
          }
        />
        <Stat
          label={
            uc?.unit === "rounds"
              ? tr(
                  `Reviewed rounds, ${periodLabel}`,
                  `Rondas revisadas, ${periodLabel}`,
                )
              : tr(
                  `Reviewed events, ${periodLabel}`,
                  `Eventos revisados, ${periodLabel}`,
                )
          }
          value={fmtInt(stat.reviewed, lang)}
          foot={
            uc?.status === "off" && !stat.reviewed
              ? tr("not run yet", "aún sin ejecutar")
              : [
                  tr(`by ${reviewers} reviewers`, `por ${reviewers} revisores`),
                  stat.live
                    ? tr(
                        `${stat.live} classified today`,
                        `${stat.live} clasificados hoy`,
                      )
                    : "",
                  stat.pending
                    ? tr(
                        `${stat.pending} waiting`,
                        `${stat.pending} pendientes`,
                      )
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
        <Stat
          label={tr(
            "Labels added to training",
            "Etiquetas agregadas al entrenamiento",
          )}
          value={fmtInt(training.labels, lang)}
          aside={tr("this month", "este mes")}
          foot={tr(
            "next model v1.5 on 28 Oct",
            "próximo modelo v1.5 el 28 oct",
          )}
        />
      </div>

      <section className="card" aria-labelledby="mp-trend-title">
        <div className="card__head">
          <div className="card__title">
            <h2 id="mp-trend-title">
              {tr(
                "Precision and recall by week",
                "Precisión y exhaustividad por semana",
              )}
            </h2>
            <span className="card__hint">
              {uc ? ucName : tr("Fleet", "Flota")} · {weekLabel(WEEKS[0], lang)}{" "}
              {tr("to", "a")} {weekLabel(WEEKS[WEEKS.length - 1], lang)} ·{" "}
              {uc
                ? uc.status === "shadow"
                  ? tr("shadow run", "ejecución en sombra")
                  : tr("reviewed events", "eventos revisados")
                : tr("all live use cases", "todos los casos de uso en vivo")}
            </span>
          </div>
          <Link to="/reports?tab=templates" className="card__link">
            {tr("Monthly report", "Informe mensual")}
          </Link>
        </div>
        <div className="mp-trend">
          <div className="mp-legend">
            <span>
              <i className="mp-sw mp-sw--p" aria-hidden="true" />
              {tr("Precision", "Precisión")}
            </span>
            <span>
              <i className="mp-sw mp-sw--r" aria-hidden="true" />
              {tr("Recall", "Exhaustividad")}
            </span>
            <span>
              <i className="mp-sw mp-sw--t" aria-hidden="true" />
              {tr("Agreed target", "Meta acordada")}
            </span>
          </div>
          <TrendChart series={week} name={ucName} />
          <span className="mp-foot">
            {tr("Reviewed events only", "Solo eventos revisados")} ·{" "}
            {uc?.status === "shadow"
              ? tr(
                  "shadow run shown for the gate decision",
                  "ejecución en sombra mostrada para decidir la compuerta",
                )
              : tr("shadow runs excluded", "sin ejecuciones en sombra")}{" "}
            ·{" "}
            {tr(
              `W${thisWeek.week} is ${docRange(thisWeek.from, data.today, "en")} so far, with today's classifications`,
              `S${thisWeek.week} es ${docRange(thisWeek.from, data.today, "es")} hasta ahora, con las clasificaciones de hoy`,
            )}
          </span>
        </div>
      </section>

      <div className="row">
        <section className="card grow" aria-labelledby="mp-uc-title">
          <div className="card__head">
            <div className="card__title">
              <h2 id="mp-uc-title">{tr("By use case", "Por caso de uso")}</h2>
              <span className="card__hint">
                {tr(
                  `${perf.length} set up · ${liveCount} live · ${shadowCount} shadow run · ${offCount} off · all on model ${live.v}`,
                  `${perf.length} configurados · ${liveCount} en vivo · ${shadowCount} en sombra · ${offCount} apagados · todos con el modelo ${live.v}`,
                )}
              </span>
            </div>
            {canSeeUseCases && (
              <Link to="/config/use-cases" className="card__link">
                {tr("Use cases", "Casos de uso")}
              </Link>
            )}
          </div>
          <div className="table-wrap">
            <table className="table num mp-table">
              <thead>
                <tr>
                  <th scope="col">{tr("Use case", "Caso de uso")}</th>
                  <th scope="col">{tr("Status", "Estado")}</th>
                  <th scope="col" className="right">
                    {period === "all"
                      ? tr("Events since go-live", "Eventos desde el inicio")
                      : tr(
                          `Events ${period === "7d" ? 7 : 30} d`,
                          `Eventos ${period === "7d" ? 7 : 30} d`,
                        )}
                  </th>
                  <th scope="col" className="right">
                    {tr("Precision", "Precisión")}
                  </th>
                  <th scope="col" className="right">
                    {tr("Recall", "Exhaustividad")}
                  </th>
                  <th scope="col" className="right">
                    <span className="mp-th2">
                      {tr("False alerts", "Falsas alertas")}
                    </span>
                    <span className="mp-th2 mp-th2--sub">
                      {tr("per camera-day", "por cámara y día")}
                    </span>
                  </th>
                  <th scope="col">{tr("Gate", "Compuerta")}</th>
                </tr>
              </thead>
              <tbody>
                {perf.map((u) => (
                  <UcRow
                    key={u.id}
                    u={u}
                    selected={u.id === ucId}
                    onSelect={() => setUcId(u.id === ucId ? "all" : u.id)}
                    linkable={canSeeUseCases}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mp-tablefoot">
            {tr(
              `Precision and recall are measured on events a reviewer has accepted or marked as a false alert, including those classified in the console today · targets are ${pct(TARGETS.precision)} precision and ${pct(TARGETS.recall)} recall per use case, and ${TARGETS.falseAlertsPerCamDay} or fewer false alerts per camera per day after the shadow run`,
              `La precisión y la exhaustividad se miden sobre eventos que un revisor aceptó o marcó como falsa alerta, incluidos los clasificados hoy en la consola · las metas son ${pct(TARGETS.precision)} de precisión y ${pct(TARGETS.recall)} de exhaustividad por caso de uso, y ${TARGETS.falseAlertsPerCamDay} o menos falsas alertas por cámara por día después de la ejecución en sombra`,
            )}
          </div>
        </section>

        <div className="mp-side stack">
          <section className="card mp-panel" aria-labelledby="mp-fa-title">
            <div className="mp-panel__head">
              <h2 id="mp-fa-title">
                {tr(
                  `Why false alerts happen · ${periodLabel}`,
                  `Por qué ocurren las falsas alertas · ${periodLabel}`,
                )}
              </h2>
              <span>
                {tr(
                  `${falseTotal} false alert${falseTotal === 1 ? "" : "s"} on ${fmtInt(stat.reviewed, lang)} reviewed ${uc?.unit === "rounds" ? "rounds" : "events"}`,
                  `${falseTotal} falsa${falseTotal === 1 ? "" : "s"} alerta${falseTotal === 1 ? "" : "s"} sobre ${fmtInt(stat.reviewed, lang)} ${uc?.unit === "rounds" ? "rondas revisadas" : "eventos revisados"}`,
                )}
                {uc ? ` · ${ucName}` : ""}
              </span>
            </div>
            {reasons.length === 0 ? (
              <p className="mp-empty">
                {tr(
                  "No false alerts for this selection.",
                  "Sin falsas alertas para esta selección.",
                )}
              </p>
            ) : (
              <ul
                className="mp-reasons"
                aria-label={tr(
                  "False alerts by reason",
                  "Falsas alertas por motivo",
                )}
              >
                {reasons.map((r) => (
                  <li key={r.id}>
                    <span>{r.label[i]}</span>
                    <strong>{r.count}</strong>
                    <span className="mp-reasons__track" aria-hidden="true">
                      <span
                        style={{
                          width: `${(r.count / reasons[0].count) * 100}%`,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {reasons.some((r) => r.id === "inflatable") && (
              <p className="mp-small">
                {tr(
                  "Inflatable jackets are in the training set for v1.5.",
                  "Los chalecos inflables están en el set de entrenamiento de v1.5.",
                )}
              </p>
            )}

            <div
              className={`mp-consent${CONSENT.onFile ? "" : " mp-consent--none"}`}
            >
              <Icon name={CONSENT.onFile ? "shield" : "lock"} size={16} />
              <span>
                {CONSENT.onFile ? (
                  <>
                    <strong>
                      {tr(
                        "Written consent on file",
                        "Consentimiento escrito registrado",
                      )}
                    </strong>{" "}
                    ·{" "}
                    {tr(
                      `signed ${fmtDay(dayIso(CONSENT.signed))} 2026. Covers ${CONSENT.covers[0].toLowerCase()}.`,
                      `firmado el ${fmtDay(dayIso(CONSENT.signed))} 2026. Cubre ${CONSENT.covers[1].toLowerCase()}.`,
                    )}
                    {excluded > 0 &&
                      sendable > 0 &&
                      ` ${tr(`${excluded} engine-room clip${excluded === 1 ? " stays" : "s stay"} out.`, `${excluded} clip${excluded === 1 ? "" : "s"} de la sala de máquinas no se envía${excluded === 1 ? "" : "n"}.`)}`}
                  </>
                ) : (
                  <strong>
                    {tr(
                      "No written consent from GFSA. Nothing can be sent to training.",
                      "Sin consentimiento escrito de GFSA. No se puede enviar nada a entrenamiento.",
                    )}
                  </strong>
                )}
              </span>
            </div>

            <button
              type="button"
              className="btn"
              disabled={!!sendDisabledReason}
              aria-describedby={sendDisabledReason ? "mp-send-why" : undefined}
              onClick={() => setSendOpen(true)}
            >
              <Icon
                name={remaining === 0 && sendable > 0 ? "check" : "send"}
                size={16}
              />
              {remaining === 0 && sendable > 0
                ? tr("Sent to training", "Enviados a entrenamiento")
                : sent && Object.keys(sent).length && remaining < sendable
                  ? tr(
                      `Send ${remaining} new clips to training`,
                      `Enviar ${remaining} clips nuevos a entrenamiento`,
                    )
                  : tr(
                      `Send ${remaining > 0 ? `${remaining} ` : ""}clips to training`,
                      `Enviar ${remaining > 0 ? `${remaining} ` : ""}clips a entrenamiento`,
                    )}
            </button>
            {sendDisabledReason && (
              <span id="mp-send-why" className="mp-small">
                {sendDisabledReason}
              </span>
            )}
          </section>

          <section className="card mp-panel" aria-labelledby="mp-train-title">
            <div className="mp-panel__head">
              <h2 id="mp-train-title">
                {tr("Training set", "Set de entrenamiento")}
              </h2>
              <span>
                {tr(
                  "GFSA footage, used only with written consent",
                  "Imágenes de GFSA, usadas solo con consentimiento escrito",
                )}
              </span>
            </div>
            <dl className="mp-dl">
              <dt>{tr("Held-out GFSA clips", "Clips de GFSA reservados")}</dt>
              <dd>412</dd>
              <dt>{tr("Labels this month", "Etiquetas este mes")}</dt>
              <dd>{fmtInt(training.labels, lang)}</dd>
              <dt>{tr("Reviewer agreement", "Acuerdo entre revisores")}</dt>
              <dd>94%</dd>
              <dt>{tr("Next model", "Próximo modelo")}</dt>
              <dd>
                <span className="mono">v1.5</span> · {tr("28 Oct", "28 oct")}
                <span className="mp-dl__sub">
                  {tr("adds inflatable jackets", "agrega chalecos inflables")}
                </span>
              </dd>
              <dt>{tr("Consent", "Consentimiento")}</dt>
              <dd>
                <span className={CONSENT.onFile ? "mp-ok" : "mp-bad"}>
                  {CONSENT.onFile
                    ? tr(
                        "Written consent on file",
                        "Consentimiento escrito registrado",
                      )
                    : tr("Not on file", "No registrado")}
                </span>
                <span className="mp-dl__sub">
                  {tr(
                    `signed ${fmtDay(dayIso(CONSENT.signed))}`,
                    `firmado el ${fmtDay(dayIso(CONSENT.signed))}`,
                  )}
                </span>
              </dd>
            </dl>
            {training.sends.length > 0 && (
              <ul
                className="mp-sends"
                aria-label={tr("Sent to training", "Enviados a entrenamiento")}
              >
                {training.sends.slice(0, 3).map((s) => (
                  <li key={s.id}>
                    <span>
                      {fmtDayTime(s.at)} · {s.by}
                    </span>
                    <strong>
                      {tr(`${s.count} clips`, `${s.count} clips`)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
            <details className="mp-details">
              <summary>
                {tr("What the consent covers", "Qué cubre el consentimiento")}
              </summary>
              <dl className="dl">
                <dt>{tr("Covers", "Cubre")}</dt>
                <dd>{CONSENT.covers[i]}</dd>
                <dt>{tr("Excludes", "Excluye")}</dt>
                <dd>{CONSENT.excludes[i]}</dd>
                <dt>{tr("Record", "Registro")}</dt>
                <dd>{CONSENT.reference[i]}</dd>
              </dl>
            </details>
          </section>

          <section className="card" aria-labelledby="mp-reg-title">
            <div className="mp-reg__head">
              <h2 id="mp-reg-title">
                {tr("Model registry", "Registro de modelos")}
              </h2>
              {canOpen(state.role, edgeNav) && (
                <Link to="/config/edge-units" className="card__link">
                  {tr("Edge units", "Unidades de borde")}
                </Link>
              )}
            </div>
            <ol className="mp-reg">
              {registry.versions.map((m) => {
                const older = isOlder(registry.versions, m.v, live.v);
                return (
                  <li
                    key={m.v}
                    className={
                      m.state === "draft" ? "mp-reg--draft" : undefined
                    }
                  >
                    <span className="mp-reg__main">
                      <span className="mp-reg__v">
                        {m.state === "live" && (
                          <span className="dot" aria-hidden="true" />
                        )}
                        {m.v}
                        {m.state === "live" && (
                          <span className="sr-only">
                            {" "}
                            ({tr("live", "en vivo")})
                          </span>
                        )}
                      </span>
                      <span className="mp-reg__note">{versionNote(m, tr)}</span>
                    </span>
                    <span className="mp-reg__right">
                      {versionRight(m, older, units, registry.pending, tr).map(
                        (x) => (
                          <span
                            key={x}
                            className={
                              m.state === "draft" ? "mp-reg__warn" : undefined
                            }
                          >
                            {x}
                          </span>
                        ),
                      )}
                      {m.state === "previous" && (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={!can("push_models")}
                          title={
                            can("push_models")
                              ? undefined
                              : tr(
                                  "Safety administrator only",
                                  "Solo el administrador de seguridad",
                                )
                          }
                          onClick={() => setRollbackTo(m)}
                        >
                          <Icon name="refresh" size={15} />
                          {older
                            ? tr(`Roll back to ${m.v}`, `Revertir a ${m.v}`)
                            : tr(`Return to ${m.v}`, `Volver a ${m.v}`)}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            {registry.rollbacks.length > 0 && (
              <ul
                className="mp-sends mp-sends--reg"
                aria-label={tr("Rollbacks", "Reversiones")}
              >
                {registry.rollbacks.slice(0, 3).map((x) => (
                  <li key={x.id}>
                    <span>
                      {fmtDayTime(x.at)} · {x.by}
                    </span>
                    <strong className="mono">
                      {x.from} → {x.to}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
            {!can("push_models") && (
              <p className="mp-reg__hint">
                {tr(
                  "Only the safety administrator can roll back or push models.",
                  "Solo el administrador de seguridad puede revertir o enviar modelos.",
                )}
              </p>
            )}
          </section>
        </div>
      </div>

      {sendOpen && (
        <InsightsDialog
          title={tr(
            `Send ${remaining} clips to training?`,
            `¿Enviar ${remaining} clips a entrenamiento?`,
          )}
          sub={tr(
            `${ucName} · ${periodLabel} · labelled by reviewers as false alerts`,
            `${ucName} · ${periodLabel} · etiquetados por los revisores como falsas alertas`,
          )}
          onClose={() => setSendOpen(false)}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setSendOpen(false)}
              >
                {tr("Cancel", "Cancelar")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={doSend}
              >
                <Icon name="send" size={16} />{" "}
                {tr(`Send ${remaining} clips`, `Enviar ${remaining} clips`)}
              </button>
            </>
          }
        >
          <ul className="mp-sendlist">
            {Object.entries(remainingBy).map(([u, n]) => (
              <li key={u}>
                <span>{useCaseName(u, lang)}</span>
                <strong>{n}</strong>
              </li>
            ))}
          </ul>
          <div className="callout">
            <Icon name="shield" size={18} />
            <span>
              {tr(
                `Sent under GFSA's written consent of ${fmtDay(dayIso(CONSENT.signed))} 2026. Faces are blurred before clips leave GFSA, and each clip keeps its reviewer label.`,
                `Se envían bajo el consentimiento escrito de GFSA del ${fmtDay(dayIso(CONSENT.signed))} 2026. Los rostros se difuminan antes de que los clips salgan de GFSA y cada clip conserva la etiqueta del revisor.`,
              )}
              {excluded > 0 &&
                ` ${tr(
                  `${excluded} engine-room clip${excluded === 1 ? " is" : "s are"} not covered and stay${excluded === 1 ? "s" : ""} on GFSA systems.`,
                  `${excluded} clip${excluded === 1 ? "" : "s"} de la sala de máquinas no ${excluded === 1 ? "está cubierto y queda" : "están cubiertos y quedan"} en los sistemas de GFSA.`,
                )}`}
            </span>
          </div>
        </InsightsDialog>
      )}

      {rollbackTo && (
        <InsightsDialog
          title={
            isOlder(registry.versions, rollbackTo.v, live.v)
              ? tr(
                  `Roll back to ${rollbackTo.v}?`,
                  `¿Revertir a ${rollbackTo.v}?`,
                )
              : tr(`Return to ${rollbackTo.v}?`, `¿Volver a ${rollbackTo.v}?`)
          }
          sub={tr(
            `Replaces ${live.v} on all ${units.length} edge units`,
            `Reemplaza ${live.v} en las ${units.length} unidades de borde`,
          )}
          onClose={() => setRollbackTo(null)}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setRollbackTo(null)}
              >
                {tr("Cancel", "Cancelar")}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => doRollback(rollbackTo)}
              >
                <Icon name="refresh" size={16} />{" "}
                {isOlder(registry.versions, rollbackTo.v, live.v)
                  ? tr(
                      `Roll back to ${rollbackTo.v}`,
                      `Revertir a ${rollbackTo.v}`,
                    )
                  : tr(`Return to ${rollbackTo.v}`, `Volver a ${rollbackTo.v}`)}
              </button>
            </>
          }
        >
          <dl className="dl">
            <dt>{tr("Now live", "En vivo ahora")}</dt>
            <dd>
              <span className="mono">{live.v}</span> · {versionNote(live, tr)}
            </dd>
            <dt>{tr("Goes live", "Pasa a vivo")}</dt>
            <dd>
              <span className="mono">{rollbackTo.v}</span> ·{" "}
              {versionNote(rollbackTo, tr)}
            </dd>
          </dl>
          <div className="callout callout--warn">
            <Icon name="alert" size={18} />
            <span>
              {tr(
                `The signed ${rollbackTo.v} package is pushed to every edge unit. The ${reach.length} units reporting switch at their next health check${outOfReach.length ? `; the ${outOfReach.length} ${outConvoys} units out of coverage switch when the link returns` : ""}. Detection keeps running during the switch. Precision and recall for ${rollbackTo.v} are tracked from today.`,
                `El paquete firmado ${rollbackTo.v} se envía a cada unidad de borde. Las ${reach.length} unidades que reportan cambian en su próximo control de estado${outOfReach.length ? `; las ${outOfReach.length} unidades de ${outConvoys} sin cobertura cambian cuando vuelva el enlace` : ""}. La detección sigue funcionando durante el cambio. La precisión y la exhaustividad de ${rollbackTo.v} se miden desde hoy.`,
              )}
            </span>
          </div>
        </InsightsDialog>
      )}
    </div>
  );
}

type Tr = (en: string, es: string) => string;

function versionNote(m: ModelVersion, tr: Tr): string {
  if (m.state === "draft")
    return tr(
      `Draft · ${m.label?.[0] ?? ""}`,
      `Borrador · ${m.label?.[1] ?? ""}`,
    );
  if (m.state === "live") {
    if (m.via === "rollback" && m.pushed)
      return tr(
        `Live · rollback started ${fmtDayTime(m.pushed)}`,
        `En vivo · reversión iniciada ${fmtDayTime(m.pushed)}`,
      );
    if (m.via === "forward" && m.pushed)
      return tr(
        `Live · returned ${fmtDayTime(m.pushed)}`,
        `En vivo · restituida ${fmtDayTime(m.pushed)}`,
      );
    return tr(
      `Live · signed, pushed ${m.pushed ? fmtDay(m.pushed) : ""}`,
      `En vivo · firmada, enviada ${m.pushed ? fmtDay(m.pushed) : ""}`,
    );
  }
  if (m.replaced)
    return tr(
      `Signed · replaced ${fmtDayTime(m.replaced)}`,
      `Firmada · reemplazada ${fmtDayTime(m.replaced)}`,
    );
  return tr(
    `Signed · ${m.signed ? fmtDay(m.signed) : ""}`,
    `Firmada · ${m.signed ? fmtDay(m.signed) : ""}`,
  );
}

/** Rollout state from the edge units themselves (fleet store). */
function versionRight(
  m: ModelVersion,
  older: boolean,
  units: EdgeUnit[],
  pending: string[],
  tr: Tr,
): string[] {
  if (m.state === "draft") return [tr("Not pushed", "Sin enviar")];
  if (m.state === "previous")
    return [
      older
        ? tr("Rollback available", "Reversión disponible")
        : tr("Previous version", "Versión anterior"),
    ];
  const confirmed = units.filter(
    (u) => u.modelVersion === m.v && u.modelConfirmed,
  ).length;
  // Out of coverage, or queued until the link returns: waiting. Reporting and installing: switching.
  const waiting = units.filter(
    (u) =>
      !(u.modelVersion === m.v && u.modelConfirmed) &&
      (u.status !== "reporting" || pending.includes(u.id)),
  ).length;
  const switching = units.length - confirmed - waiting;
  return [
    tr(
      `${confirmed} of ${units.length} units`,
      `${confirmed} de ${units.length} unidades`,
    ),
    switching ? tr(`${switching} switching`, `${switching} cambiando`) : "",
    waiting
      ? tr(`${waiting} waiting for link`, `${waiting} esperan enlace`)
      : "",
  ].filter(Boolean);
}

function TargetStat({
  label,
  value,
  period,
  target,
}: {
  label: string;
  value: number | undefined;
  period: string;
  target: number;
}) {
  const tr = useTr();
  const met = value !== undefined && value >= target;
  return (
    <Stat
      label={label}
      value={value === undefined ? "–" : pct(value)}
      aside={period}
      foot={
        value === undefined ? (
          tr("not run", "sin ejecutar")
        ) : (
          <span className="ins-inline-icon">
            <Icon name={met ? "check" : "alert"} size={13} strokeWidth={2.4} />
            {met
              ? tr(`target ${pct(target)} or more`, `meta ${pct(target)} o más`)
              : tr(
                  `below the ${pct(target)} target`,
                  `bajo la meta de ${pct(target)}`,
                )}
          </span>
        )
      }
      footTone={value === undefined ? undefined : met ? "ok" : "bad"}
    />
  );
}

function UcRow({
  u,
  selected,
  onSelect,
  linkable,
}: {
  u: UcPerf;
  selected: boolean;
  onSelect: () => void;
  linkable: boolean;
}) {
  const { state } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const def = useCaseById(u.id);
  const gate = gateOf(u);
  const off = u.status === "off";
  const below = (v: number | undefined, t: number) => v !== undefined && v < t;
  return (
    <tr className={selected ? "is-selected" : undefined}>
      <td>
        <button
          type="button"
          className="mp-ucname"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {useCaseName(u.id, lang)}
        </button>
        <span className="sub">
          {def
            ? lang === "es"
              ? (CATEGORY_ES[def.category] ?? def.category)
              : def.category
            : ""}{" "}
          · {def?.priority}
          {u.extra ? ` · ${u.extra[lang === "es" ? 1 : 0]}` : ""}
          {linkable && (
            <>
              {" · "}
              <Link to={`/config/use-cases/${u.id}`} className="mp-uclink">
                {tr("Settings", "Configuración")}
              </Link>
            </>
          )}
        </span>
      </td>
      <td>
        {u.status === "live" ? (
          <span className="badge badge--ok">
            <Icon name="check" size={13} strokeWidth={2.4} />
            {tr("Live", "En vivo")}
          </span>
        ) : u.status === "shadow" ? (
          <span className="badge badge--warn">
            <Icon name="clock" size={13} />
            {tr("Shadow run", "En sombra")}
          </span>
        ) : (
          <span className="badge">
            <Icon name="minus" size={13} />
            {tr("Off", "Apagado")}
          </span>
        )}
      </td>
      <td className={`right${off ? " mp-muted" : ""}`}>
        {u.events}
        {u.unit ? tr(" rounds", " rondas") : ""}
        {u.pending > 0 && (
          <span className="sub mp-nowrap">
            {tr(`${u.pending} to review`, `${u.pending} por revisar`)}
          </span>
        )}
      </td>
      <td
        className={`right${off ? " mp-muted" : " mp-strong"}${below(u.precision, TARGETS.precision) && !off ? " mp-warn" : ""}`}
      >
        {u.precision === undefined ? "–" : pct(u.precision)}
      </td>
      <td
        className={`right${off ? " mp-muted" : " mp-strong"}${below(u.recall, TARGETS.recall) && !off ? " mp-warn" : ""}`}
      >
        {u.recall === undefined ? "–" : pct(u.recall)}
      </td>
      <td
        className={`right${off ? " mp-muted" : ""}${(u.fa ?? 0) > TARGETS.falseAlertsPerCamDay ? " mp-warn" : ""}`}
      >
        {u.fa === undefined ? "–" : fmtFa(u.fa)}
      </td>
      <td>
        {gate === "met" && (
          <span className="mp-gate mp-gate--ok">
            <Icon name="check" size={14} strokeWidth={2.4} />
            {tr("Met", "Cumplida")}
          </span>
        )}
        {(gate === "precision" || gate === "recall" || gate === "fa") && (
          <span className="mp-gate mp-gate--warn">
            <Icon name="alert" size={14} />
            {gate === "precision"
              ? tr("Precision below target", "Precisión bajo la meta")
              : gate === "recall"
                ? tr("Recall below target", "Exhaustividad bajo la meta")
                : tr("Too many false alerts", "Demasiadas falsas alertas")}
          </span>
        )}
        {gate === "shadow" && (
          <span className="mp-gate mp-gate--warn">
            <Icon name="clock" size={14} />
            {u.shadowGate
              ? u.shadowGate[lang === "es" ? 1 : 0]
              : tr("Shadow run", "Ejecución en sombra")}
          </span>
        )}
        {gate === "not_run" && (
          <span className="mp-gate mp-gate--off">
            <span className="dot dot--idle" aria-hidden="true" />
            {tr("Not run", "Sin ejecutar")}
          </span>
        )}
        {u.gateNote && (
          <span className="sub mp-nowrap">
            {u.gateNote[lang === "es" ? 1 : 0]}
          </span>
        )}
      </td>
    </tr>
  );
}

// ---------- Trend chart (SVG) ----------

function TrendChart({ series, name }: { series: Series | null; name: string }) {
  const { state } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const [ref, width] = useWidth<HTMLDivElement>(960);
  if (!series) {
    return (
      <div ref={ref} className="mp-chart mp-chart--empty">
        <p>
          {tr(
            `${name} has not run, so there are no reviewed events to measure.`,
            `${name} no se ha ejecutado, así que no hay eventos revisados que medir.`,
          )}
        </p>
      </div>
    );
  }
  const H = 264;
  const left = 44;
  const right = Math.max(left + 100, width - 12);
  const top = 14;
  const bottom = 224;
  const vals = [...series.precision, ...series.recall].filter(
    (v): v is number => v !== null,
  );
  const minV = Math.min(70, Math.floor((Math.min(...vals) - 3) / 10) * 10);
  const maxV = 100;
  const y = (v: number) => top + ((maxV - v) / (maxV - minV)) * (bottom - top);
  const n = WEEKS.length;
  const x0 = left + 26;
  const x1 = right - 24;
  const x = (i: number) => x0 + (i * (x1 - x0)) / (n - 1);
  const grid: number[] = [];
  for (let v = maxV; v >= minV; v -= 10) grid.push(v);
  const tp = TARGETS.precision * 100;
  const trg = TARGETS.recall * 100;

  const path = (s: (number | null)[]) => {
    let d = "";
    let pen = false;
    s.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const lastP = [...series.precision].reverse().find((v) => v !== null);
  const lastR = [...series.recall].reverse().find((v) => v !== null);
  const firstIdx = series.precision.findIndex((v) => v !== null);
  const wk = (i: number) => weekLabel(WEEKS[i], lang);
  const summary = tr(
    `Weekly precision and recall for ${name}, ${wk(firstIdx)} to ${wk(n - 1)}. Precision ${series.precision[firstIdx]}% to ${lastP}%, recall ${series.recall[firstIdx]}% to ${lastR}%. Targets: precision ${tp}%, recall ${trg}%.`,
    `Precisión y exhaustividad semanales de ${name}, ${wk(firstIdx)} a ${wk(n - 1)}. Precisión de ${series.precision[firstIdx]}% a ${lastP}%, exhaustividad de ${series.recall[firstIdx]}% a ${lastR}%. Metas: precisión ${tp}%, exhaustividad ${trg}%.`,
  );
  const narrow = width < 560;

  return (
    <div ref={ref} className="mp-chart">
      <svg width={width} height={H} role="img" aria-label={summary}>
        {grid.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={right}
              y1={y(v)}
              y2={y(v)}
              className={v === minV ? "mp-axis" : "mp-grid"}
            />
            <text
              x={left - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="mp-tick"
            >
              {v}%
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={right}
          y1={y(tp)}
          y2={y(tp)}
          className="mp-target"
        />
        <line
          x1={left}
          x2={right}
          y1={y(trg)}
          y2={y(trg)}
          className="mp-target"
        />
        <text x={left + 4} y={y(tp) - 6} className="mp-tick">
          {tr(`Precision target ${tp}%`, `Meta de precisión ${tp}%`)}
        </text>
        <text
          x={right - 4}
          y={y(trg) + 15}
          textAnchor="end"
          className="mp-tick"
        >
          {tr(`Recall target ${trg}%`, `Meta de exhaustividad ${trg}%`)}
        </text>
        <path d={path(series.recall)} className="mp-line mp-line--r" />
        <path d={path(series.precision)} className="mp-line mp-line--p" />
        {series.recall.map((v, i) =>
          v === null ? null : (
            <circle
              key={`r${i}`}
              cx={x(i)}
              cy={y(v)}
              r={4}
              className="mp-pt mp-pt--r"
            >
              <title>
                {tr(`${wk(i)} recall ${v}%`, `${wk(i)} exhaustividad ${v}%`)}
              </title>
            </circle>
          ),
        )}
        {series.precision.map((v, i) =>
          v === null ? null : (
            <circle
              key={`p${i}`}
              cx={x(i)}
              cy={y(v)}
              r={4}
              className="mp-pt mp-pt--p"
            >
              <title>
                {tr(`${wk(i)} precision ${v}%`, `${wk(i)} precisión ${v}%`)}
              </title>
            </circle>
          ),
        )}
        {WEEKS.map((w, i) =>
          narrow && i % 2 === 1 && i !== n - 1 ? null : (
            <text
              key={w}
              x={x(i)}
              y={250}
              textAnchor="middle"
              className="mp-tick"
            >
              {wk(i)}
            </text>
          ),
        )}
      </svg>
      <div className="sr-only">
        <table>
          <caption>
            {tr(
              `Precision and recall by week, ${name}`,
              `Precisión y exhaustividad por semana, ${name}`,
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">{tr("Week", "Semana")}</th>
              <th scope="col">{tr("Precision", "Precisión")}</th>
              <th scope="col">{tr("Recall", "Exhaustividad")}</th>
            </tr>
          </thead>
          <tbody>
            {WEEKS.map((w, i) => (
              <tr key={w}>
                <th scope="row">{wk(i)}</th>
                <td>
                  {series.precision[i] === null
                    ? tr("no data", "sin datos")
                    : `${series.precision[i]}%`}
                </td>
                <td>
                  {series.recall[i] === null
                    ? tr("no data", "sin datos")
                    : `${series.recall[i]}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
