import Decimal from "decimal.js";
import type { Costs } from "./finance";
type Row = Record<string, any>;

// Costs passed here already include only compatible, unexpired ML conditions.
// Keep the operator's exceptions visible, including an explicit zero.
export function listingFinancialStatus(
  offer: Row,
  raw: Costs,
  effective: Costs,
  pending: string[],
  quote: Row | null,
) {
  const manualPercent = raw.mlPercent != null,
    manualFixed = raw.mlFixed != null;
  const price = offer.ml?.variablePrices ? null : offer.price;
  const fee =
    price != null && effective.mlPercent != null && effective.mlFixed != null
      ? new Decimal(price)
          .mul(effective.mlPercent)
          .div(100)
          .add(effective.mlFixed)
          .toFixed(2)
      : price != null && !manualPercent && !manualFixed && quote?.total != null
        ? new Decimal(quote.total).toFixed(2)
        : null;
  const shipping =
    effective.shipping == null
      ? null
      : new Decimal(effective.shipping).toFixed(2);
  return {
    tariff:
      fee == null
        ? null
        : {
            amount: fee,
            percent: effective.mlPercent,
            fixed: effective.mlFixed,
            source:
              manualPercent && manualFixed
                ? "manual"
                : manualPercent || manualFixed
                  ? "mixed"
                  : "ml",
          },
    shipping:
      shipping == null
        ? null
        : {
            amount: shipping,
            source: raw.shipping != null ? "manual" : "ml",
          },
    ownPending: pending.filter(
      (label) =>
        ![
          "Tarifa percentual ML",
          "Cobrança fixa ML",
          "Frete da loja",
          "Preço maior que zero",
        ].includes(label),
    ),
    ready: pending.length === 0,
    settlement:
      fee != null && shipping != null && price != null
        ? new Decimal(price).minus(fee).minus(shipping).toFixed(2)
        : null,
  };
}
export function listingCounts(offers: Row[]) {
  const own = offers.filter(
    (o) =>
      o.origin !== "reference" &&
      o.ml?.sellerId &&
      /^MLB\d+$/.test(o.ml_id || ""),
  );
  return {
    records: offers.length,
    mlIds: new Set(own.map((o) => o.store_id + ":" + o.ml_id)).size,
    titles: new Set(
      own.map(
        (o) => o.store_id + ":" + o.title.trim().toLocaleLowerCase("pt-BR"),
      ),
    ).size,
    catalog: own.filter((o) => o.ml.catalogListing).length,
    traditional: own.filter((o) => !o.ml.catalogListing).length,
    local: offers.length - own.length,
  };
}
export function listingType(value: string | null | undefined) {
  return (
    (
      {
        gold_special: "Clássico",
        gold_pro: "Premium",
        free: "Grátis",
      } as Record<string, string>
    )[value || ""] ||
    value ||
    "Não consultado"
  );
}
