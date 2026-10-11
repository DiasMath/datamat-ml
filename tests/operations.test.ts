import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { initializeDatabase, find, get, put, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import {
  saveOffer,
  saveCosts,
  saveParameters,
  createProposal,
  decideProposal,
} from "../src/server/services";
import { financialSales, stockCoverage } from "../src/domain/routine";
import {
  analysisRange,
  businessDay,
  shiftDay,
  type StoreAnalysis,
  type SaleOrder,
} from "../src/domain/analytics";
import {
  saveCompetitor,
  changeCompetitor,
  competitors,
  competitorTask,
} from "../src/server/competitors";
import {
  pairExtension,
  extensionActor,
  extensionOffers,
  extensionCapture,
  revokeExtension,
  extensionDevices,
} from "../src/server/extension";
import { encryptSecret } from "../src/server/mercadolivre";
import {
  refreshRoutine,
  routineReport,
  routineTask,
  authorizeCron,
} from "../src/server/routine";
import { receiveNotification } from "../src/server/ml-notifications";
import { applyApprovedPrice } from "../src/server/ml-price-application";

const clock = new Date("2026-10-11T15:00:00Z"),
  range = analysisRange("2026-10-11", "2026-10-11", clock);
const sale: SaleOrder = {
  id: "1",
  storeId: "a",
  created: "2026-10-11T14:00:00Z",
  status: "paid",
  shipmentId: null,
  lines: [
    {
      itemId: "MLB1",
      title: "Produto",
      price: "100",
      quantity: 2,
      fee: "15",
      contribution: "20",
      actualFeeContribution: "15",
      minMargin: "18",
      offerId: "offer",
    },
  ],
};
test("financial sales separates expected and observed-fee margins, flags low margin and deduplicates", () => {
  const rows = financialSales(
    [sale, sale, { ...sale, id: "2", status: "cancelled" }],
    range,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revenue, "200.00");
  assert.equal(rows[0].expected, "40.00");
  assert.equal(rows[0].observed, "30.00");
  assert.equal(rows[0].difference, "-10.00");
  assert.equal(rows[0].lowMargin, true);
});
test("missing sold-line costs preserve unknown totals and covered-revenue percentage", () => {
  const rows = financialSales(
    [
      {
        ...sale,
        lines: [
          ...sale.lines,
          { ...sale.lines[0], contribution: null, actualFeeContribution: null },
        ],
      },
    ],
    range,
  );
  assert.equal(rows[0].expected, null);
  assert.equal(rows[0].observed, null);
  assert.equal(rows[0].coverage, "50.00");
  assert.equal(rows[0].difference, null);
});
const historyRange = analysisRange("2026-10-04", "2026-10-10", clock);
const source: StoreAnalysis = {
  storeId: "a",
  storeName: "Loja",
  connected: true,
  sellerId: "111",
  authVersion: 1,
  observedAt: clock.toISOString(),
  complete: true,
  totalReported: 1,
  orders: [
    {
      ...sale,
      created: "2026-10-10T14:00:00Z",
      lines: [{ ...sale.lines[0], quantity: 7 }],
    },
  ],
  visits: null,
  unanswered: null,
  reputation: null,
  shipping: null,
  warnings: [],
  error: null,
};
const stockOffer = {
  id: "offer",
  store_id: "a",
  title: "Produto",
  status: "active",
  origin: "import",
  ml_id: "MLB1",
  ml: {
    sellerId: "111",
    authVersion: 1,
    availableQuantity: 3,
    observedAt: clock.toISOString(),
  },
};
test("stock coverage uses seven complete days and paid units, not lifetime sales", () => {
  const result = stockCoverage([stockOffer], [source], historyRange, clock)[0];
  assert.equal(result.coverage, "3.0");
  assert.equal(result.units, 7);
  assert.equal(result.urgency, "replenish");
});
test("stock forecasts are suppressed for stale stock, partial sales, changed sellers and zero demand", () => {
  for (const s of [
    { ...source, complete: false },
    { ...source, sellerId: "222" },
    { ...source, error: "Falha" },
    { ...source, orders: [] },
  ])
    assert.equal(
      stockCoverage([stockOffer], [s], historyRange, clock)[0].coverage,
      null,
    );
  assert.equal(
    stockCoverage(
      [
        {
          ...stockOffer,
          ml: { ...stockOffer.ml, observedAt: "2026-10-11T14:00:00Z" },
        },
      ],
      [source],
      historyRange,
      clock,
    )[0].quantity,
    null,
  );
});

let actor: Actor;
const connectionId = key("juntos-com", "mercadolivre");
let version = 100;
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-datamat-operations-" + randomUUID();
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "fake-operations-secret";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  await initializeDatabase();
  actor = await workspaceActor();
});
const reference = (overrides: Record<string, unknown> = {}) => ({
  storeId: "juntos-com",
  itemId: "MLB700",
  title: "Concorrente",
  url: "https://produto.mercadolivre.com.br/MLB-700-produto",
  price: "100",
  threshold: "5",
  ...overrides,
});
test("competitor changes preserve observed history, threshold alerts and optimistic versions", async () => {
  let row = await saveCompetitor(actor, reference({ version: 0 }));
  assert.equal(row.history.length, 1);
  row = await saveCompetitor(
    actor,
    reference({ price: "90", version: row.version }),
  );
  assert.equal(row.alert.delta, "-10.00");
  assert.equal(row.history.length, 2);
  await assert.rejects(
    saveCompetitor(actor, reference({ version: 1 })),
    /alterada/,
  );
  row = await changeCompetitor(
    actor,
    row.id,
    { version: row.version },
    "dismiss",
  );
  assert.equal(row.alert, null);
  row = await saveCompetitor(
    actor,
    reference({ price: "90", version: row.version }),
  );
  assert.equal(row.history.length, 2);
});
test("competitor references validate offer identity, foreign hosts and store permissions", async () => {
  await assert.rejects(
    saveCompetitor(
      actor,
      reference({ url: "https://malicious.example/MLB-700-produto" }),
    ),
    /Mercado Livre/,
  );
  await assert.rejects(
    saveCompetitor(
      actor,
      reference({ url: "https://produto.mercadolivre.com.br/MLB-701-produto" }),
    ),
    /corresponder/,
  );
  await assert.rejects(
    saveCompetitor({ ...actor, role: "viewer" }, reference()),
    /consulta/,
  );
  await assert.rejects(
    competitors(
      { ...actor, stores: actor.stores.filter((s) => s.id === "juntos-data") },
      new URLSearchParams({ store: "juntos-com" }),
    ),
    /Loja não encontrada/,
  );
});
test("review tasks are idempotent and deleted references cannot be reused", async () => {
  const row = await saveCompetitor(
    actor,
    reference({
      itemId: "MLB701",
      url: "https://produto.mercadolivre.com.br/MLB-701-produto",
    }),
  );
  const first = await competitorTask(actor, row.id),
    again = await competitorTask(actor, row.id);
  assert.equal(first!.id, again!.id);
  await changeCompetitor(actor, row.id, { version: row.version }, "delete");
  assert.equal(await get("competitors", row.id), undefined);
  await assert.rejects(competitorTask(actor, row.id), /não encontrada/);
});
test("extension tokens are scoped to a store and origin, hashed, revocable and never listed", async () => {
  const extensionId = "a".repeat(32),
    origin = `chrome-extension://${extensionId}`;
  const pair = await pairExtension(actor, {
    storeId: "juntos-com",
    name: "Teste Chrome",
    extensionId,
  });
  const scoped = await extensionActor(actor, `Bearer ${pair.token}`, origin);
  assert.equal(scoped.role, "manager");
  assert.equal(scoped.stores.length, 1);
  assert.equal(scoped.stores[0].id, "juntos-com");
  const list = await extensionDevices(actor);
  assert.ok(!JSON.stringify(list).includes(pair.token));
  await assert.rejects(
    extensionActor(
      actor,
      `Bearer ${pair.token}`,
      "chrome-extension://" + "b".repeat(32),
    ),
    /Pareamento/,
  );
  await assert.rejects(
    extensionCapture(scoped, reference({ storeId: "juntos-data" })),
    /outra loja/,
  );
  assert.equal((await extensionOffers(scoped)).store.id, "juntos-com");
  const device = list.find((d) => d.name === "Teste Chrome")!;
  await revokeExtension(actor, device.id);
  await assert.rejects(
    extensionActor(actor, `Bearer ${pair.token}`, origin),
    /revogado/,
  );
});
test("extension recapture keeps configured thresholds and one reference without exposing credentials", async () => {
  const scoped = {
    ...actor,
    role: "manager" as const,
    stores: actor.stores.filter((s) => s.id === "juntos-com"),
  };
  await saveCompetitor(
    actor,
    reference({
      itemId: "MLB702",
      url: "https://produto.mercadolivre.com.br/MLB-702-produto",
      threshold: "9",
    }),
  );
  const captured = await extensionCapture(scoped, {
    itemId: "MLB702",
    title: "Capturada",
    url: "https://produto.mercadolivre.com.br/MLB-702-produto",
    price: "85",
  });
  const row = await get("competitors", captured.id);
  assert.equal(row!.threshold, "9");
  assert.equal(row!.source, "extension");
  assert.equal(row!.alert.delta, "-15.00");
  assert.ok(!JSON.stringify(captured).includes("fake-operations-secret"));
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
      access_token: "operations-access",
      refresh_token: "operations-refresh",
    }),
    expires_at: Date.now() + 3600000,
  });
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const item = (price = 100) => ({
  id: "MLB500",
  seller_id: 111,
  site_id: "MLB",
  title: "Produto rotina",
  category_id: "MLB10",
  currency_id: "BRL",
  price,
  status: "active",
  listing_type_id: "gold_special",
  available_quantity: 3,
  sold_quantity: 500,
  pictures: [{ id: "1" }],
  attributes: [{ id: "BRAND", value_name: "Marca" }],
  shipping: {
    mode: "me2",
    logistic_type: "cross_docking",
    free_shipping: true,
  },
  variations: [],
});
async function mocked<T>(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
  work: () => Promise<T>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.mercadolibre.com");
    return handler(url, init);
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}
function routineResponse(url: URL) {
  if (url.pathname === "/users/111/items/search")
    return json({ results: ["MLB500"], paging: { total: 1 } });
  if (url.pathname === "/items/MLB500") return json(item());
  if (url.pathname.endsWith("/description"))
    return json({ plain_text: "Descrição do produto" });
  if (url.pathname.endsWith("/attributes")) return json([]);
  if (url.pathname === "/orders/99")
    return json({ id: 99, seller: { id: 111 } });
  if (url.pathname === "/orders/search") {
    const end = Date.parse(url.searchParams.get("order.date_created.to")!);
    return json({
      paging: { total: 1 },
      results: [
        {
          id: 99,
          seller: { id: 111 },
          date_created: new Date(
            Math.min(Date.now() - 60000, end - 3600000),
          ).toISOString(),
          status: "paid",
          currency_id: "BRL",
          shipping: null,
          order_items: [
            {
              item: { id: "MLB500", title: "Produto rotina" },
              quantity: 7,
              unit_price: 100,
              sale_fee: 10,
            },
          ],
        },
      ],
    });
  }
  if (url.pathname === "/users/111") return json({ id: 111 });
  if (url.pathname === "/questions/search") return json({ total: 2 });
  if (url.pathname.endsWith("items_visits")) return json([]);
  throw new Error("Consulta inesperada: " + url.pathname);
}
test("routine verifies official webhook resources, imports catalog, refreshes sales and reuses its lease", async () => {
  await account();
  await receiveNotification({
    _id: "routine-event",
    topic: "orders_v2",
    resource: "/orders/99",
    user_id: 111,
    application_id: 123456,
    sent: new Date().toISOString(),
  });
  let calls = 0;
  const query = new URLSearchParams({ store: "juntos-com" });
  const report = await mocked(
    (url) => {
      calls++;
      return routineResponse(url);
    },
    () => refreshRoutine(actor, query),
  );
  assert.equal(report.report.current.paidOrders, 1);
  assert.equal(
    report.stock.find((o) => o.title === "Produto rotina")?.coverage,
    "3.0",
  );
  assert.equal(
    (await get("ml_notification_inbox", connectionId))!.events[0].verified,
    true,
  );
  const before = calls;
  await mocked(
    () => {
      calls++;
      throw new Error("Não consultar durante cooldown");
    },
    () => refreshRoutine(actor, query),
  );
  assert.equal(calls, before);
  const task = await routineTask(actor, {
      storeId: "juntos-com",
      kind: "question",
      reference: "unanswered",
    }),
    same = await routineTask(actor, {
      storeId: "juntos-com",
      kind: "question",
      reference: "unanswered",
    });
  assert.equal(task.id, same.id);
  await assert.rejects(
    routineTask(actor, {
      storeId: "juntos-com",
      kind: "sale",
      reference: "other",
    }),
    /indisponível/,
  );
});
test("forged seller notifications are discarded without blocking fresh sales or being marked verified", async () => {
  const job = await get("ml_routine", connectionId);
  await put("ml_routine", connectionId, { ...job, next_attempt_at: 0 });
  await receiveNotification({
    _id: "forged-routine",
    topic: "orders_v2",
    resource: "/orders/88",
    user_id: 111,
    application_id: 123456,
    sent: new Date().toISOString(),
  });
  const report = await mocked(
    (url) =>
      url.pathname === "/orders/88"
        ? json({ id: 88, seller: { id: 222 } })
        : routineResponse(url),
    () => refreshRoutine(actor, new URLSearchParams({ store: "juntos-com" })),
  );
  assert.equal(report.report.current.paidOrders, 1);
  assert.match(report.updates[0].error!, /conta autorizada/);
  assert.ok(report.updates[0].nextAttempt > Date.now());
  assert.equal(
    (await get("ml_notification_inbox", connectionId))!.events.find(
      (e: any) => e.resource === "/orders/88",
    ).verified,
    false,
  );
  assert.equal(
    (await get("ml_notification_inbox", connectionId))!.events.find(
      (e: any) => e.resource === "/orders/88",
    ).rejected,
    true,
  );
  await assert.rejects(
    refreshRoutine({ ...actor, role: "viewer" }, new URLSearchParams()),
    /consulta/,
  );
  await assert.rejects(
    routineReport(actor, new URLSearchParams({ store: "other" })),
    /Loja não encontrada/,
  );
});
test("scheduled routine requires a secret and never accepts missing or different bearer values", () => {
  delete process.env.CRON_SECRET;
  assert.throws(() => authorizeCron(null), /não configurado/);
  process.env.CRON_SECRET = "test-cron-only";
  assert.throws(() => authorizeCron("Bearer invalid"), /não autorizado/);
  authorizeCron("Bearer test-cron-only");
  delete process.env.CRON_SECRET;
});
test("network failure schedules backoff while preserving last sales and releasing the worker lease", async () => {
  const before = await routineReport(
    actor,
    new URLSearchParams({ store: "juntos-com" }),
  );
  const job = (await get("ml_routine", connectionId))!;
  await put("ml_routine", connectionId, { ...job, next_attempt_at: 0 });
  const connection = (await get("connections", connectionId))!;
  await put("connections", connectionId, {
    ...connection,
    last_catalog_sync_at: null,
  });
  const result = await mocked(
    () => json({ message: "unavailable" }, 503),
    () => refreshRoutine(actor, new URLSearchParams({ store: "juntos-com" })),
  );
  assert.equal(
    result.report.current.paidOrders,
    before.report.current.paidOrders,
  );
  const after = (await get("ml_routine", connectionId))!;
  assert.equal(after.until, 0);
  assert.equal(after.failures, 1);
  assert.ok(after.next_attempt_at > Date.now() + 55000);
  assert.ok(after.error);
});
async function approved() {
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
  let offer = (
    await find("offers", { store_id: "juntos-com", ml_id: "MLB500" })
  )[0];
  if (!offer)
    offer = await saveOffer(actor, {
      storeId: "juntos-com",
      name: "Produto",
      title: "Produto",
      mlId: "MLB500",
      type: "unit",
      status: "active",
      price: "100",
    });
  await put("offers", offer.id, {
    ...offer,
    price: "100",
    ml: {
      sellerId: "111",
      authVersion: version,
      listingTypeId: "gold_special",
      categoryId: "MLB10",
      shippingMode: "me2",
      logisticType: "cross_docking",
      variationCount: 0,
      catalogListing: false,
      variablePrices: false,
    },
  });
  await saveCosts(actor, offer.id, {
    goods: "40",
    mlPercent: "10",
    mlFixed: "0",
    shipping: "0",
    packaging: "0",
    advertising: "0",
    other: "0",
  });
  const proposal = await createProposal(actor, {
    offerId: offer.id,
    input: { mode: "price", price: "90", conditionsVerified: true },
    reason: "Ajuste autorizado de teste",
    requestId: randomUUID(),
  });
  await decideProposal(actor, proposal.id, {
    action: "approve",
    comment: "Aprovado para teste",
    requestId: randomUUID(),
  });
  return proposal;
}
test("approved ML price is revalidated, written once, observed and audited; repeated calls do not write", async () => {
  const proposal = await approved();
  let price = 100,
    writes = 0;
  const result = await mocked(
    (url, init) => {
      if (init.method === "PUT") {
        writes++;
        assert.deepEqual(JSON.parse(init.body as string), { price: 90 });
        price = 90;
        return json(item(price));
      }
      if (url.pathname === "/items/MLB500") return json(item(price));
      if (url.pathname === "/sites/MLB/listing_prices")
        return json([
          {
            listing_type_id: "gold_special",
            sale_fee_amount: 9,
            sale_fee_details: { percentage_fee: 10, fixed_fee: 0 },
          },
        ]);
      throw new Error(url.pathname);
    },
    () => applyApprovedPrice(actor, proposal.id, { confirmed: true }),
  );
  assert.equal(result.status, "applied_ml");
  assert.equal(writes, 1);
  assert.equal((await get("offers", proposal.offer_id))!.price, "90.00");
  await mocked(
    () => {
      throw new Error("Reenvio proibido");
    },
    () => applyApprovedPrice(actor, proposal.id, { confirmed: true }),
  );
  assert.equal(writes, 1);
  const history = await find("history", {
    offer_id: proposal.offer_id,
    status: "applied_ml",
  });
  assert.equal(history.length, 1);
});
test("price failures after a possible write become verification-only, never an automatic resend", async () => {
  const proposal = await approved();
  let writes = 0;
  await assert.rejects(
    mocked(
      (url, init) => {
        if (init.method === "PUT") {
          writes++;
          throw new Error("Resposta perdida");
        }
        if (url.pathname === "/items/MLB500") return json(item());
        return json([
          {
            listing_type_id: "gold_special",
            sale_fee_amount: 9,
            sale_fee_details: { percentage_fee: 10, fixed_fee: 0 },
          },
        ]);
      },
      () => applyApprovedPrice(actor, proposal.id, { confirmed: true }),
    ),
    /conferência/,
  );
  assert.equal(
    (await get("proposals", proposal.id))!.status,
    "application_uncertain",
  );
  // A webhook may have observed the new price before the operator verifies the write.
  const observedOffer = (await get("offers", proposal.offer_id))!;
  await put("offers", proposal.offer_id, {
    ...observedOffer,
    price: "90.00",
    version: observedOffer.version + 1,
  });
  await mocked(
    (url, init) => {
      assert.notEqual(init.method, "PUT");
      return json(item(90));
    },
    () => applyApprovedPrice(actor, proposal.id, { confirmed: true }),
  );
  assert.equal(writes, 1);
});
test("foreign sellers, changed fees, unapproved proposals and viewer roles cannot write ML prices", async () => {
  const proposal = await approved();
  await assert.rejects(
    applyApprovedPrice({ ...actor, role: "manager" }, proposal.id, {
      confirmed: true,
    }),
    /aprovação/,
  );
  await assert.rejects(
    mocked(
      () => json({ ...item(), seller_id: 222 }),
      () => applyApprovedPrice(actor, proposal.id, { confirmed: true }),
    ),
    /outro anúncio/,
  );
  let writes = 0;
  await assert.rejects(
    mocked(
      (url, init) => {
        if (init.method === "PUT") writes++;
        return url.pathname === "/items/MLB500"
          ? json(item())
          : json([
              {
                listing_type_id: "gold_special",
                sale_fee_amount: 18,
                sale_fee_details: { percentage_fee: 20, fixed_fee: 0 },
              },
            ]);
      },
      () => applyApprovedPrice(actor, proposal.id, { confirmed: true }),
    ),
    /tarifa atual/,
  );
  assert.equal(writes, 0);
  await put("proposals", proposal.id, {
    ...(await get("proposals", proposal.id)),
    status: "review",
  });
  await assert.rejects(
    applyApprovedPrice(actor, proposal.id, { confirmed: true }),
    /aprovada/,
  );
});
