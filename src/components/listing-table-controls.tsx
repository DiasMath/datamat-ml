"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Bookmark, Check, Columns3, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal, Field, Submit, jsonRequest } from "./ui";
import { useToast } from "./toasts";
import { useConfirm } from "./confirmation";
import { positionListingDropdown } from "./listing-dropdown";
import {
  listingViewSignature,
  optionalListingColumns,
  type ListingView,
  type ListingViewConfig,
  type ListingColumnId,
} from "../domain/listing-views";
import type { TableColumn } from "./smart-table";
const sorted = (views: ListingView[]) =>
  [...views].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
export default function ListingTableControls({
  store,
  canWrite,
  columns,
  config,
  onHidden,
  onApply,
}: {
  store: string;
  canWrite: boolean;
  columns: TableColumn<Record<string, any>>[];
  config: ListingViewConfig;
  onHidden: (ids: string[]) => void;
  onApply: (config: ListingViewConfig) => void;
}) {
  const { notify } = useToast();
  const confirm = useConfirm();
  const [views, setViews] = useState<ListingView[]>([]);
  const [loading, setLoading] = useState(store !== "all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    view?: ListingView;
    config: ListingViewConfig;
    name: string;
  } | null>(null);
  const viewsMenu = useRef<HTMLDetailsElement>(null);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (store === "all") return;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const data = await jsonRequest<{ views: ListingView[] }>(
        "/api/listing-views?" + new URLSearchParams({ store }),
        undefined,
        "GET",
        controller.signal,
        "background",
        20000,
      );
      if (!controller.signal.aborted) setViews(data.views);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [store]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      readRequest.current?.abort();
      writeRequest.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (viewsMenu.current)
      positionListingDropdown(
        viewsMenu.current,
        ".listing-preferences-popover",
        320,
        420,
      );
  }, [views.length, loading, error]);
  const active = views.find(
    (view) =>
      listingViewSignature(view.config) === listingViewSignature(config),
  );
  const available = columns.filter((c) =>
    optionalListingColumns.includes(c.id as ListingColumnId),
  );
  const hiddenCount = available.filter((c) =>
    config.hiddenColumns.includes(c.id as ListingColumnId),
  ).length;
  function closeMenu() {
    if (viewsMenu.current) viewsMenu.current.open = false;
  }
  function openEditor(view?: ListingView, current = false) {
    closeMenu();
    setEditor({
      view,
      config: current || !view ? config : view.config,
      name: view?.name || "",
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    const controller = new AbortController();
    writeRequest.current = controller;
    setBusy(true);
    try {
      const row = await jsonRequest<ListingView>(
        "/api/listing-views" + (editor.view ? "/" + editor.view.id : ""),
        {
          storeId: store,
          name: editor.name,
          config: editor.config,
          version: editor.view?.version || 0,
        },
        editor.view ? "PUT" : "POST",
        controller.signal,
        "foreground",
        20000,
      );
      if (controller.signal.aborted) return;
      setViews((previous) =>
        sorted([...previous.filter((v) => v.id !== row.id), row]),
      );
      setEditor(null);
      notify(
        editor.view ? "Visão atualizada." : "Visão salva para esta loja.",
        "success",
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        notify((e as Error).message, "error");
        void load();
      }
    } finally {
      if (!controller.signal.aborted) {
        writeRequest.current = null;
        setBusy(false);
      }
    }
  }
  async function remove(view: ListingView) {
    if (
      busy ||
      !(await confirm({
        title: "Excluir visão salva?",
        description: `Excluir a visão “${view.name}”? Você poderá salvar uma nova visão quando quiser.`,
        confirmLabel: "Excluir visão",
        danger: true,
      })) ||
      !alive.current
    )
      return;
    const controller = new AbortController();
    writeRequest.current = controller;
    setBusy(true);
    try {
      await jsonRequest(
        "/api/listing-views/" + view.id,
        { storeId: store, version: view.version },
        "DELETE",
        controller.signal,
        "foreground",
        20000,
      );
      if (!controller.signal.aborted) {
        setViews((previous) => previous.filter((v) => v.id !== view.id));
        notify("Visão excluída.", "success");
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        notify((e as Error).message, "error");
        void load();
      }
    } finally {
      if (!controller.signal.aborted) {
        writeRequest.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="listing-table-controls">
      <details
        ref={viewsMenu}
        className="listing-preferences"
        onToggle={(e) =>
          positionListingDropdown(
            e.currentTarget,
            ".listing-preferences-popover",
            320,
            420,
          )
        }
      >
        <summary
          aria-label="Visões salvas"
          className={active ? "has-active-view" : ""}
        >
          <Bookmark size={15} />
          <span>{active?.name || "Visões"}</span>
        </summary>
        <div
          className="listing-preferences-popover"
          aria-label="Visões salvas da loja"
        >
          <div className="listing-preferences-heading">
            <strong>Visões desta loja</strong>
            <small>Busca, filtros, ordem e colunas</small>
          </div>
          {store === "all" ? (
            <p className="small muted">
              Selecione uma loja para salvar ou abrir suas visões.
            </p>
          ) : (
            <>
              {loading ? (
                <div
                  aria-label="Carregando visões"
                  aria-busy="true"
                  className="listing-views-skeleton"
                >
                  <span className="skeleton-bone" />
                  <span className="skeleton-bone" />
                </div>
              ) : error ? (
                <div>
                  <p className="small orange">{error}</p>
                  <button
                    className="text-link small"
                    onClick={() => void load()}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : (
                <>
                  {!views.length && (
                    <p className="small muted">
                      Salve uma configuração para voltar a ela rapidamente.
                    </p>
                  )}
                  <div className="listing-views-list">
                    {views.map((view) => (
                      <div className="listing-view-row" key={view.id}>
                        <button
                          className="listing-view-apply"
                          aria-label={"Aplicar visão " + view.name}
                          aria-pressed={active?.id === view.id}
                          onClick={() => {
                            closeMenu();
                            onApply(view.config);
                          }}
                        >
                          <span>{view.name}</span>
                          {active?.id === view.id && <Check size={14} />}
                        </button>
                        {canWrite && (
                          <>
                            <button
                              className="icon-button"
                              aria-label={"Renomear visão " + view.name}
                              disabled={busy}
                              onClick={() => openEditor(view)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={"Excluir visão " + view.name}
                              disabled={busy}
                              onClick={() => void remove(view)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {canWrite && (
                <div className="listing-view-actions">
                  <button
                    className="button compact"
                    disabled={busy || loading || !!error}
                    onClick={() => openEditor()}
                  >
                    <Plus size={14} />
                    Salvar nova visão
                  </button>
                  {views.length > 0 && (
                    <label className="listing-view-replace">
                      <span>Atualizar uma visão com a configuração atual</span>
                      <select
                        aria-label="Atualizar visão salva"
                        value=""
                        disabled={busy || loading || !!error}
                        onChange={(e) => {
                          const view = views.find(
                            (v) => v.id === e.target.value,
                          );
                          if (view) openEditor(view, true);
                        }}
                      >
                        <option value="">Escolher visão…</option>
                        {views.map((v) => (
                          <option value={v.id} key={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </details>
      <details
        className="listing-preferences"
        onToggle={(e) =>
          positionListingDropdown(
            e.currentTarget,
            ".listing-preferences-popover",
            280,
            460,
          )
        }
      >
        <summary aria-label="Colunas visíveis">
          <Columns3 size={15} />
          {hiddenCount > 0 && (
            <span className="offers-filter-count">{hiddenCount}</span>
          )}
        </summary>
        <div
          className="listing-preferences-popover"
          aria-label="Escolher colunas"
        >
          <div className="listing-preferences-heading">
            <strong>Colunas visíveis</strong>
            <small>
              {config.filters.tableView === "operational"
                ? "Operacional ML"
                : "Cadastro"}{" "}
              · preferência deste navegador
            </small>
          </div>
          <label className="listing-column-choice">
            <input type="checkbox" checked disabled />
            <span>Anúncio / produto</span>
            <small>Fixo</small>
          </label>
          {available.map((column) => (
            <label key={column.id} className="listing-column-choice">
              <input
                type="checkbox"
                checked={
                  !config.hiddenColumns.includes(column.id as ListingColumnId)
                }
                onChange={(e) =>
                  onHidden(
                    e.target.checked
                      ? config.hiddenColumns.filter((id) => id !== column.id)
                      : [...config.hiddenColumns, column.id],
                  )
                }
              />
              <span>{column.label}</span>
            </label>
          ))}
          <button
            className="text-link small"
            disabled={!hiddenCount}
            onClick={() => onHidden([])}
          >
            Mostrar todas as colunas
          </button>
        </div>
      </details>
      {editor && (
        <Modal
          title={editor.view ? "Editar visão salva" : "Salvar visão"}
          subtitle="Disponível nesta loja em qualquer navegador."
          busy={busy}
          onClose={() => setEditor(null)}
        >
          <form onSubmit={save} className="listing-view-form">
            <Field label="Nome da visão">
              <input
                autoFocus
                value={editor.name}
                maxLength={60}
                required
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                placeholder="Ex.: Revisar preços"
              />
            </Field>
            <p className="small muted">
              {editor.view && editor.config === editor.view.config
                ? "Altera o nome e mantém a configuração salva."
                : "Salva a busca, os filtros, a ordenação, a quantidade por página e as colunas desta configuração."}
            </p>
            <div className="form-actions">
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() =>
                  document
                    .querySelector<HTMLDialogElement>("dialog.modal[open]")
                    ?.requestClose()
                }
              >
                Cancelar
              </button>
              <Submit
                busy={busy}
                label={editor.view ? "Salvar alterações" : "Salvar visão"}
              />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
