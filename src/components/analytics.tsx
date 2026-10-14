"use client";
import { trackedFetch } from "./ui";
import { useSmartTable } from "./smart-table";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Download,
  Maximize,
  Pause,
  Play,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import {
  advertisingIndicators,
  operationalAttention,
} from "@/domain/marketplace";
import {
  businessDay,
  shiftDay,
  type AnalyticsReport,
} from "@/domain/analytics";
import { csvCell } from "@/domain/csv";
import { money, percent, Field, Empty } from "./ui";
import Collection from "./collection";
import { useToastMessage } from "./toasts";
import Skeleton from "./skeleton";
import Campaigns from "./campaigns";
import ListingDiagnostics from "./listing-diagnostics";

type Row = Record<string, any>;
type Navigate = (path: string, params?: URLSearchParams) => void;
const observedTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
const tabs = [
  "Visão geral",
  "Vendas",
  "Produtos",
  "Tráfego",
  "Financeiro",
  "Operação",
  "Publicidade",
  "Diagnóstico",
];
export default function Analytics({
  data,
  store,
  live,
  navigate,
  onOpen,
  onChanged,
}: {
  data: Row;
  store: string;
  live: boolean;
  navigate: Navigate;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const today = businessDay();
  const currentHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const [preset, setPreset] = useState("7"),
    [from, setFrom] = useState(shiftDay(today, -6)),
    [to, setTo] = useState(today);
  const [report, setReport] = useState<AnalyticsReport | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState(tabs[0]),
    [paused, setPaused] = useState(false),
    [hidden, setHidden] = useState(false),
    [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  useToastMessage(
    error
      ? `${error} Os últimos dados disponíveis são preservados quando a atualização falha.`
      : "",
  );
  useToastMessage(
    report?.stores
      .filter((s) => s.error)
      .map((s) => `${s.storeName}: ${s.error}`)
      .join(" · "),
  );
  useToastMessage(
    report?.available && !report.complete
      ? "Análise parcial: os totais usam apenas os pedidos disponíveis; a comparação entre períodos foi suspensa."
      : "",
    "warning",
  );
  const viewport = useRef<HTMLElement>(null),
    trigger = useRef<(() => void) | null>(null);
  const lastKey = useRef("");
  const requestFrom = live ? today : from,
    requestTo = live ? today : to;
  const key = new URLSearchParams({
    store,
    from: requestFrom,
    to: requestTo,
  }).toString();
  const authorizedConnections = data.connections.filter(
    (c: Row) =>
      c.provider === "mercadolivre" &&
      c.status === "connected" &&
      (store === "all" || c.store_id === store),
  );
  const canRefresh =
    data.user.role !== "viewer" && authorizedConnections.length > 0;
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    let disposed = false,
      running = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    if (lastKey.current !== key) {
      setReport(null);
      setError("");
      lastKey.current = key;
    }
    async function load(refresh: boolean, manual = false) {
      if (running || disposed) return;
      running = true;
      setLoading(true);
      try {
        const response = await trackedFetch(
          `/api/analytics${refresh ? "/refresh" : ""}?${key}`,
          {
            method: refresh ? "POST" : "GET",
            headers: refresh
              ? { "Content-Type": "application/json" }
              : undefined,
            body: refresh ? "{}" : undefined,
            signal: controller.signal,
            cache: "no-store",
          },
          refresh && !manual ? "background" : "foreground",
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Não foi possível atualizar as análises.",
          );
        if (!disposed) {
          setReport(result);
          setError("");
        }
      } catch (e) {
        if (!disposed && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        running = false;
        if (!disposed) {
          setLoading(false);
          if (live && !paused && !hidden && canRefresh)
            timer = setTimeout(() => load(true), 60000);
        }
      }
    }
    trigger.current = () => {
      if (timer) clearTimeout(timer);
      void load(true, true);
    };
    void load(false).then(() => {
      if (live && !paused && !hidden && canRefresh) {
        if (timer) clearTimeout(timer);
        void load(true);
      }
    });
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      trigger.current = null;
    };
  }, [key, live, paused, hidden, canRefresh]);
  const relevantOffers = data.offers.filter(
    (o: Row) => store === "all" || o.store_id === store,
  );
  const relevantTasks = data.tasks.filter(
    (t: Row) =>
      (store === "all" || t.store_id === store) &&
      !["done", "cancelled"].includes(t.status),
  );
  const attention = relevantOffers
    .map((o: Row) => ({ offer: o, ...operationalAttention(o) }))
    .filter((o: Row) => o.priority > 0)
    .sort((a: Row, b: Row) => b.priority - a.priority);
  const available = report?.available;
  const current = report?.current;
  const observed = report?.stores
    .filter((s) => s.observedAt)
    .map((s) => s.observedAt!)
    .sort()[0];
  function selectPreset(value: string) {
    setPreset(value);
    if (value === "custom") return;
    const days = Number(value);
    if (value === "yesterday") {
      setFrom(shiftDay(today, -1));
      setTo(shiftDay(today, -1));
    } else {
      setFrom(shiftDay(today, 1 - days));
      setTo(today);
    }
  }
  function exportSales() {
    if (!report) return;
    const rows = [
      [
        "Data",
        "Receita bruta BRL",
        "Pedidos pagos",
        "Receita comparação BRL",
        "Cobertura",
      ],
      ...report.daily.map((d) => [
        d.day,
        d.revenue,
        String(d.orders),
        d.previousRevenue,
        report.complete ? "Completa" : "Parcial",
      ]),
    ];
    const blob = new Blob(
      ["\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `datamat-analises-${requestFrom}-${requestTo}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const connectionParams = new URLSearchParams({
    store,
    configTab: "integrations",
  });
  const storeTable = useSmartTable("analyticsStores", report?.stores || [], [
    { id: "store", label: "Loja", width: 220, value: (r) => r.storeName },
    {
      id: "revenue",
      label: "Receita",
      width: 160,
      kind: "number",
      value: (r) => (r.observedAt ? r.summary.revenue : null),
    },
    {
      id: "orders",
      label: "Pedidos",
      width: 130,
      kind: "number",
      value: (r) => (r.observedAt ? r.summary.paidOrders : null),
    },
    {
      id: "ticket",
      label: "Ticket",
      width: 150,
      kind: "number",
      value: (r) => (r.observedAt ? r.summary.ticket : null),
    },
    {
      id: "date",
      label: "Consulta",
      width: 180,
      kind: "date",
      value: (r) => r.observedAt,
    },
  ]);
  return (
    <section
      className={`analytics-module stack ${live ? "analytics-live" : ""}`}
      ref={viewport}
      aria-label={live ? "Vendas ao vivo" : "Análises da operação"}
    >
      <div className="analytics-toolbar">
        <div className="analytics-period">
          {live ? (
            <span className="live-label">
              <span className={`dot ${paused || hidden ? "" : "green-dot"}`} />
              {paused
                ? "Atualização pausada"
                : hidden
                  ? "Pausado em segundo plano"
                  : "Hoje · atualização a cada 60 s"}
            </span>
          ) : (
            <>
              <Field label="Período das análises">
                <select
                  value={preset}
                  onChange={(e) => selectPreset(e.target.value)}
                >
                  {[
                    ["1", "Hoje"],
                    ["yesterday", "Ontem"],
                    ["7", "Últimos 7 dias"],
                    ["30", "Últimos 30 dias"],
                    ["90", "Últimos 90 dias"],
                    ["custom", "Personalizado"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              {preset === "custom" && (
                <>
                  <Field label="Início das análises">
                    <input
                      type="date"
                      max={to}
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </Field>
                  <Field label="Fim das análises">
                    <input
                      type="date"
                      min={from}
                      max={today}
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </Field>
                </>
              )}
            </>
          )}
        </div>
        <div className="analytics-actions">
          {live ? (
            <>
              <button className="button" onClick={() => setPaused((p) => !p)}>
                {paused ? <Play size={15} /> : <Pause size={15} />}
                {paused ? "Retomar" : "Pausar"}
              </button>
              <button
                className="button"
                onClick={async () => {
                  try {
                    if (document.fullscreenElement)
                      await document.exitFullscreen();
                    else await viewport.current?.requestFullscreen();
                  } catch {
                    setError("Tela cheia não disponível neste navegador.");
                  }
                }}
              >
                <Maximize size={15} />
                Tela cheia
              </button>
              <button
                className="button"
                onClick={() =>
                  navigate("analises", new URLSearchParams({ store }))
                }
              >
                Voltar às análises
              </button>
            </>
          ) : (
            <>
              <button
                className="button"
                disabled={!available}
                onClick={exportSales}
              >
                <Download size={15} />
                Exportar dados
              </button>
              <button
                className="button primary"
                onClick={() =>
                  navigate("analises/ao-vivo", new URLSearchParams({ store }))
                }
              >
                <Activity size={16} />
                Análise ao vivo
              </button>
            </>
          )}
          <button
            className="button"
            disabled={loading || !canRefresh}
            onClick={() => trigger.current?.()}
          >
            <RefreshCw
              size={15}
              className={loading ? "analytics-spinning" : ""}
            />
            {loading ? "Consultando…" : "Atualizar ML"}
          </button>
        </div>
      </div>
      <div className="analytics-freshness" role="status">
        {observed
          ? `Última consulta: ${observedTime(observed)} · horário de Brasília · ${report?.complete ? "pedidos completos no período consultado" : "dados parciais"}.`
          : loading
            ? "Consultando os dados disponíveis…"
            : "Nenhuma consulta de vendas para este período."}
        {live &&
          " A API pode apresentar atraso; a tela consulta periodicamente."}
      </div>
      {!authorizedConnections.length && (
        <Empty
          title="Conecte sua conta para analisar as vendas"
          body="Os diagnósticos do cadastro já estão disponíveis. Vendas, visitas e reputação dependem da autorização da loja no Mercado Livre."
          action={
            <button
              className="button"
              onClick={() => navigate("configuracoes", connectionParams)}
            >
              Conectar Mercado Livre
              <ArrowUpRight size={15} />
            </button>
          }
        />
      )}
      {!!authorizedConnections.length && !available && !loading && (
        <div className="alert">
          Clique em Atualizar ML para consultar as vendas deste período.
        </div>
      )}
      {!live && (
        <div
          className="tabs analytics-tabs"
          role="tablist"
          aria-label="Áreas de análise"
        >
          {tabs.map((t) => (
            <button
              key={t}
              id={`analytics-tab-${tabs.indexOf(t)}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls="analytics-content"
              className={tab === t ? "active" : ""}
              tabIndex={tab === t ? 0 : -1}
              onKeyDown={(e) => {
                const offset =
                  e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (offset || e.key === "Home" || e.key === "End") {
                  e.preventDefault();
                  const index =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? tabs.length - 1
                        : (tabs.indexOf(t) + offset + tabs.length) %
                          tabs.length;
                  setTab(tabs[index]);
                  document.getElementById(`analytics-tab-${index}`)?.focus();
                }
              }}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div
        id="analytics-content"
        role={live ? undefined : "tabpanel"}
        aria-labelledby={
          live ? undefined : `analytics-tab-${tabs.indexOf(tab)}`
        }
        className="stack"
        aria-busy={loading}
      >
        {loading && !report ? (
          <Skeleton variant="analytics" label="Carregando análises" />
        ) : (
          <>
            {(live || tab === "Visão geral" || tab === "Vendas") && (
              <>
                <div className="analytics-kpis">
                  {[
                    [
                      "Receita bruta",
                      available ? money(current?.revenue) : "—",
                      report?.changes?.revenue,
                      "Produtos de pedidos atualmente pagos",
                    ],
                    [
                      "Pedidos pagos",
                      available ? current?.paidOrders : "—",
                      report?.changes?.orders,
                      "Pedidos, sem agrupar por carrinho",
                    ],
                    [
                      "Unidades vendidas",
                      available ? current?.units : "—",
                      null,
                      "Quantidade de produtos",
                    ],
                    [
                      "Ticket por pedido",
                      available ? money(current?.ticket) : "—",
                      report?.changes?.ticket,
                      "Receita bruta ÷ pedidos pagos",
                    ],
                  ].map(([label, value, delta, hint]) => (
                    <Metric
                      key={String(label)}
                      label={String(label)}
                      value={value}
                      change={delta as string | null | undefined}
                      hint={String(hint)}
                    />
                  ))}
                </div>
                <div className="analytics-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          {live
                            ? "Ritmo de vendas de hoje"
                            : "Evolução das vendas"}
                        </h2>
                        <small className="muted">
                          {live
                            ? "Hora de criação dos pedidos pagos · Brasília"
                            : "Período anterior com a mesma duração e horário de corte"}
                        </small>
                      </div>
                      <select
                        aria-label="Indicador do gráfico"
                        value={metric}
                        onChange={(e) =>
                          setMetric(e.target.value as typeof metric)
                        }
                      >
                        <option value="revenue">Receita</option>
                        <option value="orders">Pedidos</option>
                      </select>
                    </div>
                    {available && report ? (
                      <SalesChart
                        label={live ? "Vendas por hora" : "Evolução das vendas"}
                        rows={
                          live
                            ? current!.hourly.map((h) => ({
                                label: `${String(h.hour).padStart(2, "0")}h`,
                                value:
                                  h.hour <= currentHour
                                    ? Number(h[metric])
                                    : null,
                                previous:
                                  h.hour > currentHour
                                    ? null
                                    : metric === "revenue"
                                      ? Number(
                                          report.previous.hourly[h.hour]
                                            .revenue,
                                        )
                                      : report.previous.hourly[h.hour].orders,
                              }))
                            : report.daily.map((d) => ({
                                label: d.day.slice(8) + "/" + d.day.slice(5, 7),
                                value: Number(d[metric]),
                                previous:
                                  metric === "revenue"
                                    ? Number(d.previousRevenue)
                                    : d.previousOrders,
                              }))
                        }
                        currency={metric === "revenue"}
                        comparison={report.complete}
                      />
                    ) : (
                      <ChartEmpty />
                    )}
                  </section>
                  <section className="panel">
                    <h2>{live ? "Últimos pedidos pagos" : "Leitura rápida"}</h2>
                    {live ? (
                      <RecentOrders report={report} stores={data.stores} />
                    ) : (
                      <>
                        <div className="analytics-funnel">
                          {[
                            ["Visitas", report?.visits],
                            [
                              "Pedidos pagos",
                              available ? current?.paidOrders : null,
                            ],
                            [
                              "Pedidos / visitas",
                              report?.orderVisitRate == null
                                ? null
                                : percent(report.orderVisitRate),
                            ],
                            [
                              "Cancelados no período",
                              available ? current?.cancelled : null,
                            ],
                          ].map(([l, v]) => (
                            <div key={String(l)}>
                              <span>{l}</span>
                              <strong>{v ?? "Indisponível"}</strong>
                            </div>
                          ))}
                        </div>
                        <p className="small muted">
                          Pedidos/visitas é uma razão do período, sem atribuição
                          de visitantes às compras. Cancelamentos consideram o
                          status atual dos pedidos criados no período.
                        </p>
                      </>
                    )}
                  </section>
                </div>
                <div className="analytics-grid">
                  <Insights
                    report={report}
                    attention={attention}
                    onOpen={onOpen}
                  />
                  <Operations
                    data={data}
                    report={report}
                    offers={relevantOffers}
                    tasks={relevantTasks}
                    compact
                    navigate={navigate}
                    store={store}
                  />
                </div>
                {tab === "Vendas" && !live && (
                  <>
                    <section className="panel">
                      <h2>Horários com mais vendas</h2>
                      {available && current ? (
                        <SalesChart
                          label="Receita por hora do dia"
                          rows={current.hourly.map((h) => ({
                            label: `${h.hour}h`,
                            value: Number(h.revenue),
                          }))}
                          currency
                        />
                      ) : (
                        <ChartEmpty />
                      )}
                    </section>
                    <section className="panel">
                      <h2>Comparativo entre lojas</h2>
                      <div className="analytics-table-wrap">
                        <table className="smart-table" {...storeTable.props}>
                          {storeTable.header()}
                          <tbody>
                            {storeTable.rows.map((s) => (
                              <tr key={s.storeId}>
                                <td>{s.storeName}</td>
                                <td>
                                  {s.observedAt
                                    ? money(s.summary.revenue)
                                    : "Indisponível"}
                                </td>
                                <td>
                                  {s.observedAt ? s.summary.paidOrders : "—"}
                                </td>
                                <td>
                                  {s.observedAt ? money(s.summary.ticket) : "—"}
                                </td>
                                <td>
                                  {s.observedAt
                                    ? observedTime(s.observedAt)
                                    : "Não consultada"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
            {!live && tab === "Produtos" && (
              <Products report={report} stores={data.stores} onOpen={onOpen} />
            )}
            {!live && tab === "Tráfego" && <Traffic report={report} />}
            {!live && tab === "Financeiro" && (
              <section className="panel">
                <h2>Receita, tarifas e contribuição</h2>
                <div className="analytics-kpis">
                  <Metric
                    label="Receita bruta de produtos"
                    value={available ? money(current?.revenue) : "—"}
                    hint="Antes de tarifas, frete, impostos e devoluções"
                  />
                  <Metric
                    label="Tarifas dos itens vendidos"
                    value={available ? money(current?.fees) : "—"}
                    hint={`Cobertura: ${percent(current?.feeCoverage)} da receita consultada`}
                  />
                  <Metric
                    label="Contribuição estimada"
                    value={available ? money(current?.contribution) : "—"}
                    hint={`Custos atuais completos: ${percent(current?.contributionCoverage)} da receita`}
                  />
                  <Metric
                    label="Margem na parcela coberta"
                    value={
                      available ? percent(current?.contributionPercent) : "—"
                    }
                    hint="Contribuição estimada ÷ receita com custos disponíveis"
                  />
                </div>
                <div className="alert">
                  A contribuição usa o preço vendido e os custos atuais
                  cadastrados, incluindo os custos estimados de tarifa, frete e
                  publicidade. Não representa lucro realizado nem conciliação de
                  pagamentos. Custos desatualizados, incompletos ou variações
                  sem vínculo ficam fora da estimativa.
                </div>
                <p className="muted">
                  Devoluções, estornos, descontos financiados, parcelas,
                  retenções e repasses exigem conciliação financeira específica.
                  Receita atribuída à publicidade já faz parte da receita total
                  e não deve ser somada novamente.
                </p>
                <button
                  className="button"
                  onClick={() =>
                    navigate("precificacao", new URLSearchParams({ store }))
                  }
                >
                  Revisar precificação
                  <ArrowUpRight size={15} />
                </button>
              </section>
            )}
            {!live && tab === "Operação" && (
              <Operations
                data={data}
                report={report}
                offers={relevantOffers}
                tasks={relevantTasks}
                navigate={navigate}
                store={store}
              />
            )}
            {!live && tab === "Publicidade" && (
              <>
                <Campaigns
                  data={data}
                  store={store}
                  from={requestFrom}
                  to={requestTo}
                  totalRevenue={
                    report?.complete ? report.current.revenue : null
                  }
                  onChanged={onChanged}
                />
                <details className="panel expand">
                  <summary>Simular indicadores sem salvar</summary>
                  <Advertising key={key} report={report} />
                </details>
              </>
            )}
            {!live && tab === "Diagnóstico" && (
              <ListingDiagnostics
                data={data}
                offers={relevantOffers}
                report={report}
                onOpen={onOpen}
              />
            )}
          </>
        )}
      </div>
      <details className="panel expand">
        <summary>Origem, cobertura e limites dos indicadores</summary>
        <p>
          Vendas: API de pedidos da conta autorizada, data de criação e status
          atual. A comparação usa o período imediatamente anterior, com a mesma
          duração. Todos os dias e horas seguem Brasília. Até 1.000 pedidos por
          loja, incluindo a comparação; períodos maiores ficam identificados
          como parciais.
        </p>
        <p>
          Estoque e qualidade: último cadastro/sincronização de anúncios.
          Reputação: janela própria informada pelo ML, independente do filtro de
          vendas. Logística: amostra de até 20 envios recentes por loja. Visitas
          e perguntas dependem dos recursos e permissões disponíveis na API.
        </p>
        {report?.warnings.map((w) => (
          <p className="small muted" key={w}>
            {w}
          </p>
        ))}
        <p className="small muted">
          Relatórios avançados de Product Ads, devoluções e reclamações,
          conciliação financeira, promoções, concorrência e métricas de catálogo
          não estão conectados automaticamente nesta versão. A publicidade
          permite conferir manualmente o relatório do mesmo período.
        </p>
      </details>
    </section>
  );
}
function Metric({
  label,
  value,
  change,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  change?: string | null;
  hint: string;
}) {
  return (
    <div className="analytics-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {change != null && (
        <span
          className={
            Number(change) >= 0 ? "analytics-positive" : "analytics-negative"
          }
        >
          {Number(change) > 0 ? "+" : ""}
          {percent(change)} <small>vs. período anterior</small>
        </span>
      )}
      <small>{hint}</small>
    </div>
  );
}
function ChartEmpty() {
  return (
    <div className="analytics-chart-empty">
      Os gráficos aparecem após consultar as vendas da conta.
    </div>
  );
}
function SalesChart({
  label,
  rows,
  currency = false,
  comparison = false,
}: {
  label: string;
  rows: { label: string; value: number | null; previous?: number | null }[];
  currency?: boolean;
  comparison?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(
    1,
    ...rows.flatMap((r) => [r.value ?? 0, comparison ? r.previous || 0 : 0]),
  );
  const x = (i: number) => 80 + (i * 630) / Math.max(1, rows.length - 1),
    y = (v: number) => 210 - (v / max) * 170;
  const path = rows
    .map((r, i) =>
      r.value === null
        ? ""
        : `${i && rows[i - 1].value !== null ? "L" : "M"}${x(i)},${y(r.value)}`,
    )
    .join(" ");
  const previous = rows
    .map((r, i) =>
      r.previous == null
        ? ""
        : `${i && rows[i - 1].previous != null ? "L" : "M"}${x(i)},${y(r.previous)}`,
    )
    .join(" ");
  const fmt = (value: number | null) =>
    value === null
      ? "—"
      : currency
        ? money(value)
        : value.toLocaleString("pt-BR");
  const showPrevious = comparison && rows.some((r) => r.previous !== undefined);
  const chartTable = useSmartTable("chart-" + label, rows, [
    { id: "label", label: "Dia / hora", width: 180, value: (r) => r.label },
    {
      id: "current",
      label: "Atual",
      width: 170,
      kind: "number" as const,
      value: (r) => r.value,
    },
    ...(showPrevious
      ? [
          {
            id: "previous",
            label: "Anterior",
            width: 170,
            kind: "number" as const,
            value: (r: (typeof rows)[number]) => r.previous,
          },
        ]
      : []),
  ]);
  return (
    <div className="analytics-chart">
      <svg viewBox="0 0 730 250" role="img" aria-label={label}>
        <title>{label}</title>
        <desc>
          Selecione um ponto para conferir o valor. Os dados também estão na
          tabela abaixo do gráfico.
        </desc>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="80"
              x2="710"
              y1={y(max * f)}
              y2={y(max * f)}
              className="chart-grid"
            />
            <text x="72" y={y(max * f) + 4} textAnchor="end">
              {new Intl.NumberFormat("pt-BR", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(max * f)}
            </text>
          </g>
        ))}
        {showPrevious && <path d={previous} className="chart-previous" />}
        <path d={path} className="chart-current" />
        {rows.map((r, i) => (
          <g key={i}>
            {(i % Math.max(1, Math.ceil(rows.length / 7)) === 0 ||
              i === rows.length - 1) && (
              <text x={x(i)} y="238" textAnchor="middle">
                {r.label}
              </text>
            )}
            {r.value !== null && (
              <circle
                cx={x(i)}
                cy={y(r.value)}
                r={selected === i ? 6 : 4}
                tabIndex={0}
                role="button"
                aria-label={`${r.label}: ${fmt(r.value)}${showPrevious ? `; anterior ${fmt(r.previous || 0)}` : ""}`}
                onFocus={() => setSelected(i)}
                onMouseEnter={() => setSelected(i)}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(i);
                  }
                }}
              />
            )}
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i />
          Atual
        </span>
        {showPrevious && (
          <span>
            <i className="previous" />
            Anterior
          </span>
        )}
        <strong aria-live="polite">
          {selected != null && rows[selected]
            ? `${rows[selected].label} · ${fmt(rows[selected].value)}${showPrevious ? ` · anterior ${fmt(rows[selected].previous || 0)}` : ""}`
            : "Passe o cursor ou selecione um ponto"}
        </strong>
      </div>
      <details className="chart-data">
        <summary>Ver dados do gráfico</summary>
        <div className="analytics-table-wrap">
          <table className="smart-table" {...chartTable.props}>
            {chartTable.header()}
            <tbody>
              {chartTable.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td>{fmt(r.value)}</td>
                  {showPrevious && <td>{fmt(r.previous ?? null)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
function RecentOrders({
  report,
  stores,
}: {
  report: AnalyticsReport | null;
  stores: Row[];
}) {
  const recent = report?.available ? report.current.recent : [];
  return recent.length ? (
    <div className="analytics-recent bounded-list">
      {recent.map((o) => (
        <div className="list-item" key={o.storeId + o.id}>
          <div>
            <strong>{money(o.revenue)}</strong>
            <small>
              {new Intl.DateTimeFormat("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(o.created))}{" "}
              · {stores.find((s) => s.id === o.storeId)?.name} · {o.units} un.
            </small>
            <span className="truncate">{o.title}</span>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="muted">
      {report?.available
        ? "Nenhum pedido pago consultado hoje."
        : "Aguardando a consulta de vendas."}
    </p>
  );
}
function Insights({
  report,
  attention,
  onOpen,
}: {
  report: AnalyticsReport | null;
  attention: Row[];
  onOpen: (id: string) => void;
}) {
  const insights: { title: string; body: string; offerId?: string }[] = [];
  if (
    report?.complete &&
    report.changes?.revenue &&
    Number(report.changes.revenue) < -15
  )
    insights.push({
      title: "Receita abaixo do período anterior",
      body: `Queda de ${percent(Math.abs(Number(report.changes.revenue)))}. Confira disponibilidade, visitas e preço antes de alterar a campanha.`,
    });
  if (
    report?.complete &&
    report.current.cancellationRate &&
    Number(report.current.cancellationRate) > 5
  )
    insights.push({
      title: "Confira os cancelamentos",
      body: `${report.current.cancelled} pedidos cancelados (${percent(report.current.cancellationRate)}). Investigue a causa no ML; esse número usa pedidos criados no período.`,
    });
  if (
    report?.complete &&
    report.current.products.length &&
    Number(report.current.revenue) > 0
  ) {
    const top = report.current.products[0],
      share = (Number(top.revenue) / Number(report.current.revenue)) * 100;
    if (share >= 40)
      insights.push({
        title: "Receita concentrada em um produto",
        body: `${top.title} responde por ${percent(share)} da receita consultada. Priorize disponibilidade e acompanhe sua margem.`,
        offerId: top.offerId || undefined,
      });
  }
  for (const item of attention.slice(0, 3))
    insights.push({
      title: item.offer.title,
      body: item.reasons.join(" · "),
      offerId: item.offer.id,
    });
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          <TrendingUp size={16} /> Próximas decisões
        </h2>
        <small className="muted">Regras explicáveis</small>
      </div>
      {insights.length ? (
        <div className="bounded-list">
          {insights.slice(0, 6).map((insight, i) => (
            <div className="list-item" key={i}>
              <div>
                <strong>{insight.title}</strong>
                <small>{insight.body}</small>
              </div>
              {insight.offerId && (
                <button
                  className="icon-button"
                  aria-label={`Abrir anúncio: ${insight.title}`}
                  onClick={() => onOpen(insight.offerId!)}
                >
                  <ArrowUpRight size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          Nenhum alerta nas verificações disponíveis. Atualize os dados para
          ampliar a análise.
        </p>
      )}
    </section>
  );
}
function Products({
  report,
  stores,
  onOpen,
}: {
  report: AnalyticsReport | null;
  stores: Row[];
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("revenue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const filtered = useMemo(
    () =>
      (report?.available ? report.current.products : []).filter((p) =>
        `${p.title} ${p.id}`
          .toLocaleLowerCase("pt-BR")
          .includes(search.toLocaleLowerCase("pt-BR")),
      ),
    [report, search],
  );
  const table = useSmartTable(
    "analyticsProducts",
    filtered,
    [
      { id: "title", label: "Produto", width: 300, value: (r) => r.title },
      {
        id: "store",
        label: "Loja",
        width: 160,
        value: (r) => stores.find((s) => s.id === r.storeId)?.name,
      },
      {
        id: "revenue",
        label: "Receita",
        width: 160,
        kind: "number",
        value: (r) => r.revenue,
      },
      {
        id: "units",
        label: "Unidades",
        width: 130,
        kind: "number",
        value: (r) => r.units,
      },
      {
        id: "share",
        label: "Participação",
        width: 150,
        kind: "number",
        value: (r) => r.revenue,
      },
      {
        id: "contribution",
        label: "Contribuição estimada",
        width: 190,
        kind: "number",
        value: (r) => r.contribution,
      },
    ],
    {
      sort: { id: sort, direction: sortDirection },
      pageId: "analyticsProducts",
      onSort: (s) => {
        setSort(s.id);
        setSortDirection(s.direction);
      },
    },
  );
  const rows = table.rows;
  return (
    <section className="panel">
      <h2>Produtos que sustentam a operação</h2>
      <div className="analytics-toolbar">
        <Field label="Buscar produto nas análises">
          <input
            placeholder="Título ou código ML"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Ordenar produtos">
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setSortDirection("desc");
            }}
          >
            <option value="revenue">Maior receita</option>
            <option value="units">Mais unidades</option>
            <option value="contribution">Maior contribuição estimada</option>
            <option value="title">Produto</option>
            <option value="store">Loja</option>
            <option value="share">Participação</option>
          </select>
        </Field>
      </div>
      {rows.length ? (
        <Collection
          id="analyticsProducts"
          sortKey={table.sortKey}
          rows={rows}
          label="Produtos nas análises"
        >
          {(page) => (
            <table className="smart-table" {...table.props}>
              {table.header()}
              <tbody>
                {page.map((p) => (
                  <tr key={p.storeId + p.id}>
                    <td>
                      {p.offerId ? (
                        <button
                          className="analytics-product-link"
                          onClick={() => onOpen(p.offerId!)}
                        >
                          {p.title}
                          <small>{p.id}</small>
                        </button>
                      ) : (
                        <span>
                          {p.title}
                          <small>{p.id}</small>
                        </span>
                      )}
                    </td>
                    <td>{stores.find((s) => s.id === p.storeId)?.name}</td>
                    <td>{money(p.revenue)}</td>
                    <td>{p.units}</td>
                    <td>
                      {Number(report?.current.revenue) > 0
                        ? percent(
                            (Number(p.revenue) /
                              Number(report?.current.revenue)) *
                              100,
                          )
                        : "—"}
                    </td>
                    <td>
                      {money(p.contribution)}
                      <small>
                        Cobertura: {percent(p.contributionCoverage)}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Collection>
      ) : (
        <p className="muted">
          Nenhuma venda de produto disponível para este filtro.
        </p>
      )}
      <p className="small muted">
        Ranking por anúncio e loja; variações podem estar agrupadas.
        Participação calculada sobre a receita consultada. A estimativa de
        contribuição usa os custos atuais disponíveis.
      </p>
    </section>
  );
}
function Operations({
  report,
  offers,
  tasks,
  compact = false,
  navigate,
  store,
}: {
  data: Row;
  report: AnalyticsReport | null;
  offers: Row[];
  tasks: Row[];
  compact?: boolean;
  navigate: Navigate;
  store: string;
}) {
  const lowStock = offers.filter(
    (o) =>
      o.status === "active" &&
      o.ml?.availableQuantity != null &&
      o.ml.availableQuantity <= 3,
  );
  const noStock = lowStock.filter((o) => o.ml.availableQuantity === 0);
  const activeOffers = offers.filter((o) => o.status === "active");
  const knownStock = activeOffers.filter(
    (o) => o.ml?.availableQuantity != null,
  ).length;
  const overdue = tasks.filter(
    (t) => t.due_date && String(t.due_date).slice(0, 10) < businessDay(),
  );
  const questionsKnown =
    report?.stores.length &&
    report.stores.every((s) => s.connected && s.unanswered !== null);
  const questions = questionsKnown
    ? report!.stores.reduce((s, c) => s + c.unanswered!, 0)
    : null;
  return (
    <section className="panel">
      <h2>Saúde da operação</h2>
      <div className="analytics-funnel">
        {[
          ["Perguntas sem resposta", questions ?? "Indisponível"],
          ["Anúncios ativos sem estoque", noStock.length],
          ["Estoque publicado de 1 a 3 un.", lowStock.length - noStock.length],
          [
            "Custos para revisar",
            offers.filter(
              (o) => o.costs_stale || o.calculation?.pending?.length,
            ).length,
          ],
          ["Ações em atraso", overdue.length],
          [
            "Anúncios com melhoria pendente",
            offers.filter((o) => o.quality?.length).length,
          ],
        ].map(([l, v]) => (
          <div key={String(l)}>
            <span>{l}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <p className="small muted">
        Estoque observado em {knownStock} de {activeOffers.length} anúncios
        ativos. Estoque e qualidade refletem a última sincronização do cadastro.
        O alerta de 1 a 3 unidades usa um limite fixo; não é previsão de
        ruptura.
      </p>
      <button
        className="button"
        onClick={() => navigate("acoes", new URLSearchParams({ store }))}
      >
        Abrir ações
        <ArrowUpRight size={15} />
      </button>
      {!compact && (
        <>
          <h3 className="analytics-subtitle">Reputação e envios por loja</h3>
          {report?.stores.map((s) => (
            <div className="analytics-store-card" key={s.storeId}>
              <strong>{s.storeName}</strong>
              <p className="small muted">
                {s.reputation
                  ? `Nível ML: ${s.reputation.level || "não informado"} · MercadoLíder: ${s.reputation.powerSeller || "não informado"} · ${s.reputation.completed ?? "—"} transações concluídas · ${s.reputation.cancelled ?? "—"} canceladas · janela ML: ${s.reputation.period || "não informada"}`
                  : "Reputação indisponível; não corresponde ao filtro de vendas."}
              </p>
              <p className="small muted">
                {s.shipping
                  ? `Envios consultados: ${s.shipping.sampled} de ${s.shipping.total} identificados nos pedidos pagos. ${Object.entries(
                      s.shipping.statuses,
                    )
                      .map(
                        ([status, count]) =>
                          `${({ ready_to_ship: "Prontos para enviar", shipped: "Em trânsito", delivered: "Entregues", pending: "Pendentes", handling: "Em preparação", cancelled: "Cancelados", not_delivered: "Não entregues" } as Record<string, string>)[status] || status}: ${count}`,
                      )
                      .join(" · ")}`
                  : "Logística indisponível."}
              </p>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
function Traffic({ report }: { report: AnalyticsReport | null }) {
  const known = report?.visits !== null && report?.visits !== undefined;
  const rows =
    report?.daily.map((d) => ({
      label: d.day.slice(8) + "/" + d.day.slice(5, 7),
      value: report.stores.reduce(
        (sum, s) => sum + (s.visits?.find((v) => v.day === d.day)?.visits || 0),
        0,
      ),
    })) || [];
  return (
    <section className="panel">
      <h2>Da visita à venda</h2>
      <div className="analytics-kpis">
        <Metric
          label="Visitas no período"
          value={known ? report!.visits : "Indisponível"}
          hint="Dias retornados pela API de visitas"
        />
        <Metric
          label="Pedidos pagos"
          value={report?.available ? report.current.paidOrders : "—"}
          hint="Criados no período, atualmente pagos"
        />
        <Metric
          label="Pedidos / visitas"
          value={percent(report?.orderVisitRate)}
          hint="Razão do período; não é atribuição de visitantes"
        />
        <Metric
          label="Unidades por pedido"
          value={
            report?.available && report.current.paidOrders
              ? (
                  report.current.units / report.current.paidOrders
                ).toLocaleString("pt-BR", { maximumFractionDigits: 2 })
              : "Indisponível"
          }
          hint="Quantidade total ÷ pedidos pagos"
        />
      </div>
      {known ? (
        <SalesChart label="Visitas por dia" rows={rows} />
      ) : (
        <div className="alert">
          As visitas não estão disponíveis para todas as lojas deste filtro.
          Confira a autorização e atualize novamente; nenhum zero foi usado para
          substituir uma resposta ausente.
        </div>
      )}
      <p className="small muted">
        As visitas podem ser agregadas e processadas com atraso pelo Mercado
        Livre. Não representam visitantes únicos nem um funil com identificação
        individual. Visitas e pedidos podem atualizar em momentos diferentes.
      </p>
    </section>
  );
}
function Advertising({ report }: { report: AnalyticsReport | null }) {
  const [values, setValues] = useState({
    spend: "",
    attributed: "",
    impressions: "",
    clicks: "",
    orders: "",
  });
  const indicators = advertisingIndicators(
    values.spend || null,
    values.attributed || null,
    report?.complete ? report.current.revenue : null,
  );
  const ratio = (a: string, b: string, multiplier = 1) =>
    /^\d+(\.\d+)?$/.test(a) &&
    /^\d+(\.\d+)?$/.test(b) &&
    Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    Number(b) > 0
      ? (Number(a) / Number(b)) * multiplier
      : null;
  const ctr = ratio(values.clicks, values.impressions, 100),
    cpc = ratio(values.spend, values.clicks),
    conversion = ratio(values.orders, values.clicks, 100);
  return (
    <section className="panel">
      <h2>Retorno da publicidade</h2>
      <p className="muted">
        Confira os números do relatório de Product Ads do mesmo período
        selecionado. Estes campos são manuais, calculam enquanto você digita e
        não alteram seus custos. A coleta automática de publicidade ainda
        depende da habilitação e integração específica da API.
      </p>
      <div className="form-grid">
        {[
          ["spend", "Investimento em anúncios (R$)"],
          ["attributed", "Receita atribuída (R$)"],
          ["impressions", "Impressões"],
          ["clicks", "Cliques"],
          ["orders", "Pedidos atribuídos"],
        ].map(([k, label]) => (
          <Field label={label} key={k}>
            <input
              type="number"
              min="0"
              step={k === "spend" || k === "attributed" ? "0.01" : "1"}
              value={values[k as keyof typeof values]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [k]: e.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      <div className="analytics-kpis" aria-live="polite">
        {[
          [
            "ROAS",
            indicators.roas === null ? "Indisponível" : indicators.roas + "×",
            "Receita atribuída ÷ investimento",
          ],
          [
            "ACOS",
            percent(indicators.acos),
            "Investimento ÷ receita atribuída",
          ],
          [
            "TACOS",
            percent(indicators.tacos),
            "Investimento ÷ receita total completa do período",
          ],
          ["CTR", percent(ctr), "Cliques ÷ impressões"],
          ["CPC", money(cpc), "Investimento ÷ cliques"],
          [
            "Pedidos / cliques",
            percent(conversion),
            "Razão dos valores informados no relatório",
          ],
        ].map(([l, v, h]) => (
          <Metric key={l} label={l} value={v} hint={h} />
        ))}
      </div>
      <p className="small muted">
        Receita atribuída já está incluída na receita total. O TACOS só aparece
        com a receita completa do período. Janelas de atribuição do ML podem
        divergir das datas de criação dos pedidos.
      </p>
    </section>
  );
}
