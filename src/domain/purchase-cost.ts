import Decimal from "decimal.js";
type Row = Record<string, any>;

// Null is unknown; an explicitly registered zero is a valid cost.
export function purchaseCost(
  offer: Row,
  products: Map<string, Row>,
  components: Row[] = [],
) {
  if (offer.type === "unit") {
    return {
      amount: products.get(offer.product_id)?.purchase_cost ?? null,
      source: "product",
      productIds: [offer.product_id],
    };
  }
  const parts = components.filter((c) => c.offer_id === offer.id);
  const productIds = [...new Set(parts.map((c) => c.product_id))];
  if (!parts.length) return { amount: null, source: "composition", productIds };
  const amounts = parts.map((c) => {
    const cost = products.get(c.product_id)?.purchase_cost;
    return cost == null ? null : new Decimal(cost).mul(c.quantity);
  });
  if (amounts.some((c) => c === null))
    return { amount: null, source: "composition", productIds };
  if (offer.type === "variation") {
    // Variations are alternatives, never the sum of all variants.
    if (!amounts.every((c) => c!.eq(amounts[0]!)))
      return {
        amount: null,
        source: "variable",
        productIds,
        reason:
          "Variações com custos diferentes: informe o custo do anúncio individual.",
      };
    return { amount: amounts[0]!.toFixed(6), source: "variation", productIds };
  }
  return {
    amount: amounts
      .reduce<Decimal>((sum, c) => sum.add(c!), new Decimal(0))
      .toFixed(6),
    source: "kit",
    productIds,
  };
}
