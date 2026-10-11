import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { initializeDatabase, get, put, find, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import {
  saveOffer,
  saveTask,
  batchOffers,
  batchDeleteOffers,
} from "../src/server/services";
import { saveCompetitor } from "../src/server/competitors";
import { encryptSecret } from "../src/server/mercadolivre";
import { batchListingStatus } from "../src/server/ml-status";
let actor: Actor,
  sequence = 80000;
const connectionId = key("juntos-com", "mercadolivre");
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-bulk-" + randomUUID();
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "fake-bulk-only";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  await initializeDatabase();
  actor = await workspaceActor();
  await put("connections", connectionId, {
    store_id: "juntos-com",
    provider: "mercadolivre",
    external_account: "111",
    status: "connected",
    auth_version: 43,
  });
  await put("ml_tokens", connectionId, {
    auth_version: 43,
    encrypted: encryptSecret({
      access_token: "fake-bulk-access",
      refresh_token: "fake-bulk-refresh",
    }),
    expires_at: Date.now() + 3600000,
  });
});
async function offer(overrides: Record<string, unknown> = {}) {
  return saveOffer(actor, {
    storeId: "juntos-com",
    name: "Produto lote",
    title: "Produto lote",
    type: "unit",
    status: "draft",
    price: "100",
    ...overrides,
  });
}
async function imported(status = "active") {
  const row = await offer({ mlId: "MLB" + ++sequence, status });
  return put("offers", row.id, {
    ...(await get("offers", row.id)),
    ml: { sellerId: "111", authVersion: 43, availableQuantity: 4 },
  });
}
const payload = (rows: any[], status = "paused", requestId = randomUUID()) => ({
  ids: rows.map((r) => r.id),
  versions: Object.fromEntries(rows.map((r) => [r.id, r.version])),
  status,
  requestId,
  confirmed: true,
});
async function mock<T>(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
  work: () => Promise<T>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("bulk edit is atomic, versioned, audited and idempotent without changing price or costs", async () => {
  const a = await offer(),
    b = await offer();
  const body = {
    ids: [a.id, b.id, a.id],
    versions: { [a.id]: a.version, [b.id]: b.version },
    titlePrefix: "Novo",
    titleSuffix: "2026",
    description: "Descrição revisada",
    requestId: randomUUID(),
  };
  const costs = await get("costs", a.id);
  assert.equal((await batchOffers(actor, body)).count, 2);
  await batchOffers(actor, body);
  for (const row of [a, b]) {
    const after = (await get("offers", row.id))!;
    assert.equal(after.title, "Novo Produto lote 2026");
    assert.equal(after.description, body.description);
    assert.equal(after.price, "100");
    assert.equal(after.status, "draft");
    assert.equal(after.version, row.version + 1);
  }
  assert.deepEqual(await get("costs", a.id), costs);
  assert.equal(
    (await find("history", { offer_id: a.id, field: "title" })).length,
    1,
  );
});
test("bulk edits reject stale versions, oversized titles and price bypass with no partial writes", async () => {
  const a = await offer(),
    b = await offer({ title: "x".repeat(195) });
  const base = {
    ids: [a.id, b.id],
    versions: { [a.id]: a.version, [b.id]: b.version },
    status: "paused",
    requestId: randomUUID(),
  };
  await assert.rejects(
    batchOffers(actor, {
      ...base,
      versions: { ...base.versions, [b.id]: b.version + 1 },
    }),
    /mudou/,
  );
  await assert.rejects(
    batchOffers(actor, { ...base, titlePrefix: "Prefixo longo" }),
    /200 caracteres/,
  );
  await assert.rejects(batchOffers(actor, { ...base, price: "1" }));
  await assert.rejects(batchOffers(actor, { ids: base.ids }));
  assert.equal((await get("offers", a.id))!.version, a.version);
  assert.equal((await get("offers", b.id))!.status, "draft");
});
test("bulk mutations reject another store and active ML locks without altering allowed rows", async () => {
  const a = await offer(),
    b = await offer({ storeId: "juntos-data" });
  const restricted = {
    ...actor,
    stores: actor.stores.filter((s) => s.id === "juntos-com"),
  };
  await assert.rejects(
    batchOffers(restricted, {
      ids: [a.id, b.id],
      status: "paused",
      versions: { [a.id]: a.version, [b.id]: b.version },
      requestId: randomUUID(),
    }),
    /loja/i,
  );
  await put("offers", b.id, {
    ...(await get("offers", b.id)),
    ml_apply_until: Date.now() + 60000,
  });
  await assert.rejects(
    batchOffers(actor, {
      ids: [a.id, b.id],
      status: "paused",
      versions: { [a.id]: a.version, [b.id]: b.version },
      requestId: randomUUID(),
    }),
    /andamento/,
  );
  assert.equal((await get("offers", a.id))!.status, "draft");
});
test("bulk delete rolls back unsafe sets, preserves audit, releases IDs and unlinks watched references", async () => {
  const a = await offer({ mlId: "MLB990001" }),
    b = await offer({ status: "active" });
  const deletion = {
    ids: [a.id, b.id],
    versions: { [a.id]: a.version, [b.id]: b.version },
    requestId: randomUUID(),
    confirmed: true,
  };
  await assert.rejects(batchDeleteOffers(actor, deletion), /rascunhos/);
  assert.ok(await get("offers", a.id));
  const ref = await saveCompetitor(actor, {
    storeId: "juntos-com",
    itemId: "MLB990002",
    url: "https://produto.mercadolivre.com.br/MLB-990002-produto",
    title: "Concorrente",
    price: "90",
    offerId: a.id,
  });
  const body = {
    ...deletion,
    ids: [a.id],
    versions: { [a.id]: a.version },
    requestId: randomUUID(),
  };
  await batchDeleteOffers(actor, body);
  await batchDeleteOffers(actor, body);
  assert.equal(await get("offers", a.id), undefined);
  assert.equal(await get("costs", a.id), undefined);
  assert.equal((await get("competitors", ref.id))!.offer_id, null);
  assert.equal((await get("competitors", ref.id))!.history.length, 1);
  assert.equal(
    (await find("history", { offer_id: a.id, field: "offer.delete" })).length,
    1,
  );
  assert.ok(await offer({ mlId: "MLB990001" }));
  const linked = await offer();
  await saveTask(actor, {
    storeId: "juntos-com",
    offerId: linked.id,
    title: "Preservar vínculo",
    priority: "medium",
    status: "todo",
  });
  await assert.rejects(
    batchDeleteOffers(actor, {
      ids: [linked.id],
      versions: { [linked.id]: linked.version },
      requestId: randomUUID(),
      confirmed: true,
    }),
    /tarefas/,
  );
  assert.ok(await get("offers", linked.id));
});
test("ML pause and activation verify each own listing and repeated requests never resend writes", async () => {
  const a = await imported(),
    b = await imported();
  const states = new Map([
    [a.ml_id, "active"],
    [b.ml_id, "active"],
  ]);
  let writes = 0;
  await mock(
    (url, init) => {
      const id = url.pathname.split("/").pop()!;
      if (init.method === "PUT") {
        writes++;
        states.set(id, JSON.parse(String(init.body)).status);
        return json({});
      }
      return json({
        id,
        seller_id: 111,
        status: states.get(id),
        available_quantity: 4,
      });
    },
    async () => {
      const pause = payload([a, b]);
      const result = await batchListingStatus(actor, pause);
      assert.deepEqual(
        result.results.map((r) => r.result),
        ["verified", "verified"],
      );
      await batchListingStatus(actor, pause);
      assert.equal(writes, 2);
      const after = [
        (await get("offers", a.id))!,
        (await get("offers", b.id))!,
      ];
      assert.equal(after[0].status, "paused");
      assert.equal(after[0].price, "100");
      assert.equal(after[0].ml_apply_until, 0);
      assert.equal(after[0].ml.availableQuantity, 4);
      assert.ok(after[0].ml.stockObservedAt);
      const active = await batchListingStatus(actor, payload(after, "active"));
      assert.ok(active.results.every((r) => r.result === "verified"));
      assert.equal(writes, 4);
      assert.equal(
        (
          await find("history", {
            offer_id: a.id,
            field: "status",
            origin: "mercadolivre",
          })
        ).length,
        2,
      );
    },
  );
});
test("mixed ML batches report stock and seller failures individually without false success", async () => {
  const good = await imported("paused"),
    zero = await imported("paused"),
    foreign = await imported("paused");
  let writes = 0;
  const states = new Map([
    [good.ml_id, "paused"],
    [zero.ml_id, "paused"],
    [foreign.ml_id, "paused"],
  ]);
  const result = await mock(
    (url, init) => {
      const id = url.pathname.split("/").pop()!;
      if (init.method === "PUT") {
        writes++;
        states.set(id, "active");
        return json({});
      }
      return json({
        id,
        seller_id: id === foreign.ml_id ? 222 : 111,
        status: states.get(id),
        available_quantity: id === zero.ml_id ? 0 : 4,
      });
    },
    () => batchListingStatus(actor, payload([good, zero, foreign], "active")),
  );
  assert.deepEqual(
    result.results.map((r) => r.result),
    ["verified", "failed", "failed"],
  );
  assert.equal(writes, 1);
  assert.match(result.results[1].message, /estoque/);
  assert.equal((await get("offers", zero.id))!.status, "paused");
  assert.equal((await get("offers", foreign.id))!.status, "paused");
});
test("uncertain ML status blocks a new action and can recover after a UI reload using reads only", async () => {
  const a = await imported();
  let writes = 0,
    remote = "active";
  await mock(
    (url, init) => {
      if (init.method === "PUT") {
        writes++;
        remote = "paused";
        throw new Error("Resposta perdida");
      }
      return json({
        id: a.ml_id,
        seller_id: 111,
        status: remote,
        available_quantity: 4,
      });
    },
    async () => {
      const first = await batchListingStatus(actor, payload([a]));
      assert.equal(first.results[0].result, "uncertain");
      const uncertain = (await get("offers", a.id))!;
      assert.ok(uncertain.ml_status_uncertain);
      assert.equal(uncertain.ml_status_target, "paused");
      const blocked = await batchListingStatus(
        actor,
        payload([uncertain], "active"),
      );
      assert.equal(blocked.results[0].result, "failed");
      assert.match(blocked.results[0].message, /anterior/);
      await assert.rejects(
        batchOffers(actor, {
          ids: [a.id],
          status: "paused",
          versions: { [a.id]: a.version },
          requestId: randomUUID(),
        }),
        /pendente/,
      );
      // A webhook can observe the target before the operator reloads and verifies.
      await put("offers", a.id, {
        ...uncertain,
        status: "paused",
        version: uncertain.version + 1,
      });
      const reloaded = (await get("offers", a.id))!;
      const recovered = await batchListingStatus(actor, payload([reloaded]));
      assert.equal(recovered.results[0].result, "verified");
      assert.equal(writes, 1);
      assert.equal((await get("offers", a.id))!.ml_status_uncertain, null);
    },
  );
});
test("ML concurrent retries hold a lease and never issue concurrent PUTs", async () => {
  const a = await imported(),
    body = payload([a]);
  let writes = 0,
    remote = "active",
    started!: () => void,
    release!: () => void;
  const began = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (release = r));
  await mock(
    async (url, init) => {
      if (init.method === "PUT") {
        writes++;
        started();
        await gate;
        remote = "paused";
        return json({});
      }
      return json({
        id: a.ml_id,
        seller_id: 111,
        status: remote,
        available_quantity: 4,
      });
    },
    async () => {
      const first = batchListingStatus(actor, body);
      await began;
      const second = await batchListingStatus(actor, body);
      assert.equal(second.results[0].result, "failed");
      assert.match(second.results[0].message, /andamento/);
      release();
      assert.equal((await first).results[0].result, "verified");
      assert.equal(writes, 1);
    },
  );
});
test("ML scope, versions, references and confirmation are checked before writes", async () => {
  const a = await imported(),
    reference = await offer({
      origin: "reference",
      referenceAccount: "Outro vendedor",
      mlId: "MLB990099",
    });
  let writes = 0;
  await mock(
    () => {
      writes++;
      throw new Error("Chamada indevida");
    },
    async () => {
      await assert.rejects(
        batchListingStatus({ ...actor, role: "viewer" }, payload([a])),
      );
      await assert.rejects(
        batchListingStatus(actor, { ...payload([a]), confirmed: false }),
      );
      const bad = await batchListingStatus(actor, {
        ...payload([a]),
        versions: { [a.id]: a.version + 1 },
      });
      assert.equal(bad.results[0].result, "failed");
      const ref = await batchListingStatus(actor, payload([reference]));
      assert.equal(ref.results[0].result, "failed");
      const other = await batchListingStatus(
        { ...actor, stores: actor.stores.filter((s) => s.id !== "juntos-com") },
        payload([a]),
      );
      assert.equal(other.results[0].result, "failed");
      assert.equal(writes, 0);
    },
  );
});
