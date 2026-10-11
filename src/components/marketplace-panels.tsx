"use client";
import { useState } from "react";
import Decimal from "decimal.js";
import { useToastMessage } from "./toasts";
import { advertisingIndicators, type QualityIssue } from "@/domain/marketplace";
import { Field, money, percent, date } from "./ui";
type Row = Record<string, any>;

export function ListingChecklist({
  detail,
  busy,
  canWrite,
  onTask,
  onRefresh,
}: {
  detail: Row;
  busy: boolean;
  canWrite: boolean;
  onTask: (key: string) => void;
  onRefresh: () => void;
}) {
  const issues = (detail.quality || []) as QualityIssue[];
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Próximas melhorias do anúncio</h2>
        <div className="heading-actions">
          <span className="count-pill">{issues.length}</span>
          {detail.mlConnection?.status === "connected" && canWrite && (
            <button
              className="button compact"
              disabled={busy}
              onClick={onRefresh}
            >
              Consultar anúncio no ML
            </button>
          )}
        </div>
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
      {detail.offer.ml && (
        <details className="expand">
          <summary>Mídia e ficha técnica da última consulta</summary>
          <p className="small muted">
            Estado oficial observado em {date(detail.offer.ml.observedAt)}.
            Qualidade ML:{" "}
            {detail.offer.ml.health == null
              ? "não fornecida"
              : `${Math.round(detail.offer.ml.health * 100)} / 100`}
            . {(detail.offer.ml.subStatus || []).join(" · ")}
          </p>
          <div className="ml-media-grid">
            {(detail.offer.ml.pictures || []).map((p: Row, i: number) =>
              p.url ? (
                <a
                  key={p.id || i}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={p.url}
                    alt={`Foto ${i + 1} de ${detail.offer.title}`}
                    loading="lazy"
                  />
                </a>
              ) : (
                <span className="small muted" key={p.id || i}>
                  Foto {i + 1}: {p.id || "URL indisponível"}
                </span>
              ),
            )}
          </div>
          <p className="small muted">
            Vídeo legado na API de anúncios:{" "}
            {detail.offer.ml.videoAvailable
              ? detail.offer.ml.videoId || "não informado"
              : "indisponível"}
            . Clips e campanhas possuem recursos separados; não presumimos que
            este retorno inclua todos os vídeos.
          </p>
          <dl className="ml-attributes">
            {(detail.offer.ml.attributes || []).map((a: Row) => (
              <div key={a.id}>
                <dt>{a.name}</dt>
                <dd>{a.value || "Não informado"}</dd>
              </div>
            ))}
          </dl>
          {!!detail.offer.ml.variationDetails?.length && (
            <details>
              <summary>Variações publicadas</summary>
              <div className="bounded-list">
                {detail.offer.ml.variationDetails.map((v: Row) => (
                  <div className="list-item" key={v.id}>
                    <div>
                      <strong>
                        {v.attributes
                          .map((a: Row) => `${a.name}: ${a.value_name || "—"}`)
                          .join(" · ") || v.id}
                      </strong>
                      <small>
                        Preço: {money(v.price)} · estoque:{" "}
                        {v.stock ?? "não informado"}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </details>
      )}
    </section>
  );
}

export function MarketplacePerformance({
  detail,
  data,
  busy,
  onRefresh,
  onCompetition,
}: {
  detail: Row;
  data: Row;
  busy: boolean;
  onRefresh: () => void;
  onCompetition: () => void;
}) {
  const snapshot = detail.mlMetrics;
  const matching =
    snapshot?.seller_id === detail.mlConnection?.external_account &&
    snapshot?.auth_version === detail.mlConnection?.auth_version;
  const m = matching ? snapshot : null;
  useToastMessage(
    snapshot && !matching
      ? "As métricas anteriores pertencem a outra autorização; consulte os dados da conta atual."
      : "",
    "warning",
  );
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
        {m && (
          <div className="detail-stats compact-metrics">
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
              <div className="compact-metric" key={String(label)}>
                <span>{label}</span>
                <strong>{value ?? "Indisponível"}</strong>
              </div>
            ))}
          </div>
        )}
        <p className="small muted">
          {m
            ? `${date(m.from)} a ${date(m.to)} · consulta ${date(m.observed_at)}. ${m.source}. Receita antes de tarifas, frete, impostos e devoluções posteriores. Pedidos/visitas é um indicador do período, sem atribuição de visitantes às compras.`
            : "Consulte as métricas da conta autorizada para este anúncio. Vendas acumuladas não são usadas como vendas do período."}
        </p>
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
      {detail.offer.ml?.catalogListing && (
        <CatalogCompetition
          detail={detail}
          busy={busy}
          onRefresh={onCompetition}
        />
      )}
      <AdvertisingCalculator />
    </>
  );
}

function CatalogCompetition({
  detail,
  busy,
  onRefresh,
}: {
  detail: Row;
  busy: boolean;
  onRefresh: () => void;
}) {
  const raw = detail.mlCompetition,
    c = detail.mlConnection;
  const snapshot =
    raw &&
    raw.seller_id === c?.external_account &&
    raw.auth_version === c?.auth_version &&
    raw.offer_version === detail.offer.version
      ? raw
      : null;
  const names: Record<string, string> = {
    winning: "Ganhando a disputa",
    losing: "Perdendo a disputa",
    sharing_first_place: "Compartilhando a primeira posição",
    listed: "Listado",
    not_listed: "Fora da disputa",
    challenging: "Disputando",
  };
  const belowFloor =
    snapshot?.priceToWin != null &&
    detail.calculation.minPrice != null &&
    new Decimal(snapshot.priceToWin).lt(detail.calculation.minPrice);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Competição no catálogo</h2>
        <button
          className="button compact"
          disabled={busy || c?.status !== "connected"}
          onClick={onRefresh}
        >
          Consultar competição no ML
        </button>
      </div>
      {snapshot ? (
        <>
          <div className="detail-stats compact-metrics">
            <div>
              <span>Situação retornada pelo ML</span>
              <strong>
                {names[snapshot.status] ||
                  "Situação a conferir: " + snapshot.status}
              </strong>
            </div>
            <div>
              <span>Preço indicativo para competir</span>
              <strong>{money(snapshot.priceToWin)}</strong>
            </div>
            <div>
              <span>Preço na consulta de competição</span>
              <strong>{money(snapshot.currentPrice)}</strong>
            </div>
          </div>
          <p className="small muted">
            Consulta {date(snapshot.observed_at)}.{" "}
            {snapshot.consistent === false
              ? "O ML sinalizou condições inconsistentes; confira antes de decidir."
              : ""}
          </p>
          {belowFloor && (
            <p className="small orange">
              O preço indicativo está abaixo do piso estimado com seus custos
              atuais. Revise a margem e as condições antes de preparar uma
              proposta.
            </p>
          )}
        </>
      ) : (
        <p className="muted">
          Consulte a situação oficial deste anúncio de catálogo. Falta de
          permissão ou recurso não fornecido permanece indisponível.
        </p>
      )}
      <p className="small muted">
        A consulta mostra a disputa observada pelo ML. O preço indicativo pode
        mudar com a logística e as condições da oferta; não garante a primeira
        posição. Confira custos e tarifas antes de preparar uma proposta.
      </p>
    </section>
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
      <div className="detail-stats compact-metrics" aria-live="polite">
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
