import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeDatabase, get, find, put, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import {
  saveOffer,
  offerDetail,
  deleteRecord,
  workspace,
} from "../src/server/services";
import {
  uploadMedia,
  readMedia,
  draftMedia,
  deleteMedia,
  MAX_MEDIA_BYTES,
  type MediaStorage,
} from "../src/server/listing-media";
import {
  listingCounts,
  listingType,
  listingMetricsFreshness,
  LISTING_METRICS_MAX_AGE,
} from "../src/domain/listing-table";
import { runListingBatches } from "../src/domain/listing-batches";
import { oauthPopupResponse } from "../src/server/oauth-popup";
let actor: Actor;
test("listing metrics cannot look current when the observation or period has expired or has an invalid date", () => {
  const clock = Date.UTC(2026, 9, 17, 12);
  const iso = (time: number) => new Date(time).toISOString();
  const current = { observed_at: iso(clock - 1000), to: iso(clock - 2000) };
  assert.equal(listingMetricsFreshness(current, clock).stale, false);
  for (const patch of [
    { observed_at: iso(clock - LISTING_METRICS_MAX_AGE) },
    { to: iso(clock - LISTING_METRICS_MAX_AGE) },
    { observed_at: iso(clock + 1000) },
    { to: iso(clock + 1000) },
    { observed_at: "invalid" },
    { to: "invalid" },
  ]) {
    assert.equal(
      listingMetricsFreshness({ ...current, ...patch }, clock).stale,
      true,
    );
  }
  assert.equal(
    listingMetricsFreshness({ observed_at: "invalid" }, clock).observedAt,
    null,
  );
});
test("listing batches retry deferred IDs without repeating completed IDs and stop honestly when no progress is possible", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => "offer-" + i);
  const calls: string[][] = [];
  const outcome = await runListingBatches(
    ids,
    async (batch) => {
      calls.push(batch);
      return batch.map((id, index) => ({
        id,
        deferred: calls.length === 1 && index >= 2,
        updated: true,
      }));
    },
    (r) => r.updated,
    () => {},
  );
  assert.equal(outcome.successful, 12);
  assert.deepEqual(outcome.pendingIds, []);
  assert.equal(calls.length, 3);
  assert.equal(calls.flat().filter((id) => id === ids[0]).length, 1);
  let count = 0;
  const paused = await runListingBatches(
    ids,
    async (batch) => {
      count++;
      return batch.map((id) => ({ id, deferred: true }));
    },
    () => false,
    () => {},
  );
  assert.equal(count, 1);
  assert.equal(paused.successful, 0);
  assert.equal(paused.failed, 0);
  assert.deepEqual(paused.pendingIds, ids);
});
test("listing batches stop at a bounded duration, expose completed progress and checkpoint only pending IDs", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `bounded-${i}`);
  let time = 0;
  const checkpoints: string[][] = [];
  const progress: number[] = [];
  const result = await runListingBatches(
    ids,
    async (batch) => {
      time += 10;
      return batch.map((id) => ({ id }));
    },
    () => true,
    (done) => progress.push(done),
    (pending) => checkpoints.push(pending),
    { maxDurationMs: 20, clock: () => time },
  );
  assert.equal(result.successful, 10);
  assert.deepEqual(result.pendingIds, ids.slice(10));
  assert.deepEqual(checkpoints.at(-1), ids.slice(10));
  assert.equal(progress.at(-1), 10);
  assert.match(result.error!, /dividida em etapas/);
  const resumed = await runListingBatches(
    result.pendingIds,
    async (batch) => batch.map((id) => ({ id })),
    () => true,
    () => {},
  );
  assert.equal(resumed.successful, 2);
  assert.deepEqual(resumed.pendingIds, []);
});
test("listing batches retain unattempted IDs after a request fails and never report omitted results as success", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => "offer-" + i);
  let calls = 0;
  const result = await runListingBatches(
    ids,
    async (batch) => {
      if (++calls === 2) throw new Error("ML temporariamente indisponível");
      return batch.map((id) => ({ id }));
    },
    () => true,
    () => {},
  );
  assert.equal(result.successful, 5);
  assert.equal(result.error, "ML temporariamente indisponível");
  assert.deepEqual(result.pendingIds, ids.slice(5));
  const missing = await runListingBatches(
    ids,
    async () => [],
    () => true,
    () => {},
  );
  assert.deepEqual(missing.pendingIds, ids);
  assert.equal(missing.successful, 0);
  const aborted = new Error("cancelled");
  aborted.name = "AbortError";
  await assert.rejects(
    () =>
      runListingBatches(
        ids,
        async () => {
          throw aborted;
        },
        () => true,
        () => {},
      ),
    /cancelled/,
  );
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
  "base64",
);
const file = (bytes = png, type = "image/png", name = "produto.png") =>
  new File([new Uint8Array(bytes)], name, { type });
const make = () =>
  saveOffer(actor, {
    storeId: "juntos-com",
    name: "Mídia " + randomUUID(),
    title: "Produto com mídia " + randomUUID(),
    type: "unit",
    status: "draft",
    price: "100",
  });
function memoryStorage() {
  const objects = new Map<string, Buffer>();
  let saves = 0;
  const adapter: MediaStorage = {
    async save(path, bytes) {
      saves++;
      objects.set(path, Buffer.from(bytes));
    },
    async read(path) {
      if (!objects.has(path)) throw new Error("missing");
      return objects.get(path)!;
    },
    async remove(path) {
      objects.delete(path);
    },
  };
  return { adapter, objects, saves: () => saves };
}
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-listing-media-" + randomUUID();
  await initializeDatabase();
  actor = await workspaceActor();
});
test("listing counts keep ML IDs separate from repeated titles, catalog listings and local/reference rows", () => {
  const own = (id: string, title: string, catalogListing = true) => ({
    store_id: "one",
    ml_id: id,
    title,
    origin: "import",
    ml: { sellerId: "11", catalogListing },
  });
  const counts = listingCounts([
    own("MLB1", "Produto"),
    own("MLB2", "Produto"),
    own("MLB3", "Outro", false),
    { ...own("MLB4", "Produto"), store_id: "two" },
    { ...own("MLB5", "Produto"), origin: "reference" },
    { title: "Local", store_id: "one", origin: "manual" },
  ]);
  assert.deepEqual(counts, {
    records: 6,
    mlIds: 4,
    titles: 3,
    catalog: 3,
    traditional: 1,
    local: 2,
  });
  assert.equal(listingType("gold_special"), "Clássico");
  assert.equal(listingType("gold_pro"), "Premium");
});
test("OAuth popup uses one CSP nonce, escapes provider messages and never sends code or state to the opener", async () => {
  const destination = new URL(
    "https://example.test/configuracoes?store=one&mlAuthorization=failed&mlMessage=" +
      encodeURIComponent("</script><img src=x onerror=evil()>"),
  );
  const channel = randomUUID(),
    response = oauthPopupResponse(destination, channel),
    html = await response.text();
  const nonce = /script-src 'nonce-([^']+)'/.exec(
    response.headers.get("Content-Security-Policy")!,
  )![1];
  assert.ok(html.includes(`script nonce="${nonce}"`));
  assert.ok(html.includes(`style nonce="${nonce}"`));
  assert.ok(!html.includes("</script><img src=x"));
  assert.ok(html.includes("BroadcastChannel"));
  assert.ok(html.includes(channel));
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
});
test("media drafts persist privately with idempotent upload, audited deletion and a working video range", async () => {
  const offer = await make(),
    memory = memoryStorage(),
    requestId = randomUUID();
  const asset = await uploadMedia(
    actor,
    offer.id,
    { file: file(), requestId, offerVersion: offer.version },
    memory.adapter,
  );
  assert.equal(asset.status, "draft");
  assert.equal(asset.kind, "image");
  assert.ok(!JSON.stringify(asset).includes("object_path"));
  const repeat = await uploadMedia(
    actor,
    offer.id,
    { file: file(), requestId, offerVersion: offer.version },
    memory.adapter,
  );
  assert.equal(repeat.id, asset.id);
  assert.equal(memory.saves(), 1);
  assert.equal((await draftMedia(actor, offer.id)).length, 1);
  assert.equal((await offerDetail(actor, offer.id)).draftMedia.length, 1);
  assert.equal((await get("offers", offer.id))!.version, offer.version);
  const response = await readMedia(
    actor,
    asset.id,
    "bytes=2-5",
    memory.adapter,
  );
  assert.equal(response.status, 206);
  assert.equal(
    response.headers.get("content-range"),
    `bytes 2-5/${png.length}`,
  );
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    png.subarray(2, 6),
  );
  assert.equal(
    (await readMedia(actor, asset.id, "bytes=9999-", memory.adapter)).status,
    416,
  );
  await assert.rejects(
    deleteRecord(actor, "offers", offer.id, {
      version: offer.version,
      requestId: randomUUID(),
    }),
    /mídia em rascunho/,
  );
  await deleteMedia(actor, asset.id, memory.adapter);
  await deleteMedia(actor, asset.id, memory.adapter);
  assert.equal(memory.objects.size, 0);
  assert.equal((await draftMedia(actor, offer.id)).length, 0);
  await assert.rejects(
    readMedia(actor, asset.id, null, memory.adapter),
    /não encontrado/,
  );
  const audits = await find("history", { offer_id: offer.id });
  assert.equal(audits.filter((r) => r.field === "media.uploaded").length, 1);
  assert.equal(audits.filter((r) => r.field === "media.deleted").length, 1);
});
test("media rejects untrusted formats, oversize, stale versions, wrong stores and viewers before storage writes", async () => {
  const offer = await make(),
    memory = memoryStorage();
  const send = (who: Actor, upload: File, version = offer.version) =>
    uploadMedia(
      who,
      offer.id,
      { file: upload, requestId: randomUUID(), offerVersion: version },
      memory.adapter,
    );
  await assert.rejects(
    send(actor, file(Buffer.from("<svg onload='evil()'/>"), "image/svg+xml")),
    /Selecione/,
  );
  await assert.rejects(send(actor, file(png, "image/jpeg")), /Selecione/);
  await assert.rejects(
    send(actor, file(Buffer.alloc(MAX_MEDIA_BYTES + 1))),
    /3 MB/,
  );
  await assert.rejects(send(actor, file(), offer.version + 1), /mudou/);
  await assert.rejects(send({ ...actor, role: "viewer" }, file()), /consulta/);
  await assert.rejects(
    send(
      { ...actor, stores: actor.stores.filter((s) => s.id !== offer.store_id) },
      file(),
    ),
    /acesso/,
  );
  assert.equal(memory.saves(), 0);
  assert.equal((await find("listing_media", { offer_id: offer.id })).length, 0);
});
test("upload leases prevent competing content and deletion during an in-flight save", async () => {
  const offer = await make(),
    memory = memoryStorage(),
    requestId = randomUUID();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    ready = new Promise<void>((resolve) => (started = resolve));
  const slow: MediaStorage = {
    ...memory.adapter,
    async save(path, bytes, type) {
      started();
      await gate;
      await memory.adapter.save(path, bytes, type);
    },
  };
  const pending = uploadMedia(
    actor,
    offer.id,
    { file: file(), requestId, offerVersion: offer.version },
    slow,
  );
  await ready;
  const row = (await find("listing_media", { offer_id: offer.id }))[0];
  await assert.rejects(
    uploadMedia(
      actor,
      offer.id,
      {
        file: file(Buffer.concat([png, Buffer.from("other")])),
        requestId,
        offerVersion: offer.version,
      },
      memory.adapter,
    ),
    /outro arquivo/,
  );
  await assert.rejects(
    uploadMedia(
      actor,
      offer.id,
      { file: file(), requestId, offerVersion: offer.version },
      memory.adapter,
    ),
    /já está sendo enviado/,
  );
  await assert.rejects(
    deleteMedia(actor, row.id, memory.adapter),
    /em andamento/,
  );
  release();
  const asset = await pending;
  assert.equal(memory.saves(), 1);
  assert.equal((await get("listing_media", asset.id))!.status, "ready");
});
test("failed storage saves remain retryable and removal failures preserve the draft", async () => {
  const offer = await make(),
    memory = memoryStorage(),
    values = {
      file: file(),
      requestId: randomUUID(),
      offerVersion: offer.version,
    };
  const unavailable: MediaStorage = {
    ...memory.adapter,
    async save() {
      throw new Error("private storage credentials must not leak");
    },
  };
  await assert.rejects(
    uploadMedia(actor, offer.id, values, unavailable),
    /Google Drive/,
  );
  assert.equal((await draftMedia(actor, offer.id)).length, 0);
  const asset = await uploadMedia(actor, offer.id, values, memory.adapter);
  await assert.rejects(
    deleteMedia(actor, asset.id, {
      ...memory.adapter,
      async remove() {
        throw new Error("private");
      },
    }),
    /Google Drive/,
  );
  assert.equal((await get("listing_media", asset.id))!.status, "ready");
  const viewer = { ...actor, role: "viewer" as const };
  assert.equal(
    (await readMedia(viewer, asset.id, null, memory.adapter)).status,
    200,
  );
  await assert.rejects(
    deleteMedia(viewer, asset.id, memory.adapter),
    /consulta/,
  );
});

test("a listing changed during upload leaves no visible draft or abandoned file", async () => {
  const offer = await make(),
    memory = memoryStorage();
  const changed: MediaStorage = {
    ...memory.adapter,
    async save(path, bytes, type) {
      await memory.adapter.save(path, bytes, type);
      await put("offers", offer.id, { ...offer, version: offer.version + 1 });
    },
  };
  await assert.rejects(
    uploadMedia(
      actor,
      offer.id,
      { file: file(), requestId: randomUUID(), offerVersion: offer.version },
      changed,
    ),
    /mudou durante/,
  );
  assert.equal(memory.objects.size, 0);
  assert.equal((await draftMedia(actor, offer.id)).length, 0);
});

test("listing estimates normalize money and hide expired quotes or metrics from another authorization", async () => {
  const offer = await make(),
    connectionId = key("juntos-com", "mercadolivre"),
    original = await get("connections", connectionId);
  await put("connections", connectionId, {
    ...original,
    store_id: "juntos-com",
    provider: "mercadolivre",
    status: "connected",
    external_account: "555",
    auth_version: 77,
  });
  const costs = (await get("costs", offer.id))!;
  await put("costs", offer.id, {
    ...costs,
    data_json: JSON.stringify({
      ...JSON.parse(costs.data_json),
      shipping: "10",
    }),
  });
  await put("ml_current_quotes", offer.id, {
    offer_id: offer.id,
    store_id: "juntos-com",
    seller_id: "555",
    auth_version: 77,
    offer_version: offer.version,
    price: "100.00",
    total: "15.00",
    quoted_at: new Date().toISOString(),
    expires_at: Date.now() + 300000,
  });
  await put("ml_metrics_7d", offer.id, {
    offer_id: offer.id,
    store_id: "juntos-com",
    seller_id: "555",
    auth_version: 77,
    periodDays: 7,
    visits: 12,
    paidOrders: 0,
    units: 0,
    observed_at: new Date().toISOString(),
  });
  const read = async () =>
    (
      await workspace(actor, new URLSearchParams({ store: "juntos-com" }))
    ).offers.find((row: any) => row.id === offer.id)!;
  try {
    const current = await read();
    assert.equal(current.settlementEstimate.amount, "75.00");
    assert.equal(current.financialStatus.tariff.source, "ml");
    assert.equal(current.financialStatus.tariff.amount, "15.00");
    assert.equal(current.financialStatus.shipping.source, "manual");
    assert.ok(
      current.financialStatus.ownPending.includes(
        "Mercadoria (oferta inteira)",
      ),
    );
    assert.equal(current.metrics7d.paidOrders, 0);
    assert.equal(current.metrics7d.stale, false);
    const metrics = (await get("ml_metrics_7d", offer.id))!;
    await put("ml_metrics_7d", offer.id, {
      ...metrics,
      observed_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    });
    assert.equal((await read()).metrics7d.stale, true);
    assert.equal((await read()).metrics7d.paidOrders, 0);
    const quote = (await get("ml_current_quotes", offer.id))!;
    await put("ml_current_quotes", offer.id, { ...quote, expires_at: 0 });
    assert.equal((await read()).settlementEstimate, null);
    // Operator exceptions must agree with pricing, even when they are zero;
    // a cached quote must never override them in the listings table.
    await put("ml_current_quotes", offer.id, quote);
    await put("costs", offer.id, {
      ...costs,
      data_json: JSON.stringify({
        goods: "0",
        packaging: "0",
        advertising: "0",
        other: "0",
        otherDescription: "",
        mlPercent: "0",
        mlFixed: "0",
        shipping: "0",
        taxRate: "0",
        taxBase: "price",
        managementRate: "0",
        managementBase: "price",
      }),
    });
    const manual = await read();
    assert.equal(manual.settlementEstimate.amount, "100.00");
    assert.equal(manual.financialStatus.tariff.source, "manual");
    assert.equal(manual.financialStatus.shipping.amount, "0.00");
    assert.equal(manual.calculation.margin, "100.00");
    assert.equal(manual.financialStatus.ready, true);
    for (const [filter, included] of [
      ["ready", true],
      ["ml", false],
      ["ownCosts", false],
    ] as const) {
      const result = await workspace(
        actor,
        new URLSearchParams({ store: "juntos-com", pending: filter }),
      );
      assert.equal(
        result.offers.some((row: any) => row.id === offer.id),
        included,
      );
    }
    await put("offers", offer.id, { ...offer, ml: { variablePrices: true } });
    assert.equal((await read()).settlementEstimate, null);
    await put("connections", connectionId, {
      ...original,
      store_id: "juntos-com",
      provider: "mercadolivre",
      status: "connected",
      external_account: "555",
      auth_version: 78,
    });
    assert.equal((await read()).metrics7d, null);
  } finally {
    if (original) await put("connections", connectionId, original);
  }
});

test("indicator batching handles ten per request, keeps order and never repeats acknowledged IDs", async () => {
  const ids = Array.from({ length: 23 }, (_, i) => String(i));
  const calls: string[][] = [];
  const result = await runListingBatches(
    ids,
    async (batch) => {
      calls.push(batch);
      return batch.map((id) => ({ id }));
    },
    () => true,
    () => {},
    () => {},
    { batchSize: 10 },
  );
  assert.deepEqual(
    calls.map((batch) => batch.length),
    [10, 10, 3],
  );
  assert.deepEqual(calls.flat(), ids);
  assert.equal(result.successful, 23);
  assert.deepEqual(result.pendingIds, []);
});
