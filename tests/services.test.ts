import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  initializeDatabase,
  get,
  find,
  id,
  db,
  put,
  transaction,
} from "../src/server/db";
import { databaseFailure } from "../src/server/database-failure";
import { workspaceActor, type Actor } from "../src/server/access";
import * as s from "../src/server/services";
import { emptyCosts } from "../src/domain/finance";
let admin: Actor, restricted: Actor, viewer: Actor, offerId: string;
const offer = (storeId = "juntos-com", extra: Record<string, any> = {}) => ({
  storeId,
  name: "Produto de teste",
  title: "Oferta de teste",
  brand: "Marca A",
  category: "Categoria A",
  model: "Modelo A",
  sku: "SKU-IGUAL",
  mlId: null,
  type: "unit",
  status: "draft",
  price: "100",
  ...extra,
});
const params = {
  minMargin: "10",
  desiredMargin: "20",
  taxRate: "5",
  taxBase: "price",
  managementRate: "1",
  managementBase: "price",
  reviewDays: 30,
  enforceSalesMargin: false,
};
const complete = {
  ...emptyCosts(),
  goods: "40",
  mlPercent: "10",
  mlFixed: "2",
  shipping: "5",
  packaging: "1",
  advertising: "2",
  other: "0",
};
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Testes precisam do emulador");
  process.env.FIREBASE_PROJECT_ID = "demo-datamat-unit-" + randomUUID();
  await initializeDatabase();
  admin = await workspaceActor();
  restricted = {
    ...admin,
    id: "manager-test",
    name: "Gestor restrito",
    role: "manager",
    stores: admin.stores.filter((s) => s.id === "juntos-com"),
  };
  viewer = {
    ...restricted,
    id: "viewer-test",
    name: "Consulta",
    role: "viewer",
  };
});
test("workspace opens without users, passwords or sessions and scopes active stores", async () => {
  assert.equal(admin.role, "admin");
  assert.equal(admin.id, "workspace-operator");
  assert.equal(admin.stores.length, 2);
  assert.equal((await find("users")).length, 0);
  assert.equal((await find("sessions")).length, 0);
});

test("quota failures stop the SDK transaction runner without committing staged writes", async () => {
  const documentId = id();
  let attempts = 0;
  await assert.rejects(
    transaction(async () => {
      attempts++;
      await put("_quota_test", documentId, { staged: true });
      throw Object.assign(new Error("Provider quota exhausted"), { code: 8 });
    }),
    (error: unknown) =>
      databaseFailure(error)?.code === "FIRESTORE_QUOTA_EXCEEDED",
  );
  assert.equal(attempts, 1);
  assert.equal(await get("_quota_test", documentId), undefined);
});
test("same SKU in separate stores and multiple offers per product are allowed", async () => {
  const first = await s.saveOffer(admin, offer());
  offerId = first.id;
  const other = await s.saveOffer(admin, offer("juntos-data"));
  assert.notEqual(other.id, first.id);
  const second = await s.saveOffer(
    admin,
    offer("juntos-com", {
      productId: first.product_id,
      title: "Outro anúncio do produto",
      mlId: "MLB-SECOND",
    }),
  );
  assert.equal(second.product_id, first.product_id);
});

test("listing profile skips history and sync log reads while preserving filters, editing data and bulk authorization", async (t) => {
  const saved = await s.saveOffer(
    admin,
    offer("juntos-com", {
      title: "Perfil leve de anúncios",
      description: "Descrição que deve continuar disponível para editar",
    }),
  );
  const scope = { store: "juntos-com", q: saved.title };
  const full = await s.workspace(admin, new URLSearchParams(scope));
  const reads: string[] = [];
  const collection = db().collection.bind(db());
  t.mock.method(db(), "collection", (path: string) => {
    reads.push(path);
    return collection(path);
  });
  const light = await s.workspace(
    admin,
    new URLSearchParams({ ...scope, profile: "listings" }),
  );
  t.mock.restoreAll();
  assert.ok(reads.includes("offers"));
  for (const name of ["history", "sync_logs", "users"])
    assert.ok(!reads.includes(name), name);
  assert.ok(full.history.some((h) => h.offer_id === saved.id));
  assert.deepEqual(light.history, []);
  assert.deepEqual(light.logs, []);
  assert.deepEqual(light.offers, full.offers);
  assert.deepEqual(light.listingCounts, full.listingCounts);
  const choice = light.offerChoices.find((o) => o.id === saved.id)!;
  for (const field of [
    "id",
    "store_id",
    "version",
    "status",
    "origin",
    "title",
    "sku",
    "price",
  ] as const)
    assert.equal(choice[field], saved[field]);
  assert.ok(!("description" in choice));
  assert.ok(!("calculation" in choice));
  assert.ok(JSON.stringify(light).length < JSON.stringify(full).length);
  await assert.rejects(
    s.workspace(
      restricted,
      new URLSearchParams({ store: "juntos-data", profile: "listings" }),
    ),
    /Loja não encontrada/,
  );
});
test("store isolation is enforced by server for reading, writing, filtering, batching and exporting data", async () => {
  const secret = await s.saveOffer(
    admin,
    offer("juntos-data", {
      title: "Oferta restrita",
      brand: "Marca B",
      mlId: "MLB-SECRET",
    }),
  );
  await assert.rejects(
    async () => await s.getOffer(restricted, secret.id),
    /acesso/,
  );
  await assert.rejects(
    async () => await s.saveOffer(restricted, offer("juntos-data")),
    /acesso/,
  );
  await assert.rejects(
    async () =>
      await s.workspace(
        restricted,
        new URLSearchParams({ store: "juntos-data" }),
      ),
    /acesso/,
  );
  const before = (await s.getOffer(admin, offerId)).status;
  await assert.rejects(
    async () =>
      await s.batchOffers(restricted, {
        ids: [offerId, secret.id],
        status: "active",
        requestId: randomUUID(),
        versions: {
          [offerId]: (await s.getOffer(admin, offerId)).version,
          [secret.id]: secret.version,
        },
      }),
    /acesso/,
  );
  assert.equal((await s.getOffer(admin, offerId)).status, before);
  assert.ok(
    (await s.workspace(restricted, new URLSearchParams())).offerChoices.every(
      (o) => o.store_id === "juntos-com",
    ),
  );
});
test("viewer cannot write, manager cannot approve or administer parameters", async () => {
  await assert.rejects(
    async () => await s.saveCosts(viewer, offerId, complete),
    /consulta/,
  );
  await assert.rejects(
    async () => await s.saveParameters(restricted, "juntos-com", params),
    /administrador/,
  );
});
test("combined filters search model/SKU/ML and scope brand/category options to selected store", async () => {
  const data = await s.workspace(
    admin,
    new URLSearchParams(
      "store=juntos-com&q=Modelo&brand=Marca+A&category=Categoria+A&type=unit",
    ),
  );
  assert.ok(data.offers.length >= 2);
  assert.ok(data.offers.every((o) => o.brand === "Marca A"));
  assert.ok(!data.offerChoices.some((o) => o.brand === "Marca B"));
  assert.equal(
    (
      await s.workspace(
        admin,
        new URLSearchParams("store=juntos-com&q=inexistente"),
      )
    ).offers.length,
    0,
  );
});
test("costs preserve explicit zero and financial changes increment version", async () => {
  const before = (await s.getOffer(admin, offerId)).version;
  await s.saveParameters(admin, "juntos-com", params);
  await s.saveCosts(admin, offerId, { ...complete, taxRate: "0" });
  const detail = await s.offerDetail(admin, offerId);
  assert.equal(detail.costs.taxRate, "0");
  assert.equal(detail.calculation.margin, "39.00");
  assert.ok(detail.offer.version > before);
  await s.saveCosts(admin, offerId, complete);
});
test("proposals are idempotent and saving does not modify current price", async () => {
  const requestId = randomUUID();
  const body = {
    offerId,
    input: { mode: "price", price: "90", conditionsVerified: true },
    reason: "Teste de preço revisado",
    requestId,
  };
  const p = await s.createProposal(admin, body),
    again = await s.createProposal(admin, body);
  assert.equal(p.id, again.id);
  assert.equal((await s.getOffer(admin, offerId)).price, "100");
  await assert.rejects(
    async () =>
      await s.createProposal(admin, { ...body, reason: "Outro motivo" }),
    /outros dados/,
  );
  await assert.rejects(
    async () =>
      await s.decideProposal(restricted, p.id, {
        action: "approve",
        comment: "aprovar teste",
        requestId: randomUUID(),
      }),
    /aprovador/,
  );
});
test("proposal workflow enforces approval and request, applies manually once and retains immutable snapshots", async () => {
  const p = await s.createProposal(admin, {
    offerId,
    input: {
      mode: "price",
      price: "85",
      conditionsVerified: true,
      mlFixed: "0",
    },
    reason: "Aplicar condição validada",
    requestId: randomUUID(),
  });
  const snapshot = p.snapshot_json;
  await assert.rejects(
    async () =>
      await s.decideProposal(admin, p.id, {
        action: "apply_manual",
        comment: "Foi feito externamente",
        requestId: randomUUID(),
      }),
    /Solicite/,
  );
  await s.decideProposal(admin, p.id, {
    action: "approve",
    comment: "Aprovado pelo cliente",
    requestId: randomUUID(),
  });
  await s.decideProposal(admin, p.id, {
    action: "request",
    comment: "Solicitada aplicação ao cliente",
    requestId: randomUUID(),
  });
  const body = {
    action: "apply_manual",
    comment: "Conferido no ML pelo cliente",
    requestId: randomUUID(),
  };
  await s.decideProposal(admin, p.id, body);
  await s.decideProposal(admin, p.id, body);
  assert.equal((await s.getOffer(admin, offerId)).price, "85.00");
  assert.equal((await s.offerDetail(admin, offerId)).costs.mlFixed, "0");
  assert.equal((await find("applications", { proposal_id: p.id })).length, 1);
  await s.saveCosts(admin, offerId, { ...complete, goods: "60" });
  assert.equal((await get("proposals", p.id))!.snapshot_json, snapshot);
  const history = await find("history", { proposal_id: p.id, field: "price" });
  assert.equal(history.length, 1);
  assert.equal(JSON.parse(history[0].snapshot_json).costs.goods, "40");
});
test("stale proposals and unverified tariffs cannot apply", async () => {
  const p = await s.createProposal(admin, {
    offerId,
    input: { mode: "price", price: "80", conditionsVerified: true },
    reason: "Proposta que ficará desatualizada",
    requestId: randomUUID(),
  });
  await s.decideProposal(admin, p.id, {
    action: "approve",
    comment: "Aprovada",
    requestId: randomUUID(),
  });
  await s.decideProposal(admin, p.id, {
    action: "request",
    comment: "Solicitada",
    requestId: randomUUID(),
  });
  await s.saveCosts(admin, offerId, complete);
  await assert.rejects(
    async () =>
      await s.decideProposal(admin, p.id, {
        action: "apply_manual",
        comment: "Confirmação",
        requestId: randomUUID(),
      }),
    /mudaram/,
  );
  const u = await s.createProposal(admin, {
    offerId,
    input: { mode: "price", price: "75" },
    reason: "Sem revalidação",
    requestId: randomUUID(),
  });
  await s.decideProposal(admin, u.id, {
    action: "approve",
    comment: "Aprovada",
    requestId: randomUUID(),
  });
  await s.decideProposal(admin, u.id, {
    action: "request",
    comment: "Solicitada",
    requestId: randomUUID(),
  });
  await assert.rejects(
    async () =>
      await s.decideProposal(admin, u.id, {
        action: "apply_manual",
        comment: "Confirmação",
        requestId: randomUUID(),
      }),
    /Revalide/,
  );
});
test("negative values and price edits outside proposal workflow are rejected", async () => {
  await assert.rejects(
    async () => await s.saveCosts(admin, offerId, { ...complete, goods: "-1" }),
  );
  const o = await s.getOffer(admin, offerId);
  await assert.rejects(
    async () =>
      await s.saveOffer(
        admin,
        offer("juntos-com", {
          productId: o.product_id,
          price: "999",
          version: o.version,
        }),
        offerId,
      ),
    /proposta/,
  );
});
test("kit composition and variation attributes are validated and persist", async () => {
  const product = (await s.getOffer(admin, offerId)).product_id;
  await assert.rejects(
    async () => await s.saveOffer(admin, offer("juntos-com", { type: "kit" })),
    /composição/,
  );
  const kit = await s.saveOffer(
    admin,
    offer("juntos-com", {
      type: "kit",
      title: "Kit",
      components: [{ productId: product, quantity: 2 }],
    }),
  );
  assert.equal((await s.offerDetail(admin, kit.id)).components[0].quantity, 2);
  await assert.rejects(
    async () =>
      await s.saveOffer(
        admin,
        offer("juntos-com", {
          type: "variation",
          components: [{ productId: product, quantity: 1 }],
        }),
      ),
    /atributos/,
  );
});
test("tasks allow store-wide work, notes convert idempotently and retain source", async () => {
  const t = await s.saveTask(admin, {
    storeId: "juntos-com",
    title: "Tarefa geral",
    priority: "high",
    status: "todo",
  });
  assert.equal(t.offer_id, null);
  await s.saveTask(
    admin,
    {
      storeId: "juntos-com",
      title: "Tarefa geral",
      priority: "high",
      status: "done",
      result: "Feito",
    },
    t.id,
  );
  assert.equal((await get("tasks", t.id))!.result, "Feito");
  const n = await s.saveNote(admin, {
    kind: "study",
    title: "Estudo geral",
    body: "Texto de estudo",
  });
  const a = await s.noteToTask(admin, n.id, { storeId: "juntos-com" }),
    b = await s.noteToTask(admin, n.id, { storeId: "juntos-com" });
  assert.equal(a.id, b.id);
  assert.equal(a.source_note_id, n.id);
  assert.ok(await get("notes", n.id));
});
test("import preview detects duplicate lines, destination duplicates and invalid references; confirmation is atomic and idempotent", async () => {
  const row = {
    name: "Importado",
    title: "Oferta CSV",
    sku: "CSV-001",
    mlId: "MLB-CSV",
    type: "unit",
    status: "draft",
    price: "50",
  };
  assert.equal(
    (await s.importPreview(admin, { storeId: "juntos-data", rows: [row, row] }))
      .valid,
    false,
  );
  const body = { storeId: "juntos-data", rows: [row], requestId: randomUUID() };
  const result = await s.confirmImport(admin, body);
  assert.equal((await s.confirmImport(admin, body)).id, result.id);
  assert.equal(
    (await s.importPreview(admin, { storeId: "juntos-data", rows: [row] }))
      .valid,
    false,
  );
  await assert.rejects(
    async () =>
      await s.confirmImport(admin, {
        ...body,
        rows: [{ ...row, title: "Alterado" }],
      }),
    /outros dados/,
  );
  const invalid = { ...row, mlId: "MLB-REF", origin: "reference" };
  assert.equal(
    (await s.importPreview(admin, { storeId: "juntos-data", rows: [invalid] }))
      .valid,
    false,
  );
});
test("cross-store links for tasks and notes are rejected", async () => {
  await assert.rejects(
    async () =>
      await s.saveTask(admin, {
        storeId: "juntos-data",
        offerId,
        title: "Inválida",
        priority: "low",
        status: "todo",
      }),
    /mesma loja/,
  );
  await assert.rejects(
    async () =>
      await s.saveNote(admin, {
        storeId: "juntos-data",
        offerId,
        title: "Inválida",
        kind: "study",
        body: "Texto",
      }),
    /mesma loja/,
  );
});
test("integration failures are truthful, recorded once and never update offers", async () => {
  const c = (
      await find("connections", {
        store_id: "juntos-com",
        provider: "mercadolivre",
      })
    )[0],
    requestId = randomUUID();
  await assert.rejects(s.sync(admin, c.id, { requestId }), /credenciais/);
  await s.sync(admin, c.id, { requestId });
  assert.equal((await find("sync_logs", { request_id: requestId })).length, 1);
  assert.equal((await s.insights(admin, offerId)).kind, "deterministic");
});
test("users from another organization cannot read the shared catalog or stores", async () => {
  const outsider = { ...admin, organization_id: "other-org", stores: [] };
  assert.equal(
    (await s.workspace(outsider, new URLSearchParams())).offers.length,
    0,
  );
  await assert.rejects(
    async () => await s.getOffer(outsider, offerId),
    /acesso/,
  );
});
test("product filters preserve general work and narrow tasks linked to offers", async () => {
  await s.saveTask(admin, {
    storeId: "juntos-com",
    offerId,
    title: "Tarefa vinculada de teste",
    priority: "low",
    status: "todo",
  });
  const data = await s.workspace(
    admin,
    new URLSearchParams("store=juntos-com&brand=Marca+inexistente"),
  );
  assert.equal(data.offers.length, 0);
  assert.ok(data.tasks.some((t) => t.offer_id === null));
  assert.ok(!data.tasks.some((t) => t.offer_id === offerId));
});

test("concurrent claims prevent duplicate ML codes without partial writes", async () => {
  const mlId = "MLB-CONCURRENT-" + randomUUID();
  const before = (await find("offers")).length;
  const results = await Promise.allSettled([
    s.saveOffer(admin, offer("juntos-com", { mlId })),
    s.saveOffer(admin, offer("juntos-com", { mlId })),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal((await find("offers")).length, before + 1);
  assert.equal((await find("offers", { ml_id: mlId })).length, 1);
});
test("concurrent proposal retries share one immutable proposal and audit entry", async () => {
  const body = {
    offerId,
    input: { mode: "price", price: "80", conditionsVerified: true },
    reason: "Concorrência validada",
    requestId: randomUUID(),
  };
  const [a, b] = await Promise.all([
    s.createProposal(admin, body),
    s.createProposal(admin, body),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    (await find("proposals", { request_id: body.requestId })).length,
    1,
  );
  assert.equal(
    (await find("history", { request_id: body.requestId })).length,
    1,
  );
});
test("changing store parameters invalidates an approved proposal without rewriting offers", async () => {
  const p = await s.createProposal(admin, {
    offerId,
    input: { mode: "price", price: "80", conditionsVerified: true },
    reason: "Revisão de parâmetros",
    requestId: randomUUID(),
  });
  await s.decideProposal(admin, p.id, {
    action: "approve",
    comment: "Aprovada",
    requestId: randomUUID(),
  });
  await s.decideProposal(admin, p.id, {
    action: "request",
    comment: "Solicitada",
    requestId: randomUUID(),
  });
  const version = (await s.getOffer(admin, offerId)).version;
  await s.saveParameters(admin, "juntos-com", { ...params, minMargin: "11" });
  assert.equal((await s.getOffer(admin, offerId)).version, version);
  await assert.rejects(
    s.decideProposal(admin, p.id, {
      action: "apply_manual",
      comment: "Conferida",
      requestId: randomUUID(),
    }),
    /mudaram/,
  );
  assert.equal((await get("proposals", p.id))!.status, "pending_application");
});
test("atomic import supports its 40-row limit and rejects oversized batches", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    name: "Importação limite " + i,
    title: "Oferta limite " + i,
    brand: "Marca limite " + i,
    category: "Categoria limite " + i,
    sku: "LIMIT-" + i,
    mlId: "MLB-LIMIT-" + i,
    type: "unit",
    status: "draft",
    price: "50",
  }));
  const result = await s.confirmImport(admin, {
    storeId: "juntos-data",
    rows,
    requestId: randomUUID(),
  });
  assert.equal(result.count, 40);
  assert.equal(
    (await find("offers", { store_id: "juntos-data" })).filter((o) =>
      o.ml_id?.startsWith("MLB-LIMIT-"),
    ).length,
    40,
  );
  await assert.rejects(
    s.confirmImport(admin, {
      storeId: "juntos-data",
      rows: [...rows, rows[0]],
      requestId: randomUUID(),
    }),
  );
});
test("Firestore rules deny direct client reads of existing private documents", async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/stores/juntos-com`;
  const result = await fetch(url);
  assert.equal(result.status, 403);
});

test("offer edits persist in Firestore and stale edits cannot overwrite them", async () => {
  const o = await s.saveOffer(
    admin,
    offer("juntos-com", { title: "Cadastro CRUD", mlId: "CRUD-" + id() }),
  );
  const payload = offer("juntos-com", {
    productId: o.product_id,
    title: "Cadastro corrigido",
    description: "Descrição corrigida",
    sku: "SKU-CORRIGIDO",
    mlId: o.ml_id,
    version: o.version,
  });
  const updated = await s.saveOffer(admin, payload, o.id);
  const stored = (await db().collection("offers").doc(o.id).get()).data()!;
  assert.equal(stored.title, "Cadastro corrigido");
  assert.equal(stored.sku, "SKU-CORRIGIDO");
  assert.equal(stored.description, "Descrição corrigida");
  assert.equal(stored.version, updated.version);
  await assert.rejects(
    s.saveOffer(admin, { ...payload, title: "Edição antiga" }, o.id),
    /outra operação/,
  );
  assert.equal((await s.getOffer(admin, o.id)).title, "Cadastro corrigido");
});
test("task and note edits have versions and deletions persist once with an audit trail", async () => {
  const task = await s.saveTask(admin, {
    storeId: "juntos-com",
    title: "Tarefa CRUD",
    priority: "high",
    status: "todo",
  });
  const changed = await s.saveTask(
    admin,
    {
      storeId: "juntos-com",
      title: "Tarefa editada",
      priority: "low",
      status: "done",
      result: "Conferida",
      version: task.version,
    },
    task.id,
  );
  assert.equal(
    (await db().collection("tasks").doc(task.id).get()).data()?.result,
    "Conferida",
  );
  await assert.rejects(
    s.saveTask(
      admin,
      {
        storeId: "juntos-com",
        title: "Antiga",
        priority: "high",
        status: "todo",
        version: task.version,
      },
      task.id,
    ),
    /alterada/,
  );
  const deletion = { requestId: id(), version: changed.version };
  await s.deleteRecord(admin, "tasks", task.id, deletion);
  await s.deleteRecord(admin, "tasks", task.id, deletion);
  assert.equal(
    (await db().collection("tasks").doc(task.id).get()).exists,
    false,
  );
  assert.equal(
    (await find("history", { field: "task.delete" })).filter(
      (h) => JSON.parse(h.old_value).id === task.id,
    ).length,
    1,
  );
  const note = await s.saveNote(admin, {
    title: "Nota geral CRUD",
    body: "Primeira anotação",
    kind: "study",
  });
  const n = await s.saveNote(
    admin,
    {
      title: "Nota geral editada",
      body: "Anotação corrigida",
      kind: "learning",
      version: note.version,
    },
    note.id,
  );
  assert.equal(
    (await db().collection("notes").doc(n.id).get()).data()?.body,
    "Anotação corrigida",
  );
  await assert.rejects(
    s.saveNote(
      admin,
      {
        title: "Nota antiga",
        body: "Antiga",
        kind: "study",
        version: note.version,
      },
      note.id,
    ),
    /alterada/,
  );
  await s.deleteRecord(admin, "notes", n.id, {
    requestId: id(),
    version: n.version,
  });
  assert.equal((await db().collection("notes").doc(n.id).get()).exists, false);
  assert.ok(
    (await s.workspace(admin, new URLSearchParams())).history.some(
      (h) => h.field === "note.delete" && JSON.parse(h.old_value).id === n.id,
    ),
  );
});
test("deletions enforce roles, store isolation, versions and note-to-task links", async () => {
  const task = await s.saveTask(admin, {
    storeId: "juntos-data",
    title: "Tarefa protegida",
    priority: "high",
    status: "todo",
  });
  await assert.rejects(
    s.deleteRecord(viewer, "tasks", task.id, { requestId: id(), version: 1 }),
    /consulta/,
  );
  await assert.rejects(
    s.deleteRecord(restricted, "tasks", task.id, {
      requestId: id(),
      version: 1,
    }),
    /acesso/,
  );
  await assert.rejects(
    s.deleteRecord(admin, "tasks", task.id, { requestId: id(), version: 99 }),
    /alterado/,
  );
  assert.ok(await get("tasks", task.id));
  const n = await s.saveNote(admin, {
    storeId: "juntos-com",
    title: "Nota com tarefa",
    body: "Preservar vínculo",
    kind: "study",
  });
  const t = await s.noteToTask(admin, n.id, { storeId: "juntos-com" });
  await assert.rejects(
    s.deleteRecord(admin, "notes", n.id, {
      requestId: id(),
      version: n.version,
    }),
    /originou uma tarefa/,
  );
  assert.ok(await get("notes", n.id));
  await s.deleteRecord(admin, "tasks", t.id, {
    requestId: id(),
    version: t.version,
  });
  await s.deleteRecord(admin, "notes", n.id, {
    requestId: id(),
    version: n.version,
  });
  assert.equal(await get("notes", n.id), undefined);
});
test("deleting an unused draft removes costs and simulations, releases ML identity and retains history", async () => {
  const mlId = "DELETE-" + id(),
    o = await s.saveOffer(admin, offer("juntos-com", { mlId }));
  await s.simulate(admin, o.id, { mode: "price", price: "95" }, true);
  const body = { requestId: id(), version: o.version };
  await s.deleteRecord(admin, "offers", o.id, body);
  await s.deleteRecord(admin, "offers", o.id, body);
  assert.equal((await db().collection("offers").doc(o.id).get()).exists, false);
  assert.equal(await get("costs", o.id), undefined);
  assert.equal((await find("simulations", { offer_id: o.id })).length, 0);
  assert.ok(await get("products", o.product_id));
  assert.equal(
    (await find("history", { offer_id: o.id })).filter(
      (h) => h.field === "offer.delete",
    ).length,
    1,
  );
  await assert.rejects(s.getOffer(admin, o.id), /não encontrado/);
  const recreated = await s.saveOffer(admin, offer("juntos-com", { mlId }));
  assert.notEqual(recreated.id, o.id);
});
test("offers in operation or linked to decisions cannot be erased", async () => {
  const active = await s.saveOffer(
    admin,
    offer("juntos-com", { status: "active" }),
  );
  await assert.rejects(
    s.deleteRecord(admin, "offers", active.id, {
      requestId: id(),
      version: active.version,
    }),
    /Encerrado/,
  );
  const draft = await s.saveOffer(admin, offer());
  await s.createProposal(admin, {
    offerId: draft.id,
    input: { mode: "price", price: "90" },
    reason: "Manter decisão registrada",
    requestId: id(),
  });
  await assert.rejects(
    s.deleteRecord(admin, "offers", draft.id, {
      requestId: id(),
      version: draft.version,
    }),
    /preservar os vínculos/,
  );
  assert.ok(await get("offers", draft.id));
});
test("shared product corrections update all related offers and respect every store grant", async () => {
  const first = await s.saveOffer(admin, offer()),
    second = await s.saveOffer(
      admin,
      offer("juntos-data", { productId: first.product_id }),
    );
  const body = offer("juntos-com", {
    productId: first.product_id,
    updateProduct: true,
    productVersion: 1,
    name: "Produto corrigido",
    brand: "Marca corrigida",
    category: "Categoria corrigida",
    model: "Modelo corrigido",
    version: first.version,
  });
  await assert.rejects(s.saveOffer(restricted, body, first.id), /acesso/);
  assert.equal(
    (await get("products", first.product_id))!.name,
    "Produto de teste",
  );
  await s.saveOffer(admin, body, first.id);
  assert.equal(
    (await s.getOffer(admin, second.id)).product_name,
    "Produto corrigido",
  );
  assert.equal((await s.getOffer(admin, second.id)).brand, "Marca corrigida");
  assert.ok((await s.getOffer(admin, second.id)).version > second.version);
});
test("saving a proposal rejects scenarios invalidated since the displayed calculation", async () => {
  const o = await s.saveOffer(admin, offer()),
    snapshot = await s.simulate(admin, o.id, { mode: "price", price: "90" });
  await s.saveCosts(admin, o.id, complete);
  await assert.rejects(
    s.createProposal(admin, {
      offerId: o.id,
      input: snapshot.input,
      offerVersion: snapshot.offer.version,
      parametersVersion: snapshot.parametersRevision,
      reason: "Cenário antigo",
      requestId: id(),
    }),
    /Calcule novamente/,
  );
  assert.equal((await find("proposals", { offer_id: o.id })).length, 0);
  await assert.rejects(
    s.saveCosts(admin, o.id, { ...complete, offerVersion: o.version }),
    /outra operação/,
  );
});
test("store creation and renaming preserve its ID, parameters, connections and access", async () => {
  const store = await s.createStore(admin, { name: "Loja de revisão" }),
    fresh = await workspaceActor();
  assert.ok(fresh.stores.some((s) => s.id === store.id));
  await s.updateStore(fresh, store.id, { name: "Loja de revisão editada" });
  assert.equal(
    (await get("stores", store.id))!.name,
    "Loja de revisão editada",
  );
  assert.ok(await get("parameters", store.id));
  assert.equal((await find("connections", { store_id: store.id })).length, 3);
  await assert.rejects(
    s.updateStore(restricted, "juntos-com", { name: "Inválida" }),
    /administrador/,
  );
  await assert.rejects(
    s.updateStore(fresh, store.id, { name: "juntos.com" }),
    /UNIQUE/,
  );
});
test("unapplied proposals can be cancelled once without changing price or their snapshot", async () => {
  const o = await s.saveOffer(admin, offer());
  const p = await s.createProposal(admin, {
    offerId: o.id,
    input: { mode: "price", price: "90" },
    reason: "Cenário a substituir",
    requestId: id(),
  });
  await s.decideProposal(admin, p.id, {
    action: "approve",
    comment: "Aprovada inicialmente",
    requestId: id(),
  });
  await s.decideProposal(admin, p.id, {
    action: "request",
    comment: "Solicitada",
    requestId: id(),
  });
  await assert.rejects(
    s.decideProposal(restricted, p.id, {
      action: "cancel",
      comment: "Não sou o autor",
      requestId: id(),
    }),
    /aprovador/,
  );
  const action = {
    action: "cancel",
    comment: "Cancelar para preparar novo cenário",
    requestId: id(),
  };
  await s.decideProposal(admin, p.id, action);
  await s.decideProposal(admin, p.id, action);
  assert.equal((await get("proposals", p.id))!.status, "cancelled");
  assert.equal((await get("proposals", p.id))!.snapshot_json, p.snapshot_json);
  assert.equal((await s.getOffer(admin, o.id)).price, "100");
  assert.equal(
    (await find("history", { proposal_id: p.id, field: "proposal.cancel" }))
      .length,
    1,
  );
  await assert.rejects(
    s.decideProposal(admin, p.id, {
      action: "apply_manual",
      comment: "Não permitida",
      requestId: id(),
    }),
    /Solicite/,
  );
});

test("spreadsheet updates preserve identity, costs and history and reject stale financial changes", async () => {
  const o = await s.saveOffer(
    admin,
    offer("juntos-com", {
      mlId: "MLB-XLSX-UPDATE",
      title: "Antes da planilha",
    }),
  );
  await s.saveCosts(admin, o.id, complete);
  const current = await s.getOffer(admin, o.id);
  const row = {
    id: current.id,
    version: current.version,
    storeId: "juntos-com",
    name: current.product_name,
    title: "Após planilha",
    model: current.model,
    brand: current.brand,
    category: current.category,
    sku: current.sku,
    mlId: current.ml_id,
    type: "unit",
    status: "paused",
    price: current.price,
    description: "Conteúdo da planilha",
    origin: "import",
  };
  const body = {
    storeId: "juntos-com",
    mode: "update",
    rows: [row],
    requestId: id(),
  };
  assert.equal((await s.importPreview(admin, body)).valid, true);
  const costsBefore = await get("costs", o.id);
  const result = await s.confirmImport(admin, body);
  assert.equal((await s.confirmImport(admin, body)).id, result.id);
  const after = await s.getOffer(admin, o.id);
  assert.equal(after.title, "Após planilha");
  assert.equal(after.origin, "manual");
  assert.equal(after.product_id, current.product_id);
  assert.equal(after.version, current.version + 1);
  assert.deepEqual(await get("costs", o.id), costsBefore);
  assert.equal((await find("offers", { ml_id: row.mlId })).length, 1);
  assert.ok(
    (await find("history", { offer_id: o.id })).some(
      (h) => h.actor_name === admin.name,
    ),
  );
  assert.equal((await s.importPreview(admin, body)).valid, false);
  const changedPrice = {
    ...body,
    requestId: id(),
    rows: [{ ...row, version: after.version, price: "80" }],
  };
  assert.ok(
    (await s.importPreview(admin, changedPrice)).rows[0].errors.some((e) =>
      e.includes("preço"),
    ),
  );
  await assert.rejects(s.confirmImport(admin, changedPrice), /prévia/);
  const otherStore = { ...body, storeId: "juntos-data", requestId: id() };
  assert.equal((await s.importPreview(admin, otherStore)).valid, false);
  await assert.rejects(s.confirmImport(admin, otherStore), /prévia/);
});
test("large import previews detect cross-batch duplicates without writing any rows", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    name: `Produto grande ${i}`,
    title: `Prévia grande ${i}`,
    mlId: `MLB-PREVIEW-${i}`,
    type: "unit",
    status: "draft",
    price: "100",
  }));
  const before = (await find("offers")).length;
  assert.equal(
    (await s.importPreview(admin, { storeId: "juntos-com", rows })).valid,
    true,
  );
  const duplicate = [...rows];
  duplicate[999] = { ...rows[0] };
  assert.equal(
    (await s.importPreview(admin, { storeId: "juntos-com", rows: duplicate }))
      .valid,
    false,
  );
  assert.equal((await find("offers")).length, before);
  await assert.rejects(
    s.importPreview(admin, { storeId: "juntos-com", rows: [...rows, rows[0]] }),
  );
  await assert.rejects(
    s.importPreview(viewer, { storeId: "juntos-com", rows: rows.slice(0, 1) }),
    /consulta/,
  );
});

test("a live scenario keeps full draft costs isolated until the approved application and is recalculated on the server", async () => {
  await s.saveParameters(admin, "juntos-com", params);
  const o = await s.saveOffer(
    admin,
    offer("juntos-com", { title: "Cenário de custos digitados" }),
  );
  await s.saveCosts(admin, o.id, complete);
  const detail = await s.offerDetail(admin, o.id);
  const input = {
    mode: "price",
    price: "90",
    conditionsVerified: true,
    costOverrides: { ...complete, goods: "15" },
  };
  const snapshot = await s.simulate(admin, o.id, input);
  assert.equal(snapshot.proposed.margin, "50.60");
  const current = await s.offerDetail(admin, o.id);
  assert.equal(current.costs.goods, "40");
  assert.equal(current.offer.price, "100");
  const proposal = await s.createProposal(admin, {
    offerId: o.id,
    input,
    reason: "Revisar custo e condição",
    offerVersion: detail.offer.version,
    parametersVersion: detail.parametersRevision,
    requestId: id(),
    calculation: { margin: "999999" },
  });
  assert.equal(proposal.snapshot.proposed.margin, "50.60");
  for (const action of ["approve", "request", "apply_manual"])
    await s.decideProposal(admin, proposal.id, {
      action,
      comment: "Conferido e executado manualmente",
      requestId: id(),
    });
  const applied = await s.offerDetail(admin, o.id);
  assert.equal(applied.offer.price, "90.00");
  assert.equal(applied.costs.goods, "15");
  assert.equal(applied.calculation.margin, "50.60");
  assert.equal(
    (await get("proposals", proposal.id))!.snapshot_json,
    JSON.stringify(proposal.snapshot),
  );
});
test("changing fees with an unchanged price still requires verification and incomplete draft costs cannot apply", async () => {
  await s.saveParameters(admin, "juntos-com", params);
  for (const incomplete of [false, true]) {
    const o = await s.saveOffer(
      admin,
      offer("juntos-com", { title: "Validação de custo proposto" }),
    );
    await s.saveCosts(admin, o.id, complete);
    const input = {
      mode: "price",
      price: "100",
      costOverrides: {
        ...complete,
        mlPercent: "12",
        ...(incomplete ? { goods: null } : {}),
      },
    };
    const proposal = await s.createProposal(admin, {
      offerId: o.id,
      input,
      reason: "Mudança de custos",
      requestId: id(),
    });
    for (const action of ["approve", "request"])
      await s.decideProposal(admin, proposal.id, {
        action,
        comment: "Revisão manual",
        requestId: id(),
      });
    await assert.rejects(
      s.decideProposal(admin, proposal.id, {
        action: "apply_manual",
        comment: "Tentativa sem validação",
        requestId: id(),
      }),
      incomplete ? /Complete os dados/ : /Revalide tarifa/,
    );
    assert.equal((await s.offerDetail(admin, o.id)).costs.mlPercent, "10");
  }
});
test("applying a draft that inherits rates removes old offer overrides instead of retaining them", async () => {
  await s.saveParameters(admin, "juntos-com", params);
  const o = await s.saveOffer(
    admin,
    offer("juntos-com", { title: "Voltar aos parâmetros da loja" }),
  );
  await s.saveCosts(admin, o.id, {
    ...complete,
    taxRate: "0",
    managementRate: "0",
  });
  const proposal = await s.createProposal(admin, {
    offerId: o.id,
    input: { mode: "price", price: "100", costOverrides: complete },
    reason: "Usar regras da loja novamente",
    requestId: id(),
  });
  assert.equal(proposal.snapshot.proposed.margin, "34.00");
  for (const action of ["approve", "request", "apply_manual"])
    await s.decideProposal(admin, proposal.id, {
      action,
      comment: "Regra conferida e aplicada",
      requestId: id(),
    });
  const detail = await s.offerDetail(admin, o.id);
  assert.equal(detail.costs.taxRate, undefined);
  assert.equal(detail.costs.managementRate, undefined);
  assert.equal(detail.calculation.margin, "34.00");
});

async function pricingFixture() {
  const store = await s.createStore(admin, { name: "Precificação " + id() });
  const actor = { ...admin, stores: [...admin.stores, store] };
  await s.saveParameters(actor, store.id, {
    ...params,
    taxRate: "0",
    managementRate: "0",
    enforceSalesMargin: true,
  });
  const unit = await s.saveOffer(
    actor,
    offer(store.id, { purchaseCost: "20" }),
  );
  const inherited = {
    ...complete,
    goods: null,
    mlPercent: "0",
    mlFixed: "0",
    shipping: "0",
    packaging: "0",
    advertising: "0",
  };
  await s.saveCosts(actor, unit.id, inherited);
  return { actor, store, unit, inherited };
}
test("product purchase costs feed linked listings, kits, workspace and immutable pricing snapshots", async () => {
  const { actor, store, unit, inherited } = await pricingFixture();
  const linked = await s.saveOffer(
    actor,
    offer(store.id, { productId: unit.product_id }),
  );
  await s.saveCosts(actor, linked.id, { ...inherited, goods: "0" });
  const kit = await s.saveOffer(
    actor,
    offer(store.id, {
      type: "kit",
      components: [{ productId: unit.product_id, quantity: 2 }],
    }),
  );
  await s.saveCosts(actor, kit.id, inherited);
  assert.equal(
    (await s.offerDetail(actor, unit.id)).calculation.margin,
    "80.00",
  );
  assert.equal(
    (await s.offerDetail(actor, kit.id)).calculation.margin,
    "60.00",
  );
  const proposal = await s.createProposal(actor, {
    offerId: kit.id,
    input: { mode: "price", price: "100" },
    reason: "Custo herdado para auditoria",
    requestId: id(),
  });
  assert.equal(proposal.snapshot.offer.purchaseCost.amount, "40.000000");
  const saved = proposal.snapshot_json;
  const current = await s.getOffer(actor, unit.id);
  await s.saveOffer(
    actor,
    offer(store.id, {
      productId: unit.product_id,
      updateProduct: true,
      productVersion: current.product_version,
      purchaseCost: "35",
      version: current.version,
    }),
    unit.id,
  );
  assert.equal(
    (await s.offerDetail(actor, unit.id)).calculation.margin,
    "65.00",
  );
  assert.equal(
    (await s.offerDetail(actor, kit.id)).calculation.margin,
    "30.00",
  );
  assert.equal(
    (await s.offerDetail(actor, linked.id)).calculation.margin,
    "100.00",
  );
  assert.equal((await s.offerDetail(actor, unit.id)).costs.goods, null);
  assert.equal((await get("proposals", proposal.id))!.snapshot_json, saved);
  await assert.rejects(
    s.decideProposal(actor, proposal.id, {
      action: "approve",
      comment: "Rever após alteração",
      requestId: id(),
    }),
    /mudaram/,
  );
  const workspace = await s.workspace(
    actor,
    new URLSearchParams({ store: store.id, profile: "listings" }),
  );
  assert.equal(
    workspace.offers.find((o) => o.id === kit.id)!.calculation.margin,
    "30.00",
  );
  // Omitted cost in older clients cannot clear the shared value.
  const latest = await s.getOffer(actor, unit.id);
  await s.saveOffer(
    actor,
    offer(store.id, {
      productId: unit.product_id,
      updateProduct: true,
      productVersion: latest.product_version,
      version: latest.version,
    }),
    unit.id,
  );
  assert.equal((await get("products", unit.product_id))!.purchase_cost, "35");
});
test("40 percent is blocked by default; warning-only policy is persisted per store and cannot bypass stale proposals", async () => {
  const { actor, store, unit, inherited } = await pricingFixture();
  await s.saveCosts(actor, unit.id, { ...inherited, goods: "60" });
  const propose = () =>
    s.createProposal(actor, {
      offerId: unit.id,
      input: { mode: "price", price: "100", conditionsVerified: true },
      reason: "Conferir limite exato",
      requestId: id(),
    });
  const proposal = await propose();
  assert.equal(proposal.snapshot.proposed.salesMarginMet, false);
  assert.equal(proposal.snapshot.proposed.salesTargetPrice, "100.01");
  await assert.rejects(
    s.decideProposal(actor, proposal.id, {
      action: "approve",
      comment: "Tentativa no limite",
      requestId: id(),
    }),
    /maior que 40/,
  );
  assert.equal((await get("proposals", proposal.id))!.status, "review");
  await s.saveParameters(actor, store.id, {
    ...params,
    taxRate: "0",
    managementRate: "0",
    enforceSalesMargin: false,
  });
  await assert.rejects(
    s.decideProposal(actor, proposal.id, {
      action: "approve",
      comment: "Regra mudou",
      requestId: id(),
    }),
    /mudaram/,
  );
  const warning = await propose();
  for (const action of ["approve", "request", "apply_manual"])
    await s.decideProposal(actor, warning.id, {
      action,
      comment: "Exceção configurada na loja",
      requestId: id(),
    });
  assert.equal((await get("proposals", warning.id))!.status, "applied_manual");
  assert.equal(
    (await s.offerDetail(actor, unit.id)).parameters.enforceSalesMargin,
    false,
  );
  assert.ok(
    warning.snapshot.proposed.warnings.some((w: string) =>
      w.includes("maior que 40"),
    ),
  );
});
test("Excel product-cost imports validate shared versions, preserve overrides and are idempotent", async () => {
  const { actor, store, unit, inherited } = await pricingFixture();
  const related = await s.saveOffer(
    actor,
    offer(store.id, { productId: unit.product_id }),
  );
  await s.saveCosts(actor, related.id, { ...inherited, goods: "0" });
  const row = {
    productId: unit.product_id,
    productVersion: 1,
    purchaseCost: "33.123456",
  };
  const body = {
    storeId: store.id,
    mode: "costs",
    rows: [row],
    requestId: id(),
  };
  assert.equal((await s.importPreview(actor, body)).valid, true);
  const result = await s.confirmImport(actor, body);
  assert.deepEqual(await s.confirmImport(actor, body), result);
  assert.equal(
    (await s.offerDetail(actor, unit.id)).calculation.breakdown.goods,
    "33.12",
  );
  assert.equal((await s.offerDetail(actor, related.id)).costs.goods, "0");
  assert.equal(
    (await s.importPreview(actor, { ...body, requestId: id() })).valid,
    false,
  );
  assert.equal(
    (await s.importPreview(actor, { ...body, rows: [row, row] })).valid,
    false,
  );
  const version = (await get("products", unit.product_id))!.version;
  const clear = {
    ...body,
    requestId: id(),
    rows: [{ ...row, productVersion: version, purchaseCost: null }],
  };
  await s.confirmImport(actor, clear);
  assert.equal((await s.offerDetail(actor, unit.id)).calculation.margin, null);
  const locked = await s.getOffer(actor, related.id);
  await put("offers", related.id, {
    ...locked,
    ml_apply_until: Date.now() + 60000,
  });
  const lockPreview = await s.importPreview(actor, {
    ...body,
    rows: [{ ...row, productVersion: version + 1 }],
  });
  assert.equal(lockPreview.valid, false);
  assert.match(lockPreview.rows[0].errors.join(" "), /andamento/);
});
