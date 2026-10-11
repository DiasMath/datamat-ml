"use client";
import { useState } from "react";
import { advertisingIndicators, type QualityIssue } from "@/domain/marketplace";
import { Field, money, percent, date } from "./ui";
type Row = Record<string, any>;

export function ListingChecklist({
  detail,
  busy,
  canWrite,
  onTask,
}: {
  detail: Row;
  busy: boolean;
  canWrite: boolean;
  onTask: (key: string) => void;
}) {
  const issues = (detail.quality || []) as QualityIssue[];
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Próximas melhorias do anúncio</h2>
        <span className="count-pill">{issues.length}</span>
      </div>
      {issues.length ? (
        <div className="bounded-list">
          {issues.map((issue) => (
            <div className="list-item" key={issue.key}>
              <div>
                <strong>{issue.title}</strong>
                <small>{issue.action}</small>
              </div>
              {canWrite && (
                <button
                  className="button compact"
                  disabled={
                    busy ||
                    detail.tasks?.some(
                      (t: Row) =>
                        t.source_quality_key === issue.key &&
                        !["done", "cancelled"].includes(t.status),
                    )
                  }
                  onClick={() => onTask(issue.key)}
                >
                  {detail.tasks?.some(
                    (t: Row) =>
                      t.source_quality_key === issue.key &&
                      !["done", "cancelled"].includes(t.status),
                  )
                    ? "Tarefa criada"
                    : "Criar tarefa"}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Nenhuma pendência nas verificações disponíveis.</p>
      )}
      {detail.offer.ml && (
        <p className="small muted">
          Consulta ML: {date(detail.offer.ml.observedAt)} ·{" "}
          {detail.offer.ml.photoCount} fotos · estoque publicado:{" "}
          {detail.offer.ml.availableQuantity}.{" "}
          {detail.offer.ml.catalogListing
            ? "Anúncio de catálogo: confira as restrições de edição."
            : ""}{" "}
          {(detail.offer.ml.unavailable || []).join(" · ")}
        </p>
      )}
    </section>
  );
}

export function MarketplacePerformance({
  detail,
  data,
  busy,
  onRefresh,
}: {
  detail: Row;
  data: Row;
  busy: boolean;
  onRefresh: () => void;
}) {
  const m = detail.mlMetrics;
  const connected =
    detail.mlConnection?.status === "connected" &&
    detail.mlConnection?.configured;
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Desempenho do anúncio</h2>
          {connected && (
            <button
              className="button compact"
              disabled={busy}
              onClick={onRefresh}
            >
              Atualizar últimos 30 dias
            </button>
          )}
        </div>
        <div className="detail-stats">
          {[
            ["Pedidos pagos", m?.paidOrders],
            ["Unidades vendidas", m?.units],
            ["Visitas", m?.visits],
            [
              "Pedidos / visitas",
              m?.orderVisitRate == null ? null : percent(m.orderVisitRate),
            ],
            ["Receita bruta de produtos", m ? money(m.grossRevenue) : null],
            ["Perguntas sem resposta", m?.unansweredQuestions],
          ].map(([label, value]) => (
            <div className="unavailable-metric" key={String(label)}>
              <span>{label}</span>
              <strong>{value ?? "Indisponível"}</strong>
            </div>
          ))}
        </div>
        <p className="small muted">
          {m
            ? `${date(m.from)} a ${date(m.to)} · consulta ${date(m.observed_at)}. ${m.source}. Receita antes de tarifas, frete, impostos e devoluções posteriores. Pedidos/visitas é um indicador do período, sem atribuição de visitantes às compras.`
            : "Conecte a conta, sincronize o anúncio e consulte as métricas. As vendas acumuladas do anúncio não são usadas como vendas do período."}
        </p>
        {m && detail.mlConnection?.external_account !== m.seller_id && (
          <div className="alert">
            Este histórico pertence à conta anteriormente conectada; atualize as
            métricas da conta atual.
          </div>
        )}
        {data.powerBiUrl && (
          <a
            className="button"
            href={data.powerBiUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir Power BI
          </a>
        )}
      </section>
      <AdvertisingCalculator />
    </>
  );
}

function AdvertisingCalculator() {
  const [values, setValues] = useState({
    spend: "",
    attributed: "",
    total: "",
  });
  const indicators = advertisingIndicators(
    values.spend || null,
    values.attributed || null,
    values.total || null,
  );
  return (
    <details className="panel expand">
      <summary>Conferir retorno da publicidade</summary>
      <p className="small muted">
        Informe os valores do mesmo período no relatório de publicidade. Receita
        atribuída já faz parte da receita total; não some as duas. Estes valores
        servem para análise e não alteram os custos cadastrados.
      </p>
      <div className="form-grid">
        {[
          ["spend", "Investimento em publicidade (R$)"],
          ["attributed", "Receita atribuída aos anúncios (R$)"],
          ["total", "Receita total do período (R$)"],
        ].map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={values[key as keyof typeof values]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [key]: e.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      <div className="detail-stats" aria-live="polite">
        {[
          ["ROAS", indicators.roas == null ? null : indicators.roas + "×"],
          ["ACOS", indicators.acos == null ? null : percent(indicators.acos)],
          [
            "TACOS",
            indicators.tacos == null ? null : percent(indicators.tacos),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value ?? "Indisponível"}</strong>
          </div>
        ))}
      </div>
    </details>
  );
}
