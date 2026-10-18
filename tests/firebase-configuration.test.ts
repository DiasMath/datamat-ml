import { firestoreReadClientConfig } from "../src/server/firestore-settings";
import { createRequire } from "node:module";
import { databaseFailure } from "../src/server/database-failure";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  parseFirebaseAccount,
  readFirebaseConfiguration,
  FirebaseConfigurationError,
} from "../src/server/firebase-configuration";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const account = {
  type: "service_account",
  project_id: "demo-credentials",
  client_email: "test@demo-credentials.iam.gserviceaccount.com",
  private_key: privateKey,
};
const json = JSON.stringify(account);
const env = {
  VERCEL: "1",
  FIREBASE_PROJECT_ID: account.project_id,
  FIREBASE_SERVICE_ACCOUNT_JSON: json,
};
test("Firebase accepts complete JSON, BOM, whitespace, pasted single quotes and encoded JSON", () => {
  for (const raw of [
    json,
    `\uFEFF  ${json}\n`,
    `'${json}'`,
    JSON.stringify(json),
  ]) {
    const value = parseFirebaseAccount(raw, account.project_id);
    assert.equal(value.privateKey, privateKey);
    assert.equal(value.clientEmail, account.client_email);
    assert.equal(createPrivateKey(value.privateKey).asymmetricKeyType, "rsa");
  }
});
test("Firebase normalizes escaped or CRLF key newlines without accepting invalid keys", () => {
  for (const key of [
    privateKey.replace(/\n/g, "\\n"),
    privateKey.replace(/\n/g, "\r\n"),
    privateKey.replace(/\n/g, "\\r\\n"),
  ]) {
    const value = parseFirebaseAccount(
      JSON.stringify({ ...account, private_key: key }),
      account.project_id,
    );
    assert.equal(value.privateKey, privateKey);
  }
  assert.throws(
    () =>
      parseFirebaseAccount(
        JSON.stringify({ ...account, private_key: "truncated" }),
        account.project_id,
      ),
    /private_key.*inválida/,
  );
});
test("Firebase errors distinguish wrong JSON type, missing fields, project and email mismatch", () => {
  for (const [value, expected] of [
    ["not json", /JSON válido/],
    ["null", /objeto completo/],
    ["[]", /objeto completo/],
    [JSON.stringify({ apiKey: "web-only" }), /firebaseConfig/],
    [JSON.stringify({ ...account, project_id: "other" }), /project_id/],
    [JSON.stringify({ ...account, client_email: "invalid" }), /client_email/],
    [JSON.stringify({ ...account, private_key: "" }), /sem private_key/],
  ] as const) {
    assert.throws(
      () => parseFirebaseAccount(value, account.project_id),
      expected,
    );
  }
  assert.throws(
    () => parseFirebaseAccount(json, account.project_id, "other@example.test"),
    /FIREBASE_SERVICE_ACCOUNT_EMAIL/,
  );
  assert.equal(
    parseFirebaseAccount(
      json,
      ` ${account.project_id}\n`,
      ` ${account.client_email}\n`,
    ).projectId,
    account.project_id,
  );
});
test("Vercel requires the JSON secret and never tries to read local credential paths", () => {
  let reads = 0;
  const read = () => {
    reads++;
    return json;
  };
  assert.equal(readFirebaseConfiguration(env, read).mode, "service-account");
  assert.throws(
    () =>
      readFirebaseConfiguration(
        { VERCEL: "1", FIREBASE_PROJECT_ID: account.project_id },
        read,
      ),
    /ausente ou vazio.*deploy/,
  );
  assert.throws(
    () =>
      readFirebaseConfiguration(
        {
          VERCEL: "1",
          FIREBASE_PROJECT_ID: account.project_id,
          FIREBASE_ADMIN_CREDENTIALS_PATH: "/workspace/credential.json",
        },
        read,
      ),
    /arquivo local.*Vercel/,
  );
  assert.equal(reads, 0);
});
test("local credentials and ADC remain supported, and invalid JSON is never silently bypassed", () => {
  const local = {
    FIREBASE_PROJECT_ID: account.project_id,
    FIREBASE_ADMIN_CREDENTIALS_PATH: "local.json",
  };
  assert.equal(
    readFirebaseConfiguration(local, () => json).account?.clientEmail,
    account.client_email,
  );
  assert.throws(
    () =>
      readFirebaseConfiguration(local, () => {
        throw new Error("secret filename");
      }),
    /não pôde ser lido/,
  );
  assert.throws(
    () =>
      readFirebaseConfiguration(
        { ...local, FIREBASE_SERVICE_ACCOUNT_JSON: "invalid" },
        () => json,
      ),
    /JSON válido/,
  );
  assert.equal(
    readFirebaseConfiguration({ FIREBASE_PROJECT_ID: account.project_id }).mode,
    "application-default",
  );
  assert.equal(
    readFirebaseConfiguration(
      {
        FIREBASE_PROJECT_ID: account.project_id,
        GOOGLE_APPLICATION_CREDENTIALS: "adc.json",
      },
      () => JSON.stringify({ type: "authorized_user" }),
    ).mode,
    "application-default",
  );
  assert.throws(
    () =>
      readFirebaseConfiguration(
        {
          FIREBASE_PROJECT_ID: account.project_id,
          GOOGLE_APPLICATION_CREDENTIALS: "adc.json",
        },
        () => "broken",
      ),
    /GOOGLE_APPLICATION_CREDENTIALS/,
  );
});
test("Firestore emulator cannot be enabled in Vercel and needs isolated demo projects", () => {
  assert.throws(
    () =>
      readFirebaseConfiguration({
        ...env,
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:9080",
      }),
    /Remova FIRESTORE_EMULATOR_HOST/,
  );
  assert.throws(
    () =>
      readFirebaseConfiguration({
        FIREBASE_PROJECT_ID: "real-project",
        FIRESTORE_EMULATOR_HOST: "localhost:9080",
      }),
    /demo-/,
  );
  assert.equal(
    readFirebaseConfiguration({
      FIREBASE_PROJECT_ID: "demo-test",
      FIRESTORE_EMULATOR_HOST: "localhost:9080",
    }).mode,
    "emulator",
  );
  assert.throws(
    () => readFirebaseConfiguration({ FIREBASE_PROJECT_ID: "   " }),
    /FIREBASE_PROJECT_ID/,
  );
});
test("configuration errors never echo input, PEM key, parser details or local filenames", () => {
  const secret = "PRIVATE_INVALID_VALUE";
  for (const run of [
    () => parseFirebaseAccount(secret, account.project_id),
    () =>
      parseFirebaseAccount(
        JSON.stringify({ ...account, private_key: secret }),
        account.project_id,
      ),
    () =>
      readFirebaseConfiguration(
        {
          FIREBASE_PROJECT_ID: account.project_id,
          FIREBASE_ADMIN_CREDENTIALS_PATH: secret,
        },
        () => {
          throw new Error(secret);
        },
      ),
  ]) {
    try {
      run();
      assert.fail("Esperava erro");
    } catch (error) {
      assert.ok(error instanceof FirebaseConfigurationError);
      assert.ok(!error.message.includes(secret));
      assert.ok(!error.message.includes(privateKey));
    }
  }
});
function validate(overrides: Record<string, string | undefined>) {
  const settings: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    APP_URL: "https://datamat-ml.vercel.app",
    ML_CLIENT_ID: "",
    ML_CLIENT_SECRET: "",
    ML_REDIRECT_URI: "",
    ML_TOKEN_ENCRYPTION_KEY: "",
  };
  delete settings.FIRESTORE_EMULATOR_HOST;
  delete settings.FIREBASE_ADMIN_CREDENTIALS_PATH;
  delete settings.FIREBASE_SERVICE_ACCOUNT_EMAIL;
  Object.assign(settings, overrides);
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-deployment.ts"],
    { env: settings, encoding: "utf8", timeout: 15000 },
  );
}
test("deployment validator and runtime accept the same credential formats without logging secrets", () => {
  for (const raw of [
    json,
    JSON.stringify(json),
    JSON.stringify({
      ...account,
      private_key: privateKey.replace(/\n/g, "\\n"),
    }),
  ]) {
    const result = validate({ FIREBASE_SERVICE_ACCOUNT_JSON: raw });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /validada/);
    assert.ok(!result.stdout.includes(privateKey));
    assert.ok(!result.stderr.includes(privateKey));
  }
});
test("deployment validator rejects missing credentials, local URLs and incomplete ML settings", () => {
  for (const settings of [
    {
      FIREBASE_SERVICE_ACCOUNT_JSON: "",
      FIREBASE_ADMIN_CREDENTIALS_PATH: "local.json",
    },
    { APP_URL: "http://localhost:3000" },
    { ML_CLIENT_ID: "123456" },
    { FIREBASE_SERVICE_ACCOUNT_EMAIL: "wrong@example.test" },
    { FIRESTORE_EMULATOR_HOST: "localhost:9080" },
  ]) {
    const result = validate(settings);
    assert.equal(result.status, 1);
    assert.ok(result.stderr);
    assert.ok(!result.stderr.includes(privateKey));
  }
  const complete = {
    ML_CLIENT_ID: "123456",
    ML_CLIENT_SECRET: "test-not-real",
    ML_REDIRECT_URI: "https://datamat-ml.vercel.app/api/mercadolivre/callback",
    ML_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
  assert.equal(validate(complete).status, 0);
  assert.equal(
    validate({
      ...complete,
      ML_TOKEN_ENCRYPTION_KEY: complete.ML_TOKEN_ENCRYPTION_KEY + "!",
    }).status,
    1,
  );
  assert.equal(validate({ ...complete, ML_CLIENT_ID: "not-an-id" }).status, 1);
  assert.equal(
    validate({
      ...complete,
      ML_REDIRECT_URI: "https://other.example/api/mercadolivre/callback",
    }).status,
    1,
  );
});

// Authentication failures must be actionable without exposing provider payloads.

test("database failures classify authentication, quota, permission and transient errors without leaking details", () => {
  for (const [code, expected] of [
    [8, "FIRESTORE_QUOTA_EXCEEDED"],
    [7, "FIREBASE_PERMISSION_DENIED"],
    [14, "FIRESTORE_UNAVAILABLE"],
    [4, "FIRESTORE_UNAVAILABLE"],
    [16, "FIREBASE_AUTH_FAILED"],
  ] as const) {
    const error = Object.assign(new Error("PRIVATE-PROVIDER-DETAILS"), {
      code,
    });
    const result = databaseFailure(error)!;
    assert.equal(result.status, 503);
    assert.equal(result.code, expected);
    assert.ok(!JSON.stringify(result).includes("PRIVATE-PROVIDER-DETAILS"));
  }
  assert.equal(
    databaseFailure(new Error("invalid_grant: JWT signature PRIVATE-KEY"))
      ?.code,
    "FIREBASE_AUTH_FAILED",
  );
  assert.equal(
    databaseFailure(
      Object.assign(new Error("query requires an index"), { code: 9 }),
    )?.code,
    "FIRESTORE_INDEX_REQUIRED",
  );
  assert.equal(databaseFailure(new TypeError("unexpected data")), null);
});

test("Firestore read settings stop quota retries while preserving bounded transient retries and commit semantics", () => {
  const require = createRequire(import.meta.url);
  const { constructSettings } = require("google-gax/fallback");
  const { Status } = require("google-gax");
  const base = require("@google-cloud/firestore-api/build/src/v1/firestore_client_config.json");
  const settings = constructSettings(
    "google.firestore.v1.Firestore",
    base,
    firestoreReadClientConfig,
    Status,
  );
  const defaults = constructSettings(
    "google.firestore.v1.Firestore",
    base,
    {},
    Status,
  );
  for (const method of [
    "getDocument",
    "batchGetDocuments",
    "runQuery",
    "beginTransaction",
  ]) {
    assert.ok(
      !settings[method].retry.retryCodes.includes(Status.RESOURCE_EXHAUSTED),
    );
    assert.ok(settings[method].retry.retryCodes.includes(Status.UNAVAILABLE));
    assert.ok(
      settings[method].retry.backoffSettings.totalTimeoutMillis <= 15000,
    );
  }
  assert.deepEqual(
    settings.commit.retry.retryCodes,
    defaults.commit.retry.retryCodes,
  );
});
