import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import {
  initializeDatabase,
  get,
  find,
  put,
  key,
  type Row,
} from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import * as ml from "../src/server/mercadolivre";
import * as s from "../src/server/services";
import { receiveNotification } from "../src/server/ml-notifications";
let actor: Actor;
const connectionId = key("juntos-com", "mercadolivre");
const secondId = key("juntos-data", "mercadolivre");
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
async function mocked<T>(handler: Handler, fn: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.mercadolibre.com");
    assert.equal(init.redirect, "error");
    return handler(url, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}
function oauth(url: URL, init: RequestInit) {
  if (url.pathname === "/oauth/token") {
    const body = new URLSearchParams(String(init.body));
    const seller = Number(
      body.get("code") || body.get("refresh_token")?.split("-")[1],
    );
    if (body.get("grant_type") === "authorization_code")
      assert.ok(body.get("code_verifier"));
    return json({
      access_token: "access-" + seller,
      refresh_token: "refresh-" + seller,
      token_type: "bearer",
      expires_in: 21600,
      user_id: seller,
    });
  }
  if (url.pathname === "/users/me")
    return json({
      id: Number(
        String((init.headers as Record<string, string>).Authorization).split(
          "-",
        )[1],
      ),
      nickname: "Vendedor teste",
      site_id: "MLB",
    });
  throw new Error("Endpoint inesperado: " + url.pathname);
}
async function connect(id = connectionId, seller = 111) {
  return mocked(oauth, async () => {
    const flow = await ml.startAuthorization(actor, id);
    const url = new URL(flow.url);
    assert.equal(url.origin, "https://auth.mercadolivre.com.br");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    return ml.finishAuthorization(
      actor,
      new URLSearchParams({ code: String(seller), state: flow.state }),
      flow.state,
    );
  });
}
function item(id = "MLB1234", extra: Row = {}) {
  return {
    id,
    seller_id: 111,
    site_id: "MLB",
    title: "Produto integrado",
    category_id: "MLB100",
    currency_id: "BRL",
    price: 100,
    status: "active",
    listing_type_id: "gold_special",
    available_quantity: 0,
    sold_quantity: 999,
    pictures: [],
    attributes: [
      { id: "BRAND", value_name: "Marca ML" },
      { id: "SELLER_SKU", value_name: "000ML" },
    ],
    shipping: { mode: "me2", logistic_type: "drop_off", free_shipping: true },
    variations: [],
    ...extra,
  };
}
function listings(items: Row[], extra?: Handler): Handler {
  return (url, init) => {
    if (extra) {
      const result = extra(url, init);
      if (result) return result;
    }
    if (url.pathname.endsWith("/items/search"))
      return json({
        results: items.map((i) => i.id),
        paging: { total: items.length },
      });
    if (url.pathname === "/categories/MLB100/attributes")
      return json([{ id: "MODEL", name: "Modelo", tags: { required: true } }]);
    if (url.pathname.endsWith("/description"))
      return json({ plain_text: "Descrição confirmada no ML" });
    const match = items.find((i) => "/items/" + i.id === url.pathname);
    if (match) return json(match);
    throw new Error("Endpoint inesperado: " + url.pathname);
  };
}
async function importedOffer(id = "MLB1234") {
  return (await find("offers", { store_id: "juntos-com", ml_id: id }))[0];
}
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-datamat-ml-" + randomUUID();
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "test-secret-not-real";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  await initializeDatabase();
  actor = await workspaceActor();
});
test("credential encryption is randomized, authenticated and server configuration rejects unsafe redirects", () => {
  const first = ml.encryptSecret({ access_token: "private-token" });
  assert.ok(!first.includes("private-token"));
  assert.notEqual(first, ml.encryptSecret({ access_token: "private-token" }));
  assert.equal(ml.decryptSecret(first).access_token, "private-token");
  assert.throws(() => ml.decryptSecret("broken." + first), /credenciais/);
  assert.equal(ml.mlConfigured(), true);
  const previous = process.env.ML_REDIRECT_URI;
  process.env.ML_REDIRECT_URI =
    "https://other.example/api/mercadolivre/callback";
  assert.equal(ml.mlConfigured(), false);
  process.env.ML_REDIRECT_URI = previous;
});
test("OAuth binds store, browser and PKCE; state is one-time and tokens never enter public workspace", async () => {
  await mocked(oauth, async () => {
    const flow = await ml.startAuthorization(actor, connectionId);
    await assert.rejects(
      ml.finishAuthorization(
        actor,
        new URLSearchParams({ code: "111", state: flow.state }),
        "other-browser",
      ),
      /navegador/,
    );
    await ml.finishAuthorization(
      actor,
      new URLSearchParams({ code: "111", state: flow.state }),
      flow.state,
    );
    await assert.rejects(
      ml.finishAuthorization(
        actor,
        new URLSearchParams({ code: "111", state: flow.state }),
        flow.state,
      ),
      /utilizada/,
    );
  });
  const c = await get("connections", connectionId);
  assert.equal(c?.external_account, "111");
  assert.equal(c?.status, "connected");
  const token = await get("ml_tokens", connectionId);
  assert.ok(token?.encrypted && !token.encrypted.includes("access-111"));
  const publicData = JSON.stringify(
    await s.workspace(actor, new URLSearchParams()),
  );
  for (const secret of [
    "access-111",
    "refresh-111",
    "test-secret-not-real",
    token!.encrypted,
  ])
    assert.ok(!publicData.includes(secret));
});
test("expired, denied and cross-store OAuth cannot connect a seller twice", async () => {
  const flow = await ml.startAuthorization(actor, secondId);
  const stateId = (
    await find("ml_oauth_states", { connection_id: secondId })
  ).find((r) => r.status === "pending")!;
  await put("ml_oauth_states", stateId.id, { ...stateId, expires_at: 0 });
  await assert.rejects(
    ml.finishAuthorization(
      actor,
      new URLSearchParams({ state: flow.state, code: "222" }),
      flow.state,
    ),
    /expirada/,
  );
  const denied = await ml.startAuthorization(actor, secondId);
  await assert.rejects(
    ml.finishAuthorization(
      actor,
      new URLSearchParams({ state: denied.state, error: "access_denied" }),
      denied.state,
    ),
    /não concedida/,
  );
  await assert.rejects(connect(secondId, 111), /UNIQUE|outra loja/);
  assert.equal((await get("connections", secondId))?.external_account, null);
  const restricted = {
    ...actor,
    stores: actor.stores.filter((r) => r.id === "juntos-data"),
  };
  await assert.rejects(
    ml.startAuthorization(restricted, connectionId),
    /acesso/,
  );
  await assert.rejects(
    ml.startAuthorization({ ...actor, role: "viewer" }, connectionId),
    /administrador/,
  );
});
test("OAuth normalizes numeric strings and bearer casing without validating unused metadata", async () => {
  await mocked(
    async (url, init) => {
      const response = oauth(url, init);
      const payload = await response.json();
      return json(
        url.pathname === "/oauth/token"
          ? {
              ...payload,
              user_id: "111",
              expires_in: "21600",
              token_type: " Bearer ",
              scope: ["read", "write", "offline_access"],
            }
          : { ...payload, id: "111" },
      );
    },
    async () => {
      const flow = await ml.startAuthorization(actor, connectionId);
      await ml.finishAuthorization(
        actor,
        new URLSearchParams({ code: "111", state: flow.state }),
        flow.state,
      );
    },
  );
  const tokens = ml.decryptSecret(
    (await get("ml_tokens", connectionId))!.encrypted,
  );
  assert.equal(tokens.user_id, 111);
  assert.equal(tokens.expires_in, 21600);
  assert.equal(tokens.token_type, "bearer");
  assert.equal(tokens.scope, undefined);
  assert.equal(
    (await get("connections", connectionId))?.external_account,
    "111",
  );
});
test("invalid OAuth fields produce actionable sanitized errors and never overwrite previous credentials", async () => {
  const previous = (await get("ml_tokens", connectionId))!.encrypted;
  for (const invalid of [
    { field: "refresh_token", value: undefined },
    { field: "expires_in", value: null },
    { field: "expires_in", value: true },
    { field: "expires_in", value: "1.5" },
    { field: "expires_in", value: 0 },
    { field: "user_id", value: "9007199254740993" },
    { field: "user_id", value: "111oops" },
    { field: "token_type", value: "secret-invalid-token-type" },
    { field: "access_token", value: " " },
  ]) {
    let requests = 0;
    await mocked(
      async (url, init) => {
        requests++;
        assert.equal(url.pathname, "/oauth/token");
        const payload = await oauth(url, init).json();
        return json({ ...payload, [invalid.field]: invalid.value });
      },
      async () => {
        const flow = await ml.startAuthorization(actor, connectionId);
        await assert.rejects(
          ml.finishAuthorization(
            actor,
            new URLSearchParams({ code: "111", state: flow.state }),
            flow.state,
          ),
          (error: any) => {
            assert.equal(error.status, 502);
            assert.match(error.message, /ao conectar/);
            assert.ok(error.message.includes(invalid.field));
            if (invalid.field === "refresh_token")
              assert.match(error.message, /offline_access/);
            for (const secret of [
              "access-111",
              "refresh-111",
              "test-secret-not-real",
              "secret-invalid-token-type",
            ])
              assert.ok(!error.message.includes(secret));
            return true;
          },
        );
      },
    );
    assert.equal(requests, 1);
    assert.equal((await get("ml_tokens", connectionId))!.encrypted, previous);
  }
  await mocked(
    async (url, init) => {
      const payload = await oauth(url, init).json();
      return json(
        url.pathname === "/users/me" ? { ...payload, id: "222" } : payload,
      );
    },
    async () => {
      const flow = await ml.startAuthorization(actor, connectionId);
      await assert.rejects(
        ml.finishAuthorization(
          actor,
          new URLSearchParams({ code: "111", state: flow.state }),
          flow.state,
        ),
        /conta vendedora/,
      );
    },
  );
  assert.equal((await get("ml_tokens", connectionId))!.encrypted, previous);
});
test("OAuth navigation preserves filters on success, denial and expiration and rejects untrusted returns", async () => {
  const target =
    "/configuracoes?store=juntos-com&configTab=integrations&brand=A&brand=B&q=busca&page=3&pageSize=50";
  const flow = await ml.startAuthorization(actor, connectionId, target);
  const params = new URLSearchParams({
    state: flow.state,
    error: "access_denied",
  });
  assert.equal(await ml.authorizationReturn(actor, params, flow.state), target);
  await assert.rejects(
    ml.finishAuthorization(actor, params, flow.state),
    /não concedida/,
  );
  assert.equal(await ml.authorizationReturn(actor, params, flow.state), target);
  assert.equal(
    await ml.authorizationReturn(actor, params, "other-browser"),
    "/configuracoes?configTab=integrations",
  );
  assert.equal(
    await ml.authorizationReturn(
      { ...actor, id: "other-actor" },
      params,
      flow.state,
    ),
    "/configuracoes?configTab=integrations",
  );
  const expired = await ml.startAuthorization(actor, connectionId, target);
  const row = (
    await find("ml_oauth_states", { connection_id: connectionId })
  ).find((r) => r.status === "pending" && r.return_to === target)!;
  await put("ml_oauth_states", row.id, { ...row, expires_at: 0 });
  assert.equal(
    await ml.authorizationReturn(
      actor,
      new URLSearchParams({ state: expired.state }),
      expired.state,
    ),
    target,
  );
  await assert.rejects(
    ml.finishAuthorization(
      actor,
      new URLSearchParams({ state: expired.state, code: "111" }),
      expired.state,
    ),
    /expirada/,
  );
  for (const value of [
    "https://evil.example/",
    "//evil.example/",
    "/api/mercadolivre/callback",
    "/configuracoes\\evil",
    "javascript:evil",
    "x".repeat(8001),
  ]) {
    const next = await ml.startAuthorization(actor, connectionId, value);
    assert.equal(
      await ml.authorizationReturn(
        actor,
        new URLSearchParams({ state: next.state }),
        next.state,
      ),
      "/configuracoes?configTab=integrations&store=juntos-com",
    );
  }
  const all = await ml.startAuthorization(
    actor,
    connectionId,
    "/configuracoes?store=all&code=private&state=private&mlMessage=old&error=old",
  );
  const allParams = new URLSearchParams({ state: all.state, code: "111" });
  assert.equal(
    await ml.authorizationReturn(actor, allParams, all.state),
    "/configuracoes?store=all",
  );
  await mocked(oauth, () =>
    ml.finishAuthorization(actor, allParams, all.state),
  );
  assert.equal(
    await ml.authorizationReturn(actor, allParams, all.state),
    "/configuracoes?store=all",
  );
});
test("listing import is idempotent, detects real quality gaps and preserves local costs and tasks", async () => {
  const requestId = randomUUID();
  await mocked(listings([item()]), async () => {
    const result = await ml.syncListings(actor, connectionId, { requestId });
    assert.equal(result.created, 1);
    assert.equal(result.processed, 1);
  });
  const o = await importedOffer();
  assert.equal(o.price, "100.00");
  assert.equal(o.sku, "000ML");
  assert.equal(o.ml.soldQuantityLifetime, 999);
  assert.equal(JSON.parse((await get("costs", o.id))!.data_json).goods, null);
  const detail = await s.offerDetail(actor, o.id);
  assert.ok(detail.quality.some((r) => r.key === "attribute:MODEL"));
  assert.ok(detail.quality.some((r) => r.key === "stock"));
  assert.equal(detail.mlMetrics, null);
  await mocked(
    () => {
      throw new Error("Uma repetição não deve chamar a API");
    },
    () => ml.syncListings(actor, connectionId, { requestId }),
  );
  await s.saveCosts(actor, o.id, {
    goods: "40",
    mlPercent: "10",
    mlFixed: "2",
    shipping: "5",
    packaging: "1",
    advertising: "2",
    other: "0",
  });
  const task = await ml.createQualityTask(actor, o.id, { issueKey: "stock" });
  const again = await ml.createQualityTask(actor, o.id, { issueKey: "stock" });
  assert.equal(task.id, again.id);
  await mocked(listings([item("MLB1234", { price: 90 })]), () =>
    ml.syncListings(actor, connectionId, { requestId: randomUUID() }),
  );
  assert.equal((await importedOffer()).price, "90.00");
  assert.equal(JSON.parse((await get("costs", o.id))!.data_json).goods, "40");
  assert.equal((await get("tasks", task.id))?.status, "todo");
  const current = await importedOffer();
  await mocked(listings([item("MLB1234", { price: 90 })]), () =>
    ml.syncListings(actor, connectionId, { requestId: randomUUID() }),
  );
  assert.equal((await importedOffer()).version, current.version);
});
test("interrupted scan resumes the saved page without advancing or duplicating the first listing", async () => {
  await mocked(
    listings([item("MLB9001"), item("MLB9002", { seller_id: 999 })]),
    async () => {
      await assert.rejects(
        ml.syncListings(actor, connectionId, { requestId: randomUUID() }),
        /outra conta/,
      );
    },
  );
  assert.ok(await importedOffer("MLB9001"));
  assert.equal(await importedOffer("MLB9002"), undefined);
  assert.ok(await get("ml_sync_pages", connectionId));
  let scans = 0;
  const handler = listings([item("MLB9001"), item("MLB9002")]);
  await mocked(
    (url, init) => {
      if (url.pathname.endsWith("/items/search")) scans++;
      return handler(url, init);
    },
    () => ml.syncListings(actor, connectionId, { requestId: randomUUID() }),
  );
  assert.equal(scans, 0);
  assert.ok(await importedOffer("MLB9002"));
  assert.equal(await get("ml_sync_pages", connectionId), undefined);
  assert.equal(
    (await find("history", { offer_id: (await importedOffer("MLB9001")).id }))
      .length,
    1,
  );
});
function tariffHandler(price = 90, totalOverride?: number): Handler {
  return (url, init) => {
    if (url.pathname === "/sites/MLB/listing_prices") {
      assert.equal(url.searchParams.get("listing_type_id"), "gold_special");
      assert.equal(url.searchParams.get("category_id"), "MLB100");
      assert.equal(url.searchParams.get("shipping_mode"), "me2");
      const p = Number(url.searchParams.get("price"));
      return json([
        {
          listing_type_id: "gold_special",
          sale_fee_amount: totalOverride ?? Number((p * 0.14 + 2).toFixed(2)),
          sale_fee_details: { percentage_fee: 14, fixed_fee: 2 },
        },
      ]);
    }
    return listings([item("MLB1234", { price })])(url, init);
  };
}
test("quote binds price/account/version, server overrides forged fees and keeps current listing intact", async () => {
  const o = await importedOffer();
  await s.saveParameters(actor, "juntos-com", {
    minMargin: "10",
    desiredMargin: "20",
    taxRate: "5",
    taxBase: "price",
    managementRate: "1",
    managementBase: "price",
    reviewDays: 30,
  });
  const quote = await mocked(tariffHandler(), () =>
    ml.quoteTariff(actor, o.id, { price: "85", offerVersion: o.version }),
  );
  assert.equal(quote.total, "13.90");
  assert.equal(quote.shippingVerified, false);
  const proposal = await s.createProposal(actor, {
    offerId: o.id,
    input: {
      mode: "price",
      price: "85",
      mlQuoteId: quote.id,
      mlPercent: "0",
      mlFixed: "0",
      conditionsVerified: true,
    },
    reason: "Tarifa oficial para o cenário",
    requestId: randomUUID(),
  });
  const snapshot = JSON.parse(proposal.snapshot_json);
  assert.equal(snapshot.input.mlPercent, "14");
  assert.equal(snapshot.proposed.margin, "18.00");
  assert.equal(snapshot.mlQuote.id, quote.id);
  assert.equal((await importedOffer()).price, "90.00");
  await assert.rejects(
    s.simulate(actor, o.id, {
      mode: "price",
      price: "84",
      mlQuoteId: quote.id,
    }),
    /não corresponde/,
  );
  await put("ml_quotes", quote.id, { ...quote, expires_at: 0 });
  await assert.rejects(
    s.simulate(actor, o.id, {
      mode: "price",
      price: "85",
      mlQuoteId: quote.id,
    }),
    /expirou/,
  );
  await mocked(tariffHandler(100), async () => {
    await assert.rejects(
      ml.quoteTariff(actor, o.id, { price: "85", offerVersion: o.version }),
      /mudaram/,
    );
  });
  await mocked(tariffHandler(90, 99), async () => {
    await assert.rejects(
      ml.quoteTariff(actor, o.id, { price: "85", offerVersion: o.version }),
      /adicionais/,
    );
  });
});
test("commercial conditions invalidate old proposals even when the published price is unchanged", async () => {
  const o = await importedOffer();
  const proposal = await s.createProposal(actor, {
    offerId: o.id,
    input: { mode: "price", price: "85", conditionsVerified: true },
    reason: "Verificar alteração da modalidade",
    requestId: randomUUID(),
  });
  await s.decideProposal(actor, proposal.id, {
    action: "approve",
    requestId: randomUUID(),
    comment: "Aprovado para verificação",
  });
  await s.decideProposal(actor, proposal.id, {
    action: "request",
    requestId: randomUUID(),
    comment: "Solicitar aplicação após conferir",
  });
  await mocked(
    listings([item("MLB1234", { price: 90, listing_type_id: "gold_pro" })]),
    () => ml.syncListings(actor, connectionId, { requestId: randomUUID() }),
  );
  assert.ok((await importedOffer()).version > o.version);
  await assert.rejects(
    s.decideProposal(actor, proposal.id, {
      action: "apply_manual",
      requestId: randomUUID(),
      comment: "Conferido no Mercado Livre",
    }),
    /mudaram/,
  );
  assert.equal(
    (await get("proposals", proposal.id))!.snapshot_json,
    proposal.snapshot_json,
  );
  await mocked(listings([item("MLB1234", { price: 90 })]), () =>
    ml.syncListings(actor, connectionId, { requestId: randomUUID() }),
  );
});
test("mixed variation prices are imported as an actionable gap and cannot yield an aggregate pricing proposal", async () => {
  const remote = item("MLB9100", {
    variations: [
      {
        id: 1,
        price: 100,
        attribute_combinations: [{ name: "Cor", value_name: "Azul" }],
      },
      {
        id: 2,
        price: 150,
        attribute_combinations: [{ name: "Cor", value_name: "Preto" }],
      },
    ],
  });
  await mocked(listings([remote]), () =>
    ml.syncListings(actor, connectionId, { requestId: randomUUID() }),
  );
  const o = await importedOffer("MLB9100"),
    detail = await s.offerDetail(actor, o.id);
  assert.equal(o.type, "variation");
  assert.equal(detail.calculation.margin, null);
  assert.ok(detail.quality.some((i) => i.key === "variations"));
  assert.equal(detail.components.length, 2);
  await assert.rejects(
    s.createProposal(actor, {
      offerId: o.id,
      input: { mode: "price", price: "85" },
      reason: "Proposta de variação inválida",
      requestId: randomUUID(),
    }),
    /individualmente/,
  );
});
test("token refresh is protected from concurrent exchanges and persists the renewed token", async () => {
  const token = (await get("ml_tokens", connectionId))!;
  await put("ml_tokens", connectionId, { ...token, expires_at: 0 });
  const o = await importedOffer();
  let refreshes = 0;
  await mocked(
    async (url, init) => {
      if (url.pathname === "/oauth/token") {
        refreshes++;
        await new Promise((r) => setTimeout(r, 50));
        return oauth(url, init);
      }
      return tariffHandler()(url, init);
    },
    async () => {
      const results = await Promise.allSettled([
        ml.quoteTariff(actor, o.id, { price: "85", offerVersion: o.version }),
        ml.quoteTariff(actor, o.id, { price: "85", offerVersion: o.version }),
      ]);
      // A Firestore retry may read the already renewed token, allowing both
      // callers to succeed. Only a single OAuth exchange may happen.
      assert.ok(results.some((r) => r.status === "fulfilled"));
      for (const result of results)
        if (result.status === "rejected")
          assert.equal(result.reason.status, 429);
      assert.equal(refreshes, 1);
    },
  );
  assert.ok((await get("ml_tokens", connectionId))!.expires_at > Date.now());
});
test("refresh normalizes numeric strings, stops after unusable rotating credentials and permits fresh consent", async () => {
  await put("ml_tokens", connectionId, {
    ...(await get("ml_tokens", connectionId))!,
    expires_at: 0,
  });
  await mocked(
    async (url, init) => {
      const payload = await oauth(url, init).json();
      return json({
        ...payload,
        user_id: "111",
        expires_in: "21600",
        scope: null,
      });
    },
    () =>
      ml.withSellerData(actor, connectionId, (request) => request("/users/me")),
  );
  assert.ok((await get("ml_tokens", connectionId))!.expires_at > Date.now());
  await put("ml_tokens", connectionId, {
    ...(await get("ml_tokens", connectionId))!,
    expires_at: 0,
  });
  let exchanges = 0;
  await mocked(
    async (url, init) => {
      if (url.pathname === "/oauth/token") exchanges++;
      const payload = await oauth(url, init).json();
      return json({ ...payload, refresh_token: undefined });
    },
    async () => {
      await assert.rejects(
        ml.withSellerData(actor, connectionId, (request) =>
          request("/users/me"),
        ),
        /ao renovar.*refresh_token.*offline_access/,
      );
      assert.equal(
        (await get("connections", connectionId))!.status,
        "unauthorized",
      );
      await assert.rejects(
        ml.withSellerData(actor, connectionId, (request) =>
          request("/users/me"),
        ),
        /Conecte/,
      );
    },
  );
  assert.equal(exchanges, 1);
  await connect();
});
test("metrics use the visits interval and paid orders, never lifetime sales or duplicate orders", async () => {
  const o = await importedOffer();
  const to = new Date().toISOString(),
    from = new Date(Date.now() - 30 * 86400000).toISOString();
  const order = {
    id: 1,
    status: "paid",
    date_created: to,
    seller: { id: 111 },
    currency_id: "BRL",
    order_items: [{ item: { id: "MLB1234" }, quantity: 2, unit_price: 80 }],
    buyer: { email: "private-buyer@example.test" },
  };
  await mocked(
    (url, init) => {
      if (url.pathname.endsWith("/visits/time_window"))
        return json({ total_visits: 100, date_from: from, date_to: to });
      if (url.pathname === "/orders/search") {
        assert.equal(url.searchParams.get("order.status"), "paid");
        assert.equal(url.searchParams.get("seller"), "111");
        assert.equal(url.searchParams.get("order.date_created.from"), from);
        return json({
          paging: { total: 4 },
          results: [
            order,
            order,
            { ...order, id: 2, status: "cancelled" },
            {
              ...order,
              id: 3,
              order_items: [
                { item: { id: "MLB-OTHER" }, quantity: 1, unit_price: 500 },
              ],
            },
          ],
        });
      }
      if (url.pathname === "/questions/search") return json({ total: 5 });
      return tariffHandler()(url, init);
    },
    async () => {
      const m = await ml.refreshMetrics(actor, o.id);
      assert.equal(m.paidOrders, 1);
      assert.equal(m.units, 2);
      assert.equal(m.grossRevenue, "160.00");
      assert.equal(m.orderVisitRate, "1.00");
      assert.equal(m.unansweredQuestions, 5);
    },
  );
  const storedRow = (await get("ml_metrics", o.id))!;
  const stored = JSON.stringify(storedRow);
  assert.ok(!stored.includes("private-buyer"));
  // A timestamp can contain 999 milliseconds; inspect the metric, not all serialized text.
  assert.equal(storedRow.units, 2);
  assert.equal("soldQuantityLifetime" in storedRow, false);
  const before = await get("ml_metrics", o.id);
  await mocked(
    (url, init) => {
      if (url.pathname.endsWith("/visits/time_window"))
        return json({ total_visits: 100, date_from: from, date_to: to });
      if (url.pathname === "/orders/search")
        return json({ paging: { total: 1001 }, results: [] });
      return tariffHandler()(url, init);
    },
    async () => {
      await assert.rejects(ml.refreshMetrics(actor, o.id), /1.000/);
    },
  );
  assert.deepEqual(await get("ml_metrics", o.id), before);
});
test("seven-day metrics use their own interval/cache and refuse thirty-day responses", async () => {
  const o = await importedOffer();
  const to = new Date().toISOString(),
    from = new Date(Date.now() - 7 * 86400000).toISOString();
  const old = await get("ml_metrics", o.id);
  let visitsQuery = "";
  await mocked(
    (url, init) => {
      if (url.pathname.endsWith("/visits/time_window")) {
        visitsQuery = url.searchParams.get("last") || "";
        return json({ total_visits: 12, date_from: from, date_to: to });
      }
      if (url.pathname === "/orders/search")
        return json({ paging: { total: 0 }, results: [] });
      if (url.pathname === "/questions/search") return json({ total: 0 });
      return tariffHandler()(url, init);
    },
    () => ml.refreshMetrics(actor, o.id, 7),
  );
  assert.equal(visitsQuery, "7");
  assert.equal((await get("ml_metrics_7d", o.id))!.periodDays, 7);
  assert.deepEqual(await get("ml_metrics", o.id), old);
  const listing = await s.workspace(
    actor,
    new URLSearchParams({ store: "juntos-com" }),
  );
  assert.equal(
    listing.offers.find((row: Row) => row.id === o.id)!.metrics7d.visits,
    12,
  );
  const saved = await get("ml_metrics_7d", o.id);
  await mocked(
    (url, init) =>
      url.pathname.endsWith("/visits/time_window")
        ? json({
            total_visits: 999,
            date_from: new Date(Date.now() - 30 * 86400000).toISOString(),
            date_to: to,
          })
        : tariffHandler()(url, init),
    () => assert.rejects(ml.refreshMetrics(actor, o.id, 7), /período/),
  );
  assert.deepEqual(await get("ml_metrics_7d", o.id), saved);
});
test("webhooks deduplicate and bound metadata, reject other apps and never trust payloads as listing updates", async () => {
  const body = {
    _id: "event-1",
    resource: "/items/MLB1234",
    user_id: 111,
    application_id: 123456,
    topic: "items",
    sent: new Date().toISOString(),
    price: 1,
  };
  await receiveNotification(body);
  await receiveNotification(body);
  assert.equal(
    (await get("ml_notification_inbox", connectionId))!.events.length,
    1,
  );
  assert.equal((await importedOffer()).price, "90.00");
  assert.equal(
    (await get("ml_notification_inbox", connectionId))!.events[0].verified,
    false,
  );
  await assert.rejects(
    receiveNotification({ ...body, application_id: 999 }),
    /outra aplicação/,
  );
  await receiveNotification({
    ...body,
    resource: "https://evil.example/secret",
  });
  assert.equal(
    (await get("ml_notification_inbox", connectionId))!.events.length,
    1,
  );
  await put("ml_notification_inbox", connectionId, {
    events: Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      resource: "/items/MLB" + (10000 + i),
      topic: "items",
    })),
  });
  await receiveNotification({ ...body, _id: "new-event" });
  assert.equal(
    (await get("ml_notification_inbox", connectionId))!.events.length,
    100,
  );
});
test("rate-limited quotes do not retry rapidly or disconnect the store", async () => {
  const o = await importedOffer(),
    before = (await get("connections", connectionId))!;
  let requests = 0;
  await mocked(
    () => {
      requests++;
      return json({ error: "too_many_requests" }, 429);
    },
    async () => {
      await assert.rejects(
        ml.quoteTariff(actor, o.id, { price: "85", offerVersion: o.version }),
        (error: any) =>
          error.status === 429 && /limitou temporariamente/.test(error.message),
      );
    },
  );
  assert.equal(requests, 1);
  assert.equal((await get("connections", connectionId))!.status, before.status);
  assert.equal(
    (await get("connections", connectionId))!.auth_version,
    before.auth_version,
  );
});
test("disconnect invalidates unfinished OAuth and in-flight tariff queries without erasing business data", async () => {
  const o = await importedOffer(),
    flow = await ml.startAuthorization(actor, connectionId);
  await mocked(
    async (url, init) => {
      if (url.pathname === "/sites/MLB/listing_prices")
        await ml.disconnect(actor, connectionId);
      return tariffHandler()(url, init);
    },
    async () => {
      await assert.rejects(
        ml.quoteTariff(actor, o.id, { price: "85", offerVersion: o.version }),
        /conexão mudou/,
      );
    },
  );
  assert.equal(await get("ml_tokens", connectionId), undefined);
  assert.ok(await get("offers", o.id));
  await assert.rejects(
    ml.finishAuthorization(
      actor,
      new URLSearchParams({ state: flow.state, code: "111" }),
      flow.state,
    ),
    /conexão foi alterada/,
  );
  await connect(secondId, 111);
  assert.equal((await get("connections", secondId))?.external_account, "111");
});
