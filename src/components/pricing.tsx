"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  calculate,
  simulationSchema,
  type Costs,
  type Parameters,
} from "@/domain/finance";
import { Calculator, ArrowRight, Save, Info } from "lucide-react";
import { Field, money, percent } from "./ui";
import { useToastMessage } from "./toasts";
type Row = Record<string, any>;
const breakdownLabels: Record<string, string> = {
  goods: "Mercadoria",
  mlPercent: "Tarifa percentual ML",
  mlFixed: "Cobrança fixa ML",
  shipping: "Frete da loja",
  packaging: "Embalagem",
  tax: "Impostos",
  management: "Comissão de gestão",
  advertising: "Publicidade",
  other: "Outros custos",
};
export default function Pricing({
  offer,
  busy,
  onProposal,
  onDirty,
  costs,
  parameters,
  parametersRevision,
  draftCosts,
  costEditor,
  mlConnection,
}: {
  offer: Row;
  busy: boolean;
  onProposal: (data: Row) => Promise<boolean>;
  onDirty: () => void;
  costs: Costs;
  parameters: Parameters;
  parametersRevision: number;
  draftCosts: Costs | null;
  costEditor: ReactNode;
  mlConnection?: Row | null;
}) {
  const [mode, setMode] = useState<"price" | "discount">("price"),
    [values, setValues] = useState<Record<string, string>>({
      price: offer.price ?? "",
      discount: "0",
      mlContribution: "0",
      promotion: "",
      proposedTitle: offer.title,
      proposedDescription: offer.description || "",
    }),
    [overrides, setOverrides] = useState<Record<string, boolean>>({}),
    [conditionsVerified, setConditionsVerified] = useState(false),
    [contentChange, setContentChange] = useState(false),
    [reason, setReason] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  const connected =
    mlConnection?.configured &&
    mlConnection?.status === "connected" &&
    Boolean(offer.ml);
  const [automaticTariff, setAutomaticTariff] = useState(Boolean(connected)),
    [quote, setQuote] = useState<Row | null>(null),
    [quoteError, setQuoteError] = useState(""),
    [quotePending, setQuotePending] = useState(false),
    [quoteRefresh, setQuoteRefresh] = useState(0);
  function change(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    onDirty();
  }
  const rawInput: Row = {
    mode,
    mlContribution: values.mlContribution || "0",
    promotion: values.promotion,
    conditionsVerified,
  };
  rawInput[mode === "price" ? "price" : "discount"] = values[mode] || null;
  for (const key of ["mlPercent", "mlFixed", "shipping", "advertising"])
    if (overrides[key]) rawInput[key] = values[key] || null;
  if (draftCosts && JSON.stringify(draftCosts) !== JSON.stringify(costs))
    rawInput.costOverrides = draftCosts;
  if (contentChange) {
    rawInput.proposedTitle = values.proposedTitle;
    rawInput.proposedDescription = values.proposedDescription;
  }
  const baseInput = simulationSchema.safeParse(rawInput);
  const quotePrice = baseInput.success
    ? calculate(offer.price, costs, parameters, baseInput.data).price
    : null;
  const useOfficialTariff =
    automaticTariff && connected && !overrides.mlPercent && !overrides.mlFixed;
  const quoteKey = quotePrice
    ? `${offer.id}:${offer.version}:${quotePrice}`
    : "";
  const activeQuote =
    useOfficialTariff &&
    quote?.key === quoteKey &&
    quote.expires_at > Date.now()
      ? quote
      : null;
  useEffect(() => {
    const abort = new AbortController();
    setQuoteError("");
    setQuotePending(Boolean(useOfficialTariff && quotePrice));
    if (!useOfficialTariff || !quotePrice) return () => abort.abort();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/offers/${offer.id}/ml-quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            price: quotePrice,
            offerVersion: offer.version,
          }),
          signal: abort.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Não foi possível consultar a tarifa");
        if (!abort.signal.aborted) setQuote({ ...data, key: quoteKey });
      } catch (e) {
        if (!abort.signal.aborted) {
          setQuote(null);
          setQuoteError(
            e instanceof Error
              ? e.message
              : "Não foi possível consultar a tarifa",
          );
        }
      } finally {
        if (!abort.signal.aborted) setQuotePending(false);
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [useOfficialTariff, quoteKey, quoteRefresh]);
  useEffect(() => {
    if (!activeQuote) return;
    const timer = setTimeout(
      () => setQuoteRefresh((n) => n + 1),
      Math.max(1000, activeQuote.expires_at - Date.now() - 5000),
    );
    return () => clearTimeout(timer);
  }, [quote]);
  if (activeQuote) {
    rawInput.mlQuoteId = activeQuote.id;
    rawInput.mlPercent = activeQuote.mlPercent;
    rawInput.mlFixed = activeQuote.mlFixed;
  }
  const parsed = simulationSchema.safeParse(rawInput);
  const error = offer.ml?.variablePrices
    ? "As variações têm preços diferentes. Confira e precifique cada variação antes de preparar uma proposta."
    : !draftCosts
      ? "Confira os custos: há um valor inválido."
      : !parsed.success
        ? parsed.error.issues.map((i) => i.message).join(" · ")
        : "";
  useToastMessage(error);
  useToastMessage(quoteError);
  const result =
    !error && parsed.success
      ? {
          current: calculate(offer.price, costs, parameters),
          proposed: calculate(offer.price, costs, parameters, parsed.data),
          input: parsed.data,
        }
      : null;
  return (
    <div className="pricing-layout">
      <section className="panel pricing-input-panel">
        <div className="panel-heading">
          <h2>
            <Calculator size={18} />
            Preparar cenário
          </h2>
          <span className="muted small">
            {offer.store_name} · {offer.sku || "SKU pendente"}
          </span>
        </div>
        <div
          className="mobile-price-summary"
          role="region"
          aria-label="Resumo da precificação ao digitar"
        >
          <div>
            <span>Preço (R$)</span>
            <strong>{moneyNumber(result?.proposed.price)}</strong>
          </div>
          <div>
            <span>Contribuição (R$)</span>
            <strong>{moneyNumber(result?.proposed.margin)}</strong>
          </div>
        </div>
        <form onSubmit={(e) => e.preventDefault()}>
          {connected && (
            <div className="ml-tariff-box" aria-live="polite">
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={automaticTariff}
                  onChange={(e) => {
                    setAutomaticTariff(e.target.checked);
                    onDirty();
                  }}
                />
                Consultar tarifas do ML automaticamente
              </label>
              <p className="small muted">
                {useOfficialTariff
                  ? quotePending || (!activeQuote && !quoteError)
                    ? "Cálculo local imediato · aguardando a tarifa do preço digitado…"
                    : activeQuote
                      ? `Tarifa consultada: ${percent(activeQuote.mlPercent)} + ${money(activeQuote.mlFixed)} · ${offer.ml.listingTypeId}`
                      : quoteError
                  : "Usando as condições informadas manualmente."}
              </p>
              <p className="small muted">
                Frete, subsídios e promoções ainda precisam de conferência.
                Preço mínimo e desejado estimam as tarifas deste cenário;
                consulte novamente ao mudar o preço.
              </p>
              {quoteError && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setQuoteRefresh((n) => n + 1)}
                >
                  Tentar consultar novamente
                </button>
              )}
            </div>
          )}
          <div className="segmented">
            <button
              className={mode === "price" ? "selected" : ""}
              type="button"
              onClick={() => {
                setMode("price");
                onDirty();
              }}
            >
              Novo preço
            </button>
            <button
              className={mode === "discount" ? "selected" : ""}
              type="button"
              onClick={() => {
                setMode("discount");
                onDirty();
              }}
            >
              Percentual de desconto
            </button>
          </div>
          <div className="form-grid">
            <Field
              label={
                mode === "price"
                  ? "Preço proposto (R$)"
                  : "Desconto financiado pela loja (%)"
              }
            >
              <input
                key={mode}
                name={mode === "price" ? "price" : "discount"}
                type="number"
                min={mode === "price" ? 0.01 : 0}
                max={mode === "discount" ? 100 : undefined}
                step={mode === "price" ? "0.01" : "0.000001"}
                value={values[mode]}
                onChange={(e) => change(mode, e.target.value)}
                required
              />
            </Field>
            <Field
              label="Contribuição do ML (R$)"
              hint="Subsídio recebido pela loja, separado do desconto."
            >
              <input
                name="mlContribution"
                type="number"
                min={0}
                step="0.01"
                value={values.mlContribution}
                onChange={(e) => change("mlContribution", e.target.value)}
              />
            </Field>
            <Field label="Nome da promoção" wide>
              <input
                name="promotion"
                value={values.promotion}
                onChange={(e) => change("promotion", e.target.value)}
                placeholder="Opcional · identificação da campanha"
              />
            </Field>
          </div>
          <details className="expand">
            <summary>Tarifas, frete e publicidade previstos</summary>
            <div className="form-grid">
              {[
                ["mlPercent", "Tarifa ML (%)"],
                ["mlFixed", "Cobrança fixa ML (R$)"],
                ["shipping", "Frete da loja (R$)"],
                ["advertising", "Publicidade por venda (R$)"],
              ].map(([key, label]) => (
                <SimulationOverride
                  key={key}
                  field={key}
                  label={label}
                  active={!!overrides[key]}
                  value={values[key] ?? ""}
                  onMode={(active) => {
                    setOverrides((v) => ({ ...v, [key]: active }));
                    onDirty();
                  }}
                  onValue={(value) => change(key, value)}
                />
              ))}
            </div>
          </details>
          <details className="expand">
            <summary>Propor título e descrição</summary>
            <label className="checkbox-line">
              <input
                type="checkbox"
                name="contentChange"
                checked={contentChange}
                onChange={(e) => {
                  setContentChange(e.target.checked);
                  onDirty();
                }}
              />
              Incluir alterações de conteúdo nesta proposta.
            </label>
            <div className="stack">
              <Field label="Novo título">
                <input
                  name="proposedTitle"
                  value={values.proposedTitle}
                  onChange={(e) => change("proposedTitle", e.target.value)}
                />
              </Field>
              <Field label="Nova descrição">
                <textarea
                  name="proposedDescription"
                  rows={5}
                  value={values.proposedDescription}
                  onChange={(e) =>
                    change("proposedDescription", e.target.value)
                  }
                />
              </Field>
            </div>
          </details>
          <label className="checkbox-line">
            <input
              type="checkbox"
              name="conditionsVerified"
              checked={conditionsVerified}
              onChange={(e) => {
                setConditionsVerified(e.target.checked);
                onDirty();
              }}
            />
            Conferi as tarifas e o frete no ML para esta condição de preço.
          </label>
          <div className="form-footer">
            <span>
              Cálculo automático ao digitar. O anúncio atual permanece intacto.
            </span>
          </div>
        </form>
        {costEditor}
      </section>
      <section
        className="panel calculation-panel"
        aria-label="Resultados da precificação"
        tabIndex={0}
      >
        <div className="panel-heading">
          <h2>Atual × proposta</h2>
          <span className="muted small">Por venda · ao digitar</span>
        </div>
        {result ? (
          <>
            <div className="price-comparison">
              <div>
                <span>Preço atual</span>
                <strong>{money(result.current.price)}</strong>
              </div>
              <ArrowRight size={20} />
              <div>
                <span>Preço proposto</span>
                <strong className="orange">
                  {money(result.proposed.price)}
                </strong>
              </div>
            </div>
            <div
              className="margin-result"
              aria-live="polite"
              aria-atomic="true"
            >
              <span>Margem de contribuição</span>
              <strong>
                {money(result.proposed.margin)}{" "}
                <small>{percent(result.proposed.marginPercent)}</small>
              </strong>
              <p>Contribuição para despesas fixas e resultado.</p>
            </div>
            <div className="comparison-row">
              <span>Desconto da loja</span>
              <strong>{percent(result.proposed.discount)}</strong>
            </div>
            <div className="comparison-row">
              <span>Contribuição do ML</span>
              <strong>{money(result.proposed.mlContribution)}</strong>
            </div>
            <div className="comparison-row">
              <span>Receita considerada</span>
              <strong>{money(result.proposed.revenue)}</strong>
            </div>
            <div className="cost-table">
              <div className="comparison-row table-label">
                <span>Custo por oferta</span>
                <span>Atual / proposto</span>
              </div>
              {Object.entries(breakdownLabels).map(([key, label]) => (
                <div className="comparison-row" key={key}>
                  <span>{label}</span>
                  <span className="mono">
                    {money(result.current.breakdown[key])}
                    <span className="muted"> / </span>
                    {money(result.proposed.breakdown[key])}
                  </span>
                </div>
              ))}
              <div className="comparison-row">
                <strong>Custo total</strong>
                <strong className="mono">
                  {money(result.current.total)} / {money(result.proposed.total)}
                </strong>
              </div>
            </div>
            <div className="limit-grid">
              <div>
                <span>Mínima / desejada</span>
                <strong>
                  {percent(result.proposed.minMargin)} /{" "}
                  {percent(result.proposed.desiredMargin)}
                </strong>
              </div>
              <div>
                <span>Preço mínimo estimado</span>
                <strong>{money(result.proposed.minPrice)}</strong>
              </div>
              <div>
                <span>Preço desejado estimado</span>
                <strong>{money(result.proposed.desiredPrice)}</strong>
              </div>
              <div>
                <span>Desconto máximo estimado</span>
                <strong>{percent(result.proposed.maxDiscount, 4)}</strong>
              </div>
            </div>
            <details className="expand calculation-conditions">
              <summary>
                <Info size={14} />
                Condições e limites
              </summary>
              <p className="small muted">
                Bases: impostos — {basis(result.proposed.bases.tax)}; comissão —{" "}
                {basis(result.proposed.bases.management)}.
              </p>
              {result.input.costOverrides && (
                <p className="small muted">
                  Os custos digitados estão incluídos nesta proposta. O cadastro
                  atual só muda ao salvar custos ou confirmar a aplicação
                  aprovada.
                </p>
              )}
              {result.proposed.pending.length > 0 && (
                <p className="small muted">
                  Resultado incompleto. Dados necessários:{" "}
                  {result.proposed.pending.join(", ")}.
                </p>
              )}
              {result.proposed.warnings.length > 0 && (
                <ul className="small muted">
                  {result.proposed.warnings.map((w: string) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </details>
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!result.proposed.price || !parsed.success) return;
                const key = JSON.stringify({
                  input: result.input,
                  reason,
                  offerVersion: offer.version,
                  parametersRevision,
                });
                if (request.current?.key !== key)
                  request.current = { key, id: crypto.randomUUID() };
                const saved = await onProposal({
                  offerId: offer.id,
                  input: result.input,
                  reason,
                  requestId: request.current.id,
                  offerVersion: offer.version,
                  parametersVersion: parametersRevision,
                });
                if (saved) {
                  setReason("");
                  request.current = null;
                }
              }}
            >
              <Field label="Motivo da proposta *">
                <textarea
                  rows={2}
                  minLength={3}
                  required
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    request.current = null;
                    onDirty();
                  }}
                  placeholder="O que muda e por quê?"
                />
              </Field>
              <button
                className="button primary"
                disabled={
                  busy ||
                  (useOfficialTariff && (!activeQuote || quotePending)) ||
                  Boolean(offer.ml?.variablePrices) ||
                  !result.proposed.price ||
                  (mode === "discount" && result.input.discount === null) ||
                  offer.origin === "reference"
                }
              >
                <Save size={15} />
                {busy ? "Salvando…" : "Salvar para revisão"}
              </button>
              {offer.origin === "reference" && (
                <p className="muted small">
                  Referências externas não recebem propostas operacionais.
                </p>
              )}
            </form>
          </>
        ) : (
          <div className="empty calculation-empty">
            <Calculator size={32} />
            <h3>Compare antes de decidir</h3>
            <p>
              Digite um preço ou desconto para ver os resultados na hora.
              Valores inválidos precisam ser corrigidos antes de preparar uma
              proposta.
            </p>
            <div className="formula">Receita − custos = contribuição</div>
          </div>
        )}
      </section>
    </div>
  );
}
function basis(value: string | null | undefined) {
  return value === "price"
    ? "preço do comprador"
    : value === "revenue"
      ? "receita com contribuição ML"
      : "pendente";
}
function moneyNumber(value: string | null | undefined) {
  return value == null
    ? "Indisponível"
    : new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value));
}
function SimulationOverride({
  field,
  label,
  active,
  value,
  onMode,
  onValue,
}: {
  field: string;
  label: string;
  active: boolean;
  value: string;
  onMode: (active: boolean) => void;
  onValue: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        name={field + "Mode"}
        value={active ? "override" : "keep"}
        onChange={(e) => onMode(e.target.value === "override")}
      >
        <option value="keep">Manter custo informado</option>
        <option value="override">Substituir neste cenário</option>
      </select>
      {active && (
        <input
          name={field}
          type="number"
          min={0}
          max={field === "mlPercent" ? 100 : undefined}
          step="0.000001"
          placeholder="Pendente"
          value={value}
          onChange={(e) => onValue(e.target.value)}
        />
      )}
    </Field>
  );
}
