import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { initializeDatabase, get, put } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import * as drive from "../src/server/google-drive";
import {
  uploadMedia,
  readMedia,
  deleteMedia,
} from "../src/server/listing-media";
import { decryptSecret } from "../src/server/mercadolivre";
let actor: Actor, store: string;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const objects = new Map<string, any>();
let count = 0,
  refreshes = 0,
  uploads = 0,
  loseAck = false;
async function mocked<T>(fn: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    options: RequestInit = {},
  ) => {
    const url = new URL(String(input));
    assert.ok(
      [
        "oauth2.googleapis.com",
        "openidconnect.googleapis.com",
        "www.googleapis.com",
      ].includes(url.hostname),
    );
    assert.equal(options.redirect, "error");
    if (url.hostname === "oauth2.googleapis.com") {
      const body = new URLSearchParams(String(options.body));
      assert.equal(body.get("client_secret"), "test-google-secret");
      if (body.get("grant_type") === "refresh_token") {
        refreshes++;
        assert.equal(body.get("refresh_token"), "test-refresh");
        return json({
          access_token: "test-access",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      assert.ok(body.get("code_verifier"));
      return json({
        access_token: "test-access",
        refresh_token: "test-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (url.hostname === "openidconnect.googleapis.com")
      return json({
        sub: "google-test-account",
        email: "operator@example.test",
        email_verified: true,
      });
    assert.equal(
      (options.headers as Record<string, string>).Authorization,
      "Bearer test-access",
    );
    if (url.pathname.endsWith("/generateIds"))
      return json({ ids: ["test-drive-file-" + ++count] });
    if (url.pathname === "/drive/v3/files" && options.method === "POST") {
      const meta = JSON.parse(String(options.body));
      objects.set(meta.id, { ...meta, capabilities: { canAddChildren: true } });
      return json({ id: meta.id });
    }
    if (url.pathname === "/upload/drive/v3/files") {
      uploads++;
      const body = Buffer.from(options.body as Uint8Array).toString();
      const meta = JSON.parse(body.split("\r\n\r\n")[1].split("\r\n--")[0]);
      objects.set(meta.id, {
        ...meta,
        size: String(bytes.length),
        md5Checksum: createHash("md5").update(bytes).digest("hex"),
        bytes,
      });
      if (loseAck) {
        loseAck = false;
        throw new Error("Lost acknowledgement after provider commit");
      }
      return json({ id: meta.id });
    }
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    const object = objects.get(id);
    if (!object) return json({ error: "notFound" }, 404);
    if (options.method === "DELETE") {
      objects.delete(id);
      return new Response(null, { status: 204 });
    }
    if (url.searchParams.get("alt") === "media")
      return new Response(new Uint8Array(object.bytes));
    return json(object);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}
before(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  await initializeDatabase();
  actor = await workspaceActor();
  store = "drive-test-" + randomUUID();
  const row = {
    id: store,
    name: "Drive Test",
    organization_id: actor.organization_id,
    active: 1,
  };
  await put("stores", store, row);
  actor = { ...actor, stores: [...actor.stores, row] };
});
test("Drive settings protect credentials, enforce store roles and optimistic versions", async () => {
  const result = await drive.configure(actor, store, {
    clientId: "test-client.apps.googleusercontent.com",
    clientSecret: "test-google-secret",
    folderName: "Datamat Test",
    version: 0,
  });
  assert.equal(result.status, "unauthorized");
  assert.equal(result.version, 1);
  assert.ok(
    !JSON.stringify(await drive.list(actor, store)).includes(
      "test-google-secret",
    ),
  );
  assert.equal(
    result.redirectUri,
    "http://localhost:3000/api/google-drive/callback",
  );
  await assert.rejects(
    drive.configure({ ...actor, role: "viewer" }, store, {}),
    /administrador/,
  );
  await assert.rejects(drive.list({ ...actor, stores: [] }, store), /Loja/);
  await assert.rejects(
    drive.configure(actor, store, {
      clientId: result.clientId,
      clientSecret: "",
      folderName: "Datamat Test",
      version: 0,
    }),
    /mudou/,
  );
});
test("Google OAuth requests minimum file scope and offline access, binds browser state, and consumes consent once", async () => {
  const flow = await drive.startAuthorization(actor, store, randomUUID()),
    url = new URL(flow.url);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.ok(url.searchParams.get("scope")!.includes("auth/drive.file"));
  assert.ok(!url.searchParams.get("scope")!.includes("auth/drive "));
  const params = new URLSearchParams({ code: "test-code", state: flow.state });
  await assert.rejects(
    drive.finishAuthorization(actor, params, "wrong-cookie"),
    /navegador/,
  );
  await mocked(async () => {
    const result = await drive.finishAuthorization(actor, params, flow.state);
    assert.equal(result.status, "connected");
    assert.equal(result.email, "operator@example.test");
    assert.ok(result.folderUrl);
    await assert.rejects(
      drive.finishAuthorization(actor, params, flow.state),
      /usada/,
    );
  });
  assert.equal((await drive.storageStatus(actor, store)).status, "ready");
});
test("Drive media upload, playback ranges and deletion preserve private scoped drafts", async () => {
  const offerId = randomUUID();
  await put("offers", offerId, {
    id: offerId,
    organization_id: actor.organization_id,
    store_id: store,
    version: 1,
    origin: "manual",
  });
  await mocked(async () => {
    const media = await uploadMedia(actor, offerId, {
      file: new File([bytes], "Minha foto.png", { type: "image/png" }),
      requestId: randomUUID(),
      offerVersion: 1,
    });
    assert.equal(media.name, "Minha foto.png");
    assert.ok(!JSON.stringify(media).includes("drive-file"));
    const response = await readMedia(actor, media.id, "bytes=0-7");
    assert.equal(response.status, 206);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      bytes.subarray(0, 8),
    );
    await assert.rejects(
      readMedia({ ...actor, stores: [] }, media.id, null),
      /Loja/,
    );
    await assert.rejects(
      drive.configure(actor, store, {
        clientId: "other.apps.googleusercontent.com",
        clientSecret: "other",
        folderName: "Other",
        version: 2,
      }),
      /rascunhos/,
    );
    assert.deepEqual(await deleteMedia(actor, media.id), { deleted: true });
    assert.deepEqual(await deleteMedia(actor, media.id), { deleted: true });
    assert.equal((await get("listing_media", media.id))?.status, "deleted");
  });
});
test("Drive upload confirms a lost acknowledgement using its reserved ID without posting twice", async () => {
  await mocked(async () => {
    const storage = drive.driveStorage(actor, store),
      before = uploads;
    loseAck = true;
    const path = "test/" + randomUUID();
    await storage.save(path, bytes, "image/png", "foto.png");
    assert.equal(uploads, before + 1);
    assert.deepEqual(await storage.read(path), bytes);
    const object = [...objects.values()].find((o) => o.name === "foto.png")!;
    object.appProperties.datamat_store = "another-store";
    await assert.rejects(storage.remove(path), /não pertence/);
    object.appProperties.datamat_store = store;
    await storage.remove(path);
  });
});
test("Google refresh preserves the existing refresh token when the response omits it", async () => {
  const projection = (await drive.list(actor, store))[0];
  const { key } = await import("../src/server/db");
  const id = key(actor.organization_id, store, "google-drive");
  const row = (await get("drive_integrations", id))!;
  const { encryptSecret } = await import("../src/server/mercadolivre");
  const tokens = decryptSecret(row.tokens, "drive-tokens:" + id);
  await put("drive_integrations", id, {
    ...row,
    tokens: encryptSecret({ ...tokens, expires_at: 0 }, "drive-tokens:" + id),
  });
  await mocked(async () => {
    const storage = drive.driveStorage(actor, store),
      path = "refresh/" + randomUUID();
    await storage.save(path, bytes, "image/png");
    await storage.remove(path);
  });
  assert.equal(refreshes, 1);
  assert.equal(
    decryptSecret(
      (await get("drive_integrations", id))!.tokens,
      "drive-tokens:" + id,
    ).refresh_token,
    "test-refresh",
  );
  await drive.disconnect(actor, store, projection.version);
  assert.equal((await drive.storageStatus(actor, store)).status, "missing");
  await assert.rejects(
    drive.driveStorage(actor, store).save("disconnected", bytes, "image/png"),
    /Conecte/,
  );
});
