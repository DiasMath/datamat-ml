import Decimal from "decimal.js";

export const ANALYTICS_TIME_ZONE = "America/Sao_Paulo";
export function businessDay(value: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function shiftDay(day: string, days: number) {
  return new Date(Date.parse(day + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export type AnalysisRange = ReturnType<typeof analysisRange>;
export function analysisRange(from: string, to: string, clock = new Date()) {
  const valid = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day + "T12:00:00Z")) &&
    shiftDay(day, 0) === day;
  if (!valid(from) || !valid(to)) throw new Error("Informe datas válidas.");
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days < 1 || days > 90 || to > businessDay(clock))
    throw new Error("Selecione até 90 dias, sem datas futuras.");
  const start = Date.parse(from + "T00:00:00-03:00");
  const end = Math.min(
    Date.parse(shiftDay(to, 1) + "T00:00:00-03:00"),
    clock.getTime(),
  );
  return {
    from,
    to,
    days,
    start,
    end,
    previousStart: start - days * 86400000,
    previousEnd: end - days * 86400000,
    timeZone: ANALYTICS_TIME_ZONE,
  };
}
export type SaleLine = {
  itemId: string;
  title: string;
  quantity: number;
  price: string;
  fee: string | null;
  contribution: string | null;
  offerId: string | null;
  actualFeeContribution?: string | null;
  minMargin?: string | null;
};
export type SaleOrder = {
  id: string;
  storeId: string;
  created: string;
  status: string;
  lines: SaleLine[];
  shipmentId: string | null;
};
export type VisitPoint = { day: string; visits: number };
export type StoreAnalysis = {
  storeId: string;
  storeName: string;
  connected: boolean;
  sellerId: string | null;
  authVersion: number | null;
  observedAt: string | null;
  collectedThrough?: string;
  complete: boolean;
  totalReported: number | null;
  orders: SaleOrder[];
  visits: VisitPoint[] | null;
  unanswered: number | null;
  reputation: {
    level: string | null;
    powerSeller: string | null;
    completed: number | null;
    cancelled: number | null;
    period: string | null;
  } | null;
  shipping: {
    sampled: number;
    total: number;
    statuses: Record<string, number>;
    entries?: Array<{
      id: string;
      status: string;
      substatus: string | null;
      handlingDeadline: string | null;
      late: boolean;
    }>;
  } | null;
  warnings: string[];
  error: string | null;
};
export function salesSummary(orders: SaleOrder[], start: number, end: number) {
  const selected = orders.filter(
    (o) => Date.parse(o.created) >= start && Date.parse(o.created) < end,
  );
  const paid = selected.filter((o) => o.status === "paid");
  let revenue = new Decimal(0),
    fees = new Decimal(0),
    contribution = new Decimal(0),
    coveredRevenue = new Decimal(0),
    feeRevenue = new Decimal(0),
    units = 0;
  const products = new Map<
    string,
    {
      id: string;
      storeId: string;
      title: string;
      offerId: string | null;
      units: number;
      revenue: Decimal;
      contribution: Decimal;
      coveredRevenue: Decimal;
      orders: Set<string>;
    }
  >();
  const daily = new Map<
    string,
    { revenue: Decimal; orders: number; units: number }
  >();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: 0,
    revenue: new Decimal(0),
  }));
  for (const order of paid) {
    const day = businessDay(order.created);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: ANALYTICS_TIME_ZONE,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(order.created)),
    );
    const d = daily.get(day) || {
      revenue: new Decimal(0),
      orders: 0,
      units: 0,
    };
    d.orders++;
    hourly[hour].orders++;
    for (const line of order.lines) {
      const value = new Decimal(line.price).mul(line.quantity);
      revenue = revenue.plus(value);
      units += line.quantity;
      d.revenue = d.revenue.plus(value);
      d.units += line.quantity;
      hourly[hour].revenue = hourly[hour].revenue.plus(value);
      const key = order.storeId + ":" + line.itemId;
      const p = products.get(key) || {
        id: line.itemId,
        storeId: order.storeId,
        title: line.title,
        offerId: line.offerId,
        units: 0,
        revenue: new Decimal(0),
        contribution: new Decimal(0),
        coveredRevenue: new Decimal(0),
        orders: new Set<string>(),
      };
      p.units += line.quantity;
      p.revenue = p.revenue.plus(value);
      p.orders.add(order.id);
      if (line.contribution !== null) {
        const estimate = new Decimal(line.contribution).mul(line.quantity);
        contribution = contribution.plus(estimate);
        coveredRevenue = coveredRevenue.plus(value);
        p.contribution = p.contribution.plus(estimate);
        p.coveredRevenue = p.coveredRevenue.plus(value);
      }
      if (line.fee !== null) {
        fees = fees.plus(new Decimal(line.fee).mul(line.quantity));
        feeRevenue = feeRevenue.plus(value);
      }
      products.set(key, p);
    }
    daily.set(day, d);
  }
  const ratio = (a: Decimal, b: Decimal) =>
    b.gt(0) ? a.div(b).mul(100).toFixed(2) : null;
  return {
    paidOrders: paid.length,
    units,
    revenue: revenue.toFixed(2),
    ticket: paid.length ? revenue.div(paid.length).toFixed(2) : null,
    cancelled: selected.filter((o) => o.status === "cancelled").length,
    otherOrders: selected.filter(
      (o) => !["paid", "cancelled"].includes(o.status),
    ).length,
    totalOrders: selected.length,
    cancellationRate: selected.length
      ? String(
          new Decimal(selected.filter((o) => o.status === "cancelled").length)
            .div(selected.length)
            .mul(100)
            .toFixed(2),
        )
      : null,
    fees: feeRevenue.gt(0) ? fees.toFixed(2) : null,
    feeCoverage: ratio(feeRevenue, revenue),
    contribution: coveredRevenue.gt(0) ? contribution.toFixed(2) : null,
    contributionCoverage: ratio(coveredRevenue, revenue),
    contributionPercent: ratio(contribution, coveredRevenue),
    daily: [...daily]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({
        day,
        orders: d.orders,
        units: d.units,
        revenue: d.revenue.toFixed(2),
      })),
    hourly: hourly.map((h) => ({ ...h, revenue: h.revenue.toFixed(2) })),
    products: [...products.values()]
      .sort((a, b) => b.revenue.comparedTo(a.revenue))
      .map((p) => ({
        ...p,
        orders: p.orders.size,
        revenue: p.revenue.toFixed(2),
        contribution: p.coveredRevenue.gt(0) ? p.contribution.toFixed(2) : null,
        contributionCoverage: ratio(p.coveredRevenue, p.revenue),
      })),
    recent: [...paid]
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(0, 20)
      .map((o) => ({
        id: o.id,
        storeId: o.storeId,
        created: o.created,
        title: o.lines.map((l) => l.title).join(" · "),
        units: o.lines.reduce((s, l) => s + l.quantity, 0),
        revenue: o.lines
          .reduce(
            (s, l) => s.plus(new Decimal(l.price).mul(l.quantity)),
            new Decimal(0),
          )
          .toFixed(2),
      })),
  };
}
export function changeRate(
  current: string | number,
  previous: string | number,
) {
  const before = new Decimal(previous);
  return before.gt(0)
    ? new Decimal(current).minus(before).div(before).mul(100).toFixed(2)
    : null;
}
export function aggregateAnalytics(
  stores: StoreAnalysis[],
  range: AnalysisRange,
) {
  const unique = new Map<string, SaleOrder>();
  for (const store of stores)
    for (const order of store.orders)
      unique.set(order.storeId + ":" + order.id, order);
  const orders = [...unique.values()];
  const current = salesSummary(orders, range.start, range.end),
    previous = salesSummary(orders, range.previousStart, range.previousEnd);
  const connected = stores.filter((s) => s.connected);
  const available = connected.length > 0 && connected.some((s) => s.observedAt);
  const complete =
    available && stores.every((s) => s.connected && s.complete && !s.error);
  const visits =
    connected.length > 0 &&
    stores.every((s) => s.connected) &&
    connected.every((s) => s.visits !== null && !!s.observedAt)
      ? connected
          .flatMap((s) => s.visits!)
          .reduce((sum, v) => sum + v.visits, 0)
      : null;
  const days = Array.from({ length: range.days }, (_, index) => {
    const day = shiftDay(range.from, index),
      previousDay = shiftDay(day, -range.days);
    const c = current.daily.find((d) => d.day === day),
      p = previous.daily.find((d) => d.day === previousDay);
    return {
      day,
      orders: c?.orders || 0,
      revenue: c?.revenue || "0.00",
      previousRevenue: p?.revenue || "0.00",
      previousOrders: p?.orders || 0,
    };
  });
  return {
    available,
    complete,
    range,
    current,
    previous,
    daily: days,
    visits,
    orderVisitRate:
      complete && visits && visits > 0
        ? new Decimal(current.paidOrders).div(visits).mul(100).toFixed(2)
        : null,
    changes: complete
      ? {
          revenue: changeRate(current.revenue, previous.revenue),
          orders: changeRate(current.paidOrders, previous.paidOrders),
          ticket:
            current.ticket && previous.ticket
              ? changeRate(current.ticket, previous.ticket)
              : null,
        }
      : null,
    stores: stores.map(({ orders: ignored, ...store }) => ({
      ...store,
      summary: salesSummary(ignored, range.start, range.end),
    })),
    warnings: [...new Set(stores.flatMap((s) => s.warnings))],
  };
}
export type AnalyticsReport = ReturnType<typeof aggregateAnalytics>;
