import Decimal from "decimal.js";
import { z } from "zod";
import type { Costs } from "./finance";
type Row = Record<string, any>;
const money = z.number().finite().nonnegative().max(1e9);
export const FINANCIAL_MAX_AGE = 30 * 60000;
export const ML_COST_FIELDS = ["mlPercent", "mlFixed", "shipping"] as const;
export function financialContext(offer: Row) {
  const ml = offer.ml || {};
  return JSON.stringify([
    offer.ml_id,
    offer.price == null ? null : new Decimal(offer.price).toFixed(2),
    ml.categoryId,
    ml.listingTypeId,
    ml.currencyId,
    ml.shippingMode,
    ml.logisticType,
    ml.freeShipping,
    ml.shippingDimensions || null,
    ml.financialAttributes || [],
    ml.variablePrices || false,
  ]);
}
export function financialMatches(offer: Row, snapshot: Row | null | undefined) {
  return (
    !!snapshot &&
    snapshot.offer_id === offer.id &&
    snapshot.store_id === offer.store_id &&
    snapshot.seller_id === offer.ml?.sellerId &&
    snapshot.auth_version === offer.ml?.authVersion &&
    snapshot.context === financialContext(offer)
  );
}
export function automaticMlCosts(
  offer: Row,
  clock = Date.now(),
  price = offer.price,
): Partial<Costs> {
  const snapshot = offer.mlFinancial;
  if (
    !financialMatches(offer, snapshot) ||
    !Number.isFinite(snapshot.expires_at) ||
    snapshot.expires_at <= clock ||
    !price ||
    !offer.price ||
    !new Decimal(price).eq(offer.price)
  )
    return {};
  return {
    mlPercent: snapshot.mlPercent ?? null,
    mlFixed: snapshot.mlFixed ?? null,
    shipping: snapshot.shipping?.amount ?? null,
  };
}
export function effectiveMlCosts(
  costs: Costs,
  offer: Row,
  clock = Date.now(),
  price = offer.price,
): Costs {
  const automatic = automaticMlCosts(offer, clock, price);
  const result = { ...costs };
  for (const field of ML_COST_FIELDS)
    if (result[field] == null && automatic[field] != null)
      result[field] = automatic[field]!;
  return result;
}
export function normalizeShipping(
  data: unknown,
  freeShipping: boolean | undefined,
) {
  const response = z
    .object({
      coverage: z.object({
        all_country: z.object({
          list_cost: money,
          currency_id: z.literal("BRL"),
          billable_weight: money.optional(),
        }),
      }),
    })
    .parse(data);
  const coverage = response.coverage.all_country;
  // This resource quotes free shipping. It does not prove the seller pays zero
  // for a buyer-paid shipment, nor does it reconcile an actual shipment charge.
  return {
    amount:
      freeShipping === true ? new Decimal(coverage.list_cost).toFixed(2) : null,
    referenceAmount: new Decimal(coverage.list_cost).toFixed(2),
    currency: "BRL",
    estimated: true,
    source: "Mercado Livre · shipping_options/free",
    reason:
      freeShipping === true
        ? null
        : "Frete sem gratuidade: confira o custo do vendedor por envio.",
  };
}
export function normalizeSalePrice(data: unknown) {
  const response = z
    .object({
      amount: money,
      regular_amount: money.nullish(),
      currency_id: z.literal("BRL"),
      metadata: z
        .object({
          promotion_id: z.union([z.string(), z.number()]).optional(),
          promotion_type: z.string().max(100).optional(),
        })
        .passthrough()
        .nullish(),
    })
    .parse(data);
  return {
    amount: new Decimal(response.amount).toFixed(2),
    regularAmount:
      response.regular_amount == null
        ? null
        : new Decimal(response.regular_amount).toFixed(2),
    promotionId:
      response.metadata?.promotion_id == null
        ? null
        : String(response.metadata.promotion_id),
    promotionType: response.metadata?.promotion_type || null,
  };
}
export function normalizePromotions(data: unknown) {
  const campaign = z.object({
    id: z.union([z.string().max(200), z.number()]),
    type: z.string().max(100),
    status: z.string().max(80),
    name: z.string().max(300).nullish(),
    price: money.nullish(),
    original_price: money.nullish(),
    start_date: z.string().max(80).nullish(),
    finish_date: z.string().max(80).nullish(),
    meli_percentage: money.max(100).nullish(),
    seller_percentage: money.max(100).nullish(),
  });
  const response = z
    .union([
      z.array(campaign).max(200),
      z.object({ results: z.array(campaign).max(200) }),
    ])
    .parse(data);
  return (Array.isArray(response) ? response : response.results).map((p) => ({
    id: String(p.id),
    type: p.type,
    status: p.status,
    name: p.name || p.type,
    price: p.price == null ? null : new Decimal(p.price).toFixed(2),
    originalPrice:
      p.original_price == null
        ? null
        : new Decimal(p.original_price).toFixed(2),
    startsAt: p.start_date || null,
    endsAt: p.finish_date || null,
    mlPercent: p.meli_percentage ?? null,
    sellerPercent: p.seller_percentage ?? null,
  }));
}

export function attachFinancial(
  offer: Row,
  snapshot: Row | null | undefined,
  account: Row | null | undefined,
  organization: string,
): Row {
  return {
    ...offer,
    mlFinancial:
      account?.status === "connected" &&
      snapshot?.organization_id === organization &&
      snapshot?.seller_id === account.external_account &&
      snapshot?.auth_version === account.auth_version &&
      financialMatches(offer, snapshot)
        ? snapshot
        : null,
  };
}

// Persist operator costs separately: a quoted charge must not become a permanent
// manual override that stops following future API updates.
export function costsAfterProposal(snapshot: Row): Costs {
  const costs: Costs = { ...(snapshot.input.costOverrides ?? snapshot.costs) };
  for (const field of [
    "mlPercent",
    "mlFixed",
    "shipping",
    "advertising",
  ] as const)
    if (snapshot.input[field] !== undefined)
      costs[field] = snapshot.input[field];
  if (snapshot.input.mlQuoteId) {
    costs.mlPercent = null;
    costs.mlFixed = null;
  }
  if (snapshot.mlShippingApplied) costs.shipping = null;
  return costs;
}
export function financialAfterApplication(
  snapshot: Row,
  offer: Row,
  organization: string,
  checkedQuote?: Row | null,
) {
  const quote = checkedQuote || snapshot.mlQuote;
  if (!quote) return null;
  return {
    ...quote,
    organization_id: organization,
    offer_id: offer.id,
    store_id: offer.store_id,
    context: financialContext({ ...offer, price: snapshot.proposed.price }),
    expires_at: Date.parse(quote.quoted_at) + FINANCIAL_MAX_AGE,
    attempted_at: quote.quoted_at,
    next_attempt_at: 0,
    last_error: null,
  };
}
