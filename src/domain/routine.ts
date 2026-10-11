import Decimal from "decimal.js";
import {
  businessDay,
  type AnalysisRange,
  type SaleOrder,
  type StoreAnalysis,
} from "./analytics";

export function financialSales(orders: SaleOrder[], range: AnalysisRange) {
  const unique = new Map(orders.map((o) => [o.storeId + ":" + o.id, o]));
  return [...unique.values()]
    .filter(
      (o) =>
        o.status === "paid" &&
        Date.parse(o.created) >= range.start &&
        Date.parse(o.created) < range.end,
    )
    .map((order) => {
      let revenue = new Decimal(0),
        expected = new Decimal(0),
        observed = new Decimal(0),
        coveredRevenue = new Decimal(0);
      let expectedKnown = true,
        observedKnown = true,
        lowMargin = false;
      for (const line of order.lines) {
        const sales = new Decimal(line.price).mul(line.quantity);
        revenue = revenue.plus(sales);
        if (line.contribution == null) expectedKnown = false;
        else
          expected = expected.plus(
            new Decimal(line.contribution).mul(line.quantity),
          );
        if (line.actualFeeContribution == null) observedKnown = false;
        else {
          const value = new Decimal(line.actualFeeContribution).mul(
            line.quantity,
          );
          observed = observed.plus(value);
          coveredRevenue = coveredRevenue.plus(sales);
          if (
            value.lt(0) ||
            (line.minMargin != null &&
              sales.gt(0) &&
              value.div(sales).mul(100).lt(line.minMargin))
          )
            lowMargin = true;
        }
      }
      return {
        id: order.id,
        storeId: order.storeId,
        created: order.created,
        title: order.lines.map((l) => l.title).join(" · "),
        offerId: order.lines.length === 1 ? order.lines[0].offerId : null,
        revenue: revenue.toFixed(2),
        expected: expectedKnown ? expected.toFixed(2) : null,
        observed: observedKnown ? observed.toFixed(2) : null,
        difference:
          expectedKnown && observedKnown
            ? observed.minus(expected).toFixed(2)
            : null,
        lowMargin,
        coverage: revenue.gt(0)
          ? coveredRevenue.div(revenue).mul(100).toFixed(2)
          : null,
      };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function stockCoverage(
  offers: Array<Record<string, any>>,
  sources: StoreAnalysis[],
  range: AnalysisRange,
  clock = new Date(),
) {
  const days =
    Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  return offers
    .filter((o) => o.origin !== "reference" && o.status !== "closed")
    .map((offer) => {
      const source = sources.find((s) => s.storeId === offer.store_id);
      const observed = offer.ml;
      const matching =
        !!source?.connected &&
        source.sellerId === observed?.sellerId &&
        source.authVersion === observed?.authVersion;
      const stockObserved = observed?.stockObservedAt || observed?.observedAt;
      const recentStock =
        !!stockObserved &&
        clock.getTime() - Date.parse(stockObserved) <= 30 * 60_000;
      const recentSales =
        !!source?.observedAt &&
        clock.getTime() - Date.parse(source.observedAt) <= 86400000;
      const reliable =
        matching &&
        recentStock &&
        recentSales &&
        source?.complete &&
        !source.error &&
        range.to < businessDay(clock);
      const units = reliable
        ? [...new Map(source.orders.map((o) => [o.id, o])).values()]
            .filter(
              (o) =>
                o.status === "paid" &&
                Date.parse(o.created) >= range.start &&
                Date.parse(o.created) < range.end,
            )
            .reduce(
              (n, o) =>
                n +
                o.lines
                  .filter((l) => l.itemId === offer.ml_id)
                  .reduce((s, l) => s + l.quantity, 0),
              0,
            )
        : null;
      const quantity =
        matching &&
        recentStock &&
        Number.isInteger(observed.availableQuantity) &&
        observed.availableQuantity >= 0
          ? observed.availableQuantity
          : null;
      const coverage =
        units && quantity != null
          ? new Decimal(quantity).mul(days).div(units).toFixed(1)
          : null;
      return {
        offerId: offer.id,
        storeId: offer.store_id,
        title: offer.title,
        quantity,
        units,
        days,
        coverage,
        urgency:
          quantity === 0
            ? "empty"
            : coverage != null && new Decimal(coverage).lte(7)
              ? "replenish"
              : "normal",
        reason: !matching
          ? "Sincronize o anúncio com a conta atual"
          : !recentStock
            ? "Estoque precisa de nova consulta"
            : !reliable
              ? "Histórico de vendas indisponível ou parcial"
              : units === 0
                ? "Sem vendas pagas na janela; cobertura não estimada"
                : "Estoque do anúncio ÷ média diária; sem previsão de demanda",
      };
    })
    .sort(
      (a, b) =>
        ["empty", "replenish", "normal"].indexOf(a.urgency) -
        ["empty", "replenish", "normal"].indexOf(b.urgency),
    );
}
