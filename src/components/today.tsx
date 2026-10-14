"use client";
import { useEffect, useRef, useState, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pause,
  Play,
  RefreshCw,
  CheckCircle2,
  LoaderCircle,
  Wallet,
  ShoppingBag,
  CircleAlert,
  ClipboardCheck,
  CirclePause,
  CirclePlay,
  FilePenLine,
  Calculator,
  ListChecks,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Package,
  Images,
  History,
  Banknote,
  ExternalLink,
  Info,
} from "lucide-react";
import { money, jsonRequest, percent, labels } from "./ui";
import { MediaImage } from "./listing-media";
import { useToast } from "./toasts";
import type { TodayFocus, TodayItem } from "../domain/today";
type Row = Record<string, any>;
const focusLabels = {
  urgent: "Urgentes",
  review: "Revisar",
  prepare: "Preparar",
};
const focusIcons = {
  urgent: CircleAlert,
  review: ListChecks,
  prepare: Calculator,
};
export default function Today({
  data,
  store,
  blocked,
  onUpdated,
  onOpen,
  onPreview,
  onTask,
  navigate,
}: {
  data: Row;
  store: string;
  blocked: boolean;
  onUpdated: (data: Row) => void;
  onOpen: (id: string, tab?: string) => void;
  onPreview: (id: string, tab?: string) => void;
  onTask: (task: Row) => void;
  navigate: (path: string, query?: URLSearchParams) => void;
}) {
  const router = useRouter(),
    search = useSearchParams(),
    { notify } = useToast();
  const initialFocus: TodayFocus = data.summary.urgent
    ? "urgent"
    : data.summary.review
      ? "review"
      : "prepare";
  const defaultFocus = useRef(initialFocus);
  const selected = search.get("todayFocus"),
    focus: TodayFocus = ["urgent", "review", "prepare"].includes(selected || "")
      ? (selected as TodayFocus)
      : defaultFocus.current;
  const decisionsOnly = search.get("todayDecisions") === "yes";
  const requestedPage = Number(search.get("todayPage"));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const [paused, setPaused] = useState(false),
    [working, setWorking] = useState(false),
    [showDeferred, setShowDeferred] = useState(false),
    [deferred, setDeferred] = useState<
      Record<string, { until: number; signature: string }>
    >({}),
    [tick, setTick] = useState(0);
  const [graphOpen, setGraphOpen] = useState(
    () =>
      data.sales.available &&
      (typeof window === "undefined" || window.innerWidth > 850),
  );
  const graphTouched = useRef(false);
  const coverageId = useId();
  const coverageRef = useRef<HTMLDivElement>(null);
  const running = useRef(false),
    trigger = useRef<() => void>(() => {});
  const latest = useRef({ data, blocked, paused, onUpdated });
  latest.current = { data, blocked, paused, onUpdated };
  useEffect(() => {
    if (
      data.sales.available &&
      !graphTouched.current &&
      window.innerWidth > 850
    )
      setGraphOpen(true);
  }, [data.sales.available]);
  const storageKey = `datamat:today-deferred:${data.user.organization_id}:${store}`;
  const signature = (item: TodayItem) =>
    item.reason + ":" + item.evidence + ":" + item.proposalId;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      setDeferred(
        Object.fromEntries(
          Object.entries(saved).filter(
            ([, v]: [string, any]) =>
              v &&
              typeof v.signature === "string" &&
              Number.isFinite(v.until) &&
              v.until > Date.now(),
          ),
        ) as typeof deferred,
      );
    } catch {
      setDeferred({});
    }
  }, [storageKey]);
  useEffect(() => {
    const next = Math.min(
      ...Object.values(deferred)
        .map((d) => d.until)
        .filter((t) => t > Date.now()),
    );
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => setTick((n) => n + 1),
      Math.max(1, next - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [deferred, tick]);
  const canRefresh =
    data.user.role !== "viewer" &&
    data.connections.some(
      (c: Row) =>
        c.status === "connected" && (store === "all" || c.store_id === store),
    );
  useEffect(() => {
    if (!canRefresh) return;
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const safe = () =>
      active &&
      !document.hidden &&
      !latest.current.blocked &&
      !document.querySelector("dialog[open]");
    const schedule = () => {
      clearTimeout(timer);
      if (active && !latest.current.paused && !document.hidden)
        timer = setTimeout(() => void refresh(false), 60000);
    };
    async function refresh(manual: boolean) {
      if (running.current || !safe() || (!manual && latest.current.paused)) {
        schedule();
        return;
      }
      running.current = true;
      setWorking(true);
      try {
        const result = await jsonRequest(
          "/api/today/refresh?" + new URLSearchParams({ store }),
          {},
          "POST",
          controller.signal,
          manual ? "foreground" : "background",
        );
        if (safe()) {
          latest.current.onUpdated(result);
          const failed = result.sales.stores.filter((s: Row) => s.error);
          if (failed.length)
            notify(
              "Algumas lojas estão com atualização pendente; os dados disponíveis foram preservados.",
              "warning",
            );
        }
      } catch (e) {
        if (active && !controller.signal.aborted)
          notify((e as Error).message, "error");
      } finally {
        running.current = false;
        if (active) setWorking(false);
        schedule();
      }
    }
    trigger.current = () => void refresh(true);
    const visibility = () => {
      if (document.hidden) clearTimeout(timer);
      else schedule();
    };
    document.addEventListener("visibilitychange", visibility);
    // One coordinator handles sales and catalogue; no second polling loop.
    if (!latest.current.paused) void refresh(false);
    else schedule();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [store, canRefresh, notify]);
  function changeFocus(value: TodayFocus, decisions = false, nextPage = 1) {
    const params = new URLSearchParams(search.toString());
    params.set("todayFocus", value);
    params.set("todayPage", String(nextPage));
    decisions
      ? params.set("todayDecisions", "yes")
      : params.delete("todayDecisions");
    router.replace("/?" + params, { scroll: false });
  }
  function defer(item: TodayItem) {
    const next = {
      ...deferred,
      [item.id]: { until: Date.now() + 3600000, signature: signature(item) },
    };
    setDeferred(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
    notify("Revisão adiada por uma hora neste navegador.");
  }
  const isDeferred = (item: TodayItem) =>
    item.severity !== "urgent" &&
    deferred[item.id]?.until > Date.now() &&
    deferred[item.id]?.signature === signature(item);
  const all = (data.queue as TodayItem[]).filter((q) =>
    decisionsOnly ? !!q.proposalId : q.severity === focus,
  );
  const postponed = all.filter(isDeferred).length;
  const rows = all.filter((q) => showDeferred || !isDeferred(q));
  const lastPage = Math.max(1, Math.ceil(rows.length / 5)),
    activePage = Math.min(page, lastPage),
    visible = rows.slice((activePage - 1) * 5, activePage * 5);
  const queueRef = useRef<HTMLDivElement>(null);
  const queueScrollKey = `${storageKey}:scroll:${focus}:${activePage}:${decisionsOnly}`;
  useEffect(() => {
    let position = 0;
    try {
      position = Number(sessionStorage.getItem(queueScrollKey) || "0");
    } catch {}
    const frame = requestAnimationFrame(() => {
      if (queueRef.current)
        queueRef.current.scrollTop = Number.isFinite(position)
          ? Math.max(0, position)
          : 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [queueScrollKey]);
  const dateTime = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(v));
  const availableStores = data.sales.stores.filter(
    (s: Row) => s.connected && s.observedAt,
  );
  const missingStores = availableStores.length < data.sales.stores.length;
  const status = data.sales.stores.some((s: Row) => s.error)
    ? "Atualização pendente"
    : data.sales.available
      ? data.sales.complete
        ? "Dados completos"
        : missingStores
          ? `Vendas de ${availableStores.length}/${data.sales.stores.length} lojas`
          : "Dados parciais"
      : "Sem consulta de vendas";
  return (
    <div className="today-dashboard" aria-busy={working}>
      <div className="today-toolbar">
        <div className="today-freshness">
          <span
            className={"dot " + (data.sales.complete ? "is-current" : "")}
          />
          {data.sales.observedAt
            ? `Consultado às ${dateTime(data.sales.observedAt)} · `
            : ""}
          {status}
          {!data.sales.complete && (
            <>
              <button
                className="icon-button today-coverage-help"
                aria-label="Ver cobertura das consultas de vendas"
                popoverTarget={coverageId}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  if (coverageRef.current) {
                    const width = Math.min(340, window.innerWidth - 24);
                    coverageRef.current.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
                    coverageRef.current.style.top = `${Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight / 2))}px`;
                  }
                }}
              >
                <Info size={14} aria-hidden="true" />
              </button>
              <div
                className="today-coverage-popover"
                id={coverageId}
                popover="auto"
                ref={coverageRef}
              >
                <h3>Consultas de vendas</h3>
                <p>
                  Os totais usam as consultas disponíveis das lojas
                  selecionadas. A comparação com ontem exige uma consulta
                  completa de todas elas.
                </p>
                <ul>
                  {data.sales.stores.map((source: Row) => (
                    <li key={source.id}>
                      <strong>{source.name}</strong>
                      <span>
                        {!source.connected
                          ? "Conta ML não conectada."
                          : source.error
                            ? source.error
                            : !source.observedAt
                              ? "A primeira consulta de vendas ainda não foi concluída."
                              : source.complete === false
                                ? "A consulta do ML retornou somente parte dos pedidos."
                                : "Consulta disponível."}
                      </span>
                      {source.connected &&
                        !source.error &&
                        source.complete === false &&
                        source.warnings?.map((warning: string) => (
                          <small key={warning}>{warning}</small>
                        ))}
                    </li>
                  ))}
                </ul>
                <button
                  className="text-link"
                  popoverTarget={coverageId}
                  popoverTargetAction="hide"
                  onClick={() =>
                    navigate(
                      "configuracoes",
                      new URLSearchParams({ store, configTab: "integrations" }),
                    )
                  }
                >
                  Conferir integrações
                  <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
        <div className="heading-actions">
          {canRefresh && (
            <>
              <button
                className="icon-button"
                title={
                  paused
                    ? "Retomar atualização automática"
                    : "Pausar atualização automática"
                }
                aria-label={
                  paused
                    ? "Retomar atualização automática"
                    : "Pausar atualização automática"
                }
                onClick={() => {
                  setPaused((v) => !v);
                  if (paused) trigger.current();
                }}
              >
                {paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
              <button
                className="button compact"
                disabled={working || blocked}
                onClick={() => trigger.current()}
              >
                {working ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}{" "}
                Atualizar ML
              </button>
            </>
          )}
          <button
            className="text-link"
            onClick={() =>
              navigate("analises/ao-vivo", new URLSearchParams({ store }))
            }
          >
            Análise ao vivo <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
      <div className="today-metrics" aria-label="Resumo de hoje">
        <div
          className="today-metric revenue"
          title="Receita dos produtos em pedidos pagos; não é o repasse líquido"
        >
          <span className="today-metric-label">
            <Wallet size={16} aria-hidden="true" />
            Receita de hoje
          </span>
          <strong
            title={
              data.sales.revenue == null ? undefined : money(data.sales.revenue)
            }
          >
            {data.sales.revenue == null ? "—" : money(data.sales.revenue)}
          </strong>
          {data.sales.change != null ? (
            <small
              className={
                Number(data.sales.change) < 0
                  ? "trend negative"
                  : "trend positive"
              }
            >
              {Number(data.sales.change) < 0 ? (
                <TrendingDown size={12} aria-hidden="true" />
              ) : (
                <TrendingUp size={12} aria-hidden="true" />
              )}
              {`${Number(data.sales.change) > 0 ? "+" : ""}${percent(data.sales.change)} vs. ontem até a consulta`}
            </small>
          ) : (
            <small>Produtos em pedidos pagos</small>
          )}
        </div>
        <div className="today-metric orders">
          <span className="today-metric-label">
            <ShoppingBag size={16} aria-hidden="true" />
            Pedidos pagos
          </span>
          <strong>{data.sales.orders ?? "—"}</strong>
          <small>
            {data.sales.units == null
              ? "Aguardando consulta"
              : `${data.sales.units} ${data.sales.units === 1 ? "unidade vendida" : "unidades vendidas"}`}
          </small>
        </div>
        <button
          className={
            "today-metric urgencies " +
            (data.summary.urgent ? "has-urgency" : "")
          }
          onClick={() => changeFocus("urgent")}
        >
          <span className="today-metric-label">
            <CircleAlert size={16} aria-hidden="true" />
            Anúncios urgentes
          </span>
          <strong className={data.summary.urgent ? "negative" : ""}>
            {data.summary.urgent}
          </strong>
          <small>
            {data.summary.urgent ? "Conferir agora" : "Nenhum problema urgente"}
            <ChevronRight size={12} aria-hidden="true" />
          </small>
        </button>
        <button
          className="today-metric decisions"
          onClick={() => changeFocus("review", true)}
        >
          <span className="today-metric-label">
            <ClipboardCheck size={16} aria-hidden="true" />
            Decisões pendentes
          </span>
          <strong>{data.summary.decisions}</strong>
          <small>
            Revisar e aplicar propostas
            <ChevronRight size={12} aria-hidden="true" />
          </small>
        </button>
      </div>
      {data.portfolio && (
        <section
          className="today-portfolio panel"
          aria-label="Resumo da carteira de anúncios"
        >
          <div className="today-portfolio-statuses">
            {(
              [
                ["active", "Ativos", CirclePlay],
                ["paused", "Pausados", CirclePause],
                ["draft", "Rascunhos", FilePenLine],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                className={"today-status-count " + key}
                onClick={() =>
                  navigate(
                    "anuncios",
                    new URLSearchParams({ store, status: key }),
                  )
                }
              >
                <Icon size={15} aria-hidden="true" />
                <strong>{data.portfolio[key]}</strong>
                {label}
              </button>
            ))}
          </div>
          <button
            className="today-cost-coverage"
            onClick={() =>
              navigate(
                "anuncios",
                new URLSearchParams({ store, pending: "costs" }),
              )
            }
          >
            <Calculator size={17} aria-hidden="true" />
            <span>
              <strong>
                {data.portfolio.financiallyReady}/{data.summary.totalOffers}
              </strong>{" "}
              com custos em dia
              <meter
                min={0}
                max={Math.max(1, data.summary.totalOffers)}
                value={data.portfolio.financiallyReady}
                aria-label="Anúncios com custos em dia"
              />
            </span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          {data.portfolio.overdueTasks > 0 && (
            <button
              className="today-overdue"
              onClick={() => navigate("acoes", new URLSearchParams({ store }))}
            >
              <Clock size={14} aria-hidden="true" />
              {data.portfolio.overdueTasks}{" "}
              {data.portfolio.overdueTasks === 1
                ? "ação atrasada"
                : "ações atrasadas"}
            </button>
          )}
        </section>
      )}
      <div className="today-main-grid">
        <section
          className="panel today-work-panel"
          aria-labelledby="today-queue-heading"
        >
          <div className="panel-heading">
            <h2 id="today-queue-heading">
              <Sparkles size={16} aria-hidden="true" />
              Próximos anúncios
            </h2>
            <span className="small muted">
              {data.summary.totalOffers} no cadastro
            </span>
          </div>
          <div
            className="today-focus"
            role="tablist"
            aria-label="Prioridade dos anúncios"
          >
            {(Object.keys(focusLabels) as TodayFocus[]).map((key) => {
              const Icon = focusIcons[key];
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={key === focus}
                  tabIndex={key === focus ? 0 : -1}
                  onKeyDown={(event) => {
                    const keys = Object.keys(focusLabels) as TodayFocus[],
                      index = keys.indexOf(key);
                    const next =
                      event.key === "ArrowRight"
                        ? keys[(index + 1) % 3]
                        : event.key === "ArrowLeft"
                          ? keys[(index + 2) % 3]
                          : event.key === "Home"
                            ? keys[0]
                            : event.key === "End"
                              ? keys[2]
                              : null;
                    if (!next) return;
                    event.preventDefault();
                    changeFocus(next);
                    requestAnimationFrame(() =>
                      document.getElementById("today-tab-" + next)?.focus(),
                    );
                  }}
                  aria-controls="today-queue"
                  id={"today-tab-" + key}
                  className={key + (key === focus ? " selected" : "")}
                  onClick={() => changeFocus(key)}
                >
                  <Icon size={13} aria-hidden="true" />
                  {focusLabels[key]} <span>{data.summary[key]}</span>
                </button>
              );
            })}
          </div>
          <div
            id="today-queue"
            role="tabpanel"
            aria-labelledby={"today-tab-" + focus}
            className="today-queue"
            ref={queueRef}
            onScroll={(event) => {
              try {
                sessionStorage.setItem(
                  queueScrollKey,
                  String(event.currentTarget.scrollTop),
                );
              } catch {}
            }}
          >
            {decisionsOnly && (
              <div className="today-filter-note">
                Somente decisões{" "}
                <button
                  className="text-link"
                  onClick={() => changeFocus(focus)}
                >
                  Mostrar tudo
                </button>
              </div>
            )}
            {visible.length ? (
              visible.map((item) => (
                <div
                  className={"today-queue-row " + item.severity}
                  key={item.id}
                >
                  <button
                    className="today-thumbnail"
                    aria-label={`Abrir ${item.title}`}
                    onClick={() => onPreview(item.id)}
                  >
                    {item.thumbnail ? (
                      <MediaImage src={item.thumbnail} alt="" />
                    ) : (
                      <span className="today-thumbnail-placeholder">
                        {item.title.slice(0, 1)}
                      </span>
                    )}
                  </button>
                  <div className="today-queue-copy">
                    <button
                      className="text-link today-title"
                      title={item.title}
                      onClick={() => onPreview(item.id)}
                    >
                      {item.title}
                    </button>
                    <span
                      className="today-reason"
                      title={
                        decisionsOnly
                          ? item.decisionEvidence || item.evidence
                          : item.evidence
                      }
                    >
                      {store === "all" ? item.storeName + " · " : ""}
                      {decisionsOnly
                        ? item.decisionReason || item.reason
                        : item.reason}
                      {item.reasons.length > 1 && (
                        <small title={item.reasons.join(" · ")}>
                          {" "}
                          +{item.reasons.length - 1}
                        </small>
                      )}
                    </span>
                    <span
                      className="today-evidence"
                      title={
                        decisionsOnly
                          ? item.decisionEvidence || item.evidence
                          : item.evidence
                      }
                    >
                      {decisionsOnly
                        ? item.decisionEvidence || item.evidence
                        : item.evidence}
                    </span>
                    <div className="today-listing-facts">
                      <span className={"today-status-badge " + item.status}>
                        {labels[item.status] || item.status}
                      </span>
                      {item.mlId && <span title={item.mlId}>{item.mlId}</span>}
                      <span title="Preço cadastrado">
                        <Banknote size={12} aria-hidden="true" />
                        {item.price == null
                          ? "Preço a conferir"
                          : money(item.price)}
                      </span>
                      {item.margin != null && (
                        <span
                          className={
                            Number(item.margin) < 0 ? "negative" : "positive"
                          }
                          title="Contribuição estimada por unidade com os custos cadastrados"
                        >
                          Margem {money(item.margin)}
                          {item.marginPercent != null
                            ? ` (${percent(item.marginPercent)})`
                            : ""}
                        </span>
                      )}
                      {item.stock != null && (
                        <span title="Estoque publicado consultado há até 15 minutos">
                          <Package size={12} aria-hidden="true" />
                          {item.stock} un.
                        </span>
                      )}
                      {item.minPrice != null && item.severity !== "prepare" && (
                        <span title="Preço mínimo calculado com as condições cadastradas">
                          Piso {money(item.minPrice)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="today-row-actions">
                    <button
                      className="button compact"
                      aria-label={
                        decisionsOnly
                          ? item.decisionAction || "Abrir proposta"
                          : item.action
                      }
                      title={
                        decisionsOnly
                          ? item.decisionAction || "Abrir proposta"
                          : item.action
                      }
                      onClick={() =>
                        onOpen(item.id, decisionsOnly ? "proposals" : item.tab)
                      }
                    >
                      <span className="today-action-label">
                        {decisionsOnly
                          ? item.decisionAction || "Abrir proposta"
                          : item.action}
                      </span>
                      {item.tab === "costs" && !decisionsOnly ? (
                        <Calculator size={14} />
                      ) : item.tab === "media" ? (
                        <Images size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </button>
                    {item.severity !== "urgent" && (
                      <button
                        className="icon-button today-defer"
                        aria-label={`Adiar revisão de ${item.title}`}
                        title="Adiar por uma hora"
                        onClick={() => defer(item)}
                      >
                        <Clock size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="today-empty">
                <CheckCircle2 size={22} />
                <strong>
                  {postponed && !showDeferred
                    ? "Revisões adiadas"
                    : focus === "urgent"
                      ? "Nenhuma urgência identificada"
                      : decisionsOnly
                        ? "Nenhuma decisão pendente"
                        : focus === "review"
                          ? "Nenhuma revisão identificada"
                          : "Dados financeiros em dia"}
                </strong>
                <span>
                  {postponed && !showDeferred
                    ? "Há revisões adiadas neste navegador."
                    : "Com base nos dados disponíveis."}
                </span>
              </div>
            )}
          </div>
          <div className="today-queue-footer">
            <span>
              {rows.length
                ? `${(activePage - 1) * 5 + 1}–${Math.min(activePage * 5, rows.length)} de ${rows.length}`
                : "0 anúncios"}
              {postponed > 0 && (
                <button
                  className="text-link"
                  onClick={() => setShowDeferred((v) => !v)}
                >
                  {showDeferred ? "Ocultar adiados" : `${postponed} adiado(s)`}
                </button>
              )}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="Anúncios anteriores"
                disabled={activePage === 1}
                onClick={() =>
                  changeFocus(focus, decisionsOnly, activePage - 1)
                }
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Próximos anúncios da fila"
                disabled={activePage === lastPage}
                onClick={() =>
                  changeFocus(focus, decisionsOnly, activePage + 1)
                }
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </section>
        <div className="today-insights">
          <details
            className="panel today-chart-panel"
            open={graphOpen}
            onToggle={(e) => setGraphOpen(e.currentTarget.open)}
          >
            <summary
              onClick={() => {
                graphTouched.current = true;
              }}
            >
              <b>
                <TrendingUp size={16} aria-hidden="true" />
                Ritmo de vendas
              </b>{" "}
              <span className="small muted">
                Hoje × ontem até o mesmo horário
              </span>
            </summary>
            <TodayChart
              hours={data.sales.hours}
              available={data.sales.available}
              complete={data.sales.complete}
            />
          </details>
          <section
            className="panel today-financial"
            aria-label="Resultado financeiro do dia"
          >
            <h2>
              <Calculator size={15} aria-hidden="true" />
              Resultado do dia
            </h2>
            <div className="today-financial-values">
              <div>
                <span>Ticket médio</span>
                <strong>
                  {data.sales.ticket == null ? "—" : money(data.sales.ticket)}
                </strong>
              </div>
              <div>
                <span>Contribuição estimada</span>
                <strong
                  className={
                    data.sales.contribution == null
                      ? ""
                      : Number(data.sales.contribution) < 0
                        ? "negative"
                        : "positive"
                  }
                >
                  {data.sales.contribution == null
                    ? "—"
                    : money(data.sales.contribution)}
                </strong>
              </div>
            </div>
            <p>
              {data.sales.contributionCoverage == null
                ? "A estimativa depende de vendas e custos completos."
                : `Custos disponíveis para ${percent(data.sales.contributionCoverage)} da receita consultada.`}
            </p>
            <button
              className="text-link"
              onClick={() =>
                navigate("analises", new URLSearchParams({ store }))
              }
            >
              Analisar margens e desempenho
              <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          </section>
        </div>
      </div>
      <div className="today-secondary">
        {data.highlights.length > 0 && (
          <details className="panel today-fold">
            <summary>
              <TrendingUp size={15} aria-hidden="true" />
              Anúncios em destaque{" "}
              <span className="small muted">7 dias completos</span>
            </summary>
            <div className="today-mini-list">
              {data.highlights.map((item: Row) => (
                <button
                  key={item.id}
                  onClick={() => onOpen(item.id, "overview")}
                >
                  <span title={item.title}>{item.title}</span>
                  <small>
                    {item.units} un. · {money(item.revenue)}
                  </small>
                </button>
              ))}
            </div>
          </details>
        )}
        {data.changes.length > 0 && (
          <details className="panel today-fold">
            <summary>
              <History size={15} aria-hidden="true" />
              Alterações detectadas <span className="small muted">Hoje</span>
            </summary>
            <div className="today-mini-list">
              {data.changes.map((item: Row) => (
                <button
                  key={item.id}
                  onClick={() => onOpen(item.id, "history")}
                >
                  <span title={item.title}>{item.title}</span>
                  <small>
                    {item.fields.join(" · ")} · {dateTime(item.at)}
                  </small>
                </button>
              ))}
            </div>
          </details>
        )}
        {data.tasks.length > 0 && (
          <details className="panel today-fold">
            <summary>
              <ClipboardCheck size={15} aria-hidden="true" />
              Ações em aberto{" "}
              <span className="count-pill">{data.tasks.length}</span>
            </summary>
            <div className="today-mini-list">
              {data.tasks.slice(0, 3).map((t: Row) => (
                <button key={t.id} onClick={() => onTask(t)}>
                  <span>{t.title}</span>
                  <small>
                    {t.due_date
                      ? `Prazo ${t.due_date.split("-").reverse().join("/")}`
                      : "Sem prazo"}
                  </small>
                </button>
              ))}
              <button
                className="text-link"
                onClick={() =>
                  navigate("acoes", new URLSearchParams({ store }))
                }
              >
                Ver todas as ações
              </button>
            </div>
          </details>
        )}
      </div>
      {!canRefresh &&
        !data.connections.some((c: Row) => c.status === "connected") &&
        data.user.role === "admin" && (
          <p className="today-footnote">
            <button
              className="text-link"
              onClick={() =>
                navigate(
                  "configuracoes",
                  new URLSearchParams({ store, configTab: "integrations" }),
                )
              }
            >
              <ExternalLink size={13} aria-hidden="true" />
              Conectar conta ML
            </button>{" "}
            para acompanhar as vendas e o desempenho.
          </p>
        )}
    </div>
  );
}
function TodayChart({
  hours,
  available,
  complete,
}: {
  hours: Row[];
  available: boolean;
  complete: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const gradient = useId();
  const width = 380,
    height = 190,
    left = 32,
    bottom = 162,
    top = 18;
  const max = Math.max(
    1,
    ...hours.flatMap((h) => [Number(h.revenue || 0), Number(h.previous || 0)]),
  );
  const x = (i: number) =>
      left + (i * (width - left - 16)) / Math.max(1, hours.length - 1),
    y = (v: number) => bottom - (v / max) * (bottom - top);
  const path = (key: string) =>
    hours
      .map((h, i) => `${i ? "L" : "M"}${x(i)},${y(Number(h[key] || 0))}`)
      .join(" ");
  const point = selected == null ? null : hours[selected];
  return (
    <div className="today-chart">
      <div className="today-chart-legend">
        <span>
          <i />
          Hoje
        </span>
        {complete && (
          <span>
            <i className="previous" />
            Ontem
          </span>
        )}
      </div>
      {!available ? (
        <div className="today-chart-empty">
          As vendas aparecem após a consulta da loja.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Receita por hora de hoje e ontem até o mesmo horário"
        >
          <title>Receita por hora</title>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ffb03f" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ffb03f" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={left}
                x2={width - 16}
                y1={y(max * f)}
                y2={y(max * f)}
                className="chart-grid"
              />
              <text x={left - 6} y={y(max * f) + 4} textAnchor="end">
                {new Intl.NumberFormat("pt-BR", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(max * f)}
              </text>
            </g>
          ))}
          {hours.length > 1 && (
            <path
              d={`${path("revenue")} L${x(hours.length - 1)},${bottom} L${x(0)},${bottom} Z`}
              fill={`url(#${gradient})`}
            />
          )}
          {complete && <path d={path("previous")} className="chart-previous" />}
          <path d={path("revenue")} className="chart-current" />
          {hours.map((h, i) => (
            <g key={h.hour}>
              {(i % Math.max(1, Math.ceil(hours.length / 5)) === 0 ||
                i === hours.length - 1) && (
                <text x={x(i)} y={bottom + 20} textAnchor="middle">
                  {h.hour}h
                </text>
              )}
              <circle
                cx={x(i)}
                cy={y(Number(h.revenue || 0))}
                r={selected === i ? 4 : 3}
                className="chart-dot"
                tabIndex={0}
                role="button"
                aria-label={`${h.hour} horas: hoje ${money(h.revenue)}${complete ? `, ontem ${money(h.previous)}` : ""}`}
                onFocus={() => setSelected(i)}
                onClick={() => setSelected(i)}
                onKeyDown={(event) => {
                  if (["Enter", " "].includes(event.key)) {
                    event.preventDefault();
                    setSelected(i);
                  }
                }}
                onMouseEnter={() => setSelected(i)}
              />
            </g>
          ))}
        </svg>
      )}
      <div className="today-chart-value">
        {point
          ? `${point.hour}h · ${money(point.revenue)}${complete ? ` / ontem ${money(point.previous)}` : ""}`
          : available
            ? "Valores por hora · produtos em pedidos pagos"
            : "Dados indisponíveis não são tratados como zero."}
      </div>
    </div>
  );
}
