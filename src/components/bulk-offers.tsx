"use client";
import { useConfirm } from "./confirmation";
import { useRef, useState } from "react";
import { Field, Submit, jsonRequest, labels } from "./ui";
import { useToast } from "./toasts";
type Row = Record<string, any>;
export default function BulkOffers({
  data,
  ids,
  initialAction = "edit",
  busy,
  onBusy,
  onChanged,
  onDone,
  onDirty,
}: {
  data: Row;
  ids: string[];
  initialAction?: string;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onChanged: () => void;
  onDone: () => void;
  onDirty: () => void;
}) {
  const { notify } = useToast();
  const confirm = useConfirm();
  const [offers, setOffers] = useState<Row[]>(() =>
    ids
      .map((id) => data.offerChoices.find((o: Row) => o.id === id))
      .filter(Boolean),
  );
  const [action, setAction] = useState(initialAction),
    [results, setResults] = useState<Row[]>([]),
    [progress, setProgress] = useState(0);
  const operations = useRef<Record<string, string>>({});
  const versions = Object.fromEntries(offers.map((o) => [o.id, o.version]));
  const canML =
    offers.length === ids.length &&
    offers.every((o) => {
      const c = data.connections.find(
        (c: Row) => c.store_id === o.store_id && c.provider === "mercadolivre",
      );
      return (
        o.origin !== "reference" &&
        /^MLB\d+$/.test(o.ml_id || "") &&
        c?.status === "connected" &&
        o.ml?.sellerId === c.external_account &&
        o.ml?.authVersion === c.auth_version
      );
    });
  const deletable =
    offers.length <= 40 &&
    offers.every((o) => o.status === "draft" || o.origin === "reference");
  const ml = action.startsWith("ml-");
  const uncertain = results.some((r) => r.result === "uncertain");
  async function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    if (offers.length !== ids.length) {
      notify("A seleção mudou; recarregue os anúncios.", "error");
      return;
    }
    if (
      ml &&
      !results.length &&
      !(await confirm({
        title: action === "ml-active" ? "Ativar anúncios?" : "Pausar anúncios?",
        description: `Esta ação altera ${offers.length} anúncio(s) diretamente no Mercado Livre.`,
        confirmLabel:
          action === "ml-active" ? "Ativar anúncios" : "Pausar anúncios",
      }))
    )
      return;
    if (
      action === "delete" &&
      !(await confirm({
        title: "Excluir cadastros?",
        description: `Excluir ${offers.length} cadastro(s) local(is)? A exclusão é definitiva e não remove anúncios do Mercado Livre.`,
        confirmLabel: "Excluir cadastros",
        danger: true,
      }))
    )
      return;
    onBusy(true);
    try {
      if (ml) {
        let updated: Row[] = [];
        setProgress(0);
        for (let offset = 0; offset < offers.length; offset += 5) {
          const selected = offers.slice(offset, offset + 5),
            opKey = action + ":" + offset;
          operations.current[opKey] ||= crypto.randomUUID();
          const result = await jsonRequest("/api/offers/batch-ml-status", {
            ids: selected.map((o) => o.id),
            versions: Object.fromEntries(
              selected.map((o) => [o.id, o.version]),
            ),
            status: action === "ml-active" ? "active" : "paused",
            requestId: operations.current[opKey],
            confirmed: true,
          });
          updated = [...updated, ...result.results];
          setResults(updated);
          setProgress(updated.length);
        }
        onChanged();
        const confirmed = updated.filter((r) => r.result === "verified").length;
        notify(
          `${confirmed} de ${offers.length} anúncio(s) confirmado(s) no ML.`,
          confirmed === offers.length ? "success" : "warning",
        );
      } else {
        const opKey = action;
        operations.current[opKey] ||= crypto.randomUUID();
        const payload: Row = {
          ids: offers.map((o) => o.id),
          versions,
          requestId: operations.current[opKey],
        };
        if (action === "delete") payload.confirmed = true;
        else {
          if (f.get("status")) payload.status = f.get("status");
          if (String(f.get("titlePrefix") || "").trim())
            payload.titlePrefix = String(f.get("titlePrefix")).trim();
          if (String(f.get("titleSuffix") || "").trim())
            payload.titleSuffix = String(f.get("titleSuffix")).trim();
          if (f.get("replaceDescription"))
            payload.description = String(f.get("description") || "");
        }
        await jsonRequest(
          action === "delete"
            ? "/api/offers/batch-delete"
            : "/api/offers/batch",
          payload,
        );
        notify(
          `${offers.length} cadastro(s) ${action === "delete" ? "excluído(s)" : "atualizado(s)"}.`,
        );
        onDone();
      }
    } catch (error) {
      notify((error as Error).message, "error");
      if (ml) onChanged();
    } finally {
      onBusy(false);
    }
  }
  return (
    <form
      onChange={onDirty}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <h3>{offers.length} anúncios selecionados</h3>
      <ul className="selected-list">
        {offers.map((o) => (
          <li key={o.id}>
            {o.store_name} · {o.title} · {o.sku || "Sem SKU"}
          </li>
        ))}
      </ul>
      <fieldset className="bulk-controls" disabled={busy}>
        <Field label="Operação em lote">
          <select
            value={action}
            disabled={uncertain}
            onChange={(e) => {
              setOffers((previous) =>
                previous.map((o) => {
                  const latest = data.offerChoices.find(
                    (row: Row) => row.id === o.id,
                  );
                  const verified = results.find(
                    (r) => r.id === o.id && r.result === "verified",
                  );
                  return latest?.version >= (verified?.version || o.version)
                    ? latest
                    : verified
                      ? {
                          ...o,
                          version: verified.version,
                          status: action === "ml-active" ? "active" : "paused",
                        }
                      : o;
                }),
              );
              setAction(e.target.value);
              setResults([]);
              operations.current = {};
            }}
          >
            <option value="edit">Editar cadastro local</option>
            <option value="ml-active" disabled={!canML}>
              Ativar no Mercado Livre
            </option>
            <option value="ml-paused" disabled={!canML}>
              Pausar no Mercado Livre
            </option>
            <option value="delete" disabled={!deletable}>
              Excluir cadastros locais
            </option>
          </select>
        </Field>
        {!ml && action === "edit" && (
          <>
            <p className="small muted">
              Estas alterações ficam no cadastro local. Preços seguem o fluxo de
              proposta e aprovação. Use as operações Mercado Livre para ativar
              ou pausar na conta.
            </p>
            <Field label="Nova situação">
              <select name="status" defaultValue="">
                <option value="">Manter situação</option>
                {["paused", "active", "draft", "closed"].map((v) => (
                  <option key={v} value={v}>
                    {labels[v]}
                  </option>
                ))}
              </select>
            </Field>
            <details className="expand">
              <summary>Título e descrição</summary>
              <div className="form-grid">
                <Field label="Adicionar antes do título">
                  <input name="titlePrefix" maxLength={80} />
                </Field>
                <Field label="Adicionar depois do título">
                  <input name="titleSuffix" maxLength={80} />
                </Field>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" name="replaceDescription" /> Substituir
                descrição nos selecionados
              </label>
              <Field label="Nova descrição">
                <textarea name="description" rows={4} maxLength={15000} />
              </Field>
            </details>
          </>
        )}
        {action === "delete" && (
          <p className="small muted">
            Exclui até 40 rascunhos ou referências sem tarefas, notas ou
            propostas. Registros em operação devem ser pausados ou encerrados
            para preservar o histórico. A exclusão não remove anúncios do ML.
          </p>
        )}
        {ml && (
          <p className="small muted">
            Altera a conta real, com confirmação por anúncio. Para ativar, é
            necessário estoque disponível.
          </p>
        )}
        {action === "edit" && (!canML || !deletable) && (
          <details className="expand">
            <summary>Requisitos das outras operações</summary>
            {!canML && (
              <p className="small muted">
                Ativação e pausa no ML exigem anúncios próprios sincronizados de
                contas autorizadas.
              </p>
            )}
            {!deletable && (
              <p className="small muted">
                Exclusão: até 40 rascunhos ou referências. Vínculos existentes
                são conferidos antes de excluir.
              </p>
            )}
          </details>
        )}
      </fieldset>
      {results.length > 0 && (
        <div
          className="bounded-list bulk-results"
          aria-label="Resultados da operação"
        >
          {results.map((r) => (
            <div className="list-item" key={r.id}>
              <div>
                <strong>{offers.find((o) => o.id === r.id)?.title}</strong>
                <small>{r.message}</small>
              </div>
              <span className={r.result === "verified" ? "green" : "orange"}>
                {r.result === "verified"
                  ? "Confirmado"
                  : r.result === "uncertain"
                    ? "Conferir"
                    : r.result === "pending"
                      ? "Pendente"
                      : "Falhou"}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="form-footer">
        <span>
          {busy && ml
            ? `Processados ${progress} de ${offers.length}`
            : "Confira os anúncios e a operação antes de confirmar."}
        </span>
        <Submit
          busy={busy}
          label={
            ml
              ? results.length
                ? "Conferir / retomar lote"
                : action === "ml-active"
                  ? "Confirmar ativação no ML"
                  : "Confirmar pausa no ML"
              : action === "delete"
                ? "Confirmar exclusão em lote"
                : "Confirmar alteração em lote"
          }
        />
      </div>
    </form>
  );
}
