import { test, before } from "node:test";
import assert from "node:assert/strict";
import { initializeDatabase, put, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import {
  searchOffers,
  navigationReport,
  taskOptions,
} from "../src/server/navigation";
import { quickSearch } from "../src/domain/quick-search";
let actor: Actor;
before(async () => {
  await initializeDatabase();
  actor = await workspaceActor();
});
test("quick search preserves leading zeros, normalizes accents and ranks exact SKU and ML identifiers", () => {
  const rows = [
    { id: "title", title: "Tomada Áudio portátil", sku: "11", mlId: "MLB111" },
    { id: "sku", title: "Outra tomada", sku: "001", mlId: "MLB123" },
  ];
  assert.equal(quickSearch(rows, "001")[0].id, "sku");
  assert.equal(quickSearch(rows, "audio PORTATIL")[0].id, "title");
  assert.equal(quickSearch(rows, "MLB-123")[0].id, "sku");
  assert.equal(quickSearch(rows, "Não existe").length, 0);
});
test("search projection scopes stores, excludes foreign-organization records and returns no full catalogue or credentials", async () => {
  await put("offers", "search-own", {
    organization_id: actor.organization_id,
    store_id: "juntos-com",
    title: "Busca escopo",
    sku: "0007",
    ml_id: "MLB77",
    price: "100",
    status: "active",
    description: "PRIVATE-DESCRIPTION",
    ml: {
      pictures: [{ url: "https://http2.mlstatic.com/test.jpg" }],
      attributes: [{ value: "PRIVATE-ATTRIBUTES" }],
    },
  });
  await put("offers", "search-other", {
    organization_id: actor.organization_id,
    store_id: "juntos-data",
    title: "OTHER-STORE",
  });
  await put("offers", "search-foreign", {
    organization_id: "foreign",
    store_id: "juntos-com",
    title: "FOREIGN-ORG",
  });
  const result = await searchOffers(
    actor,
    new URLSearchParams({ store: "juntos-com" }),
  );
  const own = result.offers.find((o) => o.id === "search-own")!;
  assert.equal(own.sku, "0007");
  assert.equal(own.thumbnail, "https://http2.mlstatic.com/test.jpg");
  const json = JSON.stringify(result);
  for (const text of [
    "PRIVATE-DESCRIPTION",
    "PRIVATE-ATTRIBUTES",
    "FOREIGN-ORG",
    "OTHER-STORE",
  ])
    assert.ok(!json.includes(text));
  await assert.rejects(
    searchOffers(actor, new URLSearchParams({ store: "not-authorized" })),
    /Loja/,
  );
  assert.deepEqual(
    (await searchOffers({ ...actor, stores: [] }, new URLSearchParams()))
      .offers,
    [],
  );
});
test("navigation metadata ignores listing filters and exposes only public connection status", async () => {
  await put("connections", key("juntos-com", "mercadolivre"), {
    organization_id: actor.organization_id,
    store_id: "juntos-com",
    provider: "mercadolivre",
    status: "connected",
    access_token_encrypted: "PRIVATE-TOKEN",
    application_secret_encrypted: "PRIVATE-SECRET",
  });
  await put("tasks", "navigation-open", {
    organization_id: actor.organization_id,
    store_id: "juntos-com",
    offer_id: "search-own",
    status: "todo",
  });
  await put("tasks", "navigation-done", {
    organization_id: actor.organization_id,
    store_id: "juntos-com",
    status: "done",
  });
  const all = await navigationReport(
    actor,
    new URLSearchParams({ store: "juntos-com" }),
  );
  const filtered = await navigationReport(
    actor,
    new URLSearchParams({
      store: "juntos-com",
      q: "missing",
      brand: "missing",
      status: "paused",
    }),
  );
  assert.equal(filtered.openTasks, all.openTasks);
  assert.ok(all.openTasks >= 1);
  assert.equal(
    filtered.connections.find((c) => c.provider === "mercadolivre")?.status,
    "connected",
  );
  assert.ok(!JSON.stringify(filtered).includes("PRIVATE-"));
  await assert.rejects(
    navigationReport(actor, new URLSearchParams({ store: "not-authorized" })),
    /Loja/,
  );
});

test("task options are lightweight, authorized and scoped to the selected store", async () => {
  const result = await taskOptions(
    actor,
    new URLSearchParams({ store: "juntos-com" }),
  );
  const own = result.offerChoices.find((o) => o.id === "search-own")!;
  assert.deepEqual(own, {
    id: "search-own",
    store_id: "juntos-com",
    title: "Busca escopo",
  });
  const json = JSON.stringify(result);
  for (const value of [
    "PRIVATE-DESCRIPTION",
    "PRIVATE-ATTRIBUTES",
    "PRIVATE-TOKEN",
    "FOREIGN-ORG",
    "OTHER-STORE",
  ])
    assert.ok(!json.includes(value));
  await assert.rejects(
    taskOptions(actor, new URLSearchParams({ store: "not-authorized" })),
    /Loja/,
  );
  assert.deepEqual(
    await taskOptions({ ...actor, stores: [] }, new URLSearchParams()),
    { offerChoices: [], tasks: [], truncated: false },
  );
});
