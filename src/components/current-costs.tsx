"use client";
import { useEffect, useState } from "react";
import { Calculator, Pencil, RefreshCw } from "lucide-react";
import { currentCosts } from "@/domain/current-costs";
import { listingType } from "@/domain/listing-table";
import { automaticMlCosts } from "@/domain/ml-financial";
import { CostsForm } from "./forms";
import ProductRegistration from "./product-registration";
import { Modal, jsonRequest, money, percent } from "./ui";
import { useToast } from "./toasts";
type Row = Record<string, any>;
const labels: Record<string, string> = {
  goods: "Mercadoria",
  mlPercent: "Tarifa percentual ML",
  mlFixed: "Cobrança fixa ML",
  shipping: "Frete da loja",
  packaging: "Embalagem",
  tax: "Impostos",
  management: "Comissão de gestão",
  advertising: "Publicidade por venda",
  other: "Outros custos",
};
export default function CurrentCosts({
  detail,
  canEdit,
  busy,
  onSaveCosts,
  onSaveCostsAndNext,
  onChanged,
  onSimulate,
}: {
  detail: Row;
  canEdit: boolean;
  busy: boolean;
  onSaveCosts: (data: Row) => Promise<boolean>;
  onSaveCostsAndNext?: (data: Row) => Promise<boolean>;
  onChanged: () => void;
  onSimulate: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const { notify } = useToast();
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const { offer } = detail;
  const {
    costs,
    calculation: result,
    receipt,
  } = currentCosts(offer, detail.costs, detail.parameters, clock);
  const automatic = automaticMlCosts(offer, clock);
  const working = busy || refreshing;
  const connected =
    detail.mlConnection?.configured &&
    detail.mlConnection?.status === "connected" &&
    offer.ml?.sellerId &&
    offer.origin !== "reference";
  function source(key: string) {
    if (key === "goods" && detail.costs.goods == null)
      return offer.purchaseCost?.amount != null
        ? offer.purchaseCost.source === "kit"
          ? "Composição do kit"
          : "Cadastro do produto"
        : "Custo de compra pendente";
    if (["mlPercent", "mlFixed", "shipping"].includes(key))
      return detail.costs[key] != null
        ? "Valor cadastrado neste anúncio"
        : automatic[key as keyof typeof automatic] != null
          ? "Consulta ML · estimativa"
          : "Consulta ML pendente ou vencida";
    return ["tax", "management"].includes(key) &&
      detail.costs[key + "Rate"] === undefined
      ? "Parâmetro da loja"
      : "Cadastro do anúncio";
  }
  async function refresh() {
    if (working) return;
    setRefreshing(true);
    try {
      const response = await jsonRequest(
        `/api/catalog/indicators?store=${encodeURIComponent(offer.store_id)}`,
        { ids: [offer.id], parts: { [offer.id]: ["fees"] } },
      );
      const record = response.results?.find((r: Row) => r.id === offer.id);
      if (!record?.fees)
        throw new Error(
          record?.errors?.join(" · ") ||
            "Custos ML ainda pendentes. Tente novamente.",
        );
      notify("Custos do ML consultados para este anúncio.", "success");
      setClock(Date.now());
      onChanged();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setRefreshing(false);
    }
  }
  async function save(data: Row, next = false) {
    const action =
      next && onSaveCostsAndNext ? onSaveCostsAndNext : onSaveCosts;
    const saved = await action(data);
    if (saved) setEditing(false);
    return saved;
  }
  return (
    <>
      <ProductRegistration
        offer={offer}
        canEdit={canEdit}
        disabled={working}
        onSaved={onChanged}
      />
      <section
        className="panel current-costs"
        aria-label="Custos atuais do anúncio"
        aria-busy={working}
      >
        <div className="panel-heading">
          <div>
            <h2>Custos atuais</h2>
            <p className="small muted">
              Valores cadastrados e custos do ML para o preço atual.
            </p>
          </div>
          <div className="current-cost-actions">
            {canEdit && (
              <button
                className="button compact"
                disabled={working}
                onClick={() => setEditing(true)}
              >
                <Pencil size={14} />
                Editar custos
              </button>
            )}
            {canEdit && connected && (
              <button
                className="button compact"
                disabled={working || !offer.price}
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} className={refreshing ? "spin" : ""} />
                {refreshing ? "Consultando…" : "Consultar custos do ML"}
              </button>
            )}
            {canEdit && (
              <button
                className="button compact"
                disabled={working}
                onClick={onSimulate}
              >
                <Calculator size={14} />
                Simular alteração
              </button>
            )}
          </div>
        </div>
        <p className="small muted">
          {offer.ml
            ? `${listingType(offer.ml.listingTypeId)} · ${offer.ml.freeShipping === true ? "Frete grátis para o comprador" : offer.ml.freeShipping === false ? "Sem frete grátis" : "Condição de frete pendente"}`
            : "Cadastro local"}
          . Frete da loja representa o custo do vendedor.
        </p>
        <div className="current-cost-grid">
          <dl className="current-cost-breakdown">
            <div className="current-cost-price">
              <dt>Preço de venda atual</dt>
              <dd>{money(offer.price)}</dd>
            </div>
            {Object.entries(labels).map(([key, label]) => (
              <div key={key}>
                <dt>
                  {label}
                  {key === "mlPercent" && costs.mlPercent != null
                    ? ` · ${percent(costs.mlPercent)}`
                    : ""}
                  <small>{source(key)}</small>
                </dt>
                <dd>
                  {result.breakdown[key] == null ? (
                    <span className="cost-pending">Pendente</span>
                  ) : (
                    money(result.breakdown[key])
                  )}
                </dd>
              </div>
            ))}
            <div className="current-cost-price">
              <dt>Custo total por venda</dt>
              <dd>{money(result.total)}</dd>
            </div>
          </dl>
          <div
            className="current-cost-results"
            aria-label="Resultado com os custos atuais"
          >
            <div>
              <span>Você recebe do ML · estimado</span>
              <strong>{money(receipt)}</strong>
              <small>Preço menos tarifa, cobrança fixa e frete da loja.</small>
            </div>
            <div>
              <span>Resultado por venda</span>
              <strong>{money(result.margin)}</strong>
              <small>
                Após mercadoria, custos do ML, impostos e demais custos.
              </small>
            </div>
            <div>
              <span>Margem sobre a venda</span>
              <strong
                className={
                  result.salesMarginMet === true
                    ? "positive"
                    : result.salesMarginMet === false
                      ? "negative"
                      : ""
                }
              >
                {percent(result.saleMarginPercent)}
              </strong>
              <small>
                Meta: acima de {percent(result.salesMarginTarget)}
                {result.salesMarginMet === true
                  ? " · Meta atendida"
                  : result.salesMarginMet === false
                    ? " · Abaixo da meta"
                    : " · Dados pendentes"}
              </small>
            </div>
            {result.salesTargetPrice != null && !result.salesMarginMet && (
              <p className="small">
                Preço sugerido para a meta:{" "}
                <strong>{money(result.salesTargetPrice)}</strong>
              </p>
            )}
            {result.pending.length > 0 && (
              <p className="small muted">
                Preencher: {result.pending.join(" · ")}. Valores pendentes
                impedem o cálculo completo da margem.
              </p>
            )}
            <p className="small muted">
              Estimativa por unidade vendida. A conferência final depende dos
              valores efetivos de cada venda.
            </p>
          </div>
        </div>
      </section>
      {editing && (
        <Modal
          title="Editar custos atuais"
          subtitle="Cadastro dos custos deste anúncio"
          busy={working}
          onClose={() => setEditing(false)}
        >
          <CostsForm
            initial={detail.costs}
            offer={offer}
            parameters={detail.parameters}
            price={offer.price}
            busy={working}
            onDirty={() => {}}
            onDraft={() => {}}
            onSave={(data) => save(data)}
            onSaveAndNext={
              onSaveCostsAndNext ? (data) => void save(data, true) : undefined
            }
          />
        </Modal>
      )}
    </>
  );
}
