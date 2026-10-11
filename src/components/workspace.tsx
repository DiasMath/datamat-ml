"use client";
import { ListingChecklist, MarketplacePerformance } from "./marketplace-panels";
import { operationalAttention } from "@/domain/marketplace";
import { useEffect, useMemo, useState, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { calendarDay } from "../domain/dates";
import {
  LayoutDashboard,
  Tags,
  Calculator,
  ListTodo,
  History,
  NotebookPen,
  Settings,
  ChevronsUpDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  Search,
  Upload,
  Download,
  ArrowUpRight,
  ArrowLeft,
  Check,
  Clock,
  AlertCircle,
  X,
  SlidersHorizontal,
  Menu,
  Store,
  Layers,
  FileCheck,
  Activity,
  Info,
  Link2,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Empty,
  Field,
  Submit,
  Modal,
  money,
  percent,
  date,
  labels,
  jsonRequest,
  string,
} from "./ui";
import { OfferForm, TaskForm, NoteForm, ParameterForm } from "./forms";
import FinancialEditor from "./financial-editor";
import AutocompleteInput from "./autocomplete";
import Importer from "./importer";
import Collection, { pageSize } from "./collection";

type Row = Record<string, any>;
const navigation = [
  { path: "", title: "Hoje", icon: LayoutDashboard },
  { path: "anuncios", title: "Anúncios", icon: Tags },
  { path: "precificacao", title: "Precificação", icon: Calculator },
  { path: "acoes", title: "Ações", icon: ListTodo },
  { path: "historico", title: "Histórico", icon: History },
  { path: "estudos", title: "Estudos e notas", icon: NotebookPen },
  { path: "configuracoes", title: "Configurações", icon: Settings },
];
const descriptions: Record<string, string> = {
  "": "O que precisa da sua atenção. Um passo de cada vez.",
  anuncios: "Organize suas ofertas e acompanhe o que precisa evoluir.",
  precificacao: "Conheça os custos. Compare cenários. Prepare decisões.",
  acoes: "Transforme decisões em trabalho com prazo e responsável.",
  historico: "Uma trilha clara das decisões e mudanças da operação.",
  estudos: "Guarde o aprendizado e conecte ideias ao trabalho.",
  configuracoes: "Lojas, regras financeiras e conexões.",
};
export default function Workspace({ view }: { view: string[] }) {
  const [transitioning, startTransition] = useTransition();
  const router = useRouter(),
    search = useSearchParams(),
    query = search.toString(),
    route = view.join("/"),
    section = view[0] || "",
    offerId = section === "anuncios" ? view[1] : undefined;
  const [data, setData] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    ),
    [modal, setModal] = useState<{ type: string; record?: Row } | null>(null),
    [dirty, setDirty] = useState(false),
    [menu, setMenu] = useState(false),
    [mobile, setMobile] = useState(false),
    [selection, setSelection] = useState<string[]>([]);
  const workspaceCache = useRef<{
    key: string;
    revision: number;
    data: Row;
  } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width:850px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobile || !menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>('[aria-label="Abrir navegação"]')
            ?.focus(),
        );
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobile, menu]);
  const store = search.get("store") || "all",
    tab = search.get("tab") || "overview";
  const dataQuery = new URLSearchParams(query);
  for (const key of [
    "page",
    "pageSize",
    "sort",
    "taskPage",
    "taskSize",
    "historyPage",
    "historySize",
    "notePage",
    "noteSize",
    "logPage",
    "logSize",
    "importPage",
    "importSize",
    "tab",
    "configTab",
    "returnTo",
    "taskQ",
    "taskStatus",
    "priority",
    "historyField",
    "historyStatus",
    "historyOffer",
    "from",
    "to",
  ])
    dataQuery.delete(key);
  const dataKey = dataQuery.toString();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetail(null);
    Promise.all([
      workspaceCache.current?.key === dataKey &&
      workspaceCache.current.revision === refresh
        ? Promise.resolve(workspaceCache.current.data)
        : jsonRequest("/api/workspace?" + dataKey),
      offerId ? jsonRequest("/api/offers/" + offerId) : Promise.resolve(null),
    ])
      .then(([d, o]) => {
        if (active) {
          workspaceCache.current = { key: dataKey, revision: refresh, data: d };
          setData(d);
          setDetail(o);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setToast({ text: e.message, error: true });
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [dataKey, offerId, refresh]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function guard() {
    if (busy) return false;
    return (
      !dirty ||
      window.confirm(
        "Há alterações ainda não salvas. Deseja descartá-las e continuar?",
      )
    );
  }
  function navigate(path: string, params?: URLSearchParams) {
    if (!guard()) return;
    setDirty(false);
    setMenu(false);
    startTransition(() =>
      router.push(
        "/" +
          path +
          (params?.toString()
            ? "?" + params
            : params
              ? ""
              : query
                ? "?" + query
                : ""),
      ),
    );
  }
  function changeParam(key: string, value: string) {
    const p = new URLSearchParams(query);
    value ? p.set(key, value) : p.delete(key);
    for (const k of ["page", "taskPage", "historyPage", "notePage", "logPage"])
      p.delete(k);
    navigate(route, p);
  }
  function changeStore(value: string) {
    if (!guard()) return;
    const p = new URLSearchParams(query);
    p.set("store", value);
    for (const k of [
      "brand",
      "category",
      "offer",
      "historyOffer",
      "page",
      "taskPage",
      "historyPage",
      "notePage",
      "logPage",
      "tab",
      "returnTo",
    ])
      p.delete(k);
    setSelection([]);
    setDirty(false);
    setToast({
      text: "Loja atualizada. Seleções de marca, categoria e registros foram limpas para respeitar a nova loja.",
    });
    startTransition(() =>
      router.push("/" + (offerId ? "anuncios" : section) + "?" + p),
    );
  }
  async function mutate(
    url: string,
    body: unknown,
    success: string,
    close = false,
    method = "POST",
  ) {
    if (busy) return false;
    setBusy(true);
    try {
      await jsonRequest(url, body, method);
      setToast({ text: success });
      setDirty(false);
      if (close) setModal(null);
      if (!(method === "DELETE" && offerId && url === "/api/offers/" + offerId))
        setRefresh((v) => v + 1);
      return true;
    } catch (e) {
      setToast({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }
  function open(type: string, record?: Row) {
    if (!guard()) return;
    setDirty(false);
    setToast(null);
    setModal({
      type,
      record:
        type === "delete"
          ? { ...record, requestId: crypto.randomUUID() }
          : record,
    });
  }
  function close() {
    if (guard()) {
      setDirty(false);
      setModal(null);
    }
  }
  function openOffer(key: string) {
    const p = new URLSearchParams();
    p.set("store", store);
    p.set("returnTo", "/anuncios" + (query ? "?" + query : ""));
    navigate("anuncios/" + key, p);
  }
  function back() {
    const target = search.get("returnTo");
    if (target?.startsWith("/anuncios") && !target.startsWith("//")) {
      if (guard()) {
        setDirty(false);
        router.push(target);
      }
    } else navigate("anuncios", new URLSearchParams({ store }));
  }
  const formData = data
    ? {
        ...data,
        selectedStore:
          detail?.offer.store_id || (store === "all" ? undefined : store),
        initialOffer: offerId,
      }
    : null;
  const canWrite = !!data && data.user.role !== "viewer";
  const title = offerId
    ? "Ficha do anúncio"
    : navigation.find((n) => n.path === section)?.title ||
      "Página não encontrada";
  return (
    <div className="app-shell">
      <aside
        id="main-navigation"
        inert={mobile && !menu}
        aria-hidden={mobile && !menu ? true : undefined}
        className={`sidebar ${menu ? "is-open" : ""}`}
      >
        <div className="brand">
          <img src="/datamat.svg" width={156} alt="DATAMAT" />
          <span>GESTÃO DE MARKETPLACE</span>
          {mobile && menu && (
            <button
              className="icon-button nav-close"
              aria-label="Fechar navegação"
              onClick={() => setMenu(false)}
            >
              <X size={20} />
            </button>
          )}
        </div>
        <div className="workspace-label">
          <div className="workspace-mark">D</div>
          <div>
            Operação Juntos<small>Seu espaço de trabalho</small>
          </div>
        </div>
        <div className="nav-caption">ESPAÇO DE TRABALHO</div>
        <nav aria-label="Navegação principal">
          {navigation.map((n) => (
            <button
              key={n.path}
              aria-label={n.title}
              className={`nav-item ${section === n.path ? "active" : ""}`}
              onClick={() => navigate(n.path)}
            >
              <n.icon size={18} />
              <span>{n.title}</span>
              {n.path === "acoes" &&
                data &&
                data.tasks.filter(
                  (t: Row) => !["done", "cancelled"].includes(t.status),
                ).length > 0 && (
                  <span className="nav-count">
                    {
                      data.tasks.filter(
                        (t: Row) => !["done", "cancelled"].includes(t.status),
                      ).length
                    }
                  </span>
                )}
              {n.path === "anuncios" && section === "anuncios" && (
                <span className="active-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="integration-note">
            <span className="dot orange-dot" />
            <span>
              Integrações
              <small>
                {data?.connections.some(
                  (c: Row) =>
                    c.provider === "mercadolivre" && c.status === "connected",
                )
                  ? "Mercado Livre conectado"
                  : "Configure as contas"}
              </small>
            </span>
            <button
              className="icon-button"
              aria-label="Configurar integrações"
              onClick={() => {
                const p = new URLSearchParams({
                  store,
                  configTab: "integrations",
                });
                navigate("configuracoes", p);
              }}
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="user-card">
            <div className="avatar">
              {data?.user.name?.slice(0, 2).toUpperCase() || "DM"}
            </div>
            <span>
              {data?.user.name || "DATAMAT"}
              <small>{labels[data?.user.role] || "Carregando…"}</small>
            </span>
          </div>
        </div>
      </aside>
      {mobile && menu && (
        <div
          className="nav-backdrop"
          aria-hidden="true"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell" inert={mobile && menu}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir navegação"
              aria-expanded={menu}
              aria-controls="main-navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <span>Gestão de anúncios</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <label className="global-store">
            <Store size={16} />
            <span className="sr-only">Loja global</span>
            <select
              aria-label="Loja global"
              disabled={transitioning || loading}
              value={store}
              onChange={(e) => changeStore(e.target.value)}
            >
              <option value="all">Todas as lojas autorizadas</option>
              {data?.stores.map((s: Row) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </header>
        <main className="content">
          {toast && !(modal && toast.error) && (
            <div
              className={`toast ${toast.error ? "error" : ""}`}
              role={toast.error ? "alert" : "status"}
            >
              {toast.error ? <AlertCircle size={17} /> : <Check size={17} />}
              <span>{toast.text}</span>
              <button
                className="icon-button"
                aria-label="Fechar aviso"
                onClick={() => setToast(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!offerId && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {section === ""
                    ? new Intl.DateTimeFormat("pt-BR", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        timeZone: "America/Sao_Paulo",
                      })
                        .format(new Date())
                        .toUpperCase()
                    : "OPERAÇÃO · " +
                      (store === "all"
                        ? "TODAS AS LOJAS"
                        : data?.stores.find((s: Row) => s.id === store)?.name ||
                          "")}
                </div>
                <h1>{title}</h1>
                <p>{descriptions[section]}</p>
              </div>
              <div className="heading-actions">
                {section === "" && canWrite && (
                  <button
                    className="button primary"
                    onClick={() => open("task")}
                  >
                    <Plus size={16} />
                    Nova ação
                  </button>
                )}
                {section === "anuncios" && (
                  <>
                    <a
                      className="button"
                      href={"/api/export?format=xlsx&" + query}
                    >
                      <Download size={15} />
                      Exportar Excel
                    </a>
                    {canWrite && (
                      <>
                        <button
                          className="button"
                          onClick={() => open("import")}
                        >
                          <Upload size={15} />
                          Importar
                        </button>
                        <button
                          className="button primary"
                          onClick={() => open("offer")}
                        >
                          <Plus size={16} />
                          Novo anúncio
                        </button>
                      </>
                    )}
                  </>
                )}
                {section === "acoes" && canWrite && (
                  <button
                    className="button primary"
                    onClick={() => open("task")}
                  >
                    <Plus size={16} />
                    Nova ação
                  </button>
                )}
                {section === "estudos" && canWrite && (
                  <button
                    className="button primary"
                    onClick={() => open("note")}
                  >
                    <Plus size={16} />
                    Nova nota
                  </button>
                )}
              </div>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <span className="loading-dot" />
              Carregando dados da operação…
            </div>
          ) : !data ? (
            <Empty
              title="Não foi possível carregar"
              body="Verifique sua conexão e tente novamente."
              action={
                <button
                  className="button"
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  Tentar novamente
                </button>
              }
            />
          ) : (
            <>
              {section === "" && (
                <Today
                  data={data}
                  onOpen={openOffer}
                  onTask={(t: Row) => open("task", t)}
                  navigate={navigate}
                  canWrite={canWrite}
                  onNew={() => open("offer")}
                />
              )}
              {section === "anuncios" && !offerId && (
                <Offers
                  data={data}
                  query={query}
                  selected={selection}
                  setSelected={setSelection}
                  onOpen={openOffer}
                  canWrite={canWrite}
                  navigate={navigate}
                  onNew={() => open("offer")}
                  onBatch={() => open("batch")}
                />
              )}
              {offerId && detail && (
                <>
                  <div className="detail-heading">
                    <button className="back-button" onClick={back}>
                      <ArrowLeft size={16} />
                      Voltar aos anúncios
                    </button>
                    <div className="detail-identity">
                      <div>
                        <div className="eyebrow">
                          {detail.offer.store_name}{" "}
                          <span className="separator">/</span>{" "}
                          {detail.offer.ml_id || "CÓDIGO ML PENDENTE"}
                        </div>
                        <h1>{detail.offer.title}</h1>
                        <p>
                          {detail.offer.product_name} · SKU{" "}
                          {detail.offer.sku || "pendente"} ·{" "}
                          {labels[detail.offer.type]}
                        </p>
                      </div>
                      <div className="heading-actions">
                        <Badge value={detail.offer.status} />
                        {canWrite && (
                          <button
                            className="button"
                            onClick={() =>
                              open("offer", {
                                ...detail.offer,
                                components: detail.components,
                              })
                            }
                          >
                            Editar cadastro
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="tabs detail-tabs">
                    {[
                      ["overview", "Visão geral"],
                      ["content", "Conteúdo"],
                      ["costs", "Custos e preço"],
                      ["performance", "Desempenho"],
                      ["tasks", "Tarefas e notas"],
                      ["history", "Histórico"],
                    ].map(([v, l]) => (
                      <button
                        key={v}
                        className={tab === v ? "active" : ""}
                        onClick={() => changeParam("tab", v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  {tab === "overview" && (
                    <>
                      <Overview
                        detail={detail}
                        onTab={(v: string) => changeParam("tab", v)}
                        onProposal={(p: Row) => open("decision", p)}
                        canWrite={canWrite}
                      />
                      <ListingChecklist
                        detail={detail}
                        busy={busy}
                        canWrite={canWrite}
                        onTask={(issueKey) =>
                          mutate(
                            `/api/offers/${offerId}/quality-task`,
                            { issueKey },
                            "Pendência adicionada às tarefas.",
                          )
                        }
                      />
                    </>
                  )}
                  {tab === "content" && (
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Conteúdo atual</h2>
                        <span className="muted small">
                          Origem:{" "}
                          {labels[detail.offer.origin] || detail.offer.origin}
                        </span>
                      </div>
                      <h3>{detail.offer.title}</h3>
                      <p className="pre-wrap muted">
                        {detail.offer.description ||
                          "Descrição pendente. Não presumir características técnicas desconhecidas."}
                      </p>
                      {canWrite && (
                        <button
                          className="button primary"
                          onClick={() => changeParam("tab", "costs")}
                        >
                          Preparar proposta de conteúdo <ArrowRightIcon />
                        </button>
                      )}
                      <p className="small muted">
                        Uma sugestão de título ou descrição fica separada do
                        conteúdo atual até a confirmação manual de aplicação.
                      </p>
                    </section>
                  )}
                  {tab === "costs" &&
                    (canWrite ? (
                      <FinancialEditor
                        key={
                          detail.offer.id +
                          ":" +
                          detail.offer.version +
                          ":" +
                          detail.parametersRevision
                        }
                        detail={detail}
                        busy={busy}
                        onDirty={() => setDirty(true)}
                        onSaveCosts={(p) =>
                          mutate(
                            "/api/offers/" + offerId + "/costs",
                            { ...p, offerVersion: detail.offer.version },
                            "Custos salvos; histórico preservado.",
                          )
                        }
                        onProposal={(p) =>
                          mutate(
                            "/api/proposals",
                            p,
                            "Proposta salva para revisão. O preço atual permanece intacto.",
                          )
                        }
                      />
                    ) : (
                      <section className="panel">
                        <CostSummary result={detail.calculation} />
                      </section>
                    ))}
                  {tab === "performance" && (
                    <MarketplacePerformance
                      detail={detail}
                      data={data}
                      busy={busy}
                      onRefresh={() =>
                        mutate(
                          `/api/offers/${offerId}/ml-metrics`,
                          {},
                          "Métricas consultadas no Mercado Livre.",
                        )
                      }
                    />
                  )}
                  {tab === "tasks" && (
                    <div className="two-columns">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Tarefas do anúncio</h2>
                          {canWrite && (
                            <button
                              className="button compact"
                              onClick={() => open("task")}
                            >
                              <Plus size={14} />
                              Nova ação
                            </button>
                          )}
                        </div>
                        <TaskList
                          tasks={detail.tasks}
                          data={data}
                          onTask={(t) => open("task", t)}
                          canWrite={canWrite}
                          onOpen={openOffer}
                        />
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Notas relacionadas</h2>
                          {canWrite && (
                            <button
                              className="button compact"
                              onClick={() => open("note")}
                            >
                              <Plus size={14} />
                              Nova nota
                            </button>
                          )}
                        </div>
                        <Notes
                          data={{ ...data, notes: detail.notes }}
                          canWrite={canWrite}
                          onEdit={(n) => open("note", n)}
                          onConvert={(n) => {
                            const t = data.tasks.find(
                              (t: Row) => t.source_note_id === n.id,
                            );
                            open(t ? "task" : "convert", t || n);
                          }}
                        />
                      </section>
                    </div>
                  )}
                  {tab === "history" && (
                    <HistoryTable
                      rows={detail.history}
                      data={data}
                      onOpen={openOffer}
                    />
                  )}
                </>
              )}
              {section === "precificacao" && (
                <PricingPage
                  data={data}
                  selected={search.get("offer")}
                  choose={(v) => changeParam("offer", v)}
                  onDirty={() => setDirty(true)}
                  busy={busy}
                  onError={(text) => setToast({ text, error: true })}
                  onProposal={async (p) => {
                    return mutate(
                      "/api/proposals",
                      p,
                      "Proposta salva para revisão. Consulte a ficha para aprovar e confirmar a aplicação.",
                    );
                  }}
                  onSaveCosts={(id, p) =>
                    mutate(
                      "/api/offers/" + id + "/costs",
                      p,
                      "Custos salvos; histórico preservado.",
                    )
                  }
                  canWrite={canWrite}
                />
              )}
              {section === "acoes" && (
                <TasksScreen
                  data={data}
                  search={search}
                  change={changeParam}
                  onTask={(t) => open("task", t)}
                  canWrite={canWrite}
                  onOpen={openOffer}
                />
              )}
              {section === "historico" && (
                <HistoryScreen
                  data={data}
                  search={search}
                  change={changeParam}
                  onOpen={openOffer}
                />
              )}
              {section === "estudos" && (
                <Notes
                  data={data}
                  canWrite={canWrite}
                  onEdit={(n) => open("note", n)}
                  onConvert={(n) => {
                    const t = data.tasks.find(
                      (t: Row) => t.source_note_id === n.id,
                    );
                    open(t ? "task" : "convert", t || n);
                  }}
                />
              )}
              {section === "configuracoes" && (
                <Configuration
                  data={data}
                  selected={
                    ["stores", "integrations", "sync"].includes(
                      search.get("configTab") || "",
                    )
                      ? search.get("configTab")!
                      : "stores"
                  }
                  onTab={(v) => changeParam("configTab", v)}
                  onStore={(s?: Row) => open("store", s)}
                  onParameters={(p) => open("parameters", p)}
                  onSync={(c) =>
                    mutate(
                      "/api/connections/" + c.id,
                      {
                        requestId: crypto.randomUUID(),
                        restart: Boolean(c.restart),
                      },
                      c.provider === "mercadolivre"
                        ? "Lote consultado. Confira os registros e continue se houver mais anúncios."
                        : "Verificação concluída.",
                    )
                  }
                  onAuthorize={async (c) => {
                    if (busy) return;
                    setBusy(true);
                    try {
                      const result = await jsonRequest(
                        `/api/connections/${c.id}/authorize`,
                        {},
                      );
                      window.location.assign(result.url);
                    } catch (e) {
                      setToast({ text: (e as Error).message, error: true });
                      setBusy(false);
                    }
                  }}
                  onDisconnect={(c) =>
                    mutate(
                      `/api/connections/${c.id}/disconnect`,
                      {},
                      "Conta desconectada; cadastros e histórico preservados.",
                    )
                  }
                  authorizationResult={search.get("mlAuthorization")}
                  authorizationMessage={search.get("mlMessage")}
                  busy={busy}
                  query={query}
                />
              )}
              {!navigation.some((n) => n.path === section) && (
                <Empty
                  title="Página não encontrada"
                  body="Use a navegação lateral para continuar."
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>DATAMAT · Gestão de marketplace</span>
            <span>Decisões e histórico preservados</span>
          </footer>
        </main>
      </div>
      {modal && data && (
        <Modal
          title={modalTitle(modal)}
          subtitle={
            modal.record?.store_id
              ? data.stores.find((s: Row) => s.id === modal.record?.store_id)
                  ?.name
              : store === "all"
                ? "Selecione a loja correspondente"
                : data.stores.find((s: Row) => s.id === store)?.name
          }
          onClose={close}
        >
          {toast?.error && (
            <div className="alert error" role="alert">
              {toast.text}
            </div>
          )}
          {modal.type === "delete" && (
            <div className="stack">
              <p>
                Excluir <strong>{modal.record!.title}</strong>?
              </p>
              <p className="muted small">
                O registro será removido do DATAMAT. O histórico será
                preservado. Nenhuma alteração será enviada ao Mercado Livre ou
                Bling.
              </p>
              <div className="form-footer">
                <button className="button" disabled={busy} onClick={close}>
                  Cancelar
                </button>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={async () => {
                    const record = modal.record!;
                    const ok = await mutate(
                      "/api/" + record.collection + "/" + record.id,
                      {
                        requestId: record.requestId,
                        version: record.version || 1,
                      },
                      "Registro excluído.",
                      true,
                      "DELETE",
                    );
                    if (
                      ok &&
                      record.collection === "offers" &&
                      offerId === record.id
                    ) {
                      setDetail(null);
                      router.push("/anuncios?store=" + store);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  {busy ? "Excluindo…" : "Confirmar exclusão"}
                </button>
              </div>
            </div>
          )}
          {modal.type === "offer" && (
            <OfferForm
              data={formData!}
              initial={modal.record}
              busy={busy}
              onDirty={() => setDirty(true)}
              onSave={(p) =>
                mutate(
                  "/api/offers" + (modal.record ? "/" + modal.record.id : ""),
                  p,
                  "Cadastro de anúncio salvo.",
                  true,
                )
              }
            />
          )}
          {modal.type === "task" && (
            <TaskForm
              data={formData!}
              initial={modal.record}
              busy={busy}
              onDirty={() => setDirty(true)}
              onSave={(p) =>
                mutate(
                  "/api/tasks" + (modal.record ? "/" + modal.record.id : ""),
                  p,
                  "Tarefa salva.",
                  true,
                )
              }
            />
          )}
          {modal.type === "note" && (
            <NoteForm
              data={formData!}
              initial={modal.record}
              busy={busy}
              onDirty={() => setDirty(true)}
              onSave={(p) =>
                mutate(
                  "/api/notes" + (modal.record ? "/" + modal.record.id : ""),
                  p,
                  "Nota salva.",
                  true,
                )
              }
            />
          )}
          {modal.record && ["offer", "task", "note"].includes(modal.type) && (
            <div className="record-danger">
              <button
                className="text-link danger-text"
                disabled={busy}
                onClick={() =>
                  open("delete", {
                    ...modal.record,
                    collection:
                      modal.type === "offer"
                        ? "offers"
                        : modal.type === "task"
                          ? "tasks"
                          : "notes",
                  })
                }
              >
                <Trash2 size={14} />
                {modal.type === "offer"
                  ? "Excluir rascunho"
                  : modal.type === "task"
                    ? "Excluir tarefa"
                    : "Excluir nota"}
              </button>
              {modal.type === "offer" && (
                <small>
                  Com propostas ou vínculos, use a situação Encerrado.
                </small>
              )}
            </div>
          )}
          {modal.type === "parameters" && (
            <ParameterForm
              initial={modal.record!}
              busy={busy}
              onDirty={() => setDirty(true)}
              onSave={(p) =>
                mutate(
                  "/api/parameters/" + modal.record!.storeId,
                  p,
                  "Parâmetros salvos. Histórico mantido.",
                  true,
                )
              }
            />
          )}
          {modal.type === "import" && (
            <Importer
              stores={data.stores}
              selected={store}
              busy={busy}
              onDirty={() => setDirty(true)}
              onWorking={setBusy}
              onDone={(count) => {
                setDirty(false);
                setModal(null);
                setRefresh((v) => v + 1);
                setToast({
                  text: `${count} anúncios importados com histórico preservado.`,
                });
              }}
            />
          )}
          {modal.type === "decision" && (
            <Decision
              proposal={modal.record!}
              data={data}
              busy={busy}
              onDirty={() => setDirty(true)}
              onSave={(p) =>
                mutate(
                  "/api/proposals/" + modal.record!.id,
                  p,
                  "Etapa da proposta registrada.",
                  true,
                )
              }
            />
          )}
          {modal.type === "batch" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                mutate(
                  "/api/offers/batch",
                  { ids: selection, status: string(f, "status") },
                  "Situação atualizada para os anúncios selecionados.",
                  true,
                ).then((ok) => {
                  if (ok) setSelection([]);
                });
              }}
            >
              <div className="alert">
                A operação altera a situação do cadastro local. Nenhuma mudança
                será enviada ao Mercado Livre.
              </div>
              <h3>{selection.length} anúncios selecionados</h3>
              <ul className="selected-list">
                {data.offerChoices
                  .filter((o: Row) => selection.includes(o.id))
                  .map((o: Row) => (
                    <li key={o.id}>
                      {o.store_name} · {o.title} · {o.sku || "Sem SKU"}
                    </li>
                  ))}
              </ul>
              <Field label="Nova situação">
                <select name="status">
                  {["paused", "active", "draft", "closed"].map((v) => (
                    <option key={v} value={v}>
                      {labels[v]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-footer">
                <span>Confira o conjunto acima antes de confirmar.</span>
                <Submit busy={busy} label="Confirmar alteração em lote" />
              </div>
            </form>
          )}
          {modal.type === "convert" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  "/api/notes/" + modal.record!.id + "/task",
                  { storeId: string(new FormData(e.currentTarget), "storeId") },
                  "Tarefa criada com vínculo à nota original.",
                  true,
                );
              }}
            >
              <p>
                Transformar <strong>{modal.record!.title}</strong> em tarefa. A
                nota original será preservada.
              </p>
              <Field label="Loja da tarefa">
                <select
                  name="storeId"
                  defaultValue={modal.record!.store_id || data.stores[0]?.id}
                >
                  {data.stores
                    .filter(
                      (s: Row) =>
                        !modal.record!.store_id ||
                        s.id === modal.record!.store_id,
                    )
                    .map((s: Row) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </Field>
              <div className="form-footer">
                <span>Repetir esta operação abre a mesma tarefa.</span>
                <Submit busy={busy} label="Criar tarefa" />
              </div>
            </form>
          )}
          {modal.type === "store" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  "/api/stores" + (modal.record ? "/" + modal.record.id : ""),
                  { name: string(new FormData(e.currentTarget), "name") },
                  "Loja salva.",
                  true,
                );
              }}
              onChange={() => setDirty(true)}
            >
              <Field label="Nome da loja">
                <input name="name" required defaultValue={modal.record?.name} />
              </Field>
              <div className="form-footer">
                <span>Vinculada à organização atual.</span>
                <Submit busy={busy} />
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function ArrowRightIcon() {
  return <ChevronRight size={15} />;
}
function modalTitle(modal: { type: string; record?: Row }) {
  return (
    {
      offer: modal.record ? "Editar anúncio" : "Novo anúncio",
      task: modal.record ? "Editar ação" : "Nova ação",
      note: modal.record ? "Editar nota" : "Nova nota",
      parameters: "Parâmetros financeiros",
      import: "Importar anúncios",
      decision: "Revisão e aplicação da proposta",
      batch: "Alterar situação em lote",
      convert: "Transformar nota em tarefa",
      store: modal.record ? "Editar loja" : "Adicionar loja",
      delete: "Confirmar exclusão",
      access: "Permissões de acesso",
    }[modal.type] || ""
  );
}
function Today({
  data,
  onOpen,
  onTask,
  navigate,
  canWrite,
  onNew,
}: {
  data: Row;
  onOpen: (id: string) => void;
  onTask: (t: Row) => void;
  navigate: (path: string, params?: URLSearchParams) => void;
  canWrite: boolean;
  onNew: () => void;
}) {
  const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    }),
    tasks = data.tasks
      .filter((t: Row) => !["done", "cancelled"].includes(t.status))
      .sort(
        (a: Row, b: Row) =>
          Number(b.due_date && b.due_date < today) -
            Number(a.due_date && a.due_date < today) ||
          ["high", "medium", "low"].indexOf(a.priority) -
            ["high", "medium", "low"].indexOf(b.priority),
      );
  const overdue = tasks.filter(
    (t: Row) => t.due_date && t.due_date < today,
  ).length;
  return (
    <>
      <div className="stats-grid">
        {[
          {
            label: "Ações em aberto",
            value: tasks.length,
            note: overdue
              ? `${overdue} com prazo vencido`
              : "Priorize seu próximo passo",
            icon: ListTodo,
            path: "acoes",
          },
          {
            label: "Propostas em revisão",
            value: data.summary.reviewProposals,
            note: "Aguardando uma decisão",
            icon: FileCheck,
            path: "anuncios",
          },
          {
            label: "Anúncios com pendências",
            value: data.summary.pendingOffers,
            note: `${data.summary.totalOffers} ofertas cadastradas`,
            icon: Tags,
            path: "anuncios",
            params: { pending: "yes" },
          },
          {
            label: "Custos a revisar",
            value: data.summary.staleCosts,
            note: "Incompletos ou desatualizados",
            icon: Calculator,
            path: "anuncios",
            params: { pending: "costs" },
          },
        ].map((s) => (
          <button
            key={s.label}
            className="stat-card"
            onClick={() =>
              navigate(
                s.path,
                new URLSearchParams({
                  store:
                    data.parameters.length === 1
                      ? data.parameters[0].storeId
                      : "all",
                  ...s.params,
                }),
              )
            }
          >
            <div className="stat-top">
              <span>{s.label}</span>
              <s.icon size={19} />
            </div>
            <strong>{s.value.toString().padStart(2, "0")}</strong>
            <div className="stat-bottom">
              <span>{s.note}</span>
              <ArrowUpRight size={14} />
            </div>
          </button>
        ))}
      </div>
      {!data.summary.totalOffers && (
        <section className="onboarding-card">
          <div className="onboarding-symbol">
            <Layers size={28} />
          </div>
          <div>
            <span className="eyebrow orange">
              SEU ESPAÇO ESTÁ PRONTO PARA COMEÇAR
            </span>
            <h2>Vamos organizar o primeiro anúncio?</h2>
            <p>
              Cadastre um produto, vincule a oferta à loja e registre os custos.
              As pendências ajudam a completar o que ainda falta.
            </p>
          </div>
          {canWrite && (
            <button className="button primary" onClick={onNew}>
              Cadastrar anúncio <Plus size={16} />
            </button>
          )}
        </section>
      )}
      <div className="today-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <ListTodo size={18} />
              Prioridades de hoje
            </h2>
            <button className="text-link" onClick={() => navigate("acoes")}>
              Ver todas <ArrowUpRight size={14} />
            </button>
          </div>
          <TaskList
            tasks={tasks.slice(0, 6)}
            data={data}
            onTask={onTask}
            canWrite={canWrite}
            onOpen={onOpen}
          />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <FileCheck size={18} />
              Decisões pendentes
            </h2>
            <span className="count-pill">
              {
                data.proposals.filter((p: Row) =>
                  [
                    "review",
                    "approved",
                    "pending_application",
                    "failed",
                  ].includes(p.status),
                ).length
              }
            </span>
          </div>
          {data.proposals.filter((p: Row) =>
            ["review", "approved", "pending_application", "failed"].includes(
              p.status,
            ),
          ).length ? (
            data.proposals
              .filter((p: Row) =>
                [
                  "review",
                  "approved",
                  "pending_application",
                  "failed",
                ].includes(p.status),
              )
              .slice(0, 5)
              .map((p: Row) => (
                <button
                  className="list-item"
                  key={p.id}
                  onClick={() => onOpen(p.offer_id)}
                >
                  <div>
                    <strong>
                      {data.offerChoices.find((o: Row) => o.id === p.offer_id)
                        ?.title || "Anúncio"}
                    </strong>
                    <small>
                      {money(p.snapshot.current.price)} →{" "}
                      {money(p.snapshot.proposed.price)} · {p.reason}
                    </small>
                  </div>
                  <Badge value={p.status} />
                </button>
              ))
          ) : (
            <Empty
              title="Nenhuma decisão esperando"
              body="As propostas salvas para revisão aparecerão aqui."
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <AlertCircle size={18} />
              Anúncios que merecem atenção
            </h2>
            <button className="text-link" onClick={() => navigate("anuncios")}>
              Abrir anúncios <ArrowUpRight size={14} />
            </button>
          </div>
          {data.offerChoices.some(
            (o: Row) => operationalAttention(o).priority,
          ) ? (
            data.offerChoices
              .filter((o: Row) => operationalAttention(o).priority)
              .toSorted(
                (a: Row, b: Row) =>
                  operationalAttention(b).priority -
                  operationalAttention(a).priority,
              )
              .slice(0, 4)
              .map((o: Row) => (
                <button
                  key={o.id}
                  className="list-item"
                  onClick={() => onOpen(o.id)}
                >
                  <div>
                    <strong>{o.title}</strong>
                    <small>
                      {o.store_name} ·{" "}
                      {operationalAttention(o).reasons.slice(0, 3).join(" · ")}
                    </small>
                  </div>
                  <ChevronRight size={17} />
                </button>
              ))
          ) : (
            <Empty
              title="Tudo que sabemos, organizado"
              body="Campos sem informação serão sinalizados nesta área."
            />
          )}
        </section>
        <div className="integration-summary">
          <Info size={15} />
          <span>
            {data.connections.some(
              (c: Row) =>
                c.provider === "mercadolivre" && c.status === "connected",
            )
              ? "Mercado Livre autorizado. Consulte os anúncios por loja e as métricas na ficha."
              : "Conecte as contas do Mercado Livre para consultar anúncios, tarifas e métricas."}
          </span>
          <button
            className="text-link"
            onClick={() =>
              navigate(
                "configuracoes",
                new URLSearchParams({
                  store:
                    data.parameters.length === 1
                      ? data.parameters[0].storeId
                      : "all",
                  configTab: "integrations",
                }),
              )
            }
          >
            Ver integrações
          </button>
        </div>
      </div>
    </>
  );
}
function Offers({
  data,
  query,
  selected,
  setSelected,
  onOpen,
  canWrite,
  navigate,
  onNew,
  onBatch,
}: {
  data: Row;
  query: string;
  selected: string[];
  setSelected: (s: string[]) => void;
  onOpen: (id: string) => void;
  canWrite: boolean;
  navigate: (p: string, q: URLSearchParams) => void;
  onNew: () => void;
  onBatch: () => void;
}) {
  const q = new URLSearchParams(query),
    [input, setInput] = useState(q.get("q") || "");
  const scrollArea = useRef<HTMLDivElement>(null);
  const selectionQuery = new URLSearchParams(query);
  for (const key of ["page", "pageSize", "sort"]) selectionQuery.delete(key);
  const selectionKey = selectionQuery.toString();
  useEffect(() => {
    setInput(new URLSearchParams(query).get("q") || "");
  }, [query]);
  useEffect(() => {
    setSelected([]);
  }, [selectionKey]);
  const sort = q.get("sort") || "updated",
    page = Math.max(
      1,
      Number.isFinite(Number(q.get("page")))
        ? Math.floor(Number(q.get("page"))) || 1
        : 1,
    ),
    size = pageSize(q.get("pageSize"));
  const sorted = [...data.offers].sort((a: Row, b: Row) =>
    sort === "price"
      ? Number(b.price || 0) - Number(a.price || 0)
      : sort === "name"
        ? a.title.localeCompare(b.title, "pt-BR")
        : b.updated_at.localeCompare(a.updated_at),
  );
  const pages = Math.max(1, Math.ceil(sorted.length / size)),
    current = Math.min(page, pages),
    rows = sorted.slice((current - 1) * size, current * size);
  useEffect(() => {
    scrollArea.current?.scrollTo({ top: 0 });
  }, [current, size, sort, selectionKey]);
  function update(key: string, values: string[]) {
    const p = new URLSearchParams(query);
    p.delete(key);
    for (const v of values) p.append(key, v);
    p.delete("page");
    navigate("anuncios", p);
  }
  const chips = [...q.entries()].filter(([k]) =>
    ["q", "brand", "category", "status", "type", "pending"].includes(k),
  );
  return (
    <section className="panel offers-panel">
      <div className="filter-toolbar">
        <form
          className="search-input"
          onSubmit={(e) => {
            e.preventDefault();
            update("q", input ? [input] : []);
          }}
        >
          <Search size={17} />
          <AutocompleteInput
            suggestions={data.offerChoices.flatMap((o: Row) => [
              o.title,
              o.product_name,
              o.sku,
              o.model,
              o.ml_id,
            ])}
            aria-label="Buscar anúncios"
            placeholder="Buscar por produto, SKU, modelo ou código ML…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {input && (
            <button
              className="icon-button"
              aria-label="Limpar pesquisa"
              type="button"
              onClick={() => {
                setInput("");
                update("q", []);
              }}
            >
              <X size={14} />
            </button>
          )}
          <button type="submit" className="search-go">
            Buscar
          </button>
        </form>
        <MultiFilter
          label="Categoria"
          values={[
            ...new Set<string>(
              data.offerChoices.map((o: Row) => o.category || "__missing"),
            ),
          ].sort()}
          selected={q.getAll("category")}
          onChange={(v) => update("category", v)}
        />
        <MultiFilter
          label="Marca"
          values={[
            ...new Set<string>(
              data.offerChoices.map((o: Row) => o.brand || "__missing"),
            ),
          ].sort()}
          selected={q.getAll("brand")}
          onChange={(v) => update("brand", v)}
        />
        <MultiFilter
          label="Situação"
          values={["draft", "active", "paused", "closed"]}
          selected={q.getAll("status")}
          onChange={(v) => update("status", v)}
        />
        <MultiFilter
          label="Tipo"
          values={["unit", "kit", "variation"]}
          selected={q.getAll("type")}
          onChange={(v) => update("type", v)}
        />
        <label className="filter-select">
          <SlidersHorizontal size={14} />
          <select
            aria-label="Filtrar pendências"
            value={q.get("pending") || ""}
            onChange={(e) =>
              update("pending", e.target.value ? [e.target.value] : [])
            }
          >
            <option value="">Pendências</option>
            <option value="yes">Qualquer pendência</option>
            <option value="costs">Custos a revisar</option>
          </select>
        </label>
      </div>
      {chips.length > 0 && (
        <div className="filter-chips">
          {chips.map(([k, v], i) => (
            <button
              className="filter-chip"
              key={k + v + i}
              onClick={() =>
                update(
                  k,
                  q.getAll(k).filter((x) => x !== v),
                )
              }
            >
              {
                (
                  {
                    q: "Busca",
                    brand: "Marca",
                    category: "Categoria",
                    status: "Situação",
                    type: "Tipo",
                    pending: "Pendência",
                  } as Row
                )[k]
              }
              :{" "}
              {labels[v] ||
                (
                  {
                    __missing: "Não informado",
                    yes: "Qualquer",
                    costs: "Custos",
                  } as Row
                )[v] ||
                v}
              <X size={12} />
            </button>
          ))}
          <button
            className="text-link small"
            onClick={() =>
              navigate(
                "anuncios",
                new URLSearchParams({ store: q.get("store") || "all" }),
              )
            }
          >
            Limpar filtros
          </button>
        </div>
      )}
      <div className="table-heading">
        <span>
          <strong>{data.offers.length}</strong>{" "}
          {data.offers.length === 1 ? "anúncio" : "anúncios"}{" "}
          {chips.length
            ? data.offers.length === 1
              ? "encontrado"
              : "encontrados"
            : data.offers.length === 1
              ? "cadastrado"
              : "cadastrados"}
          {selected.length > 0 && (
            <span className="orange"> · {selected.length} selecionados</span>
          )}
        </span>
        <div>
          {selected.length > 0 && canWrite && (
            <button className="button compact" onClick={onBatch}>
              Alterar situação em lote
            </button>
          )}
          <label className="sort-label">
            Ordenar por{" "}
            <select
              aria-label="Ordenação"
              value={sort}
              onChange={(e) => update("sort", [e.target.value])}
            >
              <option value="updated">Última atualização</option>
              <option value="name">Produto A–Z</option>
              <option value="price">Maior preço</option>
            </select>
          </label>
        </div>
      </div>
      {rows.length ? (
        <div
          className="table-wrap"
          ref={scrollArea}
          role="region"
          aria-label="Lista de anúncios"
          tabIndex={0}
        >
          <table className="offers-table">
            <thead>
              <tr>
                {canWrite && (
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      aria-label="Selecionar anúncios desta página"
                      checked={
                        rows.length > 0 &&
                        rows.every((o: Row) => selected.includes(o.id))
                      }
                      disabled={
                        !rows.every((o: Row) => selected.includes(o.id)) &&
                        selected.length +
                          rows.filter((o: Row) => !selected.includes(o.id))
                            .length >
                          100
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [
                                ...new Set([
                                  ...selected,
                                  ...rows.map((o: Row) => o.id),
                                ]),
                              ]
                            : selected.filter(
                                (id) => !rows.some((o: Row) => o.id === id),
                              ),
                        )
                      }
                    />
                  </th>
                )}
                <th>Anúncio / produto</th>
                <th>Loja</th>
                <th>Marca / categoria</th>
                <th>SKU / código ML</th>
                <th>Situação</th>
                <th className="numeric">Preço atual</th>
                <th>Pendências</th>
                <th>Atualizado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o: Row) => (
                <tr
                  key={o.id}
                  className={selected.includes(o.id) ? "row-selected" : ""}
                >
                  {canWrite && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"Selecionar " + o.title}
                        checked={selected.includes(o.id)}
                        disabled={
                          !selected.includes(o.id) && selected.length >= 100
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, o.id]
                              : selected.filter((id) => id !== o.id),
                          )
                        }
                      />
                    </td>
                  )}
                  <td>
                    <button
                      className="offer-title"
                      onClick={() => onOpen(o.id)}
                    >
                      {o.title}
                    </button>
                    <small>
                      {o.product_name}{" "}
                      <span className="type-label">{labels[o.type]}</span>
                      {o.origin === "reference" && (
                        <span className="orange">
                          {" "}
                          · Referência: {o.reference_account}
                        </span>
                      )}
                    </small>
                  </td>
                  <td>
                    <span className="store-pill">{o.store_name}</span>
                  </td>
                  <td>
                    {o.brand || <span className="muted">Sem marca</span>}
                    <small>{o.category || "Sem categoria"}</small>
                  </td>
                  <td className="mono">
                    {o.sku || "—"}
                    <small>{o.ml_id || "Sem código ML"}</small>
                  </td>
                  <td>
                    <Badge value={o.status} />
                  </td>
                  <td className="numeric mono">{money(o.price)}</td>
                  <td>
                    {o.pending.length ? (
                      <button
                        className="pending-count"
                        title={o.pending.join(", ")}
                        onClick={() => onOpen(o.id)}
                      >
                        <AlertCircle size={12} />
                        {o.pending.length} pendentes
                      </button>
                    ) : (
                      <span className="green small">
                        <Check size={13} />
                        Completo
                      </span>
                    )}
                  </td>
                  <td className="small muted">{date(o.updated_at)}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={"Abrir " + o.title}
                      onClick={() => onOpen(o.id)}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={
            chips.length
              ? "Nenhum anúncio corresponde aos filtros"
              : "Seus anúncios, organizados aqui"
          }
          body={
            chips.length
              ? "Experimente remover um filtro ou buscar por outro produto."
              : "Cadastre sua primeira oferta ou importe uma planilha Excel ou CSV. Cada anúncio ficará vinculado à sua loja."
          }
          action={
            !chips.length && canWrite ? (
              <button className="button primary" onClick={onNew}>
                <Plus size={15} />
                Cadastrar primeiro anúncio
              </button>
            ) : undefined
          }
        />
      )}
      <div className="pagination">
        <span>
          {rows.length
            ? `${(current - 1) * size + 1}–${Math.min(current * size, sorted.length)} de ${sorted.length}`
            : "0 resultados"}
        </span>
        <label className="page-size">
          Por página{" "}
          <select
            aria-label="Anúncios por página"
            value={size}
            onChange={(e) => update("pageSize", [e.target.value])}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button
            aria-label="Página anterior"
            className="icon-button"
            disabled={current <= 1}
            onClick={() => {
              const p = new URLSearchParams(query);
              p.set("page", String(current - 1));
              navigate("anuncios", p);
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current} / {pages}
          </span>
          <button
            aria-label="Próxima página"
            className="icon-button"
            disabled={current >= pages}
            onClick={() => {
              const p = new URLSearchParams(query);
              p.set("page", String(current + 1));
              navigate("anuncios", p);
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
function MultiFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <details className="multi-filter">
      <summary>
        {label}
        {selected.length > 0 && <span>{selected.length}</span>}
        <ChevronsUpDown size={12} />
      </summary>
      <div>
        {values.length ? (
          values.map((v) => (
            <label key={v}>
              <input
                type="checkbox"
                checked={selected.includes(v)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, v]
                      : selected.filter((x) => x !== v),
                  )
                }
              />
              {v === "__missing" ? "Não informado" : labels[v] || v}
            </label>
          ))
        ) : (
          <p className="muted small">Nenhuma opção nesta loja.</p>
        )}
      </div>
    </details>
  );
}
function Overview({
  detail,
  onTab,
  onProposal,
  canWrite,
}: {
  detail: Row;
  onTab: (v: string) => void;
  onProposal: (p: Row) => void;
  canWrite: boolean;
}) {
  const o = detail.offer,
    r = detail.calculation;
  return (
    <>
      <div className="detail-stats">
        <div className="panel metric">
          <span>Preço atual</span>
          <strong>{money(o.price)}</strong>
          <small>Condição atual do anúncio</small>
        </div>
        <div className="panel metric">
          <span>Margem de contribuição</span>
          <strong>
            {money(r.margin)} <small>{percent(r.marginPercent)}</small>
          </strong>
          <small>
            {r.pending.length
              ? "Custos ou parâmetros pendentes"
              : "Para despesas fixas e resultado"}
          </small>
        </div>
        <div className="panel metric">
          <span>Preço mínimo estimado</span>
          <strong>{money(r.minPrice)}</strong>
          <small>Custos constantes · sem subsídio ML</small>
        </div>
      </div>
      <div className="two-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>Identificação da oferta</h2>
            <Badge value={o.type} />
          </div>
          <dl className="description-list">
            {[
              ["Loja", o.store_name],
              ["Produto", o.product_name],
              ["Marca", o.brand || "Pendente"],
              ["Categoria", o.category || "Pendente"],
              ["Modelo", o.model || "Pendente"],
              ["SKU", o.sku || "Pendente"],
              ["Código Mercado Livre", o.ml_id || "Pendente"],
              ["Procedência", labels[o.origin] || o.origin],
              ["Última atualização", date(o.updated_at)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {detail.components.length > 0 && (
            <>
              <h3>Composição</h3>
              {detail.components.map((c: Row) => (
                <p key={c.id} className="small">
                  {c.quantity} × {c.product_name}
                  {c.variation ? " · " + c.variation : ""}
                </p>
              ))}
            </>
          )}
          {r.pending.length > 0 && (
            <div className="alert">
              Financeiro pendente: {r.pending.join(", ")}.{" "}
              <button className="text-link" onClick={() => onTab("costs")}>
                Completar custos
              </button>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Propostas e decisões</h2>
            {canWrite && (
              <button className="button compact" onClick={() => onTab("costs")}>
                <Plus size={14} />
                Preparar cenário
              </button>
            )}
          </div>
          {detail.proposals.length ? (
            detail.proposals.map((p: Row) => (
              <div className="proposal-card" key={p.id}>
                <div className="proposal-top">
                  <Badge value={p.status} />
                  <span className="muted small">{date(p.created_at)}</span>
                </div>
                <h3>
                  {money(p.snapshot.current.price)}{" "}
                  <span className="muted">→</span>{" "}
                  {money(p.snapshot.proposed.price)}
                </h3>
                <p>{p.reason}</p>
                <small className="muted">
                  Contribuição: {money(p.snapshot.proposed.margin)} ·{" "}
                  {percent(p.snapshot.proposed.marginPercent)}
                </small>
                {p.snapshot.input.proposedTitle &&
                  p.snapshot.input.proposedTitle !== p.snapshot.offer.title && (
                    <p className="small">
                      Título proposto: {p.snapshot.input.proposedTitle}
                    </p>
                  )}
                <details className="expand">
                  <summary>Retrato da decisão</summary>
                  <CostSummary result={p.snapshot.proposed} />
                  <p className="muted small">
                    Calculado em {date(p.snapshot.calculatedAt)}. Custos e
                    parâmetros preservados.
                  </p>
                </details>
                {canWrite &&
                  !["applied_manual", "rejected", "cancelled"].includes(
                    p.status,
                  ) && (
                    <button
                      className="button compact"
                      onClick={() => onProposal(p)}
                    >
                      Revisar / avançar etapa <ChevronRight size={14} />
                    </button>
                  )}
              </div>
            ))
          ) : (
            <Empty
              title="Nenhuma proposta preparada"
              body="Simule na seção Custos e preço. Salvar uma proposta não altera os dados atuais."
            />
          )}
        </section>
      </div>
    </>
  );
}
function CostSummary({ result }: { result: Row }) {
  return (
    <div>
      <div className="comparison-row">
        <span>Receita considerada</span>
        <strong>{money(result.revenue)}</strong>
      </div>
      <div className="comparison-row">
        <span>Custos totais</span>
        <strong>{money(result.total)}</strong>
      </div>
      <div className="comparison-row">
        <span>Contribuição</span>
        <strong>
          {money(result.margin)} · {percent(result.marginPercent)}
        </strong>
      </div>
      {result.pending.length > 0 && (
        <p className="small orange">Pendente: {result.pending.join(", ")}</p>
      )}
    </div>
  );
}
function PricingPage({
  data,
  selected,
  choose,
  onDirty,
  busy,
  onError,
  onProposal,
  canWrite,
  onSaveCosts,
}: {
  data: Row;
  selected: string | null;
  choose: (v: string) => void;
  onDirty: () => void;
  busy: boolean;
  onError: (m: string) => void;
  onProposal: (p: Row) => Promise<boolean>;
  canWrite: boolean;
  onSaveCosts: (id: string, data: Row) => void;
}) {
  const offer = data.offerChoices.find((o: Row) => o.id === selected);
  const [detail, setDetail] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    if (offer)
      jsonRequest("/api/offers/" + offer.id)
        .then((d) => {
          if (active) setDetail(d);
        })
        .catch((e) => {
          if (active) {
            setError(e.message);
            onError(e.message);
          }
        });
    return () => {
      active = false;
    };
  }, [offer?.id, offer?.version, data.parameters]);
  return (
    <>
      <section className="panel offer-picker">
        <Field label="Selecione uma oferta">
          <select
            value={offer?.id || ""}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Selecione um anúncio para simular</option>
            {data.offerChoices
              .filter((o: Row) => o.origin !== "reference")
              .map((o: Row) => (
                <option key={o.id} value={o.id}>
                  {o.store_name} · {o.title} · {o.sku || "Sem SKU"}
                </option>
              ))}
          </select>
        </Field>
        <p className="muted small">
          Compare o preço atual com o cenário proposto. A decisão fica vinculada
          ao anúncio e à loja.
        </p>
      </section>
      {offer ? (
        canWrite ? (
          detail && detail.offer.id === offer.id ? (
            <FinancialEditor
              key={
                detail.offer.id +
                ":" +
                detail.offer.version +
                ":" +
                detail.parametersRevision
              }
              detail={detail}
              busy={busy}
              onDirty={onDirty}
              onProposal={onProposal}
              onSaveCosts={(p) =>
                onSaveCosts(offer.id, {
                  ...p,
                  offerVersion: detail.offer.version,
                })
              }
            />
          ) : (
            <div className="alert" role={error ? "alert" : "status"}>
              {error || "Carregando custos da oferta…"}
            </div>
          )
        ) : (
          <div className="alert">
            Seu perfil permite consultar os dados financeiros na ficha. Preparar
            propostas exige permissão de gestão.
          </div>
        )
      ) : (
        <section className="panel">
          <Empty
            title="Uma condição de cada vez"
            body="Escolha uma oferta para comparar preço, desconto, custos e contribuição. Parâmetros desconhecidos permanecem pendentes."
          />
        </section>
      )}
    </>
  );
}
function TaskList({
  tasks,
  data,
  onTask,
  canWrite,
  onOpen,
}: {
  tasks: Row[];
  data: Row;
  onTask: (t: Row) => void;
  canWrite: boolean;
  onOpen: (id: string) => void;
}) {
  return tasks.length ? (
    <Collection id="task" rows={tasks} label="Ações">
      {(visible) => (
        <div className="task-list">
          {visible.map((t) => (
            <div className="task-item" key={t.id}>
              <div className="task-main">
                {canWrite ? (
                  <button className="task-title" onClick={() => onTask(t)}>
                    {t.title}
                  </button>
                ) : (
                  <span className="task-title">{t.title}</span>
                )}
                <span className="task-meta">
                  {data.stores.find((s: Row) => s.id === t.store_id)?.name} ·{" "}
                  {t.assignee || "Sem responsável"}
                  {t.offer_id && (
                    <button
                      className="inline-link"
                      onClick={() => onOpen(t.offer_id)}
                    >
                      Abrir anúncio
                    </button>
                  )}
                </span>
                {t.description && (
                  <p className="small muted">{t.description}</p>
                )}
                {(t.reason || t.result || t.evidence || t.source_note_id) && (
                  <details className="expand">
                    <summary>Motivo, resultado e evidências</summary>
                    {t.reason && <p>Motivo: {t.reason}</p>}
                    {t.result && <p>Resultado: {t.result}</p>}
                    {t.evidence && (
                      <p className="pre-wrap">Evidências: {t.evidence}</p>
                    )}
                    {t.source_note_id && (
                      <p className="muted small">Vinculada à nota original.</p>
                    )}
                  </details>
                )}
              </div>
              <div className="task-right">
                <Badge value={t.priority} />
                <span
                  className={`small ${t.due_date && t.due_date < new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) && !["done", "cancelled"].includes(t.status) ? "danger-text" : "muted"}`}
                >
                  <Clock size={12} />
                  {date(t.due_date)}
                  {t.due_date &&
                  t.due_date <
                    new Date().toLocaleDateString("en-CA", {
                      timeZone: "America/Sao_Paulo",
                    }) &&
                  !["done", "cancelled"].includes(t.status)
                    ? " · Vencida"
                    : ""}
                </span>
                <Badge value={t.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Collection>
  ) : (
    <Empty
      title="Nenhuma ação por aqui"
      body="Cadastre tarefas para anúncios ou pendências gerais da loja."
    />
  );
}
function TasksScreen({
  data,
  search,
  change,
  onTask,
  canWrite,
  onOpen,
}: {
  data: Row;
  search: ReturnType<typeof useSearchParams>;
  change: (k: string, v: string) => void;
  onTask: (t: Row) => void;
  canWrite: boolean;
  onOpen: (id: string) => void;
}) {
  const q = search.get("taskQ") || "",
    status = search.get("taskStatus") || "",
    priority = search.get("priority") || "",
    tasks = data.tasks.filter(
      (t: Row) =>
        (!q ||
          [t.title, t.description, t.assignee]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase())) &&
        (!status || t.status === status) &&
        (!priority || t.priority === priority),
    );
  return (
    <section className="panel">
      <div className="filter-toolbar">
        <SearchBox
          label="Buscar ações"
          value={q}
          onSubmit={(v) => change("taskQ", v)}
        />
        <select
          aria-label="Situação das tarefas"
          value={status}
          onChange={(e) => change("taskStatus", e.target.value)}
        >
          <option value="">Todas as situações</option>
          {["todo", "doing", "done", "cancelled"].map((v) => (
            <option key={v} value={v}>
              {labels[v]}
            </option>
          ))}
        </select>
        <select
          aria-label="Prioridade"
          value={priority}
          onChange={(e) => change("priority", e.target.value)}
        >
          <option value="">Todas as prioridades</option>
          {["high", "medium", "low"].map((v) => (
            <option key={v} value={v}>
              {labels[v]}
            </option>
          ))}
        </select>
      </div>
      <div className="table-heading">
        <span>
          <strong>{tasks.length}</strong> ações · inclui tarefas gerais da loja
        </span>
      </div>
      <TaskList
        tasks={tasks}
        data={data}
        onTask={onTask}
        canWrite={canWrite}
        onOpen={onOpen}
      />
    </section>
  );
}
function SearchBox({
  label,
  value,
  onSubmit,
}: {
  label: string;
  value: string;
  onSubmit: (v: string) => void;
}) {
  const [input, setInput] = useState(value);
  useEffect(() => setInput(value), [value]);
  return (
    <form
      className="search-input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(input);
      }}
    >
      <Search size={16} />
      <input
        aria-label={label}
        placeholder={label + "…"}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button className="search-go">Buscar</button>
    </form>
  );
}
function HistoryScreen({
  data,
  search,
  change,
  onOpen,
}: {
  data: Row;
  search: ReturnType<typeof useSearchParams>;
  change: (k: string, v: string) => void;
  onOpen: (id: string) => void;
}) {
  const field = search.get("historyField"),
    status = search.get("historyStatus"),
    from = search.get("from"),
    to = search.get("to"),
    offer = search.get("historyOffer"),
    rows = data.history.filter(
      (h: Row) =>
        (!field || h.field === field) &&
        (!status || h.status === status) &&
        (!from || calendarDay(h.created_at) >= from) &&
        (!to || calendarDay(h.created_at) <= to) &&
        (!offer || h.offer_id === offer),
    );
  return (
    <>
      <section className="panel history-filters">
        <div className="form-grid">
          <Field label="Anúncio">
            <select
              value={offer || ""}
              onChange={(e) => change("historyOffer", e.target.value)}
            >
              <option value="">Todos os anúncios e registros da loja</option>
              {data.offerChoices.map((o: Row) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Campo alterado">
            <select
              value={field || ""}
              onChange={(e) => change("historyField", e.target.value)}
            >
              <option value="">Todos os campos</option>
              {[...new Set<string>(data.history.map((h: Row) => h.field))].map(
                (v) => (
                  <option key={v} value={v}>
                    {fieldLabel(v)}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="De">
            <input
              type="date"
              value={from || ""}
              onChange={(e) => change("from", e.target.value)}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              value={to || ""}
              onChange={(e) => change("to", e.target.value)}
            />
          </Field>
          <Field label="Situação">
            <select
              value={status || ""}
              onChange={(e) => change("historyStatus", e.target.value)}
            >
              <option value="">Todas</option>
              {[...new Set<string>(data.history.map((h: Row) => h.status))].map(
                (v) => (
                  <option key={v} value={v}>
                    {labels[v] || v}
                  </option>
                ),
              )}
            </select>
          </Field>
        </div>
      </section>
      <HistoryTable rows={rows} data={data} onOpen={onOpen} />
    </>
  );
}
function fieldLabel(v: string) {
  return (
    (
      {
        "offer.create": "Cadastro de anúncio",
        "offer.update": "Edição de anúncio",
        "offer.delete": "Exclusão de rascunho",
        "task.delete": "Exclusão de tarefa",
        "note.delete": "Exclusão de nota",
        "note.create": "Nova nota",
        "note.update": "Edição de nota",
        "product.update": "Dados do produto",
        "store.update": "Nome da loja",
        costs: "Custos",
        parameters: "Parâmetros financeiros",
        price: "Preço",
        title: "Título",
        description: "Descrição",
        status: "Situação",
        proposal: "Proposta salva",
        "proposal.approve": "Aprovação",
        "proposal.reject": "Rejeição",
        "proposal.request": "Aplicação solicitada",
        "proposal.apply_manual": "Aplicação manual",
        "proposal.fail": "Falha de aplicação",
        "proposal.cancel": "Proposta cancelada",
        task: "Tarefa",
        "note.to_task": "Nota convertida",
      } as Row
    )[v] || v
  );
}
function HistoryTable({
  rows,
  data,
  onOpen,
}: {
  rows: Row[];
  data: Row;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Registro de decisões</h2>
        <span className="muted small">
          {rows.length} registros · retratos preservados
        </span>
      </div>
      {rows.length ? (
        <Collection id="history" rows={rows} label="Histórico">
          {(visible) => (
            <div className="timeline">
              {visible.map((h) => (
                <div className="history-item" key={h.id}>
                  <div className="timeline-marker" />
                  <div>
                    <div className="history-top">
                      <strong>{fieldLabel(h.field)}</strong>
                      <Badge value={h.status} />
                      <span>
                        {date(h.created_at)} · {h.actor_name || "Usuário"}
                      </span>
                    </div>
                    <p>{h.reason}</p>
                    <span className="small muted">
                      {data.stores.find((s: Row) => s.id === h.store_id)?.name}{" "}
                      ·{" "}
                      {labels[h.origin] ||
                        (h.origin === "manual_confirmation"
                          ? "Confirmação manual"
                          : h.origin)}
                    </span>
                    {h.offer_id &&
                      data.offerChoices.some(
                        (o: Row) => o.id === h.offer_id,
                      ) && (
                        <button
                          className="inline-link"
                          onClick={() => onOpen(h.offer_id)}
                        >
                          Abrir anúncio
                        </button>
                      )}
                    <details className="expand">
                      <summary>Valores e retrato da operação</summary>
                      <div className="history-values">
                        <div>
                          <span>Anterior</span>
                          <pre>{prettyValue(h.old_value)}</pre>
                        </div>
                        <div>
                          <span>Novo</span>
                          <pre>{prettyValue(h.new_value)}</pre>
                        </div>
                      </div>
                      {h.snapshot_json !== "{}" && (
                        <details>
                          <summary className="small">
                            Custos, parâmetros e cálculo preservados
                          </summary>
                          <pre className="snapshot">
                            {JSON.stringify(
                              JSON.parse(h.snapshot_json),
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                    </details>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Collection>
      ) : (
        <Empty
          title="Seu histórico começa com a primeira decisão"
          body="Cadastros, custos, propostas, aprovações e confirmações de aplicação serão registrados com data e responsável."
        />
      )}
    </section>
  );
}
function prettyValue(v: string | null) {
  if (v === null) return "Sem valor anterior";
  try {
    const p = JSON.parse(v);
    return typeof p === "object"
      ? JSON.stringify(p, null, 2)
      : labels[p] || String(p);
  } catch {
    return v;
  }
}
function Notes({
  data,
  canWrite,
  onEdit,
  onConvert,
}: {
  data: Row;
  canWrite: boolean;
  onEdit: (n: Row) => void;
  onConvert: (n: Row) => void;
}) {
  return data.notes.length ? (
    <Collection id="note" rows={data.notes as Row[]} label="Notas">
      {(visible) => (
        <div className="notes-grid">
          {visible.map((n: Row) => (
            <article className="panel note-card" key={n.id}>
              <div className="proposal-top">
                <Badge value={n.kind} />
                <span className="muted small">{date(n.created_at)}</span>
              </div>
              <h3>{n.title}</h3>
              <p className="pre-wrap">{n.body}</p>
              <div className="note-context">
                <Store size={13} />
                {n.store_id
                  ? data.stores.find((s: Row) => s.id === n.store_id)?.name
                  : "Geral · organização"}
                {n.offer_id && <span> · Anúncio vinculado</span>}
              </div>
              {n.practical_use && (
                <details className="expand">
                  <summary>Aplicação prática</summary>
                  <p className="pre-wrap small">{n.practical_use}</p>
                </details>
              )}
              {n.sources && (
                <details className="expand">
                  <summary>Fontes e links</summary>
                  <p className="pre-wrap small">{n.sources}</p>
                </details>
              )}
              {canWrite && (
                <div className="note-actions">
                  <button className="button compact" onClick={() => onEdit(n)}>
                    Editar
                  </button>
                  <button className="text-link" onClick={() => onConvert(n)}>
                    {data.tasks.some((t: Row) => t.source_note_id === n.id)
                      ? "Abrir tarefa"
                      : "Transformar em tarefa"}{" "}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </Collection>
  ) : (
    <section className="panel">
      <Empty
        title="Um lugar para o que você aprende"
        body="Registre dúvidas, estudos, ideias e insights. Conecte uma nota à loja ou ao anúncio e transforme o aprendizado em ação."
      />
    </section>
  );
}
function Decision({
  proposal,
  data,
  busy,
  onDirty,
  onSave,
}: {
  proposal: Row;
  data: Row;
  busy: boolean;
  onDirty: () => void;
  onSave: (p: Row) => void;
}) {
  const allowed = ["admin", "approver"].includes(data.user.role);
  const canCancel = allowed || proposal.author_id === data.user.id;
  const requestId = useRef<string>(null);
  const [action, setAction] = useState(
    proposal.status === "review"
      ? allowed
        ? "approve"
        : canCancel
          ? "cancel"
          : "approve"
      : proposal.status === "approved" || proposal.status === "failed"
        ? "request"
        : "apply_manual",
  );
  return (
    <form
      onChange={() => {
        requestId.current = null;
        onDirty();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        requestId.current ||= crypto.randomUUID();
        onSave({
          action,
          comment: string(f, "comment"),
          requestId: requestId.current,
        });
      }}
    >
      <div className="proposal-top">
        <Badge value={proposal.status} />
        <strong>
          {money(proposal.snapshot.current.price)} →{" "}
          {money(proposal.snapshot.proposed.price)}
        </strong>
      </div>
      <p>{proposal.reason}</p>
      <CostSummary result={proposal.snapshot.proposed} />
      <Field label="Próxima etapa">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          {canCancel && <option value="cancel">Cancelar proposta</option>}
          {proposal.status === "review" && allowed && (
            <>
              <option value="approve">Registrar aprovação</option>
              <option value="reject">Rejeitar proposta</option>
            </>
          )}
          {["approved", "failed"].includes(proposal.status) && (
            <option value="request">Solicitar aplicação manual</option>
          )}
          {proposal.status === "pending_application" && (
            <>
              <option value="apply_manual">
                Confirmar aplicação feita no ML/Bling
              </option>
              <option value="fail">Registrar falha</option>
            </>
          )}
        </select>
      </Field>
      {proposal.status === "review" && !allowed && (
        <div className="alert">
          Seu perfil prepara propostas; a aprovação exige administrador ou
          aprovador.
        </div>
      )}
      {action === "apply_manual" && (
        <div className="alert">
          Confirme somente após executar e conferir a mudança no ML/Bling. O
          registro ficará identificado como <strong>confirmação manual</strong>.
          Este sistema não envia alterações externas.
        </div>
      )}
      <Field
        label={
          action === "apply_manual"
            ? "Resultado e evidência da aplicação *"
            : "Comentário / justificativa *"
        }
      >
        <textarea
          name="comment"
          minLength={3}
          required
          rows={4}
          placeholder="Registre responsável, motivo e evidências."
        />
      </Field>
      <div className="form-footer">
        <span>Uma etapa por vez, com histórico.</span>
        <Submit
          busy={
            busy ||
            (proposal.status === "review" && !allowed && action !== "cancel")
          }
          label="Registrar etapa"
        />
      </div>
    </form>
  );
}
function Configuration({
  data,
  selected,
  onTab,
  onStore,
  onParameters,
  onSync,
  onAuthorize,
  onDisconnect,
  authorizationResult,
  authorizationMessage,
  busy,
  query,
}: {
  data: Row;
  selected: string;
  onTab: (v: string) => void;
  onStore: (store?: Row) => void;
  onParameters: (p: Row) => void;
  onSync: (c: Row) => void;
  onAuthorize: (c: Row) => void;
  onDisconnect: (c: Row) => void;
  authorizationResult: string | null;
  authorizationMessage: string | null;
  busy: boolean;
  query: string;
}) {
  const isAdmin = data.user.role === "admin";
  return (
    <>
      <div className="tabs">
        {[
          ["stores", "Lojas e parâmetros"],
          ["integrations", "Integrações"],
          ["sync", "Sincronização e dados"],
        ].map(([v, l]) => (
          <button
            key={v}
            className={selected === v ? "active" : ""}
            onClick={() => onTab(v)}
          >
            {l}
          </button>
        ))}
      </div>
      {selected === "stores" && (
        <>
          <div className="section-heading">
            <h2>Contas da operação</h2>
            {isAdmin && (
              <button className="button" onClick={() => onStore()}>
                <Plus size={15} />
                Adicionar loja
              </button>
            )}
          </div>
          <div className="two-columns">
            {data.stores
              .filter((s: Row) =>
                data.parameters.some((p: Row) => p.storeId === s.id),
              )
              .map((s: Row) => {
                const p = data.parameters.find((p: Row) => p.storeId === s.id);
                return (
                  <section className="panel store-card" key={s.id}>
                    <div className="panel-heading">
                      <h2>
                        <Store size={19} />
                        {s.name}
                      </h2>
                      <Badge value="active" />
                    </div>
                    <dl className="description-list">
                      <div>
                        <dt>Margem mínima</dt>
                        <dd>{percent(p.minMargin)}</dd>
                      </div>
                      <div>
                        <dt>Margem desejada</dt>
                        <dd>{percent(p.desiredMargin)}</dd>
                      </div>
                      <div>
                        <dt>Impostos</dt>
                        <dd>{percent(p.taxRate)}</dd>
                      </div>
                      <div>
                        <dt>Comissão de gestão</dt>
                        <dd>{percent(p.managementRate)}</dd>
                      </div>
                      <div>
                        <dt>Base da comissão</dt>
                        <dd>
                          {p.managementBase === "price"
                            ? "Preço do comprador"
                            : p.managementBase === "revenue"
                              ? "Receita com contribuição ML"
                              : "Pendente · conferir"}
                        </dd>
                      </div>
                      <div>
                        <dt>Revisão de custos</dt>
                        <dd>A cada {p.reviewDays} dias</dd>
                      </div>
                    </dl>
                    {isAdmin && (
                      <button
                        className="button"
                        onClick={() => onParameters(p)}
                      >
                        <SlidersHorizontal size={15} />
                        Editar parâmetros
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        className="text-link store-edit"
                        onClick={() => onStore(s)}
                      >
                        Editar nome da loja
                      </button>
                    )}
                  </section>
                );
              })}
          </div>
          <p className="muted small">
            Margens e impostos começam pendentes. A comissão inicial é 1%, com
            base a conferir com o cliente.
          </p>
        </>
      )}
      {selected === "integrations" && (
        <>
          {authorizationResult && (
            <div className="alert" role="status">
              {authorizationResult === "connected"
                ? "Conta Mercado Livre autorizada. Sincronize os anúncios para começar."
                : authorizationMessage ||
                  "Não foi possível conectar a conta. Tente novamente."}
            </div>
          )}
          <div className="alert">
            Conecte cada conta à sua loja e importe os anúncios em lotes de até
            20. Os custos internos ficam preservados. A consulta traz o estado
            atual do ML; propostas continuam seguindo revisão e aprovação.
          </div>
          <div className="integration-grid">
            {data.connections.map((c: Row) => (
              <section className="panel" key={c.id}>
                <div className="panel-heading">
                  <h2>{labels[c.provider]}</h2>
                  <Badge value={c.status} />
                </div>
                <p className="small muted">
                  {data.stores.find((s: Row) => s.id === c.store_id)?.name}
                </p>
                <p>
                  {c.provider === "mercadolivre" && c.external_account
                    ? `${c.nickname || "Vendedor"} · conta ${c.external_account}`
                    : c.configured
                      ? "Credenciais de aplicação presentes. A conta ainda não foi autorizada."
                      : "Credenciais não configuradas no servidor."}
                </p>
                <p className="small muted">
                  {c.provider === "mercadolivre"
                    ? c.configured
                      ? "Autorize a conta no Mercado Livre para consultar anúncios, tarifas e desempenho."
                      : "A aplicação precisa ser configurada no servidor antes de conectar as contas."
                    : c.provider === "bling"
                      ? "Necessários: BLING_CLIENT_ID, BLING_CLIENT_SECRET, BLING_REDIRECT_URI e autorização por conta."
                      : "Necessário: AI_API_KEY e implementação do provedor. As verificações atuais são regras determinísticas."}
                </p>
                {c.provider === "mercadolivre" && (
                  <>
                    <p className="small muted">
                      Última consulta:{" "}
                      {c.last_sync_at
                        ? date(c.last_sync_at)
                        : "Ainda não realizada"}
                      {c.has_more ? " · há mais anúncios para importar" : ""}
                    </p>
                    {c.last_notification_at && (
                      <p className="small muted">
                        Último aviso do ML: {date(c.last_notification_at)}.
                        Consulte novamente os dados pela loja ou ficha do
                        anúncio.
                      </p>
                    )}
                    {c.last_error && (
                      <p className="small danger-text">{c.last_error}</p>
                    )}
                  </>
                )}
                {isAdmin && c.provider === "mercadolivre" && (
                  <div className="heading-actions">
                    <button
                      className="button compact"
                      disabled={busy || !c.configured}
                      onClick={() => onAuthorize(c)}
                    >
                      {c.external_account
                        ? "Renovar autorização"
                        : "Conectar conta ML"}
                    </button>
                    {c.external_account && (
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() => onDisconnect(c)}
                      >
                        Desconectar
                      </button>
                    )}
                  </div>
                )}
                {isAdmin &&
                  (c.provider !== "mercadolivre" || c.external_account) && (
                    <button
                      className="button compact"
                      disabled={
                        busy || (c.provider === "mercadolivre" && !c.configured)
                      }
                      onClick={() => onSync(c)}
                    >
                      {c.provider === "mercadolivre"
                        ? c.has_more
                          ? "Continuar importação · 20 anúncios"
                          : "Sincronizar anúncios"
                        : "Verificar disponibilidade"}
                    </button>
                  )}
                {isAdmin && c.provider === "mercadolivre" && c.has_more && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => onSync({ ...c, restart: true })}
                  >
                    Recomeçar consulta do catálogo
                  </button>
                )}
              </section>
            ))}
          </div>
          {data.logs.length > 0 && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Registros de integração</h2>
              </div>
              <Collection
                id="log"
                rows={data.logs as Row[]}
                label="Registros de integração"
              >
                {(visible) =>
                  visible.map((l: Row) => (
                    <div className="list-item" key={l.id}>
                      <div>
                        <strong>
                          {labels[l.provider]} · {date(l.created_at)}
                        </strong>
                        <small>{l.message}</small>
                      </div>
                      <Badge value={l.status} />
                    </div>
                  ))
                }
              </Collection>
            </section>
          )}
        </>
      )}
      {selected === "sync" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Responsabilidade por campo</h2>
              <span className="eyebrow">
                PROPOSTA INICIAL · VALIDAR COM O CLIENTE
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Sistema responsável</th>
                    <th>Direção / regra</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      "Produto, SKU e estoque",
                      "Bling",
                      "Bling → ML → aplicação. Sem escrita de estoque neste sistema.",
                    ],
                    [
                      "Preço e regra comercial",
                      "Cliente · aplicação pelo Bling/ML",
                      "Proposta → aprovação → execução externa → confirmação manual.",
                    ],
                    [
                      "Título, descrição e publicação",
                      "ML / integração Bling validada",
                      "Importar estado atual. Propor alterações, sem sobrescrita automática.",
                    ],
                    [
                      "Tarifa e frete",
                      "Mercado Livre",
                      "ML → oferta. Revalidar quando o preço mudar.",
                    ],
                    [
                      "Custos, tarefas, notas e decisões",
                      "DATAMAT",
                      "Cadastro local → histórico e exportação BI.",
                    ],
                    [
                      "Análises aprofundadas",
                      "Power BI",
                      "Exportação da base → Power BI.",
                    ],
                  ].map(([field, owner, rule]) => (
                    <tr key={field}>
                      <td>{field}</td>
                      <td>{owner}</td>
                      <td>{rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">
              A consulta do Mercado Livre é iniciada por loja e não envia
              alterações ao marketplace. Não iniciar rotinas concorrentes antes
              de validar a propriedade de cada campo.
            </p>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Exportação e análise</h2>
            </div>
            <p>
              Exporte anúncios para Excel ou CSV e registros estruturados para o
              Power BI. A exportação respeita as lojas autorizadas e o filtro
              global.
            </p>
            <div className="heading-actions">
              <a className="button" href={"/api/export?format=xlsx&" + query}>
                <Download size={15} />
                Anúncios · Excel
              </a>
              <a className="button" href={"/api/export?" + query}>
                <Download size={15} />
                Anúncios · CSV
              </a>
              <a className="button" href={"/api/export?format=json&" + query}>
                <Download size={15} />
                Base para BI · JSON
              </a>
              {data.powerBiUrl && (
                <a
                  className="button primary"
                  href={data.powerBiUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Relatório Power BI <ArrowUpRight size={15} />
                </a>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
