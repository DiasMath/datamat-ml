import Decimal from "decimal.js";
import { z } from "zod";
import { monthlyGoalReport } from "./monthly-goals";
import { db, get, key, type Row } from "./db";
import { authorizeStore, HttpError, type Actor } from "./access";
import { analyticsSources } from "./analytics";
import {
  aggregateAnalytics,
  analysisRange,
  businessDay,
} from "../domain/analytics";
import { calculate, emptyCosts } from "../domain/finance";
import { pendingDecisions, todayQueue, todayWindow } from "../domain/today";
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
    "type",
    "reason",
    "result",
    "evidence",
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
async function buildTodayReport(
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
  const month = day.slice(0, 7);
  const monthQuery = new URLSearchParams({
    store,
    from: month + "-01",
    to: day,
  });
  const [
    raw,
    costs,
    parameterRows,
    proposals,
    tasks,
    competition,
    connections,
    monthlySources,
  ] = await Promise.all([
    scopedRows("offers", ids),
    scopedRows("costs", ids),
    Promise.all(ids.map((id) => get("parameters", id))),
    scopedRows("proposals", ids),
    scopedRows("tasks", ids),
    scopedRows("ml_competition", ids),
    Promise.all(ids.map((id) => get("connections", key(id, "mercadolivre")))),
    analyticsSources(actor, monthQuery, clock),
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
  const report = aggregateAnalytics(
    monthlySources,
    analysisRange(month + "-01", day, clock),
  );
  const monthlyGoal = await monthlyGoalReport(
    actor,
    store,
    clock,
    monthlySources,
  );
  // Monthly priorities use observed revenue for ranking. Daily/weekly decline
  // comparisons remain in Analytics; do not substitute another period here.
  const priorityReport = {
    ...report,
    previous: { ...report.previous, products: [] },
  };
  const ownIds = new Set(
    offers.filter((o) => o.origin !== "reference").map((o) => o.id),
  );
  const pending = proposals.filter(
    (p) =>
      scoped(p) && ownIds.has(p.offer_id) && pendingDecisions.has(p.status),
  );
  const queue = todayQueue(offers, pending, priorityReport, clock.getTime());
  const offerMap = new Map(offers.map((o) => [o.store_id + ":" + o.ml_id, o]));
  const highlights = report.complete
    ? report.current.products
        .flatMap((p) => {
          const offer = offerMap.get(p.storeId + ":" + p.id),
            source = report.stores.find((s) => s.storeId === p.storeId);
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
      period: "month" as const,
      month,
      previousRevenue: null,
      change: null,
      observedAt: observations[0] || null,
      stores: publicStores,
      hours: [],
      days: Array.from({ length: Number(day.slice(8)) }, (_, index) => {
        const date = month + "-" + String(index + 1).padStart(2, "0");
        const rows = report.current.daily.filter((d) => d.day <= date);
        return {
          day: date,
          revenue: report.available
            ? rows
                .reduce((sum, d) => sum.plus(d.revenue), new Decimal(0))
                .toFixed(2)
            : null,
        };
      }),
      day,
    },
    queue,
    monthlyGoal,
    highlights,
    changes,
    monthlyRange: { from: month + "-01", to: day },
  };
}

// Cache computation, not permissions. Revisions are committed atomically with
// writes and read on every request, so separate Vercel instances see mutations.
const reportCache = new Map<
  string,
  { until: number; promise: ReturnType<typeof buildTodayReport> }
>();
async function cachedToday(actor: Actor, store: string, clock: Date) {
  if (store !== "all") authorizeStore(actor, store);
  const selected = actor.stores.filter(
    (s) => store === "all" || s.id === store,
  );
  const revisions = await Promise.all(
    selected.map((s) => get("_today_revisions", s.id)),
  );
  const scope = JSON.stringify([
    actor.organization_id,
    actor.id,
    actor.role,
    actor.name,
    actor.stores.map((s) => [s.id, s.name]),
    store,
    businessDay(clock),
    Math.floor(clock.getTime() / 20000),
    revisions.map((r) => r?.revision || 0),
  ]);
  const entry = reportCache.get(scope);
  if (entry && entry.until > Date.now()) return entry.promise;
  for (const [key, value] of reportCache)
    if (value.until <= Date.now()) reportCache.delete(key);
  if (reportCache.size >= 16)
    reportCache.delete(reportCache.keys().next().value!);
  const promise = buildTodayReport(
    actor,
    new URLSearchParams({ store }),
    clock,
  );
  reportCache.set(scope, { until: Date.now() + 20000, promise });
  try {
    return await promise;
  } catch (error) {
    reportCache.delete(scope);
    throw error;
  }
}
const queueSchema = z
  .object({
    store: z.string().min(1).max(200).default("all"),
    focus: z.enum(["urgent", "review", "prepare"]).optional(),
    decisions: z.boolean().default(false),
    page: z.number().int().min(1).max(100000).default(1),
    showDeferred: z.boolean().default(false),
    deferred: z
      .record(
        z.string().max(200),
        z.object({
          signature: z.string().max(2000),
          until: z.number().finite(),
        }),
      )
      .default({}),
  })
  .refine(
    (p) => Object.keys(p.deferred).length <= 1000,
    "Excesso de revisões adiadas",
  );
function queueSelection(
  report: Awaited<ReturnType<typeof buildTodayReport>>,
  options: z.infer<typeof queueSchema>,
  clock: Date,
) {
  const focus =
    options.focus ||
    (report.summary.urgent
      ? "urgent"
      : report.summary.review
        ? "review"
        : "prepare");
  const all = report.queue.filter((q) =>
    options.decisions ? !!q.proposalId : q.severity === focus,
  );
  const isDeferred = (q: (typeof all)[number]) =>
    q.severity !== "urgent" &&
    options.deferred[q.id]?.until > clock.getTime() &&
    options.deferred[q.id]?.signature ===
      q.reason + ":" + q.evidence + ":" + q.proposalId;
  const postponed = all.filter(isDeferred).length;
  const rows = all.filter((q) => options.showDeferred || !isDeferred(q));
  const pages = Math.max(1, Math.ceil(rows.length / 5)),
    page = Math.min(options.page, pages);
  return {
    rows,
    queue: rows.slice((page - 1) * 5, page * 5),
    queuePage: {
      focus,
      decisions: options.decisions,
      page,
      pages,
      total: rows.length,
      postponed,
      showDeferred: options.showDeferred,
    },
  };
}
export async function todayReport(
  actor: Actor,
  query: URLSearchParams,
  clock = new Date(),
) {
  const report = await cachedToday(actor, query.get("store") || "all", clock);
  const options = queueSchema.parse({
    store: query.get("store") || "all",
    focus: query.get("todayFocus") || undefined,
    page: query.has("todayPage") ? Number(query.get("todayPage")) : 1,
    decisions: query.get("todayDecisions") === "yes",
  });
  const { rows: _rows, ...page } = queueSelection(report, options, clock);
  return { ...report, user: actor, stores: actor.stores, ...page };
}
export async function todayQueuePage(
  actor: Actor,
  payload: unknown,
  clock = new Date(),
) {
  const options = queueSchema.parse(payload);
  const report = await cachedToday(actor, options.store, clock);
  const { rows: _rows, ...page } = queueSelection(report, options, clock);
  return page;
}
export async function nextTodayOffer(
  actor: Actor,
  payload: unknown,
  clock = new Date(),
) {
  const p = z
    .object({
      store: z.string().min(1).max(200),
      focus: z.enum(["urgent", "review", "prepare"]),
      decisions: z.boolean().default(false),
      currentId: z.string().max(200).optional(),
      skipped: z.array(z.string().min(1).max(200)).max(5000).default([]),
    })
    .parse(payload);
  authorizeStore(actor, p.store);
  if (p.currentId) {
    const current = await get("offers", p.currentId);
    if (
      !current ||
      current.store_id !== p.store ||
      (current.organization_id &&
        current.organization_id !== actor.organization_id)
    )
      throw new HttpError(404, "Anúncio indisponível nesta loja");
  }
  const report = await cachedToday(actor, p.store, clock);
  const skipped = new Set([...p.skipped, p.currentId]);
  const rows = report.queue.filter(
    (q) =>
      q.tab === "costs" &&
      (p.decisions ? !!q.proposalId : q.severity === p.focus) &&
      !skipped.has(q.id),
  );
  const next = rows[0];
  return {
    next: next
      ? { id: next.id, title: next.title, storeId: next.storeId }
      : null,
    remaining: rows.length,
  };
}
