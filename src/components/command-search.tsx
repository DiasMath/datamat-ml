"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X, LoaderCircle, ChevronRight, RefreshCw } from "lucide-react";
import { quickSearch } from "../domain/quick-search";
import { jsonRequest, money, labels } from "./ui";
import { MediaImage } from "./listing-media";
import useDialogDismiss from "./use-dialog-dismiss";
type Row = Record<string, any>;
export default function CommandSearch({
  open,
  store,
  revision,
  onClose,
  onSelect,
}: {
  open: boolean;
  store: string;
  revision: number;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    listId = useId();
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0),
    [data, setData] = useState<Row | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const dismiss = useDialogDismiss(onClose);
  const cache = useRef<{ key: string; at: number; data: Row } | null>(null);
  const rows = useMemo(
    () => quickSearch(data?.offers || [], query),
    [data, query],
  ) as Row[];
  const active = Math.min(index, Math.max(0, rows.length - 1));
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => input.current?.focus());
    } else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const key = `${store}:${revision}:${retry}`;
    setError("");
    if (cache.current?.key === key && Date.now() - cache.current.at < 60000) {
      setData(cache.current.data);
      setLoading(false);
      return;
    }
    setData(null);
    setLoading(true);
    jsonRequest(
      "/api/search?" + new URLSearchParams({ store }),
      undefined,
      "GET",
      controller.signal,
      "background",
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          cache.current = { key, at: Date.now(), data: result };
          setData(result);
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
  }, [open, store, revision, retry]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);
  return (
    <dialog
      ref={dialog}
      className="command-search"
      {...dismiss}
      aria-label="Busca rápida de anúncios"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="command-search-input">
        <Search size={20} aria-hidden="true" />
        <input
          ref={input}
          autoFocus
          aria-label="Buscar por título, SKU ou código ML"
          placeholder="Título, SKU ou código ML…"
          value={query}
          maxLength={200}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            rows.length ? `${listId}-${active}` : undefined
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((n) =>
                rows.length
                  ? (n + (e.key === "ArrowDown" ? 1 : rows.length - 1)) %
                    rows.length
                  : 0,
              );
            }
            if (e.key === "Enter" && rows[active]) {
              e.preventDefault();
              onSelect(rows[active].id);
            }
          }}
        />
        {loading && (
          <LoaderCircle
            size={17}
            className="spin"
            aria-label="Carregando anúncios para busca"
          />
        )}
        <button
          className="icon-button"
          aria-label="Fechar busca"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <p className="command-search-scope">
        {store === "all" ? "Todas as lojas autorizadas" : "Loja selecionada"} ·
        a seleção abre uma prévia
      </p>
      {error && (
        <div className="command-search-error">
          <p>{error}</p>
          <button className="button" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw size={14} />
            Tentar novamente
          </button>
        </div>
      )}
      <div
        id={listId}
        role="listbox"
        aria-label="Anúncios encontrados"
        className="command-results"
        aria-busy={loading}
      >
        {!loading && !error && !rows.length && (
          <p className="command-empty">
            {query
              ? "Nenhum anúncio corresponde à busca nesta loja."
              : "Nenhum anúncio cadastrado nesta loja."}
          </p>
        )}
        {rows.map((offer, i) => (
          <div
            key={offer.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={"command-result " + (i === active ? "selected" : "")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(offer.id)}
          >
            <MediaImage src={offer.thumbnail} alt="" />
            <div>
              <strong>{offer.title}</strong>
              <small>
                {offer.storeName} · {offer.sku || offer.mlId || "Sem código"} ·{" "}
                {labels[offer.status] || offer.status}
              </small>
            </div>
            <span>{money(offer.price)}</span>
            <ChevronRight size={15} />
          </div>
        ))}
      </div>
      <footer>
        <span>↑ ↓ escolher · Enter abrir · Esc fechar</span>
        {data?.truncated && (
          <span>Busca parcial; consulte também a lista de Anúncios.</span>
        )}
        {rows.length === 20 && (
          <span>Refine a busca para encontrar outros anúncios.</span>
        )}
      </footer>
    </dialog>
  );
}
