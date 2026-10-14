import { z } from "zod";

const mlId = z.string().regex(/^MLB\d{1,20}$/);
export const marketResourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("discover"),
      query: z.string().trim().min(2).max(120),
    })
    .strict(),
  z.object({ kind: z.literal("item"), id: mlId }).strict(),
  z.object({ kind: z.literal("product"), id: mlId }).strict(),
  z.object({ kind: z.literal("category"), id: mlId }).strict(),
  z
    .object({
      kind: z.literal("ranking"),
      category_id: mlId,
      brand_id: z
        .string()
        .regex(/^\d{1,20}$/)
        .optional(),
    })
    .strict(),
]);
export type MarketResource = z.infer<typeof marketResourceSchema>;
export type PublicData = Record<string, unknown>;
export function marketPath(input: MarketResource) {
  const resource = marketResourceSchema.parse(input);
  switch (resource.kind) {
    case "discover":
      return `/sites/MLB/domain_discovery/search?limit=3&q=${encodeURIComponent(resource.query)}`;
    case "item":
      return `/items/${resource.id}`;
    case "product":
      return `/products/${resource.id}`;
    case "category":
      return `/categories/${resource.id}`;
    case "ranking":
      return `/highlights/MLB/category/${resource.category_id}${resource.brand_id ? `?attribute=BRAND&attributeValue=${resource.brand_id}` : ""}`;
  }
}
function row(value: unknown): PublicData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PublicData)
    : {};
}
function list(value: unknown): PublicData[] {
  return Array.isArray(value) ? value.map(row) : [];
}
function str(value: unknown) {
  return typeof value === "string" ? value : null;
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
function integer(value: unknown) {
  const n = number(value);
  return n !== null && Number.isSafeInteger(n) ? n : null;
}
function attributes(value: unknown) {
  return list(value)
    .slice(0, 200)
    .map((a) => ({
      id: str(a.id),
      name: str(a.name),
      value_id: str(a.value_id),
      value_name: str(a.value_name),
    }));
}
function publicUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "mercadolivre.com.br" ||
        url.hostname.endsWith(".mercadolivre.com.br"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function normalizeMarketData(
  resource: MarketResource,
  value: unknown,
): PublicData {
  if (resource.kind === "discover") {
    if (!Array.isArray(value))
      throw new Error("Resposta de categorias inválida");
    return {
      categories: list(value)
        .slice(0, 8)
        .map((a) => ({
          category_id: str(a.category_id),
          category_name: str(a.category_name),
          domain_id: str(a.domain_id),
          attributes: attributes(a.attributes),
        })),
      demand_evidence: false,
    };
  }
  const data = row(value);
  if (resource.kind === "ranking") {
    if (!Array.isArray(data.content))
      throw new Error("Resposta de ranking inválida");
    return {
      category_id: resource.category_id,
      brand_id: resource.brand_id ?? null,
      entries: list(data.content)
        .slice(0, 20)
        .map((a) => ({
          id: str(a.id),
          type: ["ITEM", "PRODUCT", "USER_PRODUCT"].includes(String(a.type))
            ? a.type
            : "UNKNOWN",
          position: integer(a.position),
        })),
      units_sold: null,
      monthly_sales: null,
      scope:
        "Posição no ranking oficial da categoria/filtro; não informa volume mensal",
    };
  }
  if (data.id !== resource.id)
    throw new Error("Resposta não corresponde ao identificador solicitado");
  if (resource.kind === "category") {
    if (!Array.isArray(data.children_categories))
      throw new Error("Categoria sem informação de subcategorias");
    return {
      id: data.id,
      name: str(data.name),
      leaf: data.children_categories.length === 0,
      children: list(data.children_categories).map((a) => ({
        id: str(a.id),
        name: str(a.name),
      })),
    };
  }
  if (resource.kind === "product")
    return {
      id: data.id,
      name: str(data.name),
      status: str(data.status),
      domain_id: str(data.domain_id),
      attributes: attributes(data.attributes),
      monthly_sales: null,
    };
  const count = integer(data.sold_quantity);
  const shipping = row(data.shipping);
  return {
    id: data.id,
    title: str(data.title),
    category_id: str(data.category_id),
    catalog_product_id: str(data.catalog_product_id),
    seller_id: integer(data.seller_id),
    status: str(data.status),
    condition: str(data.condition),
    price: number(data.price),
    original_price: number(data.original_price),
    currency_id: str(data.currency_id),
    permalink: publicUrl(data.permalink),
    attributes: attributes(data.attributes),
    variations: list(data.variations)
      .slice(0, 500)
      .map((a) => ({
        id: integer(a.id),
        price: number(a.price),
        attributes: attributes(a.attribute_combinations),
      })),
    shipping: {
      logistic_type: str(shipping.logistic_type),
      free_shipping:
        typeof shipping.free_shipping === "boolean"
          ? shipping.free_shipping
          : null,
    },
    sold_quantity_returned: count,
    counter_status: count === null ? "not_returned" : "returned",
    counter_scope:
      "Valor retornado pela API no anúncio; exatidão e janela temporal não confirmadas; não atribuir às variações",
    sales_7d: null,
    sales_30d: null,
    rating: null,
    reviews_count: null,
  };
}

export type MarketObservation = {
  resource: MarketResource;
  source: string;
  collected_at: string;
  status:
    | "ok"
    | "unavailable"
    | "blocked"
    | "rate_limited"
    | "auth_required"
    | "error";
  http_status: number | null;
  data: PublicData | null;
  note: string | null;
};
// The legacy transport maps some upstream failures to 502. Recover only its
// sanitized HTTP status; never persist raw response bodies or SDK errors.
export function marketFailure(
  resource: MarketResource,
  error: unknown,
): MarketObservation {
  const e = row(error);
  const match =
    typeof e.message === "string"
      ? /^Mercado Livre retornou HTTP (\d{3});/.exec(e.message)
      : null;
  const code = match ? Number(match[1]) : integer(e.status);
  const status =
    code === 403
      ? "blocked"
      : code === 401 || code === 409
        ? "auth_required"
        : code === 429
          ? "rate_limited"
          : code === 404
            ? "unavailable"
            : "error";
  const note =
    status === "blocked"
      ? "A API negou acesso (403); não repetir automaticamente nem interpretar como zero vendas."
      : status === "unavailable"
        ? "Recurso ou ranking indisponível (404); ausência não significa zero vendas."
        : status === "rate_limited"
          ? "Limite de consultas atingido; pausar pelo menos 60 segundos antes de retomar."
          : status === "auth_required"
            ? "Verifique a conexão existente e sua autorização."
            : "Consulta não concluída; detalhes internos não foram exportados.";
  return {
    resource,
    source: `https://api.mercadolibre.com${marketPath(resource)}`,
    collected_at: new Date().toISOString(),
    status,
    http_status: code,
    data: null,
    note,
  };
}
