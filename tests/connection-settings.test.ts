import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, generateKeyPairSync } from "node:crypto";
import { initializeDatabase, get, put, find, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import * as ml from "../src/server/mercadolivre";
import * as services from "../src/server/services";
import { receiveNotification } from "../src/server/ml-notifications";
let actor: Actor;
let a: string, b: string;
const secrets = {
  a: "test-only-store-A-secret",
  b: "test-only-store-B-secret",
};
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-applications-" + randomUUID();
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  delete process.env.ML_CLIENT_ID;
  delete process.env.ML_CLIENT_SECRET;
  delete process.env.ML_REDIRECT_URI;
  await initializeDatabase();
  actor = await workspaceActor();
  a = key("juntos-com", "mercadolivre");
  b = key("juntos-data", "mercadolivre");
});
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
async function authorize(id: string, seller: number) {
  const c = (await get("connections", id))!;
  const app = (await get("ml_applications", id))!;
  const expected = ml.decryptSecret(
    app.encrypted,
    "application:" + id,
  ).clientSecret;
  const original = globalThis.fetch;
  const requests: URLSearchParams[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.mercadolibre.com");
    if (url.pathname === "/oauth/token") {
      const body = new URLSearchParams(String(init.body));
      requests.push(body);
      assert.equal(body.get("client_id"), c.application_id);
      assert.equal(body.get("client_secret"), expected);
      return json({
        access_token: "store-access-" + seller,
        refresh_token: "store-refresh-" + seller,
        token_type: "bearer",
        expires_in: 21600,
        user_id: seller,
      });
    }
    assert.equal(url.pathname, "/users/me");
    return json({ id: seller, nickname: "Loja teste", site_id: "MLB" });
  }) as typeof fetch;
  try {
    const flow = await ml.startAuthorization(actor, id);
    assert.equal(
      new URL(flow.url).searchParams.get("client_id"),
      c.application_id,
    );
    await ml.finishAuthorization(
      actor,
      new URLSearchParams({ code: "synthetic-code", state: flow.state }),
      flow.state,
    );
    const token = (await get("ml_tokens", id))!;
    await put("ml_tokens", id, { ...token, expires_at: 0 });
    await ml.withSellerData(actor, id, (request) => request("/users/me"));
    assert.equal(requests.length, 2);
    assert.equal(requests[1].get("grant_type"), "refresh_token");
  } finally {
    globalThis.fetch = original;
  }
}
test("each store saves a distinct encrypted application without per-application environment variables", async () => {
  await ml.saveApplication(actor, a, {
    clientId: "5864666966187776",
    clientSecret: secrets.a,
    version: 0,
  });
  await ml.saveApplication(actor, b, {
    clientId: "987654321",
    clientSecret: secrets.b,
    version: 0,
  });
  assert.equal(ml.mlConfigured(), false);
  for (const [id, secret] of [
    [a, secrets.a],
    [b, secrets.b],
  ]) {
    const c = (await get("connections", id))!,
      app = (await get("ml_applications", id))!;
    assert.equal(ml.mlConfigured(c), true);
    assert.equal(c.status, "unauthorized");
    assert.ok(!JSON.stringify(app).includes(secret));
    assert.equal(
      ml.decryptSecret(app.encrypted, "application:" + id).clientSecret,
      secret,
    );
  }
});
test("workspace, offer projections and audit records do not expose application secrets or ciphertext", async () => {
  const output = JSON.stringify(
    await services.workspace(actor, new URLSearchParams()),
  );
  assert.ok(output.includes("5864666966187776"));
  for (const id of [a, b]) {
    const app = (await get("ml_applications", id))!;
    assert.ok(!output.includes(app.encrypted));
  }
  for (const secret of Object.values(secrets))
    assert.ok(!output.includes(secret));
  const publicA = ml.publicConnection((await get("connections", a))!);
  assert.equal(publicA.application_source, "store");
  assert.equal(
    publicA.redirect_uri,
    "http://localhost:3000/api/mercadolivre/callback",
  );
});
test("OAuth exchanges and refreshes use the application belonging to the selected store", async () => {
  await authorize(a, 701);
  await authorize(b, 702);
  assert.equal((await get("connections", a))?.external_account, "701");
  assert.equal((await get("connections", b))?.external_account, "702");
});
test("a blank edit retains the stored secret and an unchanged save preserves authorization", async () => {
  const before = (await get("connections", a))!;
  await ml.saveApplication(actor, a, {
    clientId: before.application_id,
    clientSecret: "",
    version: before.application_version,
  });
  assert.deepEqual(await get("connections", a), before);
  assert.ok(await get("ml_tokens", a));
  await assert.rejects(
    ml.saveApplication(actor, a, {
      clientId: "777777",
      clientSecret: "",
      version: before.application_version,
    }),
    /chave secreta/,
  );
});
test("editing one application invalidates its OAuth and tokens while preserving the other store", async () => {
  const flow = await ml.startAuthorization(actor, a),
    oldB = (await get("connections", b))!;
  await ml.saveApplication(actor, a, {
    clientId: "777777",
    clientSecret: "test-replacement-secret",
    version: 1,
  });
  assert.equal(await get("ml_tokens", a), undefined);
  assert.equal((await get("connections", a))?.external_account, null);
  assert.deepEqual(await get("connections", b), oldB);
  assert.ok(await get("ml_tokens", b));
  await assert.rejects(
    ml.finishAuthorization(
      actor,
      new URLSearchParams({ code: "synthetic-code", state: flow.state }),
      flow.state,
    ),
    /conexão foi alterada/,
  );
});
test("concurrent application edits are versioned and reject a stale overwrite", async () => {
  const outcomes = await Promise.allSettled(
    ["first-test-secret", "second-test-secret"].map((clientSecret) =>
      ml.saveApplication(actor, a, {
        clientId: "777777",
        clientSecret,
        version: 2,
      }),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = outcomes.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.status, 409);
  assert.equal((await get("ml_applications", a))?.version, 3);
});
test("notifications match the seller and that store's application instead of a global application ID", async () => {
  const body = {
    _id: "settings-notification",
    resource: "/orders/123",
    user_id: 702,
    application_id: "987654321",
    topic: "orders_v2",
    sent: new Date().toISOString(),
  };
  await receiveNotification(body);
  assert.equal((await get("ml_notification_inbox", b))?.events.length, 1);
  await receiveNotification({
    ...body,
    application_id: "777777",
    _id: "other-app",
  });
  assert.equal((await get("ml_notification_inbox", b))?.events.length, 1);
  await assert.rejects(
    receiveNotification({ ...body, application_id: "999999999" }),
    /outra aplicação/,
  );
});
test("credential writes enforce admin/store scope and ciphertext cannot be transplanted between stores", async () => {
  const payload = {
    clientId: "123456789",
    clientSecret: "test-credential",
    version: 0,
  };
  await assert.rejects(
    ml.saveApplication({ ...actor, role: "viewer" }, a, payload),
    /administrador/,
  );
  await assert.rejects(
    ml.saveApplication({ ...actor, stores: [] }, a, payload),
    /Loja não encontrada/,
  );
  await assert.rejects(
    ml.saveApplication(actor, key("juntos-com", "bling"), payload),
    /não encontrada/,
  );
  await assert.rejects(
    ml.saveApplication(actor, a, { ...payload, clientId: "invalid" }),
  );
  const appA = (await get("ml_applications", a))!,
    appB = (await get("ml_applications", b))!;
  await put("ml_applications", b, { ...appB, encrypted: appA.encrypted });
  await assert.rejects(ml.startAuthorization(actor, b), /credenciais/);
  await put("ml_applications", b, appB);
  const keyValue = process.env.ML_TOKEN_ENCRYPTION_KEY;
  delete process.env.ML_TOKEN_ENCRYPTION_KEY;
  try {
    await assert.rejects(
      ml.saveApplication(actor, a, { ...payload, version: 3 }),
      /armazenamento protegido/,
    );
  } finally {
    process.env.ML_TOKEN_ENCRYPTION_KEY = keyValue;
  }
  assert.equal(
    (await find("ml_applications", { store_id: "juntos-com" })).length,
    1,
  );
});
test("a server Firebase identity provides stable encryption without extra integration environment variables", () => {
  const names = [
    "ML_TOKEN_ENCRYPTION_KEY",
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "FIREBASE_SERVICE_ACCOUNT_EMAIL",
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const account = {
    type: "service_account",
    project_id: "demo-crypto-identity",
    client_email: "test@demo-crypto-identity.iam.gserviceaccount.com",
    private_key: privateKey,
  };
  try {
    delete process.env.ML_TOKEN_ENCRYPTION_KEY;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
    process.env.FIREBASE_PROJECT_ID = account.project_id;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(account);
    const encrypted = ml.encryptSecret(
      { test: "identity-protected-secret" },
      "application:test",
    );
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      ...account,
      private_key: privateKey.replace(/\n/g, "\r\n"),
    });
    assert.equal(
      ml.decryptSecret(encrypted, "application:test").test,
      "identity-protected-secret",
    );
    assert.equal(ml.secretStorageReady(), true);
    assert.throws(
      () => ml.decryptSecret(encrypted, "application:other"),
      /credenciais/,
    );
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
