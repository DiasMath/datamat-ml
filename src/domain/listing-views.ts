import { z } from "zod";

export const optionalListingColumns = [
  "store",
  "brand",
  "sku",
  "status",
  "price",
  "conditions",
  "settlement",
  "metrics",
  "quality",
  "margin",
  "pending",
  "updated",
] as const;
export type ListingColumnId = (typeof optionalListingColumns)[number];
const values = z
  .array(z.string().trim().min(1).max(200))
  .max(30)
  .transform((v) => [...new Set(v)].sort());
export const listingViewConfigSchema = z
  .object({
    filters: z
      .object({
        q: z.string().trim().max(200).optional(),
        category: values.optional(),
        brand: values.optional(),
        status: z
          .array(z.enum(["draft", "active", "paused", "closed"]))
          .max(4)
          .optional(),
        type: z
          .array(z.enum(["unit", "kit", "variation"]))
          .max(3)
          .optional(),
        pending: z.enum(["yes", "costs", "ml", "ownCosts", "ready"]).optional(),
        listingKind: z.enum(["catalog", "traditional", "local"]).optional(),
        sort: z.enum(["name", ...optionalListingColumns]).default("updated"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
        pageSize: z.enum(["20", "50", "100"]).default("50"),
        tableView: z.enum(["operational", "registry"]),
      })
      .strict(),
    hiddenColumns: z
      .array(z.enum(optionalListingColumns))
      .max(optionalListingColumns.length)
      .transform((v) => [...new Set(v)].sort()),
  })
  .strict();
export type ListingViewConfig = z.infer<typeof listingViewConfigSchema>;
export type ListingView = {
  id: string;
  name: string;
  version: number;
  config: ListingViewConfig;
  updatedAt: string;
};
const filterKeys = [
  "q",
  "brand",
  "category",
  "status",
  "type",
  "pending",
  "listingKind",
  "sort",
  "sortDir",
  "pageSize",
  "tableView",
];
export function captureListingView(
  query: URLSearchParams,
  operational: boolean,
  hiddenColumns: string[],
): ListingViewConfig {
  const filters: Record<string, unknown> = {};
  for (const key of filterKeys) {
    const entries = query.getAll(key).filter(Boolean);
    if (entries.length)
      filters[key] = ["brand", "category", "status", "type"].includes(key)
        ? [...new Set(entries)].sort()
        : entries[0];
  }
  filters.tableView = operational ? "operational" : "registry";
  if (filters.sort === "stock") filters.sort = "updated";
  if (
    (operational && ["store", "brand", "sku"].includes(String(filters.sort))) ||
    (!operational &&
      ["conditions", "settlement", "metrics", "quality"].includes(
        String(filters.sort),
      ))
  ) {
    delete filters.sort;
    delete filters.sortDir;
  }
  if (!filters.sortDir && filters.sort === "name") filters.sortDir = "asc";
  // Old or manually edited URLs must not prevent saving a valid current view.
  for (const key of Object.keys(filters)) {
    const field =
      listingViewConfigSchema.shape.filters.shape[
        key as keyof typeof listingViewConfigSchema.shape.filters.shape
      ];
    if (field && !field.safeParse(filters[key]).success) delete filters[key];
  }
  return listingViewConfigSchema.parse({
    filters,
    hiddenColumns: hiddenColumns.filter((id) =>
      optionalListingColumns.includes(id as ListingColumnId),
    ),
  });
}
export function applyListingView(
  query: URLSearchParams,
  config: ListingViewConfig,
) {
  const next = new URLSearchParams(query);
  for (const key of [...filterKeys, "page"]) next.delete(key);
  for (const [key, value] of Object.entries(config.filters)) {
    if (Array.isArray(value)) {
      for (const item of value) next.append(key, item);
    } else if (value) next.set(key, value);
  }
  return next;
}
export function listingViewSignature(config: ListingViewConfig) {
  const normalized = listingViewConfigSchema.parse(config);
  // Omitted and empty filters, duplicates and filter order have the same meaning.
  const filters = Object.entries(normalized.filters)
    .filter(([, v]) => (Array.isArray(v) ? v.length : !!v))
    .map(([key, v]) => [key, Array.isArray(v) ? [...new Set(v)].sort() : v]);
  return JSON.stringify([filters, normalized.hiddenColumns]);
}
