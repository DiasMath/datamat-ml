"use client";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  X,
  ArrowUpRight,
  Calculator,
  Images,
  LayoutDashboard,
  RefreshCw,
  LoaderCircle,
} from "lucide-react";
import { useConfirm, discardChanges, useUnsavedChanges } from "./confirmation";
import { Badge, money, percent, jsonRequest } from "./ui";
import { MediaImage } from "./listing-media";
import ListingMedia from "./listing-media";
import FinancialEditor from "./financial-editor";
import Skeleton from "./skeleton";
import { useToast } from "./toasts";
import useDialogDismiss from "./use-dialog-dismiss";
type Row = Record<string, any>;
export default function OfferPreview({
  id,
  initialTab,
  canEdit,
  onClose,
  onView,
  onChanged,
  onNext,
}: {
  id: string;
  initialTab?: string;
  canEdit: boolean;
  onClose: () => void;
  onView: (id: string, tab: string) => void;
  onChanged: () => void;
  onNext?: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  const [detail, setDetail] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [tab, setTab] = useState(
      initialTab === "costs"
        ? "costs"
        : initialTab === "media"
          ? "media"
          : "overview",
    );
  const confirm = useConfirm(),
    { notify, setHost } = useToast();
  useUnsavedChanges(dirty, () => {
    setDirty(false);
    onClose();
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    jsonRequest("/api/offers/" + id, undefined, "GET", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [id, revision]);
  async function leave(action: () => void) {
    if (busy) return;
    if (dirty && !(await confirm(discardChanges))) return;
    flushSync(() => setDirty(false));
    dialog.current?.close();
    action();
  }
  const dismiss = useDialogDismiss(() => void leave(onClose));
  async function changeTab(next: string) {
    if (busy) return false;
    if (next === tab) return true;
    if (dirty && !(await confirm(discardChanges))) return false;
    setDirty(false);
    setTab(next);
    return true;
  }
  async function save(
    url: string,
    body: Row,
    message: string,
    advance = false,
  ) {
    if (busy || loading || !detail) return false;
    setBusy(true);
    let persisted = false;
    try {
      await jsonRequest(url, body);
      persisted = true;
      flushSync(() => setDirty(false));
      notify(message);
      onChanged();
      if (advance && onNext) await onNext();
      else setRevision((n) => n + 1);
      return true;
    } catch (e) {
      if (persisted) setRevision((n) => n + 1);
      notify((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="offer-preview"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        void leave(onClose);
      }}
      {...dismiss}
    >
      <header className="preview-header">
        <div>
          <span className="eyebrow">PRÉVIA DO ANÚNCIO</span>
          <h2 id={titleId}>{detail?.offer.title || "Carregando anúncio"}</h2>
          {detail && (
            <p>
              {detail.offer.store_name} ·{" "}
              {detail.offer.sku || detail.offer.ml_id || "Sem código"}
            </p>
          )}
        </div>
        <button
          className="icon-button"
          autoFocus
          aria-label="Fechar prévia"
          disabled={busy}
          onClick={() => void leave(onClose)}
        >
          <X size={20} />
        </button>
      </header>
      <div className="preview-tabs" role="tablist" aria-label="Áreas da prévia">
        {(
          [
            ["overview", "Resumo", LayoutDashboard],
            ["media", "Fotos e vídeos", Images],
            ["costs", "Simular preço", Calculator],
          ] as const
        ).map(([value, name, Icon], index, all) => (
          <button
            key={value}
            data-preview-tab={value}
            role="tab"
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            className={tab === value ? "selected" : ""}
            onClick={() => void changeTab(value)}
            onKeyDown={(e) => {
              if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : (index + (e.key === "ArrowRight" ? 1 : 2)) % 3;
              void changeTab(all[next][0]).then((accepted) => {
                if (accepted)
                  requestAnimationFrame(() =>
                    dialog.current
                      ?.querySelector<HTMLButtonElement>(
                        `[data-preview-tab="${all[next][0]}"]`,
                      )
                      ?.focus(),
                  );
              });
            }}
          >
            <Icon size={15} aria-hidden="true" />
            {name}
          </button>
        ))}
      </div>
      <div className="preview-body" aria-busy={loading || busy}>
        {loading && !detail ? (
          <Skeleton variant="detail" label="Carregando prévia" />
        ) : error ? (
          <div className="preview-error">
            <p>{error}</p>
            <button
              className="button"
              onClick={() => setRevision((n) => n + 1)}
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          detail && (
            <>
              {tab === "overview" && (
                <>
                  <section className="preview-overview">
                    <MediaImage
                      src={detail.offer.ml?.pictures?.[0]?.url}
                      alt={detail.offer.title}
                      eager
                    />
                    <div>
                      <Badge value={detail.offer.status} />
                      <h3>{money(detail.offer.price)}</h3>
                      <p>{detail.offer.ml_id || "Cadastro local"}</p>
                      <p>
                        {detail.offer.ml
                          ? `Estoque na última consulta: ${detail.offer.ml.availableQuantity ?? "não informado"}`
                          : "Estoque ainda não consultado no ML."}
                      </p>
                    </div>
                  </section>
                  <section className="panel preview-finance">
                    <h3>Com os custos cadastrados</h3>
                    <div className="preview-finance-grid">
                      <div>
                        <span>Contribuição estimada</span>
                        <strong>{money(detail.calculation.margin)}</strong>
                      </div>
                      <div>
                        <span>Margem estimada</span>
                        <strong>
                          {percent(detail.calculation.saleMarginPercent)}
                        </strong>
                      </div>
                      <div>
                        <span>Preço mínimo</span>
                        <strong>
                          {money(detail.calculation.policyMinPrice)}
                        </strong>
                      </div>
                    </div>
                    {detail.calculation.pending.length > 0 && (
                      <p className="preview-pending">
                        Preencher: {detail.calculation.pending.join(" · ")}.
                      </p>
                    )}
                    <button
                      className="text-link"
                      onClick={() => void changeTab("costs")}
                    >
                      Conferir custos e simular
                      <ArrowUpRight size={13} />
                    </button>
                  </section>
                  <section className="panel">
                    <h3>Conteúdo</h3>
                    <p className="preview-description">
                      {detail.offer.description ||
                        "Descrição ainda não informada."}
                    </p>
                  </section>
                </>
              )}
              {tab === "media" && (
                <ListingMedia
                  detail={detail}
                  canWrite={false}
                  busy={busy}
                  onWorking={setBusy}
                  onChanged={() => setRevision((n) => n + 1)}
                  onRefresh={() => setRevision((n) => n + 1)}
                />
              )}
              {tab === "costs" &&
                (canEdit ? (
                  <FinancialEditor
                    key={
                      detail.offer.id +
                      ":" +
                      detail.offer.version +
                      ":" +
                      detail.parametersRevision
                    }
                    detail={detail}
                    busy={busy || loading}
                    onDirty={() => setDirty(true)}
                    onSaveCosts={(p) =>
                      void save(
                        `/api/offers/${id}/costs`,
                        { ...p, offerVersion: detail.offer.version },
                        "Custos salvos; histórico preservado.",
                      )
                    }
                    onSaveCostsAndNext={
                      onNext
                        ? (p) =>
                            void save(
                              `/api/offers/${id}/costs`,
                              { ...p, offerVersion: detail.offer.version },
                              "Custos salvos.",
                              true,
                            )
                        : undefined
                    }
                    onProposalAndNext={
                      onNext
                        ? (p) =>
                            save(
                              "/api/proposals",
                              p,
                              "Proposta salva para revisão. O preço atual foi preservado.",
                              true,
                            )
                        : undefined
                    }
                    onProposal={(p) =>
                      save(
                        "/api/proposals",
                        p,
                        "Proposta salva para revisão. O preço atual foi preservado.",
                      )
                    }
                  />
                ) : (
                  <section className="panel">
                    <h3>Custos e estimativa</h3>
                    <p>
                      {canEdit === false
                        ? "Para editar ou simular, conclua a edição em andamento ou use uma conta com permissão de edição."
                        : ""}
                    </p>
                    <p>
                      Contribuição estimada: {money(detail.calculation.margin)}
                    </p>
                    <p>{detail.calculation.pending.join(" · ")}</p>
                  </section>
                ))}
            </>
          )
        )}
      </div>
      <footer className="preview-footer">
        <button
          className="button"
          disabled={busy || dirty || loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          {loading ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Conferir cadastro
        </button>
        {onNext && (
          <span className="preview-sequence-label">
            Revisão em sequência · mesma loja
          </span>
        )}
        <button
          className="button primary"
          disabled={busy || !detail}
          onClick={() => void leave(() => onView(id, tab))}
        >
          Abrir ficha completa
          <ArrowUpRight size={14} />
        </button>
      </footer>
      <div ref={setHost} className="toast-dialog-host" />
    </dialog>
  );
}
