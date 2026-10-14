import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { get, key, put, initializeDatabase } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import {
  encryptSecret,
  withMLAccessDiagnostics,
  withSellerData,
} from "../src/server/mercadolivre";
import {
  readMarketResource,
  diagnoseMarketAccess,
  marketRequestSchema,
} from "../src/server/market-research";
import {
  backendOrigin,
  readMarketBackend,
} from "../scripts/lib/market-backend";
import { marketConfigSchema } from "../scripts/lib/market-queue";

const id = key("juntos-data", "mercadolivre");
let actor: Actor;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function mock<T>(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  read: () => Promise<T>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    handler(new URL(String(input)), init);
  try {
    return await read();
  } finally {
    globalThis.fetch = original;
  }
}
async function seed() {
  await put("connections", id, {
    store_id: "juntos-data",
    provider: "mercadolivre",
    application_id: "123456",
    status: "connected",
    external_account: "111",
    auth_version: 1,
  });
  await put("ml_tokens", id, {
    encrypted: encryptSecret({
      access_token: "TEST_PRIVATE_ACCESS",
      refresh_token: "TEST_PRIVATE_REFRESH",
    }),
    auth_version: 1,
    expires_at: Date.now() + 3600000,
  });
  await put("ml_market_operations", id, {
    auth_version: 1,
    lease_until: 0,
    next_at: 0,
  });
}
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-market-backend-" + randomUUID();
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "TEST_PRIVATE_SECRET";
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  await initializeDatabase();
  actor = await workspaceActor();
});
test("backend diagnostics use fixed resources, validate the seller and never return profile data or secrets", async () => {
  await seed();
  const paths: string[] = [];
  const result = await mock(
    (url, init) => {
      paths.push(url.pathname);
      assert.equal(init?.redirect, "error");
      if (url.pathname === "/sites/MLB") {
        assert.equal(init?.headers, undefined);
        return json({ id: "MLB" });
      }
      assert.equal(url.pathname, "/users/me");
      assert.ok(new Headers(init?.headers).has("authorization"));
      return json({
        id: 111,
        email: "TEST_PRIVATE_EMAIL",
        phone: "TEST_PRIVATE_PHONE",
      });
    },
    () =>
      diagnoseMarketAccess(actor, {
        storeId: "juntos-data",
        applicationId: "123456",
      }),
  );
  assert.deepEqual(paths, ["/sites/MLB", "/users/me"]);
  assert.equal(result.account_matches_connected_seller, true);
  assert.equal(result.observations.length, 2);
  assert.equal(JSON.stringify(result).includes("TEST_PRIVATE"), false);
  assert.equal((await get("ml_market_operations", id))?.lease_until, 0);
});
test("HTML 403 preserves diagnostic evidence and pauses market calls without converting the denial to zero", async () => {
  await seed();
  let calls = 0;
  const result = await mock(
    () => {
      calls++;
      return new Response("<html>TEST_PRIVATE_DATA</html>", {
        status: 403,
        headers: { "Content-Type": "text/html", "x-amz-cf-id": "cf-test" },
      });
    },
    () =>
      diagnoseMarketAccess(actor, {
        storeId: "juntos-data",
        applicationId: "123456",
      }),
  );
  assert.equal(result.account_matches_connected_seller, null);
  assert.equal(
    result.observations.every(
      (o) => o.http_status === 403 && o.response_format === "html",
    ),
    true,
  );
  assert.equal(JSON.stringify(result).includes("TEST_PRIVATE"), false);
  assert.ok(
    (await get("ml_market_operations", id))!.next_at > Date.now() + 50000,
  );
  await mock(
    () => {
      calls++;
      throw new Error("must not call");
    },
    async () => {
      await assert.rejects(
        readMarketResource(actor, "juntos-data", "123456", {
          kind: "item",
          id: "MLB1",
        }),
        (e: unknown) =>
          Boolean(
            e && typeof e === "object" && "status" in e && e.status === 429,
          ),
      );
    },
  );
  assert.equal(calls, 2);
});
test("authorization, connection pinning and schema validation happen before provider calls", async () => {
  await seed();
  await mock(
    () => {
      throw new Error("must not call");
    },
    async () => {
      await assert.rejects(
        diagnoseMarketAccess(
          { ...actor, role: "viewer" },
          { storeId: "juntos-data", applicationId: "123456" },
        ),
      );
      await assert.rejects(
        diagnoseMarketAccess(
          { ...actor, stores: [] },
          { storeId: "juntos-data", applicationId: "123456" },
        ),
      );
      await assert.rejects(
        diagnoseMarketAccess(actor, {
          storeId: "juntos-data",
          applicationId: "999999",
        }),
      );
    },
  );
  assert.equal(
    marketRequestSchema.safeParse({
      storeId: "juntos-data",
      applicationId: "123456",
      resource: { kind: "item", id: "MLB1", url: "https://evil.example" },
    }).success,
    false,
  );
});
test("simultaneous reads reserve a single lease; no ML writes occur and absent counters remain unknown", async () => {
  await seed();
  let calls = 0;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    arrived = new Promise<void>((r) => {
      started = r;
    });
  await mock(
    async (url, init) => {
      calls++;
      assert.equal(url.pathname, "/items/MLB1");
      assert.ok(!init?.method || init.method === "GET");
      started();
      await gate;
      return json({ id: "MLB1", price: 100 });
    },
    async () => {
      const first = readMarketResource(actor, "juntos-data", "123456", {
        kind: "item",
        id: "MLB1",
      });
      await arrived;
      try {
        await assert.rejects(
          readMarketResource(actor, "juntos-data", "123456", {
            kind: "item",
            id: "MLB1",
          }),
        );
      } finally {
        release();
      }
      const observation = await first;
      assert.equal(observation.status, "ok");
      assert.equal(observation.data?.sold_quantity_returned, null);
    },
  );
  assert.equal(calls, 1);
});
test("concurrent request-scoped diagnostics do not mix different account observations", async () => {
  await seed();
  await mock(
    () => json({ id: 111 }),
    async () => {
      const [a, b] = await Promise.all([
        withMLAccessDiagnostics(() =>
          withSellerData(actor, id, (r) => r("/users/me")),
        ),
        withMLAccessDiagnostics(async () => "no provider request"),
      ]);
      assert.equal(a.observations.length, 1);
      assert.equal(b.observations.length, 0);
    },
  );
});
test("a seller reconnected during diagnostics cannot be silently substituted for the captured account", async () => {
  await seed();
  const paths: string[] = [];
  const result = await mock(
    async (url) => {
      paths.push(url.pathname);
      if (url.pathname === "/sites/MLB") {
        const connection = await get("connections", id);
        await put("connections", id, {
          ...connection,
          auth_version: 2,
          external_account: "222",
        });
        await put("ml_tokens", id, {
          encrypted: encryptSecret({
            access_token: "TEST_PRIVATE_ACCESS_222",
            refresh_token: "TEST_PRIVATE_REFRESH_222",
          }),
          auth_version: 2,
          expires_at: Date.now() + 3600000,
        });
        return json({ id: "MLB" });
      }
      return json({ id: 222 });
    },
    () =>
      diagnoseMarketAccess(actor, {
        storeId: "juntos-data",
        applicationId: "123456",
      }),
  );
  assert.equal(result.account_matches_connected_seller, null);
  assert.deepEqual(paths, ["/sites/MLB"]);
});
test("remote collection sends no credentials and rejects mismatched results or unsafe backend URLs", async () => {
  const config = marketConfigSchema.parse({
    store_id: "juntos-data",
    application_id: "123456",
    target_brands: ["QTMOV"],
    seed_item_ids: ["MLB1"],
    search_queries: [],
  });
  assert.throws(() => backendOrigin("https://user:secret@example.com"));
  assert.throws(() => backendOrigin("http://example.com"));
  assert.throws(() =>
    backendOrigin("https://example.com/private?token=secret"),
  );
  const result = await mock(
    (url, init) => {
      assert.equal(
        url.href,
        "https://datamat.example/api/market-research/read",
      );
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      assert.equal(
        new Headers(init?.headers).get("origin"),
        "https://datamat.example",
      );
      assert.equal(String(init?.body).includes("TEST_PRIVATE"), false);
      return json({
        status: "ok",
        resource: { kind: "item", id: "MLB2" },
        source: "https://api.mercadolibre.com/items/MLB2",
        collected_at: new Date().toISOString(),
        data: { price: 100 },
      });
    },
    () =>
      readMarketBackend("https://datamat.example", config, {
        kind: "item",
        id: "MLB1",
      }),
  );
  assert.equal(result.status, "error");
  assert.equal(result.data, null);
});
