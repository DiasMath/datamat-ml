import Decimal from "decimal.js";
import { db, get, key, type Row } from "./db";
import { authorizeStore, HttpError, type Actor } from "./access";
import { analyticsSources } from "./analytics";
import {
  aggregateAnalytics,
  analysisRange,
  businessDay,
  shiftDay,
} from "../domain/analytics";
import { calculate, emptyCosts } from "../domain/finance";
import {
  pendingDecisions,
  todayQueue,
  todayHours,
  todayWindow,
} from "../domain/today";
import { safePictureUrl, publicConnection } from "./mercadolivre";
const fields = {
  offers: [
    "organization_id",
    "store_id",
    "title",
    "price",
    "status",
    "origin",
    "ml_id",
    "version",
    "ml_status_uncertain",
    "ml.sellerId",
    "ml.authVersion",
    "ml.observedAt",
    "ml.availableQuantity",
    "ml.photoCount",
    "ml.variablePrices",
    "ml.pictures",
    "ml_last_change",
  ],
  costs: ["store_id", "data_json", "updated_at"],
  proposals: ["organization_id", "store_id", "offer_id", "status"],
  tasks: [
    "organization_id",
    "store_id",
    "title",
    "offer_id",
    "status",
    "priority",
    "due_date",
    "description",
    "version",
    "assignee",
  ],
  ml_competition: [
    "store_id",
    "offer_id",
    "offer_version",
    "seller_id",
    "auth_version",
    "status",
    "consistent",
    "observed_at",
  ],
};
async function scopedRows(collection: keyof typeof fields, ids: string[]) {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const result = await db()
      .collection(collection)
      .where("store_id", "in", ids.slice(i, i + 30))
      .select(...fields[collection])
      .get();
    rows.push(...result.docs.map((d) => ({ ...d.data(), id: d.id })));
  }
  return rows;
}
export async function todayReport(
  actor: Actor,
  query: URLSearchParams,
  clock = new Date(),
) {
  const store = query.get("store") || "all";
  if (store !== "all") authorizeStore(actor, store);
  const selected = actor.stores.filter(
      (s) => store === "all" || store === s.id,
    ),
    ids = selected.map((s) => s.id as string);
  const day = businessDay(clock),
    todayRange = todayWindow(clock);
  const weeklyQuery = new URLSearchParams({
    store,
    from: shiftDay(day, -7),
    to: shiftDay(day, -1),
  });
  const [
    raw,
    costs,
    parameterRows,
    proposals,
    tasks,
    competition,
    connections,
    dailySources,
    weeklySources,
  ] = await Promise.all([
    scopedRows("offers", ids),
    scopedRows("costs", ids),
    Promise.all(ids.map((id) => get("parameters", id))),
    scopedRows("proposals", ids),
    scopedRows("tasks", ids),
    scopedRows("ml_competition", ids),
    Promise.all(ids.map((id) => get("connections", key(id, "mercadolivre")))),
    analyticsSources(actor, new URLSearchParams({ store, from: day, to: day })),
    analyticsSources(actor, weeklyQuery),
  ]);
  const scoped = (r: Row) =>
    !r.organization_id || r.organization_id === actor.organization_id;
  const costMap = new Map(costs.map((r) => [r.id, r])),
    parameterMap = new Map(
      parameterRows
        .filter(Boolean)
        .map((r) => [r!.store_id, JSON.parse(r!.data_json)]),
    ),
    competitionMap = new Map(competition.map((r) => [r.offer_id, r])),
    connectionMap = new Map(
      connections.filter(Boolean).map((r) => [r!.store_id, r!]),
    );
  const offers: Row[] = raw.filter(scoped).map((o): Row => {
    const row = costMap.get(o.id),
      parameters = parameterMap.get(o.store_id);
    if (!parameters)
      throw new HttpError(
        409,
        "Parâmetros financeiros da loja não encontrados",
      );
    const calculation = calculate(
      o.ml?.variablePrices ? null : o.price,
      row ? JSON.parse(row.data_json) : emptyCosts(),
      parameters,
    );
    const c = connectionMap.get(o.store_id);
    return {
      ...o,
      calculation,
      matched:
        c?.status === "connected" &&
        c.external_account === o.ml?.sellerId &&
        c.auth_version === o.ml?.authVersion,
      store_name: selected.find((s) => s.id === o.store_id)?.name || "",
      thumbnail:
        o.ml?.pictures?.map((p: Row) => safePictureUrl(p.url)).find(Boolean) ||
        null,
      costs_stale:
        !row?.updated_at ||
        !Number.isFinite(Date.parse(row.updated_at)) ||
        clock.getTime() - Date.parse(row.updated_at) >
          parameters.reviewDays * 86400000,
      competition: competitionMap.get(o.id),
    };
  });
  const observedTimes = dailySources
    .map((s) => {
      const through = s.collectedThrough || s.observedAt;
      return through ? Date.parse(through) : NaN;
    })
    .filter(
      (t) =>
        Number.isFinite(t) && t >= todayRange.start && t <= clock.getTime(),
    );
  const cutoff = new Date(
    observedTimes.length ? Math.min(...observedTimes) : clock.getTime(),
  );
  const report = aggregateAnalytics(dailySources, todayWindow(cutoff)),
    weekly = aggregateAnalytics(
      weeklySources,
      analysisRange(weeklyQuery.get("from")!, weeklyQuery.get("to")!, clock),
    );
  const ownIds = new Set(
    offers.filter((o) => o.origin !== "reference").map((o) => o.id),
  );
  const pending = proposals.filter(
    (p) =>
      scoped(p) && ownIds.has(p.offer_id) && pendingDecisions.has(p.status),
  );
  const queue = todayQueue(offers, pending, weekly, clock.getTime());
  const offerMap = new Map(offers.map((o) => [o.store_id + ":" + o.ml_id, o]));
  const highlights = weekly.complete
    ? weekly.current.products
        .flatMap((p) => {
          const offer = offerMap.get(p.storeId + ":" + p.id),
            source = weekly.stores.find((s) => s.storeId === p.storeId);
          if (
            !offer ||
            !offer.matched ||
            source?.authVersion !== offer.ml?.authVersion ||
            source?.sellerId !== offer.ml?.sellerId ||
            !source?.observedAt ||
            clock.getTime() - Date.parse(source.observedAt) > 6 * 3600000
          )
            return [];
          return [
            {
              id: offer.id,
              title: offer.title,
              storeId: offer.store_id,
              storeName: offer.store_name,
              units: p.units,
              revenue: p.revenue,
              thumbnail: offer.thumbnail,
            },
          ];
        })
        .sort((a, b) => new Decimal(b.revenue).comparedTo(a.revenue))
        .slice(0, 3)
    : [];
  const changes = offers
    .filter(
      (o) =>
        o.matched &&
        o.ml_last_change?.fields?.length &&
        o.ml_last_change?.authVersion === o.ml.authVersion &&
        o.ml_last_change?.sellerId === o.ml.sellerId &&
        o.ml_last_change?.at >= new Date(todayRange.start).toISOString() &&
        o.ml_last_change?.at <= clock.toISOString(),
    )
    .sort((a, b) => b.ml_last_change.at.localeCompare(a.ml_last_change.at))
    .slice(0, 3)
    .map((o) => ({
      id: o.id,
      title: o.title,
      storeName: o.store_name,
      fields: o.ml_last_change.fields,
      at: o.ml_last_change.at,
    }));
  const observations = report.stores
    .filter((s) => s.observedAt)
    .map((s) => s.observedAt!)
    .sort();
  const publicStores = report.stores.map((s) => ({
    id: s.storeId,
    name: s.storeName,
    connected: s.connected,
    complete: s.complete,
    observedAt: s.observedAt,
    error: s.error,
    warnings: s.warnings,
  }));
  const own = offers.filter(
    (o) => o.origin !== "reference" && o.status !== "closed",
  );
  const financiallyReady = own.filter(
    (o) => !o.costs_stale && o.calculation.margin !== null,
  ).length;
  return {
    user: actor,
    stores: actor.stores,
    connections: connections.filter(Boolean).map((c) => publicConnection(c!)),
    tasks: tasks
      .filter((t) => scoped(t) && !["done", "cancelled"].includes(t.status))
      .sort(
        (a, b) =>
          Number(!!b.due_date && b.due_date < day) -
            Number(!!a.due_date && a.due_date < day) ||
          ["high", "medium", "low"].indexOf(a.priority) -
            ["high", "medium", "low"].indexOf(b.priority),
      ),
    summary: {
      totalOffers: offers.filter(
        (o) => o.origin !== "reference" && o.status !== "closed",
      ).length,
      urgent: queue.filter((q) => q.severity === "urgent").length,
      review: queue.filter((q) => q.severity === "review").length,
      prepare: queue.filter((q) => q.severity === "prepare").length,
      decisions: new Set(pending.map((p) => p.offer_id)).size,
    },
    portfolio: {
      active: own.filter((o) => o.status === "active").length,
      paused: own.filter((o) => o.status === "paused").length,
      draft: own.filter((o) => o.status === "draft").length,
      financiallyReady,
      needsCosts: own.length - financiallyReady,
      overdueTasks: tasks.filter(
        (t) =>
          scoped(t) &&
          !["done", "cancelled"].includes(t.status) &&
          t.due_date &&
          t.due_date < day,
      ).length,
    },
    sales: {
      available: report.available,
      complete: report.complete,
      revenue: report.available ? report.current.revenue : null,
      orders: report.available ? report.current.paidOrders : null,
      units: report.available ? report.current.units : null,
      ticket: report.available ? report.current.ticket : null,
      contribution: report.available ? report.current.contribution : null,
      contributionCoverage: report.available
        ? report.current.contributionCoverage
        : null,
      previousRevenue: report.complete ? report.previous.revenue : null,
      change: report.changes?.revenue ?? null,
      observedAt: observations[0] || null,
      stores: publicStores,
      hours: todayHours(report, cutoff),
      day,
    },
    queue,
    highlights,
    changes,
    weeklyRange: { from: weeklyQuery.get("from"), to: weeklyQuery.get("to") },
  };
}
