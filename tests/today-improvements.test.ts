import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  initializeDatabase,
  get,
  find,
  put,
  remove,
  transaction,
  key,
} from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import { createStore, saveOffer, saveCosts } from "../src/server/services";
import { emptyCosts } from "../src/domain/finance";
import {
  saveMonthlyGoal,
  deleteMonthlyGoal,
  monthlyGoalReport,
} from "../src/server/monthly-goals";
import {
  todayReport,
  todayQueuePage,
  nextTodayOffer,
} from "../src/server/today";
const clock = new Date("2026-10-14T12:30:00Z");
let actor: Actor;
before(async () => {
  process.env.FIREBASE_PROJECT_ID = "demo-today-improvements-" + randomUUID();
  process.env.ML_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "test-only";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.APP_URL = "http://localhost:3000";
  await initializeDatabase();
  actor = await workspaceActor();
});
async function scope() {
  const store = await createStore(actor, { name: "Meta " + randomUUID() });
  return { store, user: { ...actor, stores: [store] } };
}
test("monthly goals persist with optimistic versions, audit and store/write authorization", async () => {
  const { store, user } = await scope();
  const body = {
    storeId: store.id,
    month: "2026-10",
    target: "1000.10",
    version: 0,
  };
  const goal = await saveMonthlyGoal(user, body);
  assert.equal(goal.target, "1000.10");
  assert.equal(goal.version, 1);
  assert.equal(
    (await get(
      "monthly_goals",
      key(user.organization_id, store.id, "2026-10"),
    ))!.target,
    "1000.10",
  );
  await assert.rejects(saveMonthlyGoal(user, body), /meta mudou/);
  await assert.rejects(
    saveMonthlyGoal({ ...user, role: "viewer" }, { ...body, version: 1 }),
    /consulta/,
  );
  await assert.rejects(saveMonthlyGoal({ ...user, stores: [] }, body), /Loja/);
  for (const target of ["0", "-1", "1.001", "NaN", "1000000000000"])
    await assert.rejects(
      saveMonthlyGoal(user, { ...body, target, version: 1 }),
    );
  await assert.rejects(
    saveMonthlyGoal(user, { ...body, month: "2026-13", version: 1 }),
  );
  await saveMonthlyGoal(user, { ...body, target: "2000", version: 1 });
  await assert.rejects(
    deleteMonthlyGoal(user, { ...body, version: 1 }),
    /meta mudou/,
  );
  await deleteMonthlyGoal(user, { ...body, version: 2 });
  assert.equal(await get("monthly_goals", goal.id), undefined);
  const audit = await find("history", {
    store_id: store.id,
    field: "goal.monthly",
  });
  assert.equal(audit.length, 3);
  assert.ok(
    audit.some(
      (h) => h.old_value === null && h.new_value === JSON.stringify("1000.10"),
    ),
  );
  assert.ok(
    audit.some(
      (h) => h.new_value === null && h.old_value === JSON.stringify("2000.00"),
    ),
  );
  assert.ok(
    audit.every((h) => h.actor_id === user.id && h.actor_name === user.name),
  );
});
test("monthly revenue uses paid sales in Brasília, exact decimals and explicit partial coverage", async () => {
  const { store, user } = await scope();
  await saveMonthlyGoal(user, {
    storeId: store.id,
    month: "2026-10",
    target: "1000",
    version: 0,
  });
  const connection = (await get("connections", key(store.id, "mercadolivre")))!;
  await put("connections", connection.id, {
    ...connection,
    status: "connected",
    external_account: "monthly-seller",
    auth_version: 7,
  });
  const order = (
    id: string,
    created: string,
    status = "paid",
    price = "100.10",
  ) => ({
    id,
    storeId: store.id,
    created,
    status,
    shipmentId: null,
    lines: [
      {
        itemId: "MLB1",
        title: "Produto",
        quantity: 2,
        price,
        fee: null,
        contribution: null,
        offerId: null,
      },
    ],
  });
  const source = {
    storeId: store.id,
    storeName: store.name,
    connected: true,
    sellerId: "monthly-seller",
    authVersion: 7,
    observedAt: clock.toISOString(),
    complete: true,
    totalReported: 3,
    visits: null,
    unanswered: null,
    reputation: null,
    shipping: null,
    warnings: [],
    error: null,
    orders: [
      order("paid", "2026-10-01T03:00:00Z"),
      order("cancelled", "2026-10-13T12:00:00Z", "cancelled", "9999"),
      order("previous-month", "2026-10-01T02:59:59Z"),
    ],
  };
  const snapshot = key(
    user.organization_id,
    store.id,
    "2026-10-01",
    "2026-10-14",
    "7",
    "monthly-seller",
  );
  await put("ml_analytics", snapshot, {
    store_id: store.id,
    data_json: JSON.stringify(source),
    last_error: null,
  });
  const report = await monthlyGoalReport(user, store.id, clock);
  assert.equal(report.revenue, "200.20");
  assert.equal(report.percent, "20.02");
  assert.equal(report.remaining, "799.80");
  assert.equal(report.perDay, "44.43");
  assert.equal(report.remainingDays, 18);
  await put("ml_analytics", snapshot, {
    store_id: store.id,
    data_json: JSON.stringify({ ...source, complete: false }),
    last_error: null,
  });
  const partial = await monthlyGoalReport(user, store.id, clock);
  assert.equal(partial.revenue, "200.20");
  assert.equal(partial.percent, null);
  assert.equal(partial.perDay, null);
  await put("connections", connection.id, {
    ...connection,
    status: "unconfigured",
  });
  const unavailable = await monthlyGoalReport(user, store.id, clock);
  assert.equal(unavailable.revenue, null);
  assert.equal(unavailable.percent, null);
  assert.equal(
    (await monthlyGoalReport(user, store.id, new Date("2026-11-01T02:59:59Z")))
      .month,
    "2026-10",
  );
  assert.equal(
    (await monthlyGoalReport(user, store.id, new Date("2026-11-01T03:00:00Z")))
      .configured,
    0,
  );
});
test("all-store goals include only stores with a target and never blend an unauthorized store", async () => {
  const a = await scope(),
    b = await scope();
  await saveMonthlyGoal(a.user, {
    storeId: a.store.id,
    month: "2026-10",
    target: "100",
    version: 0,
  });
  await saveMonthlyGoal(b.user, {
    storeId: b.store.id,
    month: "2026-10",
    target: "900",
    version: 0,
  });
  const report = await monthlyGoalReport(a.user, "all", clock);
  assert.equal(report.target, "100.00");
  assert.equal(report.configured, 1);
  assert.equal(report.totalStores, 1);
  assert.ok(!JSON.stringify(report).includes(b.store.id));
});
test("Today pages on the server, reuses a computation and invalidates after committed costs", async () => {
  const { store, user } = await scope();
  const offers: Record<string, any>[] = [];
  for (let i = 0; i < 12; i++)
    offers.push(
      await saveOffer(user, {
        storeId: store.id,
        name: "Fila " + i,
        title: "Fila " + String(i).padStart(2, "0"),
        price: "100",
        type: "unit",
        status: "paused",
      }),
    );
  const query = new URLSearchParams({ store: store.id });
  const first = await todayReport(user, query, clock),
    again = await todayReport(user, query, clock);
  assert.equal(first.queue.length, 5);
  assert.equal(first.queuePage.total, 12);
  assert.equal(first.queue[0], again.queue[0]);
  const second = await todayQueuePage(
    user,
    { store: store.id, focus: "prepare", page: 2 },
    clock,
  );
  assert.deepEqual(
    second.queue.map((q) => q.id),
    offers.slice(5, 10).map((o) => o.id),
  );
  assert.equal(
    (await todayQueuePage(user, { store: store.id, page: 999 }, clock))
      .queuePage.page,
    3,
  );
  await saveCosts(user, offers[0].id, {
    ...emptyCosts(),
    goods: "20",
    mlPercent: "0",
    mlFixed: "0",
    shipping: "0",
    packaging: "0",
    advertising: "0",
    other: "0",
    taxRate: "0",
    taxBase: "price",
    managementBase: "price",
    offerVersion: offers[0].version,
  });
  const after = await todayReport(user, query, clock);
  assert.equal(after.summary.prepare, 11);
  assert.equal(after.portfolio.financiallyReady, 1);
  assert.ok(!after.queue.some((q) => q.id === offers[0].id));
  await remove("offers", offers[1].id);
  assert.equal((await todayReport(user, query, clock)).summary.totalOffers, 11);
  await assert.rejects(
    todayQueuePage({ ...user, stores: [] }, { store: store.id }, clock),
    /Loja/,
  );
  await assert.rejects(
    todayQueuePage(user, { store: store.id, page: -1 }, clock),
  );
});
test("rolled-back transactions do not publish revisions or stale partial data", async () => {
  const { store, user } = await scope();
  const before = (await get("_today_revisions", store.id))!.revision;
  await assert.rejects(
    transaction(async () => {
      await put("tasks", "rollback-" + store.id, {
        store_id: store.id,
        title: "Não salvar",
      });
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal((await get("_today_revisions", store.id))!.revision, before);
  assert.equal(
    (await todayReport(user, new URLSearchParams({ store: store.id }), clock))
      .tasks.length,
    0,
  );
});
test("server pagination honors valid deferred signatures and fills the page with other listings", async () => {
  const { store, user } = await scope();
  for (let i = 0; i < 7; i++)
    await saveOffer(user, {
      storeId: store.id,
      name: "Adiar " + i,
      title: "Adiar " + i,
      price: "100",
      type: "unit",
      status: "paused",
    });
  const first = await todayQueuePage(user, { store: store.id }, clock);
  const item = first.queue[0];
  const deferred = {
    [item.id]: {
      signature: item.reason + ":" + item.evidence + ":" + item.proposalId,
      until: clock.getTime() + 3600000,
    },
  };
  const hidden = await todayQueuePage(
    user,
    { store: store.id, deferred },
    clock,
  );
  assert.equal(hidden.queuePage.total, 6);
  assert.equal(hidden.queue.length, 5);
  assert.equal(hidden.queuePage.postponed, 1);
  assert.ok(!hidden.queue.some((q) => q.id === item.id));
  assert.equal(
    (
      await todayQueuePage(
        user,
        { store: store.id, deferred, showDeferred: true },
        clock,
      )
    ).queuePage.total,
    7,
  );
  deferred[item.id].signature = "different observation";
  assert.equal(
    (await todayQueuePage(user, { store: store.id, deferred }, clock)).queuePage
      .postponed,
    0,
  );
});
test("next listing stays in its store and advances through unvisited financial priorities", async () => {
  const a = await scope(),
    b = await scope();
  const one = await saveOffer(a.user, {
    storeId: a.store.id,
    name: "Primeiro",
    title: "A",
    price: "100",
    type: "unit",
    status: "paused",
  });
  const two = await saveOffer(a.user, {
    storeId: a.store.id,
    name: "Segundo",
    title: "B",
    price: "100",
    type: "unit",
    status: "paused",
  });
  const foreign = await saveOffer(b.user, {
    storeId: b.store.id,
    name: "Outra",
    title: "C",
    price: "100",
    type: "unit",
    status: "paused",
  });
  const next = await nextTodayOffer(
    a.user,
    { store: a.store.id, focus: "prepare", currentId: one.id },
    clock,
  );
  assert.equal(next.next!.id, two.id);
  assert.equal(next.next!.storeId, a.store.id);
  assert.equal(
    (
      await nextTodayOffer(
        a.user,
        {
          store: a.store.id,
          focus: "prepare",
          currentId: two.id,
          skipped: [one.id],
        },
        clock,
      )
    ).next,
    null,
  );
  await assert.rejects(
    nextTodayOffer(
      a.user,
      { store: a.store.id, focus: "prepare", currentId: foreign.id },
      clock,
    ),
    /indisponível/,
  );
});
