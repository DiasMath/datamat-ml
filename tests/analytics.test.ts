import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  aggregateAnalytics,
  analysisRange,
  businessDay,
  changeRate,
  salesSummary,
  shiftDay,
  type SaleOrder,
  type StoreAnalysis,
} from "../src/domain/analytics";
import { analyticsReport, refreshAnalytics } from "../src/server/analytics";
import { initializeDatabase, get, put, find, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import { encryptSecret } from "../src/server/mercadolivre";
import { saveOffer, saveCosts, saveParameters } from "../src/server/services";

const clock = new Date("2026-10-11T15:00:00Z");
const range = analysisRange("2026-10-11", "2026-10-11", clock);
const sale = (id: string, overrides: Partial<SaleOrder> = {}): SaleOrder => ({
  id,
  storeId: "a",
  created: "2026-10-11T14:00:00Z",
  status: "paid",
  shipmentId: null,
  lines: [
    {
      itemId: "MLB1",
      title: "Produto",
      quantity: 3,
      price: "0.10",
      fee: "0.01",
      contribution: "0.02",
      offerId: "offer",
    },
  ],
  ...overrides,
});
const source = (
  orders: SaleOrder[],
  overrides: Partial<StoreAnalysis> = {},
): StoreAnalysis => ({
  storeId: "a",
  storeName: "Loja A",
  connected: true,
  sellerId: "111",
  authVersion: 1,
  observedAt: clock.toISOString(),
  complete: true,
  totalReported: orders.length,
  orders,
  visits: [{ day: "2026-10-11", visits: 100 }],
  unanswered: 0,
  reputation: null,
  shipping: null,
  warnings: [],
  error: null,
  ...overrides,
});
test("analytics uses Brasília day boundaries and equal elapsed time for live comparisons", () => {
  assert.equal(businessDay("2026-10-11T02:59:59Z"), "2026-10-10");
  assert.equal(new Date(range.start).toISOString(), "2026-10-11T03:00:00.000Z");
  assert.equal(
    new Date(range.previousEnd).toISOString(),
    "2026-10-10T15:00:00.000Z",
  );
  assert.equal(
    range.end - range.start,
    range.previousEnd - range.previousStart,
  );
  for (const [from, to] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-01-01", "2026-10-11"],
    ["2026-10-12", "2026-10-12"],
    ["2026-10-11", "2026-10-10"],
  ])
    assert.throws(() => analysisRange(from, to, clock));
});
test("sales analytics keeps decimal precision, actual status, units and fee coverage", () => {
  const result = salesSummary(
    [
      sale("1"),
      sale("2", { status: "cancelled" }),
      sale("3", { status: "payment_required" }),
    ],
    range.start,
    range.end,
  );
  assert.equal(result.revenue, "0.30");
  assert.equal(result.fees, "0.03");
  assert.equal(result.contribution, "0.06");
  assert.equal(result.paidOrders, 1);
  assert.equal(result.units, 3);
  assert.equal(result.cancelled, 1);
  assert.equal(result.otherOrders, 1);
  assert.equal(result.cancellationRate, "33.33");
  assert.equal(result.hourly[11].orders, 1);
  assert.equal(result.contributionCoverage, "100.00");
});
test("missing costs are excluded rather than treated as zero profit", () => {
  const missing = sale("2");
  missing.lines[0].contribution = null;
  missing.lines[0].fee = null;
  const result = salesSummary([sale("1"), missing], range.start, range.end);
  assert.equal(result.contributionCoverage, "50.00");
  assert.equal(result.feeCoverage, "50.00");
  assert.equal(result.contribution, "0.06");
  assert.equal(result.contributionPercent, "20.00");
});
test("duplicate order IDs do not multiply sales and store identities stay separate", () => {
  const other = sale("1", { storeId: "b" });
  const result = aggregateAnalytics(
    [source([sale("1"), sale("1")]), source([other], { storeId: "b" })],
    range,
  );
  assert.equal(result.current.paidOrders, 2);
  assert.equal(result.current.revenue, "0.60");
  assert.equal(result.current.products.length, 2);
});
test("partial or disconnected stores suspend misleading comparisons and visits totals", () => {
  const result = aggregateAnalytics(
    [
      source([sale("1")]),
      source([], { connected: false, visits: null, observedAt: null }),
    ],
    range,
  );
  assert.equal(result.complete, false);
  assert.equal(result.visits, null);
  assert.equal(result.changes, null);
  assert.equal(result.orderVisitRate, null);
  assert.equal(changeRate("10", "0"), null);
  const empty = aggregateAnalytics(
    [source([], { connected: false, observedAt: null })],
    range,
  );
  assert.equal(empty.available, false);
});
test("live comparisons exclude previous-day orders after the equivalent cutoff", () => {
  const result = aggregateAnalytics(
    [
      source([
        sale("1"),
        sale("2", { created: "2026-10-10T14:00:00Z" }),
        sale("3", { created: "2026-10-10T19:00:00Z" }),
      ]),
    ],
    range,
  );
  assert.equal(result.previous.paidOrders, 1);
  assert.equal(result.changes?.revenue, "0.00");
});

let actor: Actor,
  version = 10;
const connectionId = key("juntos-com", "mercadolivre");
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-datamat-analytics-" + randomUUID();
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "test-not-real";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  await initializeDatabase();
  actor = await workspaceActor();
});
async function account() {
  version++;
  await put("connections", connectionId, {
    store_id: "juntos-com",
    provider: "mercadolivre",
    external_account: "111",
    status: "connected",
    auth_version: version,
  });
  await put("ml_tokens", connectionId, {
    auth_version: version,
    encrypted: encryptSecret({
      access_token: "test-analytics-access",
      refresh_token: "test-analytics-refresh",
    }),
    expires_at: Date.now() + 3600000,
  });
}
const query = () =>
  new URLSearchParams({
    store: "juntos-com",
    from: businessDay(),
    to: businessDay(),
  });
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const order = (id = 1, overrides: Record<string, any> = {}) => ({
  id,
  seller: { id: 111 },
  date_created: new Date(Date.now() - 60000).toISOString(),
  status: "paid",
  currency_id: "BRL",
  shipping: { id: 99 },
  buyer: { first_name: "PRIVATE BUYER", email: "private@example.test" },
  order_items: [
    {
      item: { id: "MLB100", title: "Produto vendido" },
      quantity: 2,
      unit_price: 25.1,
      sale_fee: 2.5,
    },
  ],
  ...overrides,
});
async function mocked<T>(
  handler: (url: URL) => Response | Promise<Response>,
  work: () => Promise<T>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.mercadolibre.com");
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      "Bearer test-analytics-access",
    );
    return handler(url);
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}
function extras(url: URL) {
  if (url.pathname === "/users/111")
    return json({
      id: 111,
      seller_reputation: {
        level_id: "5_green",
        transactions: { completed: 500, canceled: 3, period: "historic" },
      },
    });
  if (url.pathname === "/questions/search") return json({ total: 2 });
  if (url.pathname.endsWith("items_visits"))
    return json([{ date: businessDay(), total: 100 }]);
  if (url.pathname === "/shipments/99")
    return json({ id: 99, sender_id: 111, status: "ready_to_ship" });
  throw new Error("Endpoint inesperado: " + url.pathname);
}
test("account analytics paginates, deduplicates shipments, caches and never persists buyer data", async () => {
  await account();
  let calls = 0;
  const result = await mocked(
    (url) => {
      calls++;
      if (url.pathname === "/orders/search") {
        assert.equal(url.searchParams.get("seller"), "111");
        return json({
          paging: { total: 2 },
          results: [order(1), order(2, { status: "cancelled" })],
        });
      }
      return extras(url);
    },
    () => refreshAnalytics(actor, query()),
  );
  assert.equal(result.complete, true);
  assert.equal(result.current.revenue, "50.20");
  assert.equal(result.current.cancelled, 1);
  assert.equal(result.visits, 100);
  assert.equal(result.stores[0].unanswered, 2);
  assert.equal(result.stores[0].shipping?.sampled, 1);
  assert.equal(result.current.contribution, null);
  const saved = (await find("ml_analytics", { store_id: "juntos-com" })).find(
    (row) => row.auth_version === version,
  )!;
  assert.ok(saved);
  assert.ok(!saved.data_json.includes("PRIVATE BUYER"));
  assert.ok(!saved.data_json.includes("private@example.test"));
  assert.ok(!saved.data_json.includes("test-analytics-access"));
  const before = calls;
  await mocked(
    () => {
      calls++;
      throw new Error("Não deveria consultar novamente");
    },
    () => refreshAnalytics(actor, query()),
  );
  assert.equal(calls, before);
  assert.equal(
    (await analyticsReport(actor, query())).current.revenue,
    "50.20",
  );
});
test("an analytics snapshot is hidden after the seller authorization changes", async () => {
  await account();
  const report = await analyticsReport(actor, query());
  assert.equal(report.available, false);
  assert.equal(report.stores[0].observedAt, null);
});
test("contribution uses sold price and excludes stale costs instead of extrapolating current margins", async () => {
  await account();
  await saveParameters(actor, "juntos-com", {
    minMargin: "10",
    desiredMargin: "20",
    taxRate: "0",
    taxBase: "price",
    managementRate: "0",
    managementBase: "price",
    reviewDays: 30,
  });
  const offer = await saveOffer(actor, {
    storeId: "juntos-com",
    name: "Produto da análise",
    title: "Produto da análise",
    mlId: "MLB100",
    sku: "analysis",
    brand: "Marca",
    category: "Categoria",
    type: "unit",
    status: "active",
    price: "100",
  });
  await saveCosts(actor, offer.id, {
    goods: "10",
    mlPercent: "10",
    mlFixed: "0",
    shipping: "0",
    packaging: "0",
    advertising: "0",
    other: "0",
  });
  const stored = await get("offers", offer.id);
  await put("offers", offer.id, {
    ...stored,
    ml: { sellerId: "111", authVersion: version, variablePrices: false },
  });
  const handler = (url: URL) =>
    url.pathname === "/orders/search"
      ? json({ paging: { total: 1 }, results: [order(1, { shipping: null })] })
      : extras(url);
  let report = await mocked(handler, () => refreshAnalytics(actor, query()));
  assert.equal(report.current.contribution, "25.18");
  assert.equal(report.current.contributionCoverage, "100.00");
  const costs = await get("costs", offer.id);
  await put("costs", offer.id, {
    ...costs,
    updated_at: new Date(Date.now() - 31 * 86400000).toISOString(),
  });
  const snapshot = (
    await find("ml_analytics", { store_id: "juntos-com" })
  ).find((r) => r.auth_version === version)!;
  await put("ml_analytics", snapshot.id, {
    ...snapshot,
    updated_at: new Date(Date.now() - 60000).toISOString(),
  });
  report = await mocked(handler, () => refreshAnalytics(actor, query()));
  assert.equal(report.current.contribution, null);
  assert.equal(report.current.contributionCoverage, "0.00");
});
test("concurrent refreshes reserve one seller query without duplicating API calls", async () => {
  await account();
  let requests = 0;
  const reports = await mocked(
    async (url) => {
      if (url.pathname === "/orders/search") {
        requests++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return json({ paging: { total: 0 }, results: [] });
      }
      return extras(url);
    },
    () =>
      Promise.all([
        refreshAnalytics(actor, query()),
        refreshAnalytics(actor, query()),
      ]),
  );
  assert.equal(requests, 1);
  assert.ok(reports.some((r) => r.available));
});
test("cross-seller orders are rejected without exposing foreign orders", async () => {
  await account();
  const report = await mocked(
    (url) =>
      url.pathname === "/orders/search"
        ? json({
            paging: { total: 1 },
            results: [order(1, { seller: { id: 222 } })],
          })
        : extras(url),
    () => refreshAnalytics(actor, query()),
  );
  assert.equal(report.available, false);
  assert.equal(report.current.paidOrders, 0);
  assert.match(report.stores[0].error!, /outra conta/);
});
test("optional metrics failures preserve complete sales and do not invent visits", async () => {
  await account();
  const report = await mocked(
    (url) =>
      url.pathname === "/orders/search"
        ? json({
            paging: { total: 1 },
            results: [order(1, { shipping: null })],
          })
        : json({ error: "forbidden" }, 403),
    () => refreshAnalytics(actor, query()),
  );
  assert.equal(report.complete, true);
  assert.equal(report.current.paidOrders, 1);
  assert.equal(report.visits, null);
  assert.equal(report.orderVisitRate, null);
  assert.equal(report.stores[0].unanswered, null);
});
test("empty pages and malformed periods produce visible errors; foreign stores are blocked", async () => {
  await account();
  const report = await mocked(
    () => json({ paging: { total: 10 }, results: [] }),
    () => refreshAnalytics(actor, query()),
  );
  assert.equal(report.available, false);
  assert.match(report.stores[0].error!, /incompleta/);
  await assert.rejects(
    analyticsReport(actor, new URLSearchParams({ store: "foreign" })),
    /Loja não encontrada/,
  );
  await assert.rejects(
    analyticsReport(actor, new URLSearchParams({ from: "invalid" })),
    /datas válidas/,
  );
  await assert.rejects(
    refreshAnalytics({ ...actor, role: "viewer" }, query()),
    /somente de consulta/,
  );
});
test("large periods return identified partial results rather than false complete totals", async () => {
  await account();
  const report = await mocked(
    (url) => {
      if (url.pathname === "/orders/search") {
        const offset = Number(url.searchParams.get("offset"));
        return json({
          paging: { total: 1001 },
          results: Array.from({ length: 50 }, (_, i) =>
            order(offset + i + 1, { shipping: null }),
          ),
        });
      }
      return extras(url);
    },
    () => refreshAnalytics(actor, query()),
  );
  assert.equal(report.current.paidOrders, 1000);
  assert.equal(report.complete, false);
  assert.equal(report.changes, null);
  assert.ok(report.warnings.some((w) => w.includes("1.000")));
});
test("failed updates preserve the last snapshot and mark comparisons as unavailable", async () => {
  const row = (await find("ml_analytics", { store_id: "juntos-com" })).find(
    (r) => r.auth_version === version,
  )!;
  await put("ml_analytics", row.id, {
    ...row,
    updated_at: new Date(Date.now() - 60000).toISOString(),
  });
  const report = await mocked(
    () => json({ message: "unauthorized" }, 401),
    () => refreshAnalytics(actor, query()),
  );
  assert.equal(report.available, true);
  assert.equal(report.current.paidOrders, 1000);
  assert.equal(report.complete, false);
  assert.ok(report.stores[0].error);
});
