import { createHash } from "node:crypto";
import { z } from "zod";
import {
  marketResourceSchema,
  type MarketResource,
  type MarketObservation,
} from "../../src/domain/market-research";

export const marketConfigSchema = z
  .object({
    store_id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    application_id: z.string().regex(/^\d{1,30}$/),
    interval_seconds: z.number().min(2).max(60).default(2),
    max_resources: z.number().int().min(1).max(500).default(200),
    target_brands: z.array(z.string().min(1).max(80)).min(1).max(20),
    seed_item_ids: z.array(z.string().regex(/^MLB\d{1,20}$/)).max(100),
    search_queries: z.array(z.string().trim().min(2).max(120)).max(20),
  })
  .strict();
export type MarketConfig = z.infer<typeof marketConfigSchema>;
export type MarketState = {
  version: 1;
  config_hash: string;
  started_at: string;
  updated_at: string;
  tasks: MarketResource[];
  done: string[];
  observations: MarketObservation[];
  brands_by_category: Record<string, string[]>;
  stopped_reason: string | null;
  next_allowed_at: string | null;
  resource_limit_reached: boolean;
};
export const taskKey = (task: MarketResource) =>
  JSON.stringify(marketResourceSchema.parse(task));
export const configHash = (config: MarketConfig) =>
  createHash("sha256").update(JSON.stringify(config)).digest("hex");
export function startMarketQueue(config: MarketConfig): MarketState {
  const state: MarketState = {
    version: 1,
    config_hash: configHash(config),
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tasks: [],
    done: [],
    observations: [],
    brands_by_category: {},
    stopped_reason: null,
    next_allowed_at: null,
    resource_limit_reached: false,
  };
  // Known advertisements are stronger starting points than text categorization.
  for (const id of config.seed_item_ids)
    enqueue(state, { kind: "item", id }, config);
  for (const query of config.search_queries)
    enqueue(state, { kind: "discover", query }, config);
  return state;
}
function enqueue(
  state: MarketState,
  task: MarketResource,
  config: MarketConfig,
) {
  const key = taskKey(task);
  if (state.tasks.some((t) => taskKey(t) === key)) return;
  if (state.tasks.length >= config.max_resources) {
    state.resource_limit_reached = true;
    state.stopped_reason = "resource_limit";
    return;
  }
  state.tasks.push(task);
}
export function nextMarketTask(state: MarketState) {
  return state.tasks.find((t) => !state.done.includes(taskKey(t)));
}
function isMlId(value: unknown): value is string {
  return typeof value === "string" && /^MLB\d{1,20}$/.test(value);
}
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((a) => a && typeof a === "object")
    : [];
}
export function acceptMarketObservation(
  state: MarketState,
  observation: MarketObservation,
  config: MarketConfig,
) {
  state.observations.push(observation);
  state.updated_at = observation.collected_at;
  state.next_allowed_at = null;
  if (!["ok", "unavailable"].includes(observation.status)) {
    state.stopped_reason = observation.status;
    if (observation.status === "rate_limited")
      state.next_allowed_at = new Date(Date.now() + 60000).toISOString();
    return false;
  }
  const key = taskKey(observation.resource);
  if (!state.done.includes(key)) state.done.push(key);
  const data = observation.data;
  if (!data) return true;
  const resource = observation.resource;
  if (resource.kind === "item" && isMlId(data.category_id)) {
    const category = data.category_id;
    const brands = (state.brands_by_category[category] ||= []);
    for (const attr of asRows(data.attributes)) {
      if (
        attr.id === "BRAND" &&
        typeof attr.value_name === "string" &&
        config.target_brands.some(
          (b) =>
            b.toUpperCase() ===
            attr.value_name!.toString().trim().toUpperCase(),
        ) &&
        typeof attr.value_id === "string" &&
        /^\d{1,20}$/.test(attr.value_id) &&
        !brands.includes(attr.value_id)
      )
        brands.push(attr.value_id);
    }
    enqueue(state, { kind: "category", id: category }, config);
    // Category may already have been read before a later item's brand was seen.
    if (
      state.observations.some(
        (o) =>
          o.status === "ok" &&
          o.resource.kind === "category" &&
          o.resource.id === category &&
          o.data?.leaf === true,
      )
    )
      for (const brand_id of brands)
        enqueue(
          state,
          { kind: "ranking", category_id: category, brand_id },
          config,
        );
  }
  if (resource.kind === "discover")
    for (const category of asRows(data.categories))
      if (isMlId(category.category_id))
        enqueue(state, { kind: "category", id: category.category_id }, config);
  if (resource.kind === "category" && data.leaf === true) {
    enqueue(state, { kind: "ranking", category_id: resource.id }, config);
    for (const brand_id of state.brands_by_category[resource.id] || [])
      enqueue(
        state,
        { kind: "ranking", category_id: resource.id, brand_id },
        config,
      );
  }
  if (resource.kind === "ranking")
    for (const entry of asRows(data.entries)) {
      // USER_PRODUCT is a different resource and must not be queried as an item.
      if (
        isMlId(entry.id) &&
        (entry.type === "ITEM" || entry.type === "PRODUCT")
      )
        enqueue(
          state,
          { kind: entry.type === "ITEM" ? "item" : "product", id: entry.id },
          config,
        );
    }
  return true;
}
export function marketCsv(state: MarketState) {
  const columns = [
    "collected_at",
    "kind",
    "id_or_query",
    "brand_filter",
    "status",
    "http_status",
    "title",
    "category_id",
    "price",
    "currency",
    "sold_quantity_returned",
    "sales_7d",
    "sales_30d",
    "source",
    "note",
  ];
  const cell = (v: unknown) => {
    let text = v === null || v === undefined ? "" : String(v);
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = state.observations.map((o) => {
    const r = o.resource,
      d = o.data;
    return [
      o.collected_at,
      r.kind,
      r.kind === "discover"
        ? r.query
        : r.kind === "ranking"
          ? r.category_id
          : r.id,
      r.kind === "ranking" ? r.brand_id : null,
      o.status,
      o.http_status,
      d?.title ?? d?.name,
      d?.category_id,
      d?.price,
      d?.currency_id,
      d?.sold_quantity_returned,
      null,
      null,
      o.source,
      o.note ?? d?.counter_scope ?? d?.scope,
    ];
  });
  return [columns, ...rows].map((r) => r.map(cell).join(";")).join("\n") + "\n";
}
