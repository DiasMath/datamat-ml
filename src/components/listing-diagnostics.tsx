"use client";
import { useState } from "react";
import {
  listingDiagnostics,
  titleTerms,
  titleChecks,
} from "@/domain/listing-intelligence";
import type { AnalyticsReport } from "@/domain/analytics";
import { money, percent, date, Field, Empty, jsonRequest } from "./ui";
import { useSmartTable } from "./smart-table";
import Collection from "./collection";
import { useToast } from "./toasts";
type Row = Record<string, any>;
const trends: Record<string, string> = {
  up: "Ganhando vendas",
  down: "Perdendo vendas",
  stable: "Estável",
  unknown: "Sem base suficiente",
};
export default function ListingDiagnostics({
  data,
  offers,
  report,
  onOpen,
}: {
  data: Row;
  offers: Row[];
  report: AnalyticsReport | null;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all"),
    [q, setQ] = useState("");
  const diagnosed = listingDiagnostics(offers, report),
    rows = diagnosed.filter(
      (r) =>
        (filter === "all" ||
          (filter === "attention" && r.issues.length > 0) ||
          r.trend === filter) &&
        r.title
          .toLocaleLowerCase("pt-BR")
          .includes(q.toLocaleLowerCase("pt-BR")),
    );
  const table = useSmartTable("listingDiagnostics", rows, [
    { id: "title", label: "Anúncio", width: 260, value: (r) => r.title },
    {
      id: "trend",
      label: "Tendência de vendas",
      width: 180,
      value: (r) => trends[r.trend],
    },
    {
      id: "revenue",
      label: "Receita / anterior",
      width: 150,
      value: (r) => r.revenue,
      kind: "number",
    },
    {
      id: "delta",
      label: "Variação",
      width: 105,
      value: (r) => r.delta,
      kind: "number",
    },
    {
      id: "margin",
      label: "Margem atual",
      width: 120,
      value: (r) => r.margin,
      kind: "number",
    },
    {
      id: "health",
      label: "Qualidade ML",
      width: 120,
      value: (r) => r.health,
      kind: "number",
    },
    {
      id: "issues",
      label: "O que revisar",
      width: 320,
      value: (r) => r.issues.length,
      kind: "number",
    },
  ]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Diagnóstico dos anúncios</h2>
        <span className="count-pill">{rows.length}</span>
      </div>
      <p className="small muted">
        Comparação de receita com o período anterior equivalente. Ganhar vendas
        não significa ganhar margem nem vencer a disputa de catálogo.
      </p>
      <div className="form-grid">
        <Field label="Filtrar diagnóstico">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todos</option>
            <option value="attention">Com ações para revisar</option>
            <option value="down">Perdendo vendas</option>
            <option value="up">Ganhando vendas</option>
            <option value="stable">Estáveis</option>
          </select>
        </Field>
        <Field label="Buscar anúncio no diagnóstico">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Título do anúncio"
          />
        </Field>
      </div>
      {rows.length ? (
        <Collection
          id="listingDiagnostics"
          rows={table.rows}
          label="Diagnóstico dos anúncios"
          sortKey={table.sortKey}
        >
          {(visible) => (
            <table className="smart-table" {...table.props}>
              {table.header()}
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => onOpen(r.id)}
                      >
                        {r.title}
                      </button>
                      <small className="cell-sub">
                        {data.stores.find((s: Row) => s.id === r.storeId)?.name}{" "}
                        · ML: {date(r.observedAt)}
                      </small>
                    </td>
                    <td>
                      <span
                        className={
                          r.trend === "up"
                            ? "green"
                            : r.trend === "down"
                              ? "orange"
                              : "muted"
                        }
                      >
                        {trends[r.trend]}
                      </span>
                    </td>
                    <td>
                      {money(r.revenue)}
                      <small className="cell-sub">
                        Anterior: {money(r.previousRevenue)}
                      </small>
                    </td>
                    <td>{percent(r.delta)}</td>
                    <td>{percent(r.margin)}</td>
                    <td>
                      {r.health === null ? "Indisponível" : r.health + " / 100"}
                    </td>
                    <td>
                      {r.issues.length ? (
                        <>
                          <strong>{r.issues[0].title}</strong>
                          <small className="cell-sub">
                            {r.issues[0].action}
                          </small>
                          {r.issues.length > 1 && (
                            <details>
                              <summary>
                                Mais {r.issues.length - 1} ajustes
                              </summary>
                              {r.issues.slice(1).map((i, n) => (
                                <p className="small muted" key={n}>
                                  {i.title}: {i.action}
                                </p>
                              ))}
                            </details>
                          )}
                        </>
                      ) : (
                        "Sem pendência nas verificações disponíveis"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Collection>
      ) : (
        <Empty
          title="Nenhum anúncio neste filtro"
          body="Importe seus anúncios ou ajuste a seleção para acompanhar o desempenho."
        />
      )}
      <details className="expand">
        <summary>Critérios e dados disponíveis</summary>
        <p className="small muted">
          Tendência exige dados completos, vendedor/autorização correspondentes
          e pelo menos cinco pedidos somando os períodos. Variação a partir de
          +15% indica crescimento; até −15%, queda. Sem receita anterior ou
          amostra suficiente não calculamos crescimento percentual. A margem
          atual usa custos cadastrados; não é a margem histórica das vendas.
          Qualidade ML é health × 100 quando o campo é fornecido pela API.
          Mídia/estoque são retratos da última consulta; acima de 15 minutos
          pedimos atualização. Posição de catálogo, ranking por busca e causas
          da perda não são inferidos das vendas.
        </p>
      </details>
    </section>
  );
}
export function TitleWorkbench({
  detail,
  canWrite,
  onDirty,
  onSaved,
}: {
  detail: Row;
  canWrite: boolean;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const { notify } = useToast(),
    [draft, setDraft] = useState(detail.offer.title),
    [busy, setBusy] = useState(false);
  const refs = detail.competitorTitles || [],
    terms = titleTerms(refs.map((r: Row) => r.title)),
    checks = titleChecks(draft);
  return (
    <details className="panel expand">
      <summary>Analisar título e termos da concorrência</summary>
      <Field label="Rascunho do título">
        <textarea
          value={draft}
          maxLength={200}
          rows={3}
          onChange={(e) => {
            setDraft(e.target.value);
            onDirty(true);
          }}
        />
      </Field>
      <p className="small muted">
        {draft.length} caracteres. Confira especificações e limites da categoria
        antes de publicar. O rascunho não altera o anúncio.
      </p>
      {checks.map((c) => (
        <p className="small muted" key={c}>
          {c}
        </p>
      ))}
      <h3>Termos observados nas referências vinculadas</h3>
      {terms.length ? (
        <>
          <div className="keyword-terms">
            {terms.map((t) => (
              <span key={t.term}>
                {t.term}
                <small>{t.count}</small>
              </span>
            ))}
          </div>
          <p className="small muted">
            {refs.length} título(s) capturado(s). A contagem representa títulos
            da sua amostra, não volume de busca ou posição no ML. Não transfira
            características de outro produto sem conferir.
          </p>
        </>
      ) : (
        <p className="small muted">
          Vincule referências de concorrentes ao anúncio, pelo site ou extensão,
          para analisar os termos da amostra.
        </p>
      )}
      <div className="heading-actions">
        <button
          className="button compact"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(draft);
              notify("Rascunho copiado.");
            } catch {
              notify("Selecione o texto do rascunho para copiar.", "warning");
            }
          }}
        >
          Copiar rascunho
        </button>
        {canWrite && (
          <button
            className="button compact"
            disabled={busy || !draft.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await jsonRequest("/api/notes", {
                  storeId: detail.offer.store_id,
                  offerId: detail.offer.id,
                  title:
                    "Rascunho de título: " + detail.offer.title.slice(0, 100),
                  body: draft,
                  kind: "idea",
                  sources: "Análise dos títulos das referências vinculadas",
                  practicalUse:
                    "Revisar e aplicar no ML após conferir as características do produto",
                });
                onDirty(false);
                onSaved();
                notify("Rascunho salvo como nota do anúncio.");
              } catch (e) {
                notify((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Salvar rascunho como nota
          </button>
        )}
      </div>
    </details>
  );
}
