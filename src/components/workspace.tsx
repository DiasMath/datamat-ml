"use client";
import {
  useConfirm,
  discardChanges,
  useUnsavedRegistry,
  useUnsavedChanges,
} from "./confirmation";
import { useSmartTable, type TableColumn } from "./smart-table";
import BulkOffers from "./bulk-offers";
import { ListingChecklist, MarketplacePerformance } from "./marketplace-panels";
import Analytics from "./analytics";
import { useToast, useToastMessage } from "./toasts";
import ListingMedia, { MediaImage } from "./listing-media";
import { listingCounts, listingType } from "../domain/listing-table";
import { ListingInformationProvider, ListingHint } from "./listing-information";
import ListingGlobalPanel from "./listing-global-panel";
import {
  listingRowInformation,
  listingDiscountLimit,
} from "./listing-row-information";
import GoogleDriveSettings from "./google-drive-settings";
import IntegrationForm from "./integration-form";
import useMlAuthorization from "./use-ml-authorization";
import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useTransition,
  useCallback,
  type SetStateAction,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { calendarDay } from "../domain/dates";
import {
  LoaderCircle,
  RefreshCw,
  ShoppingCart,
  Eye,
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
  PanelLeftClose,
  PanelLeftOpen,
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
  RequestLoading,
  trackedFetch,
} from "./ui";
import { OfferForm, TaskForm, NoteForm, ParameterForm } from "./forms";
import FinancialEditor from "./financial-editor";
import AutocompleteInput from "./autocomplete";
import Importer from "./importer";
import Collection, { pageSize } from "./collection";
import Skeleton from "./skeleton";
import Today from "./today";
import Competitors from "./competitors";
import ExtensionSettings from "./extension-settings";
import { TitleWorkbench } from "./listing-diagnostics";
import useCatalogPolling from "./use-catalog-polling";
import OfferPreview from "./offer-preview";
import CommandSearch from "./command-search";
import WorkspaceClock from "./workspace-clock";
import TodayFreshness from "./today-freshness";
import WorkspaceFreshness, {
  type AnalysisFreshness,
} from "./workspace-freshness";
import type { AnalyticsReport } from "../domain/analytics";
import CopyCode from "./copy-code";
import QuickTaskForm from "./quick-task-form";
import useListingIndicators from "./use-listing-indicators";
import ListingUpdateProgress from "./listing-update-progress";

type Row = Record<string, any>;
const navigation = [
  { path: "", title: "Hoje", icon: LayoutDashboard },
  { path: "anuncios", title: "Anúncios", icon: Tags },
  { path: "precificacao", title: "Precificação", icon: Calculator },
  { path: "analises", title: "Análises", icon: Activity },
  { path: "concorrencia", title: "Concorrência", icon: Search },
  { path: "acoes", title: "Ações", icon: ListTodo },
  { path: "historico", title: "Histórico", icon: History },
  { path: "estudos", title: "Estudos e notas", icon: NotebookPen },
  { path: "configuracoes", title: "Configurações", icon: Settings },
];
const descriptions: Record<string, string> = {
  "": "O que precisa da sua atenção. Um passo de cada vez.",
  anuncios: "Organize suas ofertas e acompanhe o que precisa evoluir.",
  precificacao: "Conheça os custos. Compare cenários. Prepare decisões.",
  analises: "Entenda as vendas. Encontre prioridades. Acompanhe o dia a dia.",
  concorrencia:
    "Acompanhe ofertas comparáveis e transforme mudanças em decisões.",
  acoes: "Transforme decisões em trabalho com prazo e responsável.",
  historico: "Uma trilha clara das decisões e mudanças da operação.",
  estudos: "Guarde o aprendizado e conecte ideias ao trabalho.",
  configuracoes: "Lojas, regras financeiras e conexões.",
};
export default function Workspace({ view }: { view: string[] }) {
  const confirm = useConfirm();
  const { hasUnsaved } = useUnsavedRegistry();
  const { notify, clear: clearToasts } = useToast();
  const setToast = useMemo(
    () => (message: { text: string; error?: boolean }) =>
      notify(message.text, message.error ? "error" : "success"),
    [notify],
  );
  const [transitioning, startTransition] = useTransition();
  const router = useRouter(),
    search = useSearchParams(),
    query = search.toString(),
    route = view.join("/"),
    section = view[0] || "",
    offerId = section === "anuncios" ? view[1] : undefined;
  const [data, setData] = useState<Row | null>(null),
    [navigationData, setNavigationData] = useState<Row | null>(null),
    [preview, setPreview] = useState<{
      id: string;
      tab?: string;
      canEdit: boolean;
      sequence?: {
        store: string;
        focus: "urgent" | "review" | "prepare";
        decisions: boolean;
        skipped: string[];
      };
    } | null>(null),
    [searchOpen, setSearchOpen] = useState(false),
    [detail, setDetail] = useState<Row | null>(null),
    [formWorkspace, setFormWorkspace] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [modal, setModal] = useState<{ type: string; record?: Row } | null>(null),
    [dirty, setDirty] = useState(false),
    [menu, setMenu] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [selection, setSelection] = useState<string[]>([]);
  const workspaceCache = useRef<{
    key: string;
    revision: number;
    data: Row;
  } | null>(null);
  const loadedContext = useRef("");
  const [loadedScope, setLoadedScope] = useState("");
  const [consultationError, setConsultationError] = useState("");
  const [analysisFreshness, setAnalysisFreshness] =
    useState<AnalysisFreshness | null>(null);
  const previewChanged = useRef(false);
  const backgroundReload = useRef(false);
  const editing = useRef(false);
  editing.current = busy || dirty || !!modal || !!preview || searchOpen;
  const reloadInBackground = useCallback((action: SetStateAction<number>) => {
    backgroundReload.current = true;
    setRefresh(action);
  }, []);
  const mlAuthorization = useMlAuthorization({
    disabled: busy,
    returnTo: "/" + route + (query ? "?" + query : ""),
    onWorking: setBusy,
    onResult: ({ connected, message }) => {
      setToast({
        text: connected
          ? "Mercado Livre conectado. A conta foi atualizada."
          : message || "Não foi possível conectar a conta.",
        error: !connected,
      });
      if (connected) {
        setLoading(true);
        setRefresh((n) => n + 1);
      }
    },
  });
  const authorizationResult = search.get("mlAuthorization");
  const authorizationMessage = search.get("mlMessage");
  const handledAuthorization = useRef("");
  useEffect(() => {
    if (!authorizationResult) {
      handledAuthorization.current = "";
      return;
    }
    const resultKey = authorizationResult + ":" + (authorizationMessage || "");
    if (handledAuthorization.current === resultKey) return;
    handledAuthorization.current = resultKey;
    notify(
      authorizationResult === "connected"
        ? "Conta Mercado Livre autorizada. Sincronize os anúncios para começar."
        : authorizationMessage ||
            "Não foi possível conectar a conta. Tente novamente.",
      authorizationResult === "connected" ? "success" : "error",
    );
    const params = new URLSearchParams(query);
    params.delete("mlAuthorization");
    params.delete("mlMessage");
    router.replace("/" + route + (params.size ? "?" + params : ""), {
      scroll: false,
    });
  }, [authorizationResult, authorizationMessage, notify, query, route, router]);
  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem("datamat:sidebar-collapsed") === "true",
      );
    } catch {}
  }, []);
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem("datamat:sidebar-collapsed", String(next));
    } catch {}
  }
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
    "todayFocus",
    "todayPage",
    "todayDecisions",
    "page",
    "pageSize",
    "sort",
    "sortDir",
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
    "analyticsProductsPage",
    "analyticsProductsSize",
    "routineSalesPage",
    "routineSalesSize",
    "routineStockPage",
    "routineStockSize",
    "competitorsPage",
    "competitorsSize",
    "extensionId",
    "tab",
    "configTab",
    "tableView",
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
  if (section === "analises")
    for (const key of [
      "q",
      "brand",
      "category",
      "status",
      "type",
      "pending",
      "stale",
    ])
      dataQuery.delete(key);
  const analysisScope = `${route}:${store}`;
  const onAnalysisFreshness = useCallback(
    (report: AnalyticsReport | null, error?: string) => {
      setAnalysisFreshness((previous) => ({
        scope: analysisScope,
        report:
          report ||
          (error && previous?.scope === analysisScope ? previous.report : null),
        error,
      }));
    },
    [analysisScope],
  );
  const indicatorUpdate = useListingIndicators({
    scope: `${route}:${store}`,
    onWorking: setBusy,
    onChanged: () => reloadInBackground((n) => n + 1),
  });
  const home = section === "";
  const dataKey = home
    ? new URLSearchParams({ store }).toString()
    : dataQuery.toString();
  const cacheKey = dataKey + (home ? ":today" : ":workspace");
  const contentReady = loadedScope === `${section}:${store}:${offerId || ""}`;
  const chrome = navigationData || data;
  useEffect(() => {
    const controller = new AbortController();
    jsonRequest(
      "/api/navigation?" + new URLSearchParams({ store }),
      undefined,
      "GET",
      controller.signal,
      "background",
    )
      .then((result) => {
        if (!controller.signal.aborted) setNavigationData(result);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [store, refresh]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "k"
      )
        return;
      event.preventDefault();
      if (searchOpen) setSearchOpen(false);
      else if (!document.querySelector("dialog[open]")) {
        setMenu(false);
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [searchOpen]);
  useEffect(() => {
    setPreview(null);
    setSearchOpen(false);
    setModal(null);
  }, [route, store]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const contextKey = cacheKey + ":" + (offerId || "");
    const scopeKey = `${section}:${store}:${offerId || ""}`;
    const background =
      backgroundReload.current && loadedContext.current === contextKey;
    backgroundReload.current = false;
    setConsultationError("");
    if (!background) setLoading(true);
    if (loadedScope !== scopeKey) {
      setData(null);
      setDetail(null);
    }
    Promise.all([
      !home &&
      workspaceCache.current?.key === cacheKey &&
      workspaceCache.current.revision === refresh
        ? Promise.resolve(workspaceCache.current.data)
        : jsonRequest(
            (home ? "/api/today?" : "/api/workspace?") + dataKey,
            undefined,
            "GET",
            controller.signal,
            background ? "background" : "foreground",
          ),
      offerId
        ? jsonRequest(
            "/api/offers/" + offerId,
            undefined,
            "GET",
            controller.signal,
            background ? "background" : "foreground",
          )
        : Promise.resolve(null),
    ])
      .then(([d, o]) => {
        if (active && !(background && editing.current)) {
          loadedContext.current = contextKey;
          setLoadedScope(scopeKey);
          workspaceCache.current = {
            key: cacheKey,
            revision: refresh,
            data: d,
          };
          setData(d);
          setDetail(o);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active && !controller.signal.aborted) {
          if (!background && (!home || loadedContext.current !== contextKey))
            setData(null);
          setLoadedScope(scopeKey);
          setConsultationError(e.message);
          setToast({ text: e.message, error: true });
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [cacheKey, offerId, refresh, home, dataKey, section, store]);
  useCatalogPolling({
    store,
    offerId,
    enabled:
      !home &&
      data?.user.role === "admin" &&
      !!data?.connections.some(
        (c: Row) =>
          c.provider === "mercadolivre" &&
          c.status === "connected" &&
          (store === "all" || c.store_id === store),
      ),
    blocked: loading || busy || dirty || !!modal || !!preview || searchOpen,
    onReload: reloadInBackground,
  });
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useUnsavedChanges(dirty, () => {
    setDirty(false);
    setModal(null);
  });
  async function guard() {
    if (busy) return false;
    return (!dirty && !hasUnsaved()) || (await confirm(discardChanges));
  }
  async function navigate(path: string, params?: URLSearchParams) {
    if (!(await guard())) return;
    setDirty(false);
    setMenu(false);
    setModal(null);
    const targetQuery =
      params ??
      (path.split("/")[0] !== section
        ? new URLSearchParams({ store })
        : new URLSearchParams(query));
    startTransition(() =>
      router.push("/" + path + (targetQuery.size ? "?" + targetQuery : ""), {
        scroll: path !== route,
      }),
    );
  }
  function changeParam(key: string, value: string) {
    const p = new URLSearchParams(query);
    value ? p.set(key, value) : p.delete(key);
    for (const k of ["page", "taskPage", "historyPage", "notePage", "logPage"])
      p.delete(k);
    navigate(route, p);
  }
  async function changeStore(value: string) {
    if (!(await guard())) return;
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
      if (!(
        method === "DELETE" &&
        offerId &&
        url === "/api/offers/" + offerId
      )) {
        setLoading(true);
        setRefresh((v) => v + 1);
      }
      return true;
    } catch (e) {
      setToast({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function open(type: string, record?: Row) {
    if (!(await guard())) return;
    if (home && type !== "task") {
      setBusy(true);
      try {
        setFormWorkspace(
          await jsonRequest("/api/workspace?" + new URLSearchParams({ store })),
        );
      } catch (error) {
        setToast({ text: (error as Error).message, error: true });
        return;
      } finally {
        setBusy(false);
      }
    }
    setDirty(false);
    clearToasts();
    setModal({
      type,
      record:
        type === "delete"
          ? { ...record, requestId: crypto.randomUUID() }
          : record,
    });
  }
  async function close() {
    if (await guard()) {
      setDirty(false);
      setModal(null);
    }
  }
  function openOffer(key: string, initialTab?: string) {
    const p = new URLSearchParams();
    p.set("store", store);
    const target = "/" + route + (query ? "?" + query : "");
    p.set("returnTo", target);
    try {
      sessionStorage.setItem(
        "datamat:return-scroll:" + target,
        String(window.scrollY),
      );
    } catch {}

    if (initialTab) p.set("tab", initialTab);
    navigate("anuncios/" + key, p);
  }
  function openPreview(id: string, initialTab?: string) {
    if (busy || modal) return;
    setSearchOpen(false);
    setPreview({
      id,
      tab: initialTab,
      canEdit:
        !!chrome && chrome.user.role !== "viewer" && !dirty && !hasUnsaved(),
    });
  }
  function startReview(
    item: { id: string; storeId: string },
    focus: "urgent" | "review" | "prepare",
    decisions: boolean,
  ) {
    if (
      busy ||
      modal ||
      dirty ||
      hasUnsaved() ||
      chrome?.user.role === "viewer"
    )
      return;
    setPreview({
      id: item.id,
      tab: "costs",
      canEdit: true,
      sequence: { store: item.storeId, focus, decisions, skipped: [] },
    });
  }
  async function nextPreview() {
    if (!preview?.sequence) return;
    const sequence = preview.sequence;
    const skipped = [...sequence.skipped, preview.id];
    const result = await jsonRequest("/api/today/next", {
      ...sequence,
      skipped,
      currentId: preview.id,
    });
    if (result.next)
      setPreview({
        ...preview,
        id: result.next.id,
        tab: "costs",
        sequence: { ...sequence, skipped },
      });
    else {
      closePreview();
      notify(
        "Fim da sequência nesta loja. As pendências restantes continuam na Hoje.",
      );
    }
  }
  function closePreview() {
    setPreview(null);
    if (previewChanged.current && !dirty) {
      previewChanged.current = false;
      setRefresh((n) => n + 1);
    }
  }
  async function back() {
    const target = search.get("returnTo");
    let valid = false;
    if (
      target &&
      target.startsWith("/") &&
      !target.startsWith("//") &&
      !target.includes("\\")
    ) {
      try {
        const destination = new URL(target, window.location.origin);
        valid =
          destination.origin === window.location.origin &&
          (navigation.some((n) => destination.pathname === "/" + n.path) ||
            /^\/anuncios\/[a-zA-Z0-9_-]+$/.test(destination.pathname));
      } catch {}
    }
    if (target && valid) {
      if (await guard()) {
        setDirty(false);
        router.push(target, { scroll: false });
      }
    } else navigate("anuncios", new URLSearchParams({ store }));
  }
  const formData = data
    ? {
        ...(home ? formWorkspace || data : data),
        offerChoices: (home ? formWorkspace : data)?.offerChoices || [],
        tasks: (home ? formWorkspace : data)?.tasks || data.tasks || [],
        selectedStore:
          detail?.offer.store_id || (store === "all" ? undefined : store),
        initialOffer: offerId,
      }
    : null;
  const restoredPosition = useRef("");
  useEffect(() => {
    if (loading || !contentReady || offerId) return;
    const target = "/" + route + (query ? "?" + query : "");
    if (restoredPosition.current === target) return;
    restoredPosition.current = target;
    let position: string | null = null;
    try {
      position = sessionStorage.getItem("datamat:return-scroll:" + target);
      if (position !== null)
        sessionStorage.removeItem("datamat:return-scroll:" + target);
    } catch {}
    if (position === null || !Number.isFinite(Number(position)))
      return () => {
        restoredPosition.current = "";
      };
    const frame = requestAnimationFrame(() =>
      window.scrollTo({
        top: Math.max(0, Number(position)),
        behavior: "instant",
      }),
    );
    return () => {
      cancelAnimationFrame(frame);
      restoredPosition.current = "";
    };
  }, [loading, contentReady, offerId, route, query]);
  const TaskEditor = home ? QuickTaskForm : TaskForm;
  const canWrite = contentReady && !!data && data.user.role !== "viewer";
  const title = offerId
    ? "Ficha do anúncio"
    : section === "analises" && view[1] === "ao-vivo"
      ? "Análise ao vivo"
      : navigation.find((n) => n.path === section)?.title ||
        "Página não encontrada";
  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${section === "anuncios" && !offerId ? "offers-layout" : ""}`}
    >
      <aside
        id="main-navigation"
        inert={mobile && !menu}
        aria-hidden={mobile && !menu ? true : undefined}
        className={`sidebar ${menu ? "is-open" : ""}`}
      >
        <div className="brand">
          <span className="brand-lockup" role="img" aria-label="DATAMAT">
            <img
              src="/icon.svg"
              width={28}
              height={36}
              alt=""
              fetchPriority="low"
            />
            {(!sidebarCollapsed || mobile) && (
              <svg
                className="brand-wordmark"
                viewBox="410 80 1892 350"
                width={128}
                height={36}
                aria-hidden="true"
              >
                <image href="/datamat.svg" width={2302} height={453} />
              </svg>
            )}
          </span>
          <button
            className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="main-navigation"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
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
              title={n.title}
              aria-current={section === n.path ? "page" : undefined}
              className={`nav-item ${section === n.path ? "active" : ""}`}
              onClick={() => navigate(n.path)}
            >
              <n.icon size={18} />
              <span>{n.title}</span>
              {n.path === "acoes" &&
                chrome &&
                (chrome.openTasks ??
                  chrome.tasks?.filter(
                    (t: Row) => !["done", "cancelled"].includes(t.status),
                  ).length ??
                  0) > 0 && (
                  <span className="nav-count">
                    {chrome.openTasks ??
                      chrome.tasks?.filter(
                        (t: Row) => !["done", "cancelled"].includes(t.status),
                      ).length}
                  </span>
                )}
              {n.path === "anuncios" && section === "anuncios" && (
                <span className="active-dot" />
              )}
            </button>
          ))}
        </nav>
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
          <div className="header-context">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir navegação"
              aria-expanded={menu}
              aria-controls="main-navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <div className="header-summary">
              <WorkspaceClock />
              {contentReady && consultationError && !data ? (
                <span className="today-freshness">
                  <span className="dot" />
                  Consulta indisponível
                </span>
              ) : contentReady &&
                data &&
                (section !== "analises" ||
                  (analysisFreshness?.scope === analysisScope &&
                    (analysisFreshness.report || analysisFreshness.error))) ? (
                home && data.sales && !consultationError ? (
                  <TodayFreshness
                    sales={data.sales}
                    store={store}
                    navigate={navigate}
                  />
                ) : (
                  <WorkspaceFreshness
                    data={data}
                    section={section}
                    error={consultationError}
                    analysis={
                      analysisFreshness?.scope === analysisScope
                        ? analysisFreshness
                        : undefined
                    }
                  />
                )
              ) : (
                <span
                  className="header-status-skeleton skeleton-bone"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="nav-search"
              aria-label="Abrir busca rápida (Ctrl+K)"
              title="Buscar anúncios · Ctrl+K ou ⌘K"
              onClick={() => {
                setMenu(false);
                setSearchOpen(true);
              }}
            >
              <Search size={16} aria-hidden="true" />
              <span>Buscar anúncios</span>
              <kbd>Ctrl K</kbd>
            </button>
            <label className="global-store">
              <Store size={16} />
              <span className="sr-only">Loja global</span>
              <select
                aria-label="Loja global"
                disabled={busy}
                value={store}
                onChange={(e) => changeStore(e.target.value)}
              >
                <option value="all">Todas as lojas autorizadas</option>
                {chrome?.stores.map((s: Row) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {home && (chrome?.user.role || data?.user.role) !== "viewer" && (
              <button
                className="button primary header-new-action"
                disabled={busy || loading || !canWrite}
                onClick={() => open("task")}
              >
                <Plus size={15} /> Nova ação
              </button>
            )}
            <RequestLoading
              busy={loading || !contentReady || busy || transitioning}
              label={
                mlAuthorization.connectionId
                  ? "Aguardando autorização…"
                  : indicatorUpdate.progress
                    ? `Consultando ML: ${indicatorUpdate.progress.done} de ${indicatorUpdate.progress.total} concluídos…`
                    : undefined
              }
            />
          </div>
        </header>
        <main
          className={
            "content " +
            (home
              ? "today-content"
              : section === "anuncios" && !offerId
                ? "offers-content"
                : "")
          }
          aria-busy={loading || !contentReady || busy}
        >
          {home && <h1 className="sr-only">Hoje</h1>}
          {!offerId && !home && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {section === ""
                    ? ""
                    : "OPERAÇÃO · " +
                      (store === "all"
                        ? "TODAS AS LOJAS"
                        : data?.stores.find((s: Row) => s.id === store)?.name ||
                          "")}
                </div>
                <h1>{title}</h1>
                <p>
                  {section === "analises" && view[1] === "ao-vivo"
                    ? "O ritmo das vendas de hoje e o que precisa de atenção agora."
                    : descriptions[section]}
                </p>
              </div>
              <div className="heading-actions">
                {section === "anuncios" && (
                  <>
                    <button
                      className="button"
                      aria-label="Exportar Excel"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const result = await trackedFetch(
                            "/api/export?format=xlsx&" + query,
                          );
                          if (!result.ok)
                            throw new Error(
                              "Não foi possível exportar a planilha.",
                            );
                          const blob = await result.blob(),
                            url = URL.createObjectURL(blob),
                            link = document.createElement("a");
                          link.href = url;
                          link.download = "datamat-anuncios.xlsx";
                          document.body.append(link);
                          link.click();
                          link.remove();
                          setTimeout(() => URL.revokeObjectURL(url), 10000);
                        } catch (error) {
                          setToast({
                            text: (error as Error).message,
                            error: true,
                          });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Download size={15} />
                      <span>Exportar Excel</span>
                    </button>
                    {canWrite && (
                      <>
                        <button
                          className="button"
                          aria-label="Importar"
                          onClick={() => open("import")}
                        >
                          <Upload size={15} />
                          <span>Importar</span>
                        </button>
                        <button
                          className="button primary"
                          aria-label="Novo anúncio"
                          onClick={() => open("offer")}
                        >
                          <Plus size={16} />
                          <span>Novo anúncio</span>
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
          {(!contentReady || loading) && (!contentReady || !data) ? (
            <Skeleton
              variant={
                offerId
                  ? "detail"
                  : section === ""
                    ? "today"
                    : section === "analises"
                      ? "analytics"
                      : section === "configuracoes"
                        ? "settings"
                        : section === "precificacao"
                          ? "pricing"
                          : "list"
              }
            />
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
            <fieldset className="workspace-data" disabled={loading}>
              {section === "" && (
                <Today
                  data={data}
                  store={store}
                  blocked={busy || dirty || !!modal || !!preview || searchOpen}
                  onUpdated={(next) => {
                    setData(next);
                    workspaceCache.current = {
                      key: cacheKey,
                      revision: refresh,
                      data: next,
                    };
                  }}
                  onOpen={openOffer}
                  onPreview={openPreview}
                  onReview={startReview}
                  onTask={(t: Row) => open("task", t)}
                  navigate={navigate}
                />
              )}
              {section === "anuncios" && !offerId && (
                <Offers
                  data={data}
                  query={query}
                  selected={selection}
                  setSelected={setSelection}
                  onOpen={openOffer}
                  onPreview={openPreview}
                  canWrite={canWrite}
                  navigate={navigate}
                  onNew={() => open("offer")}
                  onBatch={() => open("batch")}
                  onChanged={() => reloadInBackground((n) => n + 1)}
                  busy={busy}
                  onIndicators={(ids) => {
                    if (!busy) void indicatorUpdate.start(ids);
                  }}
                />
              )}
              {offerId && detail && (
                <>
                  <div className="detail-heading">
                    <button className="back-button" onClick={back}>
                      <ArrowLeft size={16} />
                      {search.get("returnTo")?.startsWith("/?") ||
                      search.get("returnTo") === "/"
                        ? "Voltar à Hoje"
                        : "Voltar aos anúncios"}
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
                        {canWrite &&
                          detail.mlConnection?.status === "connected" &&
                          detail.offer.origin !== "reference" &&
                          /^MLB\d+$/.test(detail.offer.ml_id || "") && (
                            <button
                              className="button"
                              onClick={() =>
                                open("batch", {
                                  ids: [detail.offer.id],
                                  action: detail.offer.ml_status_target
                                    ? "ml-" + detail.offer.ml_status_target
                                    : detail.offer.status === "active"
                                      ? "ml-paused"
                                      : "ml-active",
                                })
                              }
                            >
                              {detail.offer.ml_status_uncertain
                                ? "Conferir situação no ML"
                                : detail.offer.status === "active"
                                  ? "Pausar no ML"
                                  : "Ativar no ML"}
                            </button>
                          )}

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
                      ["media", "Fotos e vídeos"],
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
                        busy={busy || dirty}
                        canWrite={canWrite}
                        onRefresh={() =>
                          mutate(
                            `/api/catalog/refresh?store=${detail.offer.store_id}`,
                            { offerId },
                            "Estado do anúncio consultado no Mercado Livre.",
                          )
                        }
                        onTask={(issueKey) =>
                          mutate(
                            `/api/offers/${offerId}/quality-task`,
                            { issueKey },
                            "Pendência adicionada às tarefas.",
                          )
                        }
                      />
                      <TitleWorkbench
                        key={detail.offer.id + ":" + detail.offer.version}
                        detail={detail}
                        canWrite={canWrite}
                        onDirty={setDirty}
                        onSaved={() => setRefresh((n) => n + 1)}
                      />
                    </>
                  )}
                  {tab === "media" && (
                    <ListingMedia
                      detail={detail}
                      canWrite={canWrite}
                      busy={busy || dirty}
                      onWorking={setBusy}
                      onChanged={() => setRefresh((n) => n + 1)}
                      onRefresh={() =>
                        mutate(
                          `/api/catalog/refresh?store=${detail.offer.store_id}`,
                          { offerId },
                          "Fotos e vídeos consultados no ML.",
                        )
                      }
                    />
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
                      onCompetition={() =>
                        mutate(
                          `/api/offers/${offerId}/ml-competition`,
                          {},
                          "Competição consultada no Mercado Livre.",
                        )
                      }
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
              {section === "analises" && (
                <Analytics
                  key={route}
                  data={data}
                  store={store}
                  live={view[1] === "ao-vivo"}
                  navigate={navigate}
                  onOpen={openOffer}
                  onChanged={() => setRefresh((n) => n + 1)}
                  onFreshness={onAnalysisFreshness}
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
              {section === "concorrencia" && (
                <Competitors
                  data={data}
                  store={store}
                  onOpen={openOffer}
                  onChanged={() => setRefresh((v) => v + 1)}
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
                    ["stores", "integrations", "sync", "extension"].includes(
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
                  onAuthorize={(c) => mlAuthorization.authorize(c.id)}
                  authorizingId={mlAuthorization.connectionId}
                  onCancelAuthorization={mlAuthorization.cancel}
                  onDisconnect={(c) =>
                    mutate(
                      `/api/connections/${c.id}/disconnect`,
                      {},
                      "Conta desconectada; cadastros e histórico preservados.",
                    )
                  }
                  onApplication={(c) => open("integration", c)}
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
            </fieldset>
          )}
        </main>
      </div>
      {indicatorUpdate.progress && (
        <ListingUpdateProgress
          {...indicatorUpdate.progress}
          onCancel={indicatorUpdate.cancel}
        />
      )}
      <CommandSearch
        open={searchOpen}
        store={store}
        revision={refresh}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => openPreview(id)}
      />
      {preview && (
        <OfferPreview
          key={preview.id}
          id={preview.id}
          initialTab={preview.tab}
          canEdit={preview.canEdit}
          onClose={closePreview}
          onNext={preview.sequence ? nextPreview : undefined}
          onChanged={() => {
            previewChanged.current = true;
          }}
          onView={(id, tab) => {
            closePreview();
            openOffer(id, tab);
          }}
        />
      )}
      {modal && data && (
        <Modal
          protectChanges={false}
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
          {modal.type === "integration" && (
            <IntegrationForm
              connection={modal.record!}
              busy={busy}
              onDirty={() => setDirty(true)}
              onSave={(p) =>
                mutate(
                  `/api/connections/${modal.record!.id}/application`,
                  p,
                  "Credenciais salvas para esta loja. Autorize a conta para começar.",
                  true,
                )
              }
            />
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
            <TaskEditor
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
              onApplyML={() =>
                mutate(
                  `/api/proposals/${modal.record!.id}/apply-ml`,
                  { confirmed: true },
                  "Preço confirmado na API do Mercado Livre.",
                  true,
                ).then((ok) => {
                  if (!ok) {
                    setModal(null);
                    setDirty(false);
                    setRefresh((v) => v + 1);
                  }
                })
              }
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
            <BulkOffers
              data={data}
              ids={modal.record?.ids || selection}
              initialAction={modal.record?.action || "edit"}
              busy={busy}
              onBusy={setBusy}
              onDirty={() => setDirty(true)}
              onChanged={() => {
                setDirty(false);
                setRefresh((v) => v + 1);
              }}
              onDone={() => {
                setSelection([]);
                setDirty(false);
                setModal(null);
                setRefresh((v) => v + 1);
              }}
            />
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
      batch: "Ações em lote",
      convert: "Transformar nota em tarefa",
      store: modal.record ? "Editar loja" : "Adicionar loja",
      delete: "Confirmar exclusão",
      access: "Permissões de acesso",
      integration: "Credenciais do Mercado Livre",
    }[modal.type] || ""
  );
}
function Offers({
  data,
  query,
  selected,
  setSelected,
  onOpen,
  onPreview,
  canWrite,
  navigate,
  onNew,
  onBatch,
  busy,
  onIndicators,
  onChanged,
}: {
  data: Row;
  query: string;
  selected: string[];
  setSelected: (s: string[]) => void;
  onOpen: (id: string, initialTab?: string) => void;
  onPreview: (id: string, initialTab?: string) => void;
  canWrite: boolean;
  navigate: (p: string, q: URLSearchParams) => void;
  onNew: () => void;
  onBatch: () => void;
  busy: boolean;
  onIndicators: (ids: string[]) => void;
  onChanged: () => void;
}) {
  const q = new URLSearchParams(query),
    [input, setInput] = useState(q.get("q") || "");
  const scrollArea = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      for (const details of toolbar.current?.querySelectorAll<HTMLDetailsElement>(
        "details[open]",
      ) || []) {
        if (
          event instanceof KeyboardEvent ||
          !details.contains(event.target as Node)
        ) {
          if (
            event instanceof KeyboardEvent &&
            details.contains(document.activeElement)
          )
            details.querySelector("summary")?.focus();
          details.open = false;
        }
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    const resize = () => {
      toolbar.current
        ?.querySelectorAll<HTMLDetailsElement>("details[open]")
        .forEach((details) => {
          details.open = false;
        });
    };
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", resize);
    };
  }, []);
  const selectionQuery = new URLSearchParams(query);
  for (const key of ["page", "pageSize", "sort", "sortDir"])
    selectionQuery.delete(key);
  const selectionKey = selectionQuery.toString();
  useEffect(() => {
    setInput(new URLSearchParams(query).get("q") || "");
  }, [query]);
  useEffect(() => {
    setSelected([]);
  }, [selectionKey]);
  const sort =
      q.get("sort") === "stock" ? "updated" : q.get("sort") || "updated",
    page = Math.max(
      1,
      Number.isFinite(Number(q.get("page")))
        ? Math.floor(Number(q.get("page"))) || 1
        : 1,
    ),
    size = pageSize(q.get("pageSize") ?? "50");
  const operational = q.get("tableView")
    ? q.get("tableView") === "operational"
    : data.offers.some((o: Row) => !!o.ml);
  const counts = listingCounts(data.offers);
  const eligible = data.offers.filter(
    (o: Row) =>
      o.ml?.sellerId &&
      o.origin !== "reference" &&
      (!selected.length || selected.includes(o.id)),
  );
  const columns = useMemo<TableColumn<Row>[]>(
    () => [
      ...(canWrite
        ? [{ id: "select", label: "", width: 44, fixed: true }]
        : []),
      {
        id: "name",
        className: "offer-align-left",
        label: "Anúncio / produto",
        width: operational ? 260 : 290,
        value: (o: Row) => o.title,
      },
      ...(!operational
        ? [
            {
              id: "store",
              label: "Loja",
              width: 125,
              value: (o: Row) => o.store_name,
            },
            {
              id: "brand",
              label: "Marca / categoria",
              width: 165,
              value: (o: Row) =>
                [o.brand, o.category].filter(Boolean).join(" · "),
            },
            {
              id: "sku",
              label: "SKU",
              width: 160,
              value: (o: Row) => o.sku,
            },
            {
              id: "status",
              label: "Situação",
              width: 105,
              value: (o: Row) => labels[o.status],
            },
          ]
        : []),
      {
        id: "price",
        className: "offer-align-right",
        label: "Preço atual",
        width: operational ? 120 : 140,
        kind: "number" as const,
        value: (o: Row) => o.price,
      },
      ...(operational
        ? [
            {
              id: "conditions",
              label: "Condições",
              width: 150,
              value: (o: Row) => o.ml?.listingTypeId,
            },
            {
              id: "settlement",
              className: "offer-align-right",
              label: "Recebe (estim.)",
              width: 155,
              kind: "number" as const,
              value: (o: Row) => o.settlementEstimate?.amount,
            },
            {
              id: "metrics",
              label: "Últimos 7 dias",
              width: 125,
              kind: "number" as const,
              value: (o: Row) =>
                o.metrics7d?.stale ? null : o.metrics7d?.paidOrders,
            },
            {
              id: "quality",
              label: "Qualidade",
              width: 110,
              kind: "number" as const,
              value: (o: Row) => o.ml?.health,
            },
            {
              id: "status",
              label: "Situação",
              width: 105,
              value: (o: Row) => labels[o.status],
            },
          ]
        : []),
      {
        id: "margin",
        label: "Margem / limites",
        width: 185,
        kind: "number",
        value: (o: Row) => o.calculation.margin,
      },
      {
        id: "pending",
        label: "Pendências",
        width: 150,
        kind: "number" as const,
        value: (o: Row) => o.pending.length,
      },
      {
        id: "updated",
        label: "Edição local",
        width: 145,
        kind: "date" as const,
        value: (o: Row) => o.updated_at,
      },
      { id: "open", label: "", width: 48, fixed: true },
    ],
    [canWrite, operational],
  );
  const table = useSmartTable<Row>("offers", data.offers, columns, {
    sort: {
      id: sort,
      direction:
        q.get("sortDir") === "asc" || (!q.get("sortDir") && sort === "name")
          ? "asc"
          : "desc",
    },
    onSort: (next) => {
      const params = new URLSearchParams(query);
      params.set("sort", next.id);
      params.set("sortDir", next.direction);
      params.delete("page");
      navigate("anuncios", params);
    },
  });
  const sorted = table.rows;
  const pages = Math.max(1, Math.ceil(sorted.length / size)),
    current = Math.min(page, pages),
    rows = sorted.slice((current - 1) * size, current * size);
  useEffect(() => {
    scrollArea.current?.scrollTo({ top: 0 });
  }, [current, size, sort, q.get("sortDir"), selectionKey]);
  function update(key: string, values: string[]) {
    const p = new URLSearchParams(query);
    p.delete(key);
    for (const v of values) p.append(key, v);
    p.delete("page");
    if (key === "sort") p.delete("sortDir");
    if (
      key === "tableView" &&
      values[0] === "operational" &&
      ["store", "brand", "sku"].includes(p.get("sort") || "")
    ) {
      p.delete("sort");
      p.delete("sortDir");
    }
    if (
      key === "tableView" &&
      values[0] === "registry" &&
      ["conditions", "settlement", "metrics", "quality"].includes(
        p.get("sort") || "",
      )
    ) {
      p.delete("sort");
      p.delete("sortDir");
    }
    navigate("anuncios", p);
  }
  const chips = [...q.entries()].filter(([k]) =>
    [
      "q",
      "brand",
      "category",
      "status",
      "type",
      "pending",
      "listingKind",
    ].includes(k),
  );
  return (
    <ListingInformationProvider>
      <section className="panel offers-panel">
        <div className="filter-toolbar offers-toolbar" ref={toolbar}>
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
          <label className="filter-select">
            <select
              aria-label="Tipo de publicação ML"
              value={q.get("listingKind") || ""}
              onChange={(e) =>
                update("listingKind", e.target.value ? [e.target.value] : [])
              }
            >
              <option value="">Todas as publicações</option>
              <option value="catalog">Catálogo</option>
              <option value="traditional">Tradicionais</option>
              <option value="local">Cadastros locais / referências</option>
            </select>
          </label>
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
              <option value="ml">Tarifa / frete a conferir</option>
              <option value="ownCosts">Custos próprios pendentes</option>
              <option value="ready">Margem calculável</option>
            </select>
          </label>

          <details
            className="listing-counts offers-counts"
            onToggle={(event) => {
              positionListingDropdown(
                event.currentTarget,
                ".offers-counts-popover",
                340,
                400,
              );
            }}
          >
            <summary aria-label="Contagem e filtros ativos dos anúncios">
              <strong>{data.offers.length}</strong>{" "}
              {data.offers.length === 1 ? "anúncio" : "anúncios"}
              {chips.length > 0 && (
                <span className="offers-filter-count" title="Filtros ativos">
                  {chips.length}
                </span>
              )}
              <Info size={13} />
            </summary>
            <div className="offers-counts-popover">
              {counts.mlIds > 0 && (
                <>
                  <div className="offers-counts-stats">
                    <span>
                      <strong>{counts.mlIds}</strong> IDs ML
                    </span>
                    <span>
                      <strong>{counts.titles}</strong>{" "}
                      {counts.titles === 1
                        ? "título distinto"
                        : "títulos distintos"}
                    </span>
                    <span>
                      {counts.catalog} catálogo · {counts.traditional}{" "}
                      tradicionais
                      {counts.local
                        ? ` · ${counts.local} locais/referências`
                        : ""}
                    </span>
                  </div>
                  <p>
                    Um registro por ID do ML. Publicações com títulos iguais
                    podem ter condições diferentes. O painel do ML pode usar
                    outros agrupamentos e filtros; anúncios não são unidos por
                    título.
                  </p>
                </>
              )}
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
                            listingKind: "Publicação",
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
                            ml: "Tarifa / frete a conferir",
                            ownCosts: "Custos próprios pendentes",
                            ready: "Margem calculável",
                            catalog: "Catálogo",
                            traditional: "Tradicionais",
                            local: "Cadastros locais / referências",
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
            </div>
          </details>
          <label className="sort-label">
            <select
              aria-label="Visão da tabela"
              value={operational ? "operational" : "registry"}
              onChange={(e) => update("tableView", [e.target.value])}
            >
              <option value="operational">Operacional ML</option>
              <option value="registry">Cadastro</option>
            </select>
          </label>
          <ListingGlobalPanel
            overview={data.listingOverview}
            store={q.get("store") || "all"}
            canWrite={canWrite}
            canSync={data.user.role === "admin"}
            onChanged={onChanged}
            onPreview={onPreview}
          />
          {eligible.length > 0 && canWrite && (
            <button
              className="button compact offers-refresh"
              aria-label="Consultar indicadores ML"
              title="Consultar tarifas, frete e indicadores ML dos anúncios filtrados ou selecionados"
              disabled={busy}
              onClick={() => onIndicators(eligible.map((o: Row) => o.id))}
            >
              <RefreshCw className={busy ? "spin" : ""} size={15} />
            </button>
          )}
          {selected.length > 0 && (
            <span className="offers-selected orange">
              {selected.length} selecionados
            </span>
          )}
          {selected.length > 0 && canWrite && (
            <button className="button compact" onClick={onBatch}>
              Ações em lote
            </button>
          )}
        </div>
        {rows.length ? (
          <div
            className="table-wrap"
            ref={scrollArea}
            role="region"
            aria-label="Lista de anúncios"
            tabIndex={0}
          >
            <table
              className={
                "offers-table smart-table " + (operational ? "operational" : "")
              }
              {...table.props}
              style={{ ...table.props.style, width: "100%" }}
            >
              {table.header({
                select: (
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
                ),
              })}
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
                    <td className="offer-product-col">
                      <div className="offer-product-cell">
                        <button
                          className="offer-photo-button"
                          aria-label={"Ver fotos e vídeos de " + o.title}
                          onClick={() => onOpen(o.id, "media")}
                        >
                          <MediaImage
                            src={o.ml?.thumbnailUrl}
                            alt={"Foto de " + o.title}
                            className="offer-thumbnail"
                          />
                        </button>
                        <div>
                          <ListingHint
                            content={() =>
                              listingRowInformation(o, "product", onPreview)
                            }
                          >
                            <button
                              className="offer-title"
                              title={o.title}
                              onClick={() => onOpen(o.id)}
                            >
                              {o.title}
                            </button>
                          </ListingHint>
                          <small>
                            {!operational || o.product_name !== o.title
                              ? o.product_name
                              : ""}{" "}
                            {(!operational || o.type !== "unit") && (
                              <span className="type-label">
                                {labels[o.type]}
                              </span>
                            )}
                            {o.origin === "reference" && (
                              <span className="orange">
                                {" "}
                                · Referência: {o.reference_account}
                              </span>
                            )}
                          </small>
                          {o.ml?.catalogListing && <small>Catálogo</small>}
                          <small className="mono offer-ml-code">
                            {o.ml_id || "Sem código ML"}
                            {o.ml_id && <CopyCode value={o.ml_id} />}
                          </small>
                          <ListingHint
                            content={() =>
                              listingRowInformation(o, "stock", onPreview)
                            }
                          >
                            <span
                              className={
                                "listing-stock-value " +
                                (o.ml?.availableQuantity === 0 ? "orange" : "")
                              }
                            >
                              Estoque:{" "}
                              {o.ml?.availableQuantity == null
                                ? "não informado"
                                : `${o.ml.availableQuantity} un.`}
                            </span>
                          </ListingHint>
                          {operational && o.sku && (
                            <small className="mono">SKU {o.sku}</small>
                          )}
                        </div>
                      </div>
                    </td>
                    {!operational && (
                      <>
                        <td>
                          <span className="store-pill">{o.store_name}</span>
                        </td>
                        <td>
                          {o.brand || <span className="muted">Sem marca</span>}
                          <small>{o.category || "Sem categoria"}</small>
                        </td>
                        <td className="mono">{o.sku || "—"}</td>
                        <td>
                          <Badge value={o.status} />
                        </td>
                      </>
                    )}
                    <td className="numeric mono">
                      <ListingHint
                        content={() =>
                          listingRowInformation(o, "price", onPreview)
                        }
                      >
                        <span>{money(o.price)}</span>
                      </ListingHint>
                    </td>
                    {operational && (
                      <>
                        <td>
                          <span>{listingType(o.ml?.listingTypeId)}</span>
                          <ListingHint
                            content={() =>
                              listingRowInformation(o, "tariff", onPreview)
                            }
                          >
                            <button
                              className={
                                "listing-cost-link " +
                                (o.financialStatus?.tariff ? "" : "orange")
                              }
                              onClick={() => onPreview(o.id, "costs")}
                              title={
                                o.financialStatus?.tariff
                                  ? `Tarifa usada na estimativa. ${o.financialStatus.tariff.percent ?? "—"}% + ${money(o.financialStatus.tariff.fixed)}. Abra para conferir as fontes e editar custos.`
                                  : "Consulte os indicadores ML ou informe uma exceção manual nos custos."
                              }
                            >
                              {o.financialStatus?.tariff
                                ? `Tarifa: ${money(o.financialStatus.tariff.amount)}`
                                : "Tarifa a consultar"}
                              <span
                                className={
                                  "listing-source " +
                                  (o.financialStatus?.tariff?.source === "ml"
                                    ? "green"
                                    : "muted")
                                }
                              >
                                {o.financialStatus?.tariff?.source === "ml"
                                  ? "ML"
                                  : o.financialStatus?.tariff?.source ===
                                      "manual"
                                    ? "Manual"
                                    : o.financialStatus?.tariff
                                      ? "ML + manual"
                                      : ""}
                              </span>
                            </button>
                          </ListingHint>
                          <small>
                            {o.ml?.freeShipping == null
                              ? "Frete não consultado"
                              : o.ml.freeShipping
                                ? "Oferece frete grátis"
                                : "Frete por conta do comprador"}
                          </small>
                        </td>
                        <td className="numeric">
                          <ListingHint
                            content={() =>
                              listingRowInformation(o, "settlement", onPreview)
                            }
                          >
                            <span title="Estimativa após tarifa e frete consultado ou informado, antes de impostos, custos e ajustes da venda.">
                              {o.settlementEstimate
                                ? money(o.settlementEstimate.amount)
                                : "—"}
                            </span>
                          </ListingHint>
                          <ListingHint
                            content={() =>
                              listingRowInformation(o, "shipping", onPreview)
                            }
                          >
                            <button
                              className={
                                "listing-cost-link " +
                                (o.financialStatus?.shipping ? "" : "orange")
                              }
                              onClick={() => onPreview(o.id, "costs")}
                              title="Custo do frete para a loja. A cotação ML é estimada; o custo efetivo depende do envio. Frete pago pelo comprador não comprova custo zero para o vendedor."
                            >
                              {o.financialStatus?.shipping
                                ? `Frete: ${money(o.financialStatus.shipping.amount)}`
                                : "Conferir frete da loja"}
                              {o.financialStatus?.shipping && (
                                <span
                                  className={
                                    "listing-source " +
                                    (o.financialStatus.shipping.source === "ml"
                                      ? "green"
                                      : "muted")
                                  }
                                >
                                  {o.financialStatus.shipping.source === "ml"
                                    ? "ML · estim."
                                    : "Manual"}
                                </span>
                              )}
                            </button>
                          </ListingHint>
                          <small>
                            {o.settlementEstimate
                              ? "Antes dos custos próprios"
                              : o.financialStatus?.tariff
                                ? "Tarifa disponível"
                                : "Estimativa incompleta"}
                          </small>
                        </td>
                        <td>
                          {o.metrics7d?.stale ? (
                            <>
                              <ListingHint
                                content={() =>
                                  listingRowInformation(o, "metrics", onPreview)
                                }
                              >
                                <span className="small orange">
                                  Métricas a atualizar
                                </span>
                              </ListingHint>
                              <small>
                                {o.metrics7d.observedAt
                                  ? `Consulta: ${date(o.metrics7d.observedAt)}`
                                  : "Data da consulta indisponível"}
                              </small>
                            </>
                          ) : o.metrics7d ? (
                            <>
                              <ListingHint
                                content={() =>
                                  listingRowInformation(o, "metrics", onPreview)
                                }
                              >
                                <div
                                  className="listing-metrics"
                                  title={`${date(o.metrics7d.from)} a ${date(o.metrics7d.to)}`}
                                >
                                  <span
                                    aria-label={o.metrics7d.visits + " visitas"}
                                  >
                                    <Eye size={13} />
                                    {o.metrics7d.visits}
                                  </span>
                                  <span
                                    aria-label={
                                      o.metrics7d.paidOrders + " pedidos pagos"
                                    }
                                  >
                                    <ShoppingCart size={13} />
                                    {o.metrics7d.paidOrders}
                                  </span>
                                </div>
                              </ListingHint>
                              <small>
                                {o.metrics7d.orderVisitRate == null
                                  ? "Conversão indisponível"
                                  : `${o.metrics7d.orderVisitRate}% pedidos/visitas`}
                              </small>
                              <small className="muted">
                                Consulta: {date(o.metrics7d.observedAt)}
                              </small>
                            </>
                          ) : (
                            <span className="small muted">Não consultado</span>
                          )}
                        </td>
                        <td>
                          {o.ml?.health == null ? (
                            <span className="small muted">ML não informou</span>
                          ) : (
                            <span className="quality-score">
                              {Math.round(o.ml.health * 100)} / 100
                            </span>
                          )}
                          <ListingHint
                            content={() =>
                              listingRowInformation(o, "quality", onPreview)
                            }
                          >
                            <small title="Checklist próprio de campos e mídia; não representa experiência de compra ou ranking oficial.">
                              {o.quality?.length
                                ? `${o.quality.length} melhorias no checklist`
                                : "Checklist sem pendências"}
                            </small>
                          </ListingHint>
                        </td>
                        <td>
                          <Badge value={o.status} />
                          {o.ml?.subStatus?.includes("paused_by_seller") && (
                            <small>Pausado pelo vendedor</small>
                          )}
                        </td>
                      </>
                    )}

                    <td>
                      <ListingHint
                        content={() =>
                          listingRowInformation(o, "margin", onPreview)
                        }
                      >
                        <button
                          className="listing-margin-value"
                          onClick={() => onPreview(o.id, "costs")}
                        >
                          {o.financialStatus?.ready ? (
                            <>
                              <strong>
                                {money(o.calculation.margin)}{" "}
                                <span
                                  className={
                                    Number(o.calculation.margin) < 0
                                      ? "orange"
                                      : "green"
                                  }
                                >
                                  {percent(o.calculation.marginPercent, 1)}
                                </span>
                              </strong>
                              <small>
                                Piso{" "}
                                <b>
                                  {o.calculation.minPrice == null
                                    ? "A definir"
                                    : money(o.calculation.minPrice)}
                                </b>
                              </small>
                              <small>
                                Desc. máx.{" "}
                                <b>
                                  {o.calculation.maxDiscount == null
                                    ? o.calculation.minPrice != null &&
                                      Number(o.calculation.minPrice) >
                                        Number(o.price)
                                      ? "Sem desconto"
                                      : "A definir"
                                    : listingDiscountLimit(
                                        o.calculation.maxDiscount,
                                      )}
                                </b>
                              </small>
                            </>
                          ) : (
                            <>
                              <span>Custos pendentes</span>
                              <small>Complete para calcular</small>
                            </>
                          )}
                        </button>
                      </ListingHint>
                    </td>
                    <td>
                      {o.financialStatus?.ownPending.length > 0 && (
                        <ListingHint
                          content={() =>
                            listingRowInformation(o, "pending", onPreview)
                          }
                        >
                          <button
                            className="listing-cost-link orange"
                            title={o.financialStatus.ownPending.join(", ")}
                            onClick={() => onPreview(o.id, "costs")}
                          >
                            {o.financialStatus.ownPending.length}{" "}
                            {o.financialStatus.ownPending.length === 1
                              ? "custo próprio pendente"
                              : "custos próprios pendentes"}
                          </button>
                        </ListingHint>
                      )}
                      {o.pending.length ? (
                        <ListingHint
                          content={() =>
                            listingRowInformation(o, "pending", onPreview)
                          }
                        >
                          <button
                            className="pending-count"
                            title={o.pending.join(", ")}
                            onClick={() => onOpen(o.id)}
                          >
                            <AlertCircle size={12} />
                            {o.pending.length} pendentes
                          </button>
                        </ListingHint>
                      ) : (
                        <span className="green small">
                          <Check size={13} />
                          Completo
                        </span>
                      )}
                    </td>
                    <td>
                      <ListingHint
                        content={() =>
                          listingRowInformation(o, "updated", onPreview)
                        }
                      >
                        <span>{date(o.updated_at)}</span>
                      </ListingHint>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={"Prévia de " + o.title}
                        title="Abrir prévia lateral"
                        onClick={() => onPreview(o.id)}
                      >
                        <Eye size={15} />
                      </button>
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
    </ListingInformationProvider>
  );
}
// Fixed menus escape the bounded table layout and fit above or below their trigger.
function positionListingDropdown(
  details: HTMLDetailsElement,
  selector: string,
  preferredWidth = 260,
  preferredHeight = 260,
) {
  if (!details.open) return;
  const popup = details.querySelector<HTMLElement>(selector);
  const anchor = details.querySelector("summary");
  if (!popup || !anchor) return;
  const bounds = anchor.getBoundingClientRect();
  const width = Math.min(preferredWidth, window.innerWidth - 16);
  const minimumTop =
    (document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0) +
    8;
  Object.assign(popup.style, {
    position: "fixed",
    width: `${width}px`,
    minWidth: "0",
    right: "auto",
    transform: "none",
    maxHeight: `${preferredHeight}px`,
  });
  const desiredHeight = Math.min(popup.scrollHeight + 2, preferredHeight);
  const below = Math.max(0, window.innerHeight - bounds.bottom - 14);
  const above = Math.max(0, bounds.top - minimumTop - 6);
  const upwards = desiredHeight > below && above > below;
  const height = Math.min(desiredHeight, upwards ? above : below);
  popup.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`;
  popup.style.top = `${upwards ? bounds.top - height - 6 : bounds.bottom + 6}px`;
  popup.style.maxHeight = `${height}px`;
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
    <details
      className="multi-filter"
      onToggle={(event) => {
        positionListingDropdown(event.currentTarget, ":scope > div");
      }}
    >
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
                  ![
                    "applied_manual",
                    "applied_ml",
                    "rejected",
                    "cancelled",
                  ].includes(p.status) && (
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
          ) : error ? (
            <Empty
              title="Custos indisponíveis"
              body="Selecione novamente a oferta para tentar."
            />
          ) : (
            <Skeleton variant="pricing" label="Carregando custos da oferta" />
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
        "goal.monthly": "Meta mensal de faturamento",
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
  onApplyML,
}: {
  proposal: Row;
  data: Row;
  busy: boolean;
  onDirty: () => void;
  onSave: (p: Row) => void;
  onApplyML: () => void;
}) {
  const confirm = useConfirm();
  const allowed = ["admin", "approver"].includes(data.user.role);
  const canCancel = allowed || proposal.author_id === data.user.id;
  const canStage = !["application_uncertain", "applying_ml"].includes(
    proposal.status,
  );
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
      {canStage && (
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
      )}
      {proposal.status === "review" && !allowed && (
        <div className="alert">
          Seu perfil prepara propostas; a aprovação exige administrador ou
          aprovador.
        </div>
      )}
      {canStage && action === "apply_manual" && (
        <div className="alert">
          Confirme somente após executar e conferir a mudança no ML/Bling. O
          registro ficará identificado como <strong>confirmação manual</strong>.
        </div>
      )}
      {allowed &&
        [
          "approved",
          "pending_application",
          "application_uncertain",
          "applying_ml",
        ].includes(proposal.status) &&
        data.connections.some(
          (c: Row) =>
            c.store_id === proposal.store_id &&
            c.provider === "mercadolivre" &&
            c.status === "connected",
        ) && (
          <div className="ml-application-action">
            <p className="small muted">
              Aplicação por API para preço de anúncio individual, sem catálogo,
              variações, promoção ou mudança de conteúdo. Tarifa e preço atual
              serão conferidos novamente.
            </p>
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  ["application_uncertain", "applying_ml"].includes(
                    proposal.status,
                  ) ||
                  (await confirm({
                    title: "Aplicar preço no ML?",
                    description: `O preço será alterado para ${money(proposal.snapshot.proposed.price)} no Mercado Livre.`,
                    confirmLabel: "Aplicar preço",
                  }))
                )
                  onApplyML();
              }}
            >
              {["application_uncertain", "applying_ml"].includes(
                proposal.status,
              )
                ? "Conferir aplicação no ML"
                : "Aplicar preço no ML"}
            </button>
          </div>
        )}
      {canStage && (
        <>
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
                (proposal.status === "review" &&
                  !allowed &&
                  action !== "cancel")
              }
              label="Registrar etapa"
            />
          </div>
        </>
      )}
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
  onApplication,
  authorizingId,
  onCancelAuthorization,
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
  onApplication: (c: Row) => void;
  authorizingId?: string | null;
  onCancelAuthorization?: () => void;
  busy: boolean;
  query: string;
}) {
  const ownershipRows = [
    [
      "Produto, SKU e estoque",
      "Bling",
      "Bling → ML → aplicação. Sem escrita de estoque neste sistema.",
    ],
    [
      "Preço e regra comercial",
      "Cliente · aplicação pelo Bling/ML",
      "Proposta aprovada → confirmação → aplicação de preço elegível por API → conferência. Demais cenários permanecem manuais.",
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
    ["Análises aprofundadas", "Power BI", "Exportação da base → Power BI."],
  ];
  const ownership = useSmartTable("fieldOwnership", ownershipRows, [
    { id: "field", label: "Campo", width: 260, value: (r) => r[0] },
    {
      id: "owner",
      label: "Sistema responsável",
      width: 270,
      value: (r) => r[1],
    },
    { id: "rule", label: "Direção / regra", width: 460, value: (r) => r[2] },
  ]);
  const isAdmin = data.user.role === "admin";
  return (
    <>
      <div className="tabs">
        {[
          ["stores", "Lojas e parâmetros"],
          ["integrations", "Integrações"],
          ["sync", "Sincronização e dados"],
          ["extension", "Extensão"],
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
      {selected === "extension" && isAdmin && <ExtensionSettings data={data} />}
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
          <p className="small muted integration-intro">
            Conecte a loja e consulte o catálogo. Ative{" "}
            <strong>leitura, escrita e offline_access</strong> no aplicativo ML:
            o refresh token é fornecido automaticamente ao autorizar, sem
            precisar copiá-lo.
          </p>
          <div className="integration-grid">
            {data.connections.map((c: Row) => (
              <section
                className={
                  "panel integration-card " +
                  (c.status === "connected" ? "is-connected" : "")
                }
                key={c.id}
              >
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
                      : "Integração ainda não configurada."}
                </p>
                <p className="small muted">
                  {c.provider === "mercadolivre"
                    ? c.configured
                      ? c.status === "connected"
                        ? "Anúncios, tarifas e desempenho vinculados a esta loja."
                        : "Autorize a conta no Mercado Livre para consultar anúncios, tarifas e desempenho."
                      : "Cadastre o ID e a chave da aplicação pelo botão abaixo."
                    : c.provider === "bling"
                      ? "A conexão de produtos e estoque com o Bling está em desenvolvimento."
                      : "Sugestões com IA estão em desenvolvimento."}
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
                  <div className="integration-actions">
                    <div className="integration-primary-actions">
                      {c.status === "connected" && (
                        <button
                          className="button primary"
                          disabled={busy || !c.configured}
                          onClick={() => onSync(c)}
                        >
                          {busy && authorizingId !== c.id ? (
                            <LoaderCircle className="spin" size={15} />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                          {c.has_more
                            ? "Continuar importação · 20 anúncios"
                            : "Sincronizar anúncios"}
                        </button>
                      )}
                      <button
                        className={
                          "button " +
                          (c.status === "connected" ? "" : "primary")
                        }
                        disabled={busy || !c.configured}
                        onClick={() => onAuthorize(c)}
                      >
                        {authorizingId === c.id && (
                          <LoaderCircle className="spin" size={15} />
                        )}
                        {authorizingId === c.id
                          ? "Aguardando autorização…"
                          : c.external_account
                            ? "Renovar autorização"
                            : "Conectar conta ML"}
                      </button>
                      {authorizingId === c.id && (
                        <button
                          className="button"
                          onClick={onCancelAuthorization}
                        >
                          Cancelar autorização
                        </button>
                      )}
                    </div>
                    <div className="integration-secondary-actions">
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() => onApplication(c)}
                      >
                        {c.application_source === "store"
                          ? "Editar credenciais"
                          : "Configurar integração"}
                      </button>
                      {c.has_more && (
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => onSync({ ...c, restart: true })}
                        >
                          Recomeçar consulta do catálogo
                        </button>
                      )}
                      {c.external_account && (
                        <button
                          className="text-link danger-text"
                          disabled={busy}
                          onClick={() => onDisconnect(c)}
                        >
                          Desconectar
                        </button>
                      )}
                    </div>
                    {authorizingId === c.id && (
                      <p className="small muted">
                        Conclua a autorização na janela do Mercado Livre. Esta
                        tela continua aberta e mantém seus filtros.
                      </p>
                    )}
                  </div>
                )}
                {isAdmin && c.provider !== "mercadolivre" && (
                  <button
                    className="button compact"
                    disabled={busy}
                    onClick={() => onSync(c)}
                  >
                    {busy && <LoaderCircle className="spin" size={15} />}
                    Verificar disponibilidade
                  </button>
                )}
              </section>
            ))}
          </div>
          <GoogleDriveSettings
            stores={data.stores}
            query={query}
            isAdmin={isAdmin}
          />
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
              <table className="smart-table" {...ownership.props}>
                {ownership.header()}
                <tbody>
                  {ownership.rows.map(([field, owner, rule]) => (
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
              A sincronização consulta dados por loja. Ativar, pausar e aplicar
              preços enviam alterações ao ML após confirmação do operador.
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
