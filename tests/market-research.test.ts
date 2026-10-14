import { test } from "node:test";
import assert from "node:assert/strict";
import { readMarketResource } from "../src/server/market-research";
import {
  marketPath,
  marketResourceSchema,
  normalizeMarketData,
  marketFailure,
  type MarketObservation,
  type MarketResource,
} from "../src/domain/market-research";
import {
  marketConfigSchema,
  startMarketQueue,
  acceptMarketObservation,
  nextMarketTask,
  marketCsv,
  configHash,
} from "../scripts/lib/market-queue";

const config = marketConfigSchema.parse({
  store_id: "juntos-data",
  application_id: "123456",
  target_brands: ["DUTOTEC", "QTMOV"],
  seed_item_ids: ["MLB1", "MLB1"],
  search_queries: [],
});
const observation = (
  resource: MarketResource,
  data: Record<string, unknown>,
): MarketObservation => ({
  resource,
  data,
  status: "ok",
  http_status: 200,
  collected_at: "2026-10-14T20:00:00.000Z",
  source: "https://api.mercadolibre.com" + marketPath(resource),
  note: null,
});

test("a store outside the actor's grants is rejected before database or provider access", async () => {
  await assert.rejects(
    readMarketResource(
      {
        id: "viewer",
        organization_id: "datamat",
        name: "Viewer",
        email: "",
        role: "viewer",
        stores: [],
      },
      "juntos-data",
      config.application_id,
      { kind: "item", id: "MLB1" },
    ),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404,
      ),
  );
});

test("only documented read resources are accepted; query text cannot change the API path", () => {
  assert.equal(
    marketPath({ kind: "discover", query: "tomadas &limit=99" }),
    "/sites/MLB/domain_discovery/search?limit=3&q=tomadas%20%26limit%3D99",
  );
  assert.equal(
    marketPath({ kind: "ranking", category_id: "MLB123", brand_id: "456" }),
    "/highlights/MLB/category/MLB123?attribute=BRAND&attributeValue=456",
  );
  for (const input of [
    { kind: "item", id: "MLB1/../../users/me" },
    { kind: "item", id: "MLB1", token: "secret" },
    { kind: "ranking", category_id: "MLB1", brand_id: "1&foo=2" },
    { kind: "orders", id: "MLB1" },
  ])
    assert.equal(marketResourceSchema.safeParse(input).success, false);
});
test("absent or invalid counters remain unknown; zero is preserved only when actually returned", () => {
  const r = { kind: "item", id: "MLB1" } as const;
  for (const count of [undefined, null, "1000", -1, 1.5]) {
    const data = normalizeMarketData(r, { id: "MLB1", sold_quantity: count });
    assert.equal(data.sold_quantity_returned, null);
    assert.equal(data.counter_status, "not_returned");
    assert.equal(data.price, null);
  }
  assert.equal(
    normalizeMarketData(r, { id: "MLB1", sold_quantity: 0 })
      .sold_quantity_returned,
    0,
  );
  const data = normalizeMarketData(r, {
    id: "MLB1",
    sold_quantity: 1000,
    variations: [
      {
        id: 3,
        sold_quantity: 500,
        price: 99,
        attribute_combinations: [{ id: "COLOR", value_name: "Branco" }],
      },
    ],
  });
  assert.equal(data.sales_7d, null);
  assert.equal(data.sales_30d, null);
  assert.equal(
    (data.variations as Record<string, unknown>[])[0].sold_quantity,
    undefined,
  );
});
test("normalization excludes tokens, arbitrary fields and untrusted URLs; wrong response IDs fail", () => {
  const result = normalizeMarketData(
    { kind: "item", id: "MLB1" },
    {
      id: "MLB1",
      access_token: "DO_NOT_EXPORT",
      client_secret: "DO_NOT_EXPORT",
      permalink: "https://evil.example/MLB1",
      attributes: [
        { id: "BRAND", value_name: "QTMOV", token: "DO_NOT_EXPORT" },
      ],
    },
  );
  assert.equal(result.permalink, null);
  assert.equal(JSON.stringify(result).includes("DO_NOT_EXPORT"), false);
  assert.throws(
    () => normalizeMarketData({ kind: "item", id: "MLB1" }, { id: "MLB2" }),
    /identificador/,
  );
  assert.throws(
    () => normalizeMarketData({ kind: "ranking", category_id: "MLB1" }, {}),
    /ranking/,
  );
});
test("sanitized upstream 403 is recovered from legacy 502; error payloads never become sales evidence", () => {
  const error = Object.assign(
    new Error(
      "Mercado Livre retornou HTTP 403; confira as permissões da aplicação e tente novamente",
    ),
    { status: 502, token: "DO_NOT_EXPORT" },
  );
  const blocked = marketFailure({ kind: "item", id: "MLB1" }, error);
  assert.equal(blocked.http_status, 403);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.data, null);
  assert.equal(JSON.stringify(blocked).includes("DO_NOT_EXPORT"), false);
  const missing = marketFailure(
    { kind: "ranking", category_id: "MLB1" },
    Object.assign(
      new Error(
        "Mercado Livre retornou HTTP 404; confira as permissões da aplicação e tente novamente",
      ),
      { status: 502 },
    ),
  );
  assert.equal(missing.status, "unavailable");
  assert.match(missing.note!, /não significa zero/);
});
test("blocked and throttled tasks remain pending; resume retains completed observations", () => {
  const state = startMarketQueue(config);
  assert.equal(state.tasks.length, 1);
  const failed = marketFailure(state.tasks[0], { status: 403 });
  assert.equal(acceptMarketObservation(state, failed, config), false);
  assert.equal(state.done.length, 0);
  assert.equal(nextMarketTask(state)?.kind, "item");
  assert.equal(
    acceptMarketObservation(
      state,
      marketFailure(state.tasks[0], { status: 429 }),
      config,
    ),
    false,
  );
  assert.ok(Date.parse(state.next_allowed_at!) > Date.now());
  const resumed = JSON.parse(JSON.stringify(state));
  assert.equal(resumed.config_hash, configHash(config));
  acceptMarketObservation(
    resumed,
    marketFailure(resumed.tasks[0], { status: 404 }),
    config,
  );
  assert.equal(nextMarketTask(resumed), undefined);
  assert.equal(resumed.done.length, 1);
  assert.equal(resumed.observations.length, 3);
});
test("ranking requires a verified leaf category and brand IDs observed in target-brand item attributes", () => {
  const state = startMarketQueue(config);
  acceptMarketObservation(
    state,
    observation(
      { kind: "item", id: "MLB1" },
      {
        category_id: "MLB10",
        attributes: [
          { id: "BRAND", value_id: "25", value_name: "QTMOV" },
          { id: "BRAND", value_id: "26", value_name: "Outra marca" },
        ],
      },
    ),
    config,
  );
  assert.equal(
    state.tasks.some((t) => t.kind === "ranking"),
    false,
  );
  acceptMarketObservation(
    state,
    observation({ kind: "category", id: "MLB10" }, { leaf: true }),
    config,
  );
  assert.deepEqual(
    state.tasks.filter((t) => t.kind === "ranking"),
    [
      { kind: "ranking", category_id: "MLB10" },
      { kind: "ranking", category_id: "MLB10", brand_id: "25" },
    ],
  );
  acceptMarketObservation(
    state,
    observation({ kind: "category", id: "MLB20" }, { leaf: false }),
    config,
  );
  assert.equal(
    state.tasks.some((t) => t.kind === "ranking" && t.category_id === "MLB20"),
    false,
  );
});
test("brands observed after category verification still get a separate filtered ranking", () => {
  const state = startMarketQueue(config);
  acceptMarketObservation(
    state,
    observation({ kind: "category", id: "MLB10" }, { leaf: true }),
    config,
  );
  acceptMarketObservation(
    state,
    observation(
      { kind: "item", id: "MLB1" },
      {
        category_id: "MLB10",
        attributes: [{ id: "BRAND", value_id: "25", value_name: "dutotec" }],
      },
    ),
    config,
  );
  assert.ok(
    state.tasks.some((t) => t.kind === "ranking" && t.brand_id === "25"),
  );
});
test("ranked ITEM, PRODUCT and USER_PRODUCT resources retain their types and do not invent volumes", () => {
  const state = startMarketQueue(config),
    resource = { kind: "ranking", category_id: "MLB10" } as const;
  const data = normalizeMarketData(resource, {
    content: [
      { id: "MLB2", type: "ITEM", position: 1 },
      { id: "MLB3", type: "PRODUCT", position: 2 },
      { id: "MLB4", type: "USER_PRODUCT", position: 3 },
    ],
  });
  acceptMarketObservation(state, observation(resource, data), config);
  assert.ok(state.tasks.some((t) => t.kind === "item" && t.id === "MLB2"));
  assert.ok(state.tasks.some((t) => t.kind === "product" && t.id === "MLB3"));
  assert.equal(
    state.tasks.some((t) => "id" in t && t.id === "MLB4"),
    false,
  );
  assert.equal(data.units_sold, null);
  assert.equal(data.monthly_sales, null);
});
test("CSV prevents spreadsheet formula execution and leaves missing counters blank; queue growth is bounded", () => {
  const limited = { ...config, max_resources: 1 },
    state = startMarketQueue(limited);
  acceptMarketObservation(
    state,
    observation(
      { kind: "item", id: "MLB1" },
      {
        title: "=CMD()",
        category_id: "MLB10",
        price: 0,
        sold_quantity_returned: null,
      },
    ),
    limited,
  );
  const csv = marketCsv(state);
  assert.match(csv, /"'=CMD\(\)"/);
  assert.match(csv, /"0";"";"";"";""/);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.stopped_reason, "resource_limit");
  assert.equal(state.resource_limit_reached, true);
});
