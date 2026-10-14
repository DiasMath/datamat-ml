import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  aggregateAnalytics,
  analysisRange,
  type StoreAnalysis,
} from "../src/domain/analytics";
import { todayQueue, todayHours, todayWindow } from "../src/domain/today";
import { todayReport } from "../src/server/today";
import { initializeDatabase, put, get, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import { saveOffer } from "../src/server/services";
const clock = new Date("2026-10-14T12:30:00Z");
const weeklyRange = analysisRange("2026-10-07", "2026-10-13", clock);
const source: StoreAnalysis = {
  storeId: "s",
  storeName: "Loja",
  connected: true,
  sellerId: "111",
  authVersion: 1,
  observedAt: clock.toISOString(),
  complete: true,
  totalReported: 0,
  orders: [],
  visits: null,
  unanswered: null,
  reputation: null,
  shipping: null,
  warnings: [],
  error: null,
};
const weekly = () => aggregateAnalytics([source], weeklyRange);
const offer = (extra: Record<string, any> = {}) => ({
  id: "offer",
  store_id: "s",
  store_name: "Loja",
  title: "Anúncio",
  ml_id: "MLB1",
  version: 2,
  origin: "import",
  status: "active",
  matched: true,
  thumbnail: null,
  costs_stale: false,
  calculation: {
    margin: "20",
    marginPercent: "20",
    minMargin: "10",
    pending: [],
  },
  ml: {
    sellerId: "111",
    authVersion: 1,
    observedAt: clock.toISOString(),
    availableQuantity: 3,
    photoCount: 2,
  },
  ...extra,
});
test("Today incomplete costs and voluntary pauses remain preparation, not urgency", () => {
  const row = offer({
    status: "paused",
    costs_stale: true,
    calculation: { margin: null, pending: ["Mercadoria", "Frete"] },
  });
  const queue = todayQueue([row], [], weekly(), clock.getTime());
  assert.equal(queue.length, 1);
  assert.equal(queue[0].severity, "prepare");
  assert.equal(queue[0].reason, "Dados financeiros a completar");
  assert.match(queue[0].evidence, /Mercadoria e Frete/);
  assert.deepEqual(
    todayQueue(
      [
        offer({
          status: "paused",
          calculation: { margin: "-20", pending: [] },
        }),
      ],
      [],
      weekly(),
      clock.getTime(),
    ),
    [],
  );
});
test("Today merges margin, stock and proposal problems into a single urgent listing", () => {
  const row = offer({
    calculation: {
      margin: "-20",
      marginPercent: "-20",
      minMargin: "10",
      pending: [],
    },
    ml: { ...offer().ml, availableQuantity: 0 },
  });
  const queue = todayQueue(
    [row],
    [{ id: "p", offer_id: "offer", store_id: "s", status: "approved" }],
    weekly(),
    clock.getTime(),
  );
  assert.equal(queue.length, 1);
  assert.equal(queue[0].proposalId, "p");
  assert.equal(queue[0].decisionAction, "Abrir proposta");
  assert.match(queue[0].decisionEvidence!, /aprovada/);
  assert.equal(queue[0].severity, "urgent");
  assert.ok(queue[0].reasons.includes("Contribuição estimada negativa"));
  assert.ok(queue[0].reasons.includes("Anúncio ativo sem estoque"));
  assert.ok(queue[0].reasons.includes("Proposta pronta para aplicação"));
});
test("Today ignores stale or mismatched observations and never infers catalogue competition", () => {
  const old = offer({
    ml: {
      ...offer().ml,
      observedAt: "2026-10-14T10:00:00Z",
      availableQuantity: 0,
    },
    calculation: { margin: "-10", pending: [] },
  });
  assert.deepEqual(todayQueue([old], [], weekly(), clock.getTime()), []);
  const row = offer({
    matched: false,
    calculation: { margin: "-10", pending: [] },
  });
  assert.deepEqual(todayQueue([row], [], weekly(), clock.getTime()), []);
  const comp = {
    offer_version: 2,
    seller_id: "111",
    auth_version: 1,
    consistent: true,
    status: "losing",
    observed_at: clock.toISOString(),
  };
  assert.equal(
    todayQueue([offer({ competition: comp })], [], weekly(), clock.getTime())[0]
      .severity,
    "review",
  );
  for (const invalid of [
    { ...comp, offer_version: 1 },
    { ...comp, auth_version: 2 },
    { ...comp, consistent: false },
    { ...comp, status: "winning" },
    { ...comp, status: "competing" },
  ])
    assert.deepEqual(
      todayQueue(
        [offer({ competition: invalid })],
        [],
        weekly(),
        clock.getTime(),
      ),
      [],
    );
});
test("Today declines require complete comparable weeks and sufficient paid volume", () => {
  const orders = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    storeId: "s",
    created: i < 4 ? "2026-10-02T12:00:00Z" : "2026-10-09T12:00:00Z",
    status: "paid",
    shipmentId: null,
    lines: [
      {
        itemId: "MLB1",
        title: "Anúncio",
        quantity: 1,
        price: "100",
        fee: "12",
        contribution: "20",
        offerId: "offer",
      },
    ],
  }));
  const report = aggregateAnalytics([{ ...source, orders }], weeklyRange);
  assert.equal(
    todayQueue([offer()], [], report, clock.getTime())[0].reason,
    "Receita do anúncio em queda",
  );
  assert.deepEqual(
    todayQueue([offer()], [], { ...report, complete: false }, clock.getTime()),
    [],
  );
  const sparse = aggregateAnalytics(
    [{ ...source, orders: orders.slice(0, 2) }],
    weeklyRange,
  );
  assert.deepEqual(todayQueue([offer()], [], sparse, clock.getTime()), []);
});
test("Today excludes references but retains decisions for closed listings", () => {
  const decisions = [
    {
      id: "p",
      offer_id: "offer",
      store_id: "s",
      status: "application_uncertain",
    },
  ];
  assert.equal(
    todayQueue(
      [offer({ status: "closed" })],
      decisions,
      weekly(),
      clock.getTime(),
    )[0].action,
    "Conferir aplicação",
  );
  assert.deepEqual(
    todayQueue(
      [offer({ origin: "reference" })],
      decisions,
      weekly(),
      clock.getTime(),
    ),
    [],
  );
});
test("Today compares only elapsed hours in Brasília and masks unavailable comparisons", () => {
  const range = todayWindow(clock);
  assert.equal(range.previousEnd, range.end - 86400000);
  const report = aggregateAnalytics([source], range);
  const hours = todayHours(report, clock);
  assert.equal(hours.at(-1)!.hour, 9);
  assert.equal(hours.length, 10);
  assert.ok(
    todayHours({ ...report, complete: false }, clock).every(
      (h) => h.previous === null,
    ),
  );
  assert.ok(
    todayHours({ ...report, available: false }, clock).every(
      (h) => h.revenue === null,
    ),
  );
});
let actor: Actor;
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-today-" + randomUUID();
  await initializeDatabase();
  actor = await workspaceActor();
});
test("Today summary scopes stores and omits full catalogue, media, history, notes and proposal snapshots", async () => {
  const a = await saveOffer(actor, {
    storeId: "juntos-com",
    name: "Preparar Hoje",
    title: "Preparar Hoje",
    price: "100",
    type: "unit",
    status: "paused",
  });
  const b = await saveOffer(actor, {
    storeId: "juntos-data",
    name: "Outra loja",
    title: "Outra loja",
    price: "100",
    type: "unit",
    status: "draft",
  });
  await put("offers", a.id, {
    ...(await get("offers", a.id))!,
    ml: {
      sellerId: "111",
      authVersion: 1,
      observedAt: new Date().toISOString(),
      pictures: [{ url: "https://http2.mlstatic.com/test-image.png" }],
      attributes: [{ name: "PRIVATE-LARGE-ATTRIBUTES" }],
    },
  });
  await put("notes", "today-private-note", {
    organization_id: actor.organization_id,
    store_id: "juntos-com",
    content: "FULL-NOTE-NOT-NEEDED",
  });
  await put("proposals", "today-proposal", {
    organization_id: actor.organization_id,
    store_id: "juntos-com",
    offer_id: a.id,
    status: "review",
    snapshot_json: JSON.stringify({ private: "FULL-SNAPSHOT-NOT-NEEDED" }),
  });
  const report = await todayReport(
    actor,
    new URLSearchParams({ store: "juntos-com" }),
  );
  assert.equal(report.summary.totalOffers, 1);
  assert.equal(report.summary.urgent, 0);
  assert.equal(report.summary.decisions, 1);
  assert.equal(report.portfolio.paused, 1);
  assert.equal(report.portfolio.financiallyReady, 0);
  assert.equal(report.portfolio.needsCosts, 1);
  assert.equal(report.sales.contribution, null);
  assert.equal(report.queue[0].id, a.id);
  assert.equal(report.queue[0].severity, "review");
  const payload = JSON.stringify(report);
  for (const value of [
    b.id,
    "PRIVATE-LARGE-ATTRIBUTES",
    "FULL-NOTE-NOT-NEEDED",
    "FULL-SNAPSHOT-NOT-NEEDED",
  ])
    assert.ok(!payload.includes(value));
  assert.ok(!("offers" in report));
  assert.ok(!("history" in report));
  await assert.rejects(
    todayReport(
      { ...actor, stores: actor.stores.filter((s) => s.id === "juntos-data") },
      new URLSearchParams({ store: "juntos-com" }),
    ),
    /Loja/,
  );
  await assert.rejects(
    todayReport(actor, new URLSearchParams({ store: "foreign-store" })),
    /Loja/,
  );
});

test("Today actionable facts hide outdated stock and cost estimates", () => {
  const base = offer({
    price: "100",
    calculation: {
      margin: "20",
      marginPercent: "20",
      minPrice: "80",
      minMargin: "30",
      pending: [],
    },
  });
  const fresh = todayQueue([base], [], weekly(), clock.getTime())[0];
  assert.equal(fresh.price, "100");
  assert.equal(fresh.stock, 3);
  assert.equal(fresh.margin, "20");
  assert.equal(fresh.minPrice, "80");
  const stale = todayQueue(
    [
      {
        ...base,
        costs_stale: true,
        ml: { ...base.ml, observedAt: "2026-10-14T10:00:00Z" },
      },
    ],
    [],
    weekly(),
    clock.getTime(),
  )[0];
  assert.equal(stale.stock, null);
  assert.equal(stale.margin, null);
  assert.equal(stale.marginPercent, null);
  assert.equal(stale.minPrice, null);
});

test("Today reports the current month without inventing daily comparisons", async () => {
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "test-only";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const { businessDay, shiftDay } = await import("../src/domain/analytics");
  const now = new Date("2026-10-14T15:00:00Z"),
    day = businessDay(now),
    start = Date.parse(day + "T00:00:00-03:00");
  const observed = new Date(Math.max(start + 1000, now.getTime() - 60000));
  const storeId = "juntos-data",
    connectionId = key(storeId, "mercadolivre"),
    old = (await get("connections", connectionId))!;
  await put("connections", connectionId, {
    ...old,
    status: "connected",
    external_account: "test-day-seller",
    auth_version: 77,
  });
  const orders = [
    {
      id: "earlier",
      storeId,
      created: new Date(observed.getTime() - 1000).toISOString(),
      status: "paid",
      shipmentId: null,
      lines: [
        {
          itemId: "MLB99",
          title: "Teste",
          quantity: 1,
          price: "100",
          fee: null,
          contribution: null,
          offerId: null,
        },
      ],
    },
    {
      id: "earlier-this-month",
      storeId,
      created: new Date(observed.getTime() - 86400000 + 30000).toISOString(),
      status: "paid",
      shipmentId: null,
      lines: [
        {
          itemId: "MLB99",
          title: "Teste",
          quantity: 1,
          price: "500",
          fee: null,
          contribution: null,
          offerId: null,
        },
      ],
    },
  ];
  orders.push(
    { ...orders[0], id: "outside-month", created: "2026-09-30T23:59:00-03:00" },
    { ...orders[0], id: "cancelled", status: "cancelled" },
  );
  const snapshot = key(
    actor.organization_id,
    storeId,
    day.slice(0, 7) + "-01",
    day,
    "77",
    "test-day-seller",
  );
  await put("ml_analytics", snapshot, {
    data_json: JSON.stringify({
      ...source,
      storeId,
      storeName: "Loja",
      sellerId: "test-day-seller",
      authVersion: 77,
      observedAt: now.toISOString(),
      collectedThrough: observed.toISOString(),
      orders,
    }),
    last_error: null,
  });
  const report = await todayReport(
    actor,
    new URLSearchParams({ store: storeId }),
    now,
  );
  assert.equal(report.sales.revenue, "600.00");
  assert.equal(report.sales.period, "month");
  assert.equal(report.sales.orders, 2);
  assert.equal(report.sales.days.at(-2)!.revenue, "500.00");
  assert.equal(report.sales.days.at(-1)!.revenue, "600.00");
  assert.equal(report.sales.previousRevenue, null);
  assert.equal(report.sales.change, null);
  await put("connections", connectionId, old);
});
