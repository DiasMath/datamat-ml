"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Plus } from "lucide-react";
import { useToast } from "./toasts";
import {
  Empty,
  Field,
  Modal,
  Submit,
  date,
  jsonRequest,
  money,
  percent,
} from "./ui";
import Collection from "./collection";
import Skeleton from "./skeleton";
import { csvCell } from "@/domain/csv";

type Row = Record<string, any>;
export default function Competitors({
  data,
  store,
  onOpen,
  onChanged,
}: {
  data: Row;
  store: string;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null),
    [modal, setModal] = useState<Row | null | undefined>(),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const canWrite = data.user.role !== "viewer";
  const [formStore, setFormStore] = useState(
    store === "all" ? data.stores[0]?.id : store,
  );
  function edit(record: Row | null) {
    setFormStore(
      record?.store_id || (store === "all" ? data.stores[0]?.id : store),
    );
    setModal(record);
  }
  const loadedStore = useRef("");
  useEffect(() => {
    let active = true;
    if (loadedStore.current !== store) {
      setRows(null);
      loadedStore.current = store;
    }
    jsonRequest(`/api/competitors?` + new URLSearchParams({ store }))
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) {
          setRows([]);
          notify(e.message, "error");
        }
      });
    return () => {
      active = false;
    };
  }, [store, revision, notify]);
  async function mutate(
    url: string,
    payload: unknown,
    message: string,
    method = "POST",
  ) {
    setBusy(true);
    try {
      await jsonRequest(url, payload, method);
      setModal(undefined);
      setRevision((v) => v + 1);
      if (url.endsWith("/task")) onChanged();
      notify(message);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  function exportRows() {
    const content = [
      [
        "Loja",
        "Código ML",
        "Título",
        "Preço",
        "Frete informado",
        "Variação %",
        "Consulta",
        "URL",
      ],
      ...(rows || []).map((r) => [
        data.stores.find((s: Row) => s.id === r.store_id)?.name || r.store_id,
        r.item_id,
        r.title,
        r.price,
        r.shipping ?? "",
        r.alert?.delta ?? "",
        r.observed_at,
        r.url,
      ]),
    ]
      .map((r) => r.map((v) => csvCell(String(v))).join(";"))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "datamat-concorrencia.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Referências acompanhadas</h2>
          <p className="small muted">
            Preços observados por você ou pela extensão. Compare produto,
            quantidade e entrega.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="button"
            disabled={!rows?.length}
            onClick={exportRows}
          >
            <Download size={15} />
            Exportar CSV
          </button>
          {canWrite && (
            <button className="button primary" onClick={() => edit(null)}>
              <Plus size={15} />
              Adicionar referência
            </button>
          )}
        </div>
      </div>
      {!rows ? (
        <Skeleton />
      ) : !rows.length ? (
        <section className="panel">
          <Empty
            title="Acompanhe os concorrentes que importam"
            body="Adicione uma oferta comparável ou capture o anúncio com a extensão. O histórico começa na primeira observação."
            action={
              canWrite ? (
                <button className="button" onClick={() => edit(null)}>
                  Adicionar referência
                </button>
              ) : undefined
            }
          />
        </section>
      ) : (
        <section className="panel">
          <Collection
            id="competitors"
            rows={rows}
            label="Concorrentes acompanhados"
          >
            {(visible) => (
              <table className="competitors-table">
                <thead>
                  <tr>
                    <th>Referência</th>
                    <th>Preço observado</th>
                    <th>Sua oferta</th>
                    <th>Última observação</th>
                    <th>Mudança</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const own = data.offerChoices.find(
                      (o: Row) => o.id === r.offer_id,
                    );
                    return (
                      <tr key={r.id}>
                        <td>
                          <button className="text-link" onClick={() => edit(r)}>
                            {r.title}
                          </button>
                          <small>
                            {
                              data.stores.find((s: Row) => s.id === r.store_id)
                                ?.name
                            }{" "}
                            · {r.item_id}
                          </small>
                        </td>
                        <td>
                          {money(r.price)}
                          <small>
                            {r.shipping === null
                              ? "Frete não informado"
                              : `Frete: ${money(r.shipping)}`}
                          </small>
                        </td>
                        <td>
                          {own ? (
                            <button
                              className="text-link"
                              onClick={() => onOpen(own.id)}
                            >
                              {money(own.price)}
                            </button>
                          ) : (
                            "Sem vínculo"
                          )}
                        </td>
                        <td>
                          {date(r.observed_at)}
                          <small>
                            {r.source === "extension"
                              ? "Captura pela extensão"
                              : "Observação manual"}
                          </small>
                        </td>
                        <td>
                          {r.alert ? (
                            <>
                              <strong className="orange">
                                {percent(r.alert.delta)}
                              </strong>
                              <small>
                                {money(r.alert.previous)} →{" "}
                                {money(r.alert.current)}
                              </small>
                            </>
                          ) : (
                            "Sem alerta"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Collection>
        </section>
      )}
      {modal !== undefined && (
        <Modal
          title={modal ? "Atualizar referência" : "Adicionar referência"}
          subtitle="Dados observados; nenhuma alteração será aplicada à sua oferta."
          onClose={() => {
            if (!busy) setModal(undefined);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              mutate(
                "/api/competitors",
                {
                  storeId: String(f.get("storeId")),
                  itemId: String(f.get("itemId"))
                    .toUpperCase()
                    .replace("-", ""),
                  title: f.get("title"),
                  url: f.get("url"),
                  price: f.get("price"),
                  shipping: f.get("shipping") || null,
                  seller: f.get("seller") || "",
                  offerId: f.get("offerId") || null,
                  threshold: f.get("threshold"),
                  version: modal?.version || 0,
                },
                "Referência e histórico atualizados.",
              );
            }}
          >
            <fieldset disabled={busy || !canWrite} className="form-grid">
              <Field label="Loja *">
                <select
                  name="storeId"
                  value={formStore}
                  onChange={(e) => setFormStore(e.target.value)}
                  disabled={!!modal}
                >
                  {data.stores.map((s: Row) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {modal && (
                  <input type="hidden" name="storeId" value={modal.store_id} />
                )}
              </Field>
              <Field label="Código ML *">
                <input
                  name="itemId"
                  required
                  defaultValue={modal?.item_id}
                  readOnly={!!modal}
                  placeholder="MLB123456789"
                />
              </Field>
              <Field label="Título *" wide>
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={modal?.title}
                />
              </Field>
              <Field label="URL do anúncio *" wide>
                <input
                  name="url"
                  type="url"
                  required
                  defaultValue={modal?.url}
                  placeholder="https://produto.mercadolivre.com.br/MLB-…"
                />
              </Field>
              <Field label="Preço observado (R$) *">
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={modal?.price}
                />
              </Field>
              <Field label="Frete informado (R$)">
                <input
                  name="shipping"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={modal?.shipping ?? ""}
                />
              </Field>
              <Field label="Vendedor">
                <input
                  name="seller"
                  maxLength={200}
                  defaultValue={modal?.seller}
                />
              </Field>
              <Field label="Alertar mudança a partir de (%)">
                <input
                  name="threshold"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  required
                  defaultValue={modal?.threshold || "5"}
                />
              </Field>
              <Field label="Vincular à sua oferta" wide>
                <select name="offerId" defaultValue={modal?.offer_id || ""}>
                  <option value="">Sem vínculo</option>
                  {data.offerChoices
                    .filter(
                      (o: Row) =>
                        o.origin !== "reference" && o.store_id === formStore,
                    )
                    .map((o: Row) => (
                      <option key={o.id} value={o.id}>
                        {o.store_name} · {o.title}
                      </option>
                    ))}
                </select>
              </Field>
            </fieldset>
            {modal && (
              <details className="routine-details">
                <summary>
                  Histórico observado · {modal.history.length} registros
                </summary>
                <div className="collection-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Preço</th>
                        <th>Frete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modal.history.toReversed().map((h: Row, i: number) => (
                        <tr key={i}>
                          <td>{date(h.observedAt)}</td>
                          <td>{money(h.price)}</td>
                          <td>{money(h.shipping)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted">
                  Até 100 mudanças recentes. Sem histórico anterior à primeira
                  captura.
                </p>
              </details>
            )}
            <div className="form-footer">
              <span>Compare ofertas equivalentes.</span>
              {canWrite && <Submit busy={busy} label="Salvar referência" />}
            </div>
          </form>
          {modal && canWrite && (
            <div className="competitor-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  mutate(
                    `/api/competitors/${modal.id}/task`,
                    {},
                    "Tarefa criada ou recuperada.",
                  )
                }
              >
                Criar tarefa de revisão
              </button>
              {modal.alert && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    mutate(
                      `/api/competitors/${modal.id}/dismiss`,
                      { version: modal.version },
                      "Alerta marcado como visto.",
                    )
                  }
                >
                  Marcar alerta como visto
                </button>
              )}
              <button
                className="text-link danger-text"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Excluir esta referência e seu histórico observado?",
                    )
                  )
                    mutate(
                      `/api/competitors/${modal.id}`,
                      { version: modal.version },
                      "Referência excluída.",
                      "DELETE",
                    );
                }}
              >
                Excluir referência
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
