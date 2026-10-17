import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  createPrivateKey,
  hkdfSync,
} from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  admin,
  authorizeStore,
  canWrite,
  canApprove,
  HttpError,
  type Actor,
} from "./access";
import {
  claim,
  release,
  get,
  find,
  put,
  remove,
  transaction,
  key,
  now,
  type Row,
} from "./db";
import { emptyCosts, priceAmount } from "../domain/finance";
import { listingQuality } from "../domain/marketplace";
import { financialContext } from "../domain/ml-financial";
import { readFinancialConditions } from "./ml-financial-conditions";
import { readFirebaseConfiguration } from "./firebase-configuration";

const API = "https://api.mercadolibre.com";
const requestDeadline = new AsyncLocalStorage<number>();
export const ML_STATE_COOKIE = "datamat-ml-oauth";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function encryptionKey() {
  const encoded = process.env.ML_TOKEN_ENCRYPTION_KEY?.trim() || "";
  // Preserve existing installations' keys. New installations can use their
  // existing server identity, without per-store hosting configuration.
  if (!encoded) {
    try {
      const configuration = readFirebaseConfiguration();
      if (configuration.account) {
        const privateKey = createPrivateKey(
          configuration.account.privateKey,
        ).export({ type: "pkcs8", format: "der" });
        return Buffer.from(
          hkdfSync(
            "sha256",
            privateKey,
            configuration.projectId,
            "datamat-integrations-v1",
            32,
          ),
        );
      }
    } catch {}
    throw new HttpError(
      503,
      "O armazenamento protegido das integrações precisa de uma credencial administrativa válida no servidor",
    );
  }
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32 || value.toString("base64") !== encoded)
    throw new HttpError(
      503,
      "Configure a chave de proteção dos tokens do Mercado Livre no servidor",
    );
  return value;
}
export function encryptSecret(value: unknown, context = "") {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decryptSecret(value: string, context = ""): any {
  try {
    const [iv, tag, data] = value
      .split(".")
      .map((v) => Buffer.from(v, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(data), decipher.final()]).toString(),
    );
  } catch {
    throw new HttpError(
      503,
      "Não foi possível abrir as credenciais da conta; confira a chave de proteção no servidor",
    );
  }
}
function appOrigin() {
  let app: URL;
  try {
    app = new URL(process.env.APP_URL || "http://localhost:3000");
  } catch {
    throw new HttpError(
      503,
      "Confira o endereço público do sistema no servidor",
    );
  }
  if (
    app.username ||
    app.password ||
    app.search ||
    app.hash ||
    app.pathname !== "/" ||
    (app.protocol !== "https:" &&
      !(
        app.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(app.hostname)
      ))
  )
    throw new HttpError(
      503,
      "O endereço do sistema deve ser uma origem HTTPS válida",
    );
  return app;
}
export function integrationUrls() {
  const app = appOrigin();
  return {
    redirectUri: new URL("/api/mercadolivre/callback", app).toString(),
    notificationUri: new URL("/api/mercadolivre/notifications", app).toString(),
  };
}
export function secretStorageReady() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
// Compatibility for accounts configured before the per-store settings screen.
function config() {
  const clientId = process.env.ML_CLIENT_ID?.trim(),
    clientSecret = process.env.ML_CLIENT_SECRET?.trim(),
    redirectUri = process.env.ML_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri)
    throw new HttpError(
      503,
      "Configure as credenciais da aplicação do Mercado Livre no servidor antes de conectar uma conta",
    );
  if (!/^[1-9]\d*$/.test(clientId))
    throw new HttpError(
      503,
      "ML_CLIENT_ID deve ser o ID numérico da aplicação no portal de desenvolvedores do Mercado Livre",
    );
  encryptionKey();
  let redirect: URL, app: URL;
  try {
    redirect = new URL(redirectUri);
    app = new URL(process.env.APP_URL || "http://localhost:3000");
  } catch {
    throw new HttpError(503, "Confira APP_URL e ML_REDIRECT_URI no servidor");
  }
  if (
    redirect.origin !== app.origin ||
    redirect.pathname !== "/api/mercadolivre/callback" ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    (redirect.protocol !== "https:" &&
      !(
        redirect.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(redirect.hostname)
      ))
  )
    throw new HttpError(
      503,
      "A URL de retorno deve ser /api/mercadolivre/callback no mesmo endereço público HTTPS do sistema",
    );
  return { clientId, clientSecret, redirectUri, app };
}
export function mlConfigured(connection?: Row) {
  try {
    if (connection?.application_configured) {
      encryptionKey();
      appOrigin();
    } else config();
    return true;
  } catch {
    return false;
  }
}
export function publicConnection(c: Row) {
  const configured = mlConfigured(c);
  let urls: ReturnType<typeof integrationUrls> | null = null;
  try {
    urls = integrationUrls();
  } catch {}
  return {
    id: c.id,
    store_id: c.store_id,
    provider: c.provider,
    status: configured
      ? c.status === "unconfigured"
        ? "unauthorized"
        : c.status
      : "unconfigured",
    configured,
    application_id:
      c.application_id || process.env.ML_CLIENT_ID?.trim() || null,
    application_version: c.application_version || 0,
    application_source: c.application_configured
      ? "store"
      : configured
        ? "legacy"
        : null,
    secret_storage_ready: secretStorageReady(),
    redirect_uri: urls?.redirectUri || null,
    notification_uri: urls?.notificationUri || null,
    external_account: c.external_account || null,
    auth_version: c.auth_version || 0,
    nickname: c.nickname || null,
    last_sync_at: c.last_sync_at || null,
    last_catalog_sync_at: c.last_catalog_sync_at || null,
    last_catalog_completed_at:
      c.last_catalog_completed_at ||
      (!c.has_more && !c.pending_batch ? c.last_catalog_sync_at || null : null),
    sync_running: c.sync_until > Date.now(),
    catalog_total: c.catalog_total ?? null,
    has_more: Boolean(c.has_more || c.pending_batch),
    last_error: c.last_error || null,
    last_notification_at: c.last_notification_at || null,
    updated_at: c.updated_at,
  };
}
async function connection(actor: Actor, connectionId: string) {
  const c = await get("connections", connectionId);
  if (!c || c.provider !== "mercadolivre")
    throw new HttpError(404, "Conexão Mercado Livre não encontrada");
  authorizeStore(actor, c.store_id);
  return c;
}
async function applicationConfig(c: Row) {
  if (!c.application_configured) return config();
  const row = await get("ml_applications", c.id);
  if (
    !row ||
    row.version !== c.application_version ||
    row.client_id !== c.application_id
  )
    throw new HttpError(
      409,
      "As credenciais da loja mudaram; atualize a tela e tente novamente",
    );
  const secret = decryptSecret(row.encrypted, "application:" + c.id);
  if (typeof secret.clientSecret !== "string" || !secret.clientSecret)
    throw new HttpError(503, "Edite as credenciais da integração desta loja");
  return {
    clientId: row.client_id as string,
    clientSecret: secret.clientSecret,
    redirectUri: integrationUrls().redirectUri,
    app: appOrigin(),
  };
}
const applicationSchema = z
  .object({
    clientId: z
      .string()
      .trim()
      .regex(/^[1-9]\d{0,31}$/, "Informe o ID numérico da aplicação"),
    clientSecret: z.string().trim().max(512).default(""),
    version: z.number().int().nonnegative(),
  })
  .strict();
export async function saveApplication(
  actor: Actor,
  connectionId: string,
  payload: unknown,
) {
  admin(actor);
  const p = applicationSchema.parse(payload);
  encryptionKey();
  appOrigin();
  return transaction(async () => {
    const c = await connection(actor, connectionId);
    if ((c.application_version || 0) !== p.version)
      throw new HttpError(
        409,
        "As credenciais foram editadas em outra tela. Atualize antes de salvar",
      );
    const previous = await get("ml_applications", c.id);
    let oldSecret: string | null = null;
    if (previous) {
      try {
        oldSecret = decryptSecret(
          previous.encrypted,
          "application:" + c.id,
        ).clientSecret;
      } catch (e) {
        if (!p.clientSecret) throw e;
      }
    }
    if (!p.clientSecret && (!previous || previous.client_id !== p.clientId))
      throw new HttpError(422, "Informe a chave secreta desta aplicação");
    const clientSecret = p.clientSecret || oldSecret;
    if (previous?.client_id === p.clientId && oldSecret === clientSecret)
      return publicConnection(c);
    if (c.external_account)
      await release(
        "ml.seller." + actor.organization_id,
        c.external_account,
        c.id,
      );
    await remove("ml_tokens", c.id);
    await remove("ml_sync_pages", c.id);
    const version = p.version + 1;
    await put("ml_applications", c.id, {
      store_id: c.store_id,
      organization_id: actor.organization_id,
      client_id: p.clientId,
      encrypted: encryptSecret({ clientSecret }, "application:" + c.id),
      version,
      updated_at: now(),
    });
    const updated = await put("connections", c.id, {
      ...c,
      application_id: p.clientId,
      application_version: version,
      application_configured: true,
      status: "unauthorized",
      external_account: null,
      nickname: null,
      auth_version: (c.auth_version || 0) + 1,
      last_sync_at: null,
      last_catalog_sync_at: null,
      last_catalog_completed_at: null,
      last_notification_at: null,
      sync_until: 0,
      sync_cursor: null,
      pending_batch: false,
      sync_lease: null,
      has_more: false,
      last_error: null,
      updated_at: now(),
    });
    await audit(
      actor,
      c.store_id,
      "",
      "integration.application",
      c.application_id || null,
      p.clientId,
      "Credenciais da aplicação atualizadas; nova autorização necessária",
    );
    return publicConnection(updated);
  });
}
async function http(
  path: string,
  options: RequestInit = {},
  retry = 0,
): Promise<unknown> {
  if (
    requestDeadline.getStore() &&
    Date.now() + 16000 > requestDeadline.getStore()!
  )
    throw new HttpError(
      429,
      "A consulta atingiu o tempo deste lote; continue a importação para retomar os anúncios restantes",
    );
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new HttpError(422, "Caminho de integração inválido");
  let response: Response;
  try {
    response = await fetch(API + path, {
      ...options,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(
      502,
      "O Mercado Livre não respondeu; tente novamente em instantes",
    );
  }
  if (
    response.status >= 500 &&
    (!options.method || options.method === "GET") &&
    !path.includes("/items/search?") &&
    retry < 2
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** retry));
    return http(path, options, retry + 1);
  }
  if (!response.ok) {
    if (path === "/oauth/token" && [400, 401].includes(response.status)) {
      const body = await response.json().catch(() => ({}));
      if (body.error === "invalid_grant")
        throw new HttpError(
          401,
          "A autorização do Mercado Livre expirou ou foi revogada; reconecte a conta",
        );
    }
    throw new HttpError(
      response.status === 401 ? 401 : response.status === 429 ? 429 : 502,
      response.status === 401
        ? "A conta precisa de nova autorização no Mercado Livre"
        : response.status === 429
          ? "O Mercado Livre limitou temporariamente as consultas. Aguarde um minuto e consulte novamente; a conexão continua válida."
          : response.status >= 500
            ? "O Mercado Livre está temporariamente indisponível. Tente novamente em instantes."
            : `Mercado Livre retornou HTTP ${response.status}; confira as permissões da aplicação e tente novamente`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, "Resposta inválida recebida do Mercado Livre");
  }
}
// Numeric JSON strings are equivalent to integers here; never coerce null,
// booleans, fractions or unsafe seller identifiers into valid credentials.
const oauthInteger = z.preprocess(
  (value) =>
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
);
const tokenSchema = z.object({
  access_token: z.string().trim().min(1),
  refresh_token: z.string().trim().min(1),
  token_type: z.string().trim().toLowerCase().pipe(z.literal("bearer")),
  expires_in: oauthInteger,
  user_id: oauthInteger,
  // Scope and other provider metadata are unused; their shape must not reject
  // otherwise valid credentials. Zod strips them before protected storage.
});
class TokenResponseError extends HttpError {}
async function exchange(connection: Row, values: Record<string, string>) {
  const c = await applicationConfig(connection);
  const raw = await http("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      ...values,
    }),
  });
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.map((i) => String(i.path[0] || "resposta")),
      ),
    ];
    const operation =
      values.grant_type === "refresh_token" ? "renovar" : "conectar";
    const missingRefresh = fields.includes("refresh_token");
    throw new TokenResponseError(
      502,
      `O Mercado Livre retornou campos ausentes ou inválidos ao ${operation} a conta: ${fields.join(", ")}. ` +
        (missingRefresh
          ? "Confira a permissão offline_access na aplicação Mercado Livre e autorize a conta novamente."
          : "Autorize a conta novamente; se persistir, informe os nomes dos campos deste aviso."),
    );
  }
  return parsed.data;
}
function authorizationReturnPath(
  actor: Actor,
  storeId: string,
  value?: unknown,
) {
  const fallback = `/configuracoes?configTab=integrations&store=${encodeURIComponent(storeId)}`;
  if (
    typeof value !== "string" ||
    value.length > 8000 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return fallback;
  const base = "https://workspace.invalid";
  const url = new URL(value, base);
  if (
    url.origin !== base ||
    !/^\/(?:anuncios(?:\/[a-zA-Z0-9_-]+)?|precificacao|analises(?:\/ao-vivo)?|concorrencia|acoes|historico|estudos|configuracoes)?$/.test(
      url.pathname,
    )
  )
    return fallback;
  for (const name of [
    "code",
    "state",
    "error",
    "error_description",
    "mlAuthorization",
    "mlMessage",
  ])
    url.searchParams.delete(name);
  const store = url.searchParams.get("store");
  if (!store || (store !== "all" && !actor.stores.some((s) => s.id === store)))
    url.searchParams.set("store", storeId);
  url.hash = "";
  return url.pathname + (url.searchParams.size ? "?" + url.searchParams : "");
}

// Read only the navigation context, bound to the same actor and browser as
// OAuth. Keep it available for denied/expired/failed flows as well as success.
export async function authorizationContext(
  actor: Actor,
  params: URLSearchParams,
  cookie: string | undefined,
) {
  const fallback = {
    path: "/configuracoes?configTab=integrations",
    popupChannel: null as string | null,
  };
  const state = params.get("state");
  if (
    !state ||
    state.length > 200 ||
    !cookie ||
    digest(cookie) !== digest(state)
  )
    return fallback;
  const row = await get("ml_oauth_states", digest(state));
  if (
    !row ||
    row.organization_id !== actor.organization_id ||
    row.actor_id !== actor.id
  )
    return fallback;
  const c = await connection(actor, row.connection_id);
  return {
    path: authorizationReturnPath(actor, c.store_id, row.return_to),
    popupChannel: z.uuid().safeParse(row.popup_channel).success
      ? (row.popup_channel as string)
      : null,
  };
}
export async function authorizationReturn(
  actor: Actor,
  params: URLSearchParams,
  cookie: string | undefined,
) {
  return (await authorizationContext(actor, params, cookie)).path;
}

export async function startAuthorization(
  actor: Actor,
  connectionId: string,
  returnTo?: unknown,
  popupChannel?: string,
) {
  admin(actor);
  const c = await connection(actor, connectionId),
    cfg = await applicationConfig(c),
    state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  await put("ml_oauth_states", digest(state), {
    connection_id: c.id,
    organization_id: actor.organization_id,
    actor_id: actor.id,
    auth_version: c.auth_version || 0,
    return_to: authorizationReturnPath(actor, c.store_id, returnTo),
    popup_channel: popupChannel ? z.uuid().parse(popupChannel) : null,
    secret: encryptSecret(verifier),
    expires_at: Date.now() + 600000,
    status: "pending",
  });
  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state };
}
export async function finishAuthorization(
  actor: Actor,
  params: URLSearchParams,
  cookie: string | undefined,
) {
  admin(actor);
  const state = params.get("state");
  if (
    !state ||
    state.length > 200 ||
    !cookie ||
    digest(cookie) !== digest(state)
  )
    throw new HttpError(
      400,
      "A autorização não corresponde a este navegador; conecte a conta novamente",
    );
  const documentId = digest(state);
  const pending = await transaction(async () => {
    const row = await get("ml_oauth_states", documentId);
    if (
      !row ||
      row.status !== "pending" ||
      row.expires_at < Date.now() ||
      row.organization_id !== actor.organization_id ||
      row.actor_id !== actor.id
    )
      throw new HttpError(
        400,
        "Autorização expirada ou já utilizada; conecte a conta novamente",
      );
    const c = await connection(actor, row.connection_id);
    if ((c.auth_version || 0) !== row.auth_version)
      throw new HttpError(
        409,
        "A conexão foi alterada; inicie uma nova autorização",
      );
    await put("ml_oauth_states", documentId, {
      ...row,
      status: "processing",
      secret: null,
    });
    return row;
  });
  try {
    if (params.get("error"))
      throw new HttpError(400, "Autorização não concedida no Mercado Livre");
    const code = params.get("code");
    if (!code || code.length > 2000)
      throw new HttpError(400, "Código de autorização ausente ou inválido");
    const current = await connection(actor, pending.connection_id);
    if ((current.auth_version || 0) !== pending.auth_version)
      throw new HttpError(
        409,
        "A conexão foi alterada; inicie uma nova autorização",
      );
    const cfg = await applicationConfig(current);
    const tokens = await exchange(current, {
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: decryptSecret(pending.secret),
    });
    const user = z
      .object({
        id: oauthInteger,
        nickname: z.string(),
        site_id: z.string(),
      })
      .parse(
        await http("/users/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }),
      );
    if (tokens.user_id !== user.id || user.site_id !== "MLB")
      throw new HttpError(
        422,
        "Autorize uma conta vendedora brasileira do Mercado Livre",
      );
    await transaction(async () => {
      const c = await connection(actor, pending.connection_id);
      if ((c.auth_version || 0) !== pending.auth_version)
        throw new HttpError(
          409,
          "A conexão foi alterada durante a autorização",
        );
      await claim("ml.seller." + actor.organization_id, String(user.id), c.id);
      if (c.external_account && c.external_account !== String(user.id))
        throw new HttpError(
          409,
          "Esta loja já está vinculada a outro vendedor; desconecte antes de trocar a conta",
        );
      await put("ml_tokens", c.id, {
        encrypted: encryptSecret(tokens),
        expires_at: Date.now() + tokens.expires_in * 1000,
        auth_version: pending.auth_version + 1,
        updated_at: now(),
      });
      await put("connections", c.id, {
        ...c,
        external_account: String(user.id),
        nickname: user.nickname,
        status: "connected",
        auth_version: pending.auth_version + 1,
        last_sync_at: null,
        last_catalog_sync_at: null,
        last_catalog_completed_at: null,
        last_notification_at: null,
        sync_until: 0,
        sync_cursor: null,
        pending_batch: false,
        has_more: false,
        last_error: null,
        updated_at: now(),
      });
      await put("ml_oauth_states", documentId, {
        ...pending,
        secret: null,
        status: "completed",
      });
    });
    return {
      storeId: (await connection(actor, pending.connection_id)).store_id,
    };
  } catch (e) {
    await put("ml_oauth_states", documentId, {
      ...pending,
      secret: null,
      status: "failed",
    });
    throw e;
  }
}
export async function disconnect(actor: Actor, connectionId: string) {
  admin(actor);
  return transaction(async () => {
    const c = await connection(actor, connectionId);
    if (c.external_account)
      await release(
        "ml.seller." + actor.organization_id,
        c.external_account,
        c.id,
      );
    await remove("ml_tokens", c.id);
    await remove("ml_sync_pages", c.id);
    await put("connections", c.id, {
      ...c,
      status: "unauthorized",
      external_account: null,
      nickname: null,
      auth_version: (c.auth_version || 0) + 1,
      last_sync_at: null,
      last_catalog_sync_at: null,
      last_catalog_completed_at: null,
      last_notification_at: null,
      sync_until: 0,
      sync_cursor: null,
      pending_batch: false,
      sync_lease: null,
      has_more: false,
      last_error: null,
      updated_at: now(),
    });
    return { disconnected: true };
  });
}
async function accessToken(c: Row, rejectedToken?: string): Promise<string> {
  await applicationConfig(c);
  const lease = randomUUID();
  const token = await transaction(async () => {
    const current = await get("connections", c.id),
      row = await get("ml_tokens", c.id);
    if (
      !row ||
      !current?.external_account ||
      current.status === "unauthorized" ||
      row.auth_version !== c.auth_version ||
      current.auth_version !== c.auth_version
    )
      throw new HttpError(
        401,
        "Conecte esta conta do Mercado Livre antes de consultar",
      );
    const value = decryptSecret(row.encrypted);
    if (
      row.expires_at > Date.now() + 60000 &&
      (!rejectedToken || value.access_token !== rejectedToken)
    )
      return { access: value.access_token as string };
    if (row.refresh_until > Date.now())
      throw new HttpError(
        429,
        "A conta está renovando a autorização; tente novamente em instantes",
      );
    await put("ml_tokens", c.id, {
      ...row,
      refresh_lease: lease,
      refresh_until: Date.now() + 30000,
    });
    return { refresh: value.refresh_token as string };
  });
  if (token.access) return token.access;
  try {
    const tokens = await exchange(c, {
      grant_type: "refresh_token",
      refresh_token: token.refresh!,
    });
    if (String(tokens.user_id) !== c.external_account)
      throw new HttpError(
        502,
        "A renovação retornou uma conta diferente da autorizada",
      );
    await transaction(async () => {
      const row = await get("ml_tokens", c.id),
        current = await get("connections", c.id);
      if (
        !row ||
        row.refresh_lease !== lease ||
        current?.auth_version !== c.auth_version
      )
        throw new HttpError(409, "A conexão mudou durante a renovação");
      await put("ml_tokens", c.id, {
        encrypted: encryptSecret(tokens),
        auth_version: c.auth_version,
        expires_at: Date.now() + tokens.expires_in * 1000,
        updated_at: now(),
      });
      await put("connections", c.id, {
        ...current,
        status: "connected",
        last_error: null,
        updated_at: now(),
      });
    });
    return tokens.access_token;
  } catch (e) {
    await transaction(async () => {
      const row = await get("ml_tokens", c.id),
        current = await get("connections", c.id);
      if (
        row?.refresh_lease === lease &&
        current?.auth_version === c.auth_version
      ) {
        await put("ml_tokens", c.id, {
          ...row,
          refresh_lease: null,
          refresh_until: 0,
        });
        // A successful token POST can consume the old refresh token even if
        // its response is unusable. Stop reusing it and request fresh consent.
        if (
          e instanceof HttpError &&
          (e.status === 401 || e instanceof TokenResponseError)
        )
          await put("connections", c.id, {
            ...current,
            status: "unauthorized",
            last_error: e.message,
            updated_at: now(),
          });
      }
    });
    throw e;
  }
}
async function api(c: Row, path: string) {
  const token = await accessToken(c);
  try {
    return await http(path, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 401) throw e;
    return http(path, {
      headers: { Authorization: `Bearer ${await accessToken(c, token)}` },
    });
  }
}
// Analytics uses the same authorized seller, token renewal and request deadline.
// Never expose the token or accept a seller selected by the browser.
export async function withSellerData<T>(
  actor: Actor,
  connectionId: string,
  read: (
    request: (path: string) => Promise<unknown>,
    account: Row,
  ) => Promise<T>,
  deadline = Date.now() + 220000,
): Promise<T> {
  const account = await connection(actor, connectionId);
  if (!account.external_account || account.status !== "connected")
    throw new HttpError(
      409,
      "Conecte esta loja ao Mercado Livre para consultar as análises",
    );
  const result = await requestDeadline.run(deadline, () =>
    read((path) => api(account, path), account),
  );
  const current = await connection(actor, connectionId);
  if (
    current.auth_version !== account.auth_version ||
    current.external_account !== account.external_account
  )
    throw new HttpError(
      409,
      "A conta mudou durante a consulta; atualize novamente",
    );
  return result;
}
export async function writeSellerPrice(
  actor: Actor,
  connectionId: string,
  itemId: string,
  price: string,
) {
  canApprove(actor);
  const c = await connection(actor, connectionId);
  if (
    c.status !== "connected" ||
    !c.external_account ||
    !/^MLB\d+$/.test(itemId)
  )
    throw new HttpError(409, "Conta ou anúncio indisponível para aplicação");
  // No automatic retry for writes, including timeouts and authentication failures.
  await http(`/items/${itemId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await accessToken(c)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ price: Number(price) }),
  });
}
export async function writeSellerStatus(
  actor: Actor,
  connectionId: string,
  itemId: string,
  status: "active" | "paused",
) {
  canWrite(actor);
  const c = await connection(actor, connectionId);
  if (
    c.status !== "connected" ||
    !c.external_account ||
    !/^MLB\d+$/.test(itemId)
  )
    throw new HttpError(409, "Conta ou anúncio indisponível para alteração");
  // A lost response must be verified through a read, never retried as a write.
  await http(`/items/${itemId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await accessToken(c)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
}
export function safePictureUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      /(^|\.)mlstatic\.com$/.test(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export function safeListingUrl(value: string | undefined, itemId: string) {
  try {
    const url = new URL(value || "");
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["produto.mercadolivre.com.br", "www.mercadolivre.com.br"].includes(
        url.hostname,
      )
    )
      return url.toString();
  } catch {}
  return `https://produto.mercadolivre.com.br/${itemId.replace(/^MLB/, "MLB-")}-_JM`;
}
const itemSchema = z.object({
  id: z.string().regex(/^MLB\d+$/),
  seller_id: z.number().int().positive(),
  site_id: z.literal("MLB"),
  title: z.string().min(1).max(200),
  category_id: z.string(),
  currency_id: z.string(),
  price: z
    .number()
    .finite()
    .positive()
    .refine((v) => priceAmount.safeParse(v).success),
  status: z.string(),
  listing_type_id: z.string(),
  seller_custom_field: z.string().nullable().optional(),
  available_quantity: z.number().int().nonnegative(),
  sold_quantity: z.number().int().nonnegative(),
  original_price: z.number().finite().positive().nullish(),
  catalog_listing: z.boolean().optional(),
  catalog_product_id: z.string().nullable().optional(),
  user_product_id: z.string().nullable().optional(),
  parent_item_id: z.string().nullable().optional(),
  pictures: z
    .array(
      z.object({
        id: z.string().optional(),
        secure_url: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
      }),
    )
    .max(100),
  video_id: z.string().nullable().optional(),
  health: z.number().min(0).max(1).nullable().optional(),
  sub_status: z.array(z.string()).optional(),
  permalink: z.string().optional(),
  attributes: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      value_name: z.string().nullable().optional(),
      value_id: z.string().nullable().optional(),
    }),
  ),
  shipping: z.object({
    mode: z.string().optional(),
    logistic_type: z.string().optional(),
    free_shipping: z.boolean().optional(),
    dimensions: z.string().max(200).nullish(),
  }),
  variations: z
    .array(
      z.object({
        id: z.number(),
        price: z.number().optional(),
        seller_custom_field: z.string().nullable().optional(),
        available_quantity: z.number().int().nonnegative().optional(),
        attribute_combinations: z
          .array(
            z.object({
              name: z.string(),
              value_name: z.string().nullable().optional(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
});
type Item = z.infer<typeof itemSchema>;
async function audit(
  actor: Actor,
  storeId: string,
  offerId: string,
  field: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  await put("history", randomUUID(), {
    organization_id: actor.organization_id,
    store_id: storeId,
    offer_id: offerId,
    actor_id: actor.id,
    actor_name: actor.name,
    field,
    old_value: before == null ? null : JSON.stringify(before),
    new_value: JSON.stringify(after),
    reason,
    origin: "mercadolivre",
    status: "confirmed",
    snapshot_json: "{}",
    created_at: now(),
  });
}
async function importItem(
  actor: Actor,
  c: Row,
  item: Item,
  observation: Row,
  description: string | null,
  lease: string,
  markPage = true,
) {
  return transaction(async () => {
    const current = await connection(actor, c.id);
    if (current.sync_lease !== lease || current.auth_version !== c.auth_version)
      throw new HttpError(409, "A conexão mudou durante a sincronização");
    const existing = (
      await find("offers", { store_id: c.store_id, ml_id: item.id })
    )[0];
    if (existing?.ml_apply_until > Date.now())
      throw new HttpError(
        409,
        "Uma aplicação de preço está em andamento; tente novamente em instantes",
      );
    if (existing?.origin === "reference")
      throw new HttpError(
        409,
        "Este código está cadastrado como referência; confira o vínculo antes de importar",
      );
    const offerId = existing?.id || key(c.store_id, item.id),
      productId =
        existing?.product_id || key(actor.organization_id, c.store_id, item.id);
    await claim("offers.ml." + c.store_id, item.id, offerId);
    const attribute = (id: string) =>
      item.attributes.find((a) => a.id === id)?.value_name || null;
    if (!existing) {
      const brand = attribute("BRAND"),
        brandId = brand ? key(actor.organization_id, "brands", brand) : null;
      if (brandId && !(await get("brands", brandId)))
        await put("brands", brandId, {
          organization_id: actor.organization_id,
          name: brand,
        });
      await put("products", productId, {
        organization_id: actor.organization_id,
        name: item.title,
        model: attribute("MODEL"),
        brand_id: brandId,
        category_id: null,
        version: 1,
      });
      await put("costs", offerId, {
        offer_id: offerId,
        store_id: c.store_id,
        data_json: JSON.stringify(emptyCosts()),
        updated_at: now(),
      });
      if (item.variations.length)
        for (const v of item.variations.slice(0, 100))
          await put("components", key(offerId, String(v.id)), {
            offer_id: offerId,
            product_id: productId,
            quantity: 1,
            variation:
              v.attribute_combinations
                ?.map((a) => `${a.name}: ${a.value_name || "a conferir"}`)
                .join(" · ") || String(v.id),
          });
    }
    const status = ["active", "paused", "closed"].includes(item.status)
      ? item.status
      : "draft";
    const next = {
      title: item.title,
      price: new Decimal(item.price).toFixed(2),
      status,
      description: description ?? existing?.description ?? "",
      sku:
        attribute("SELLER_SKU") ||
        item.seller_custom_field ||
        existing?.sku ||
        null,
    };
    const contextFields = [
      "sellerId",
      "authVersion",
      "listingTypeId",
      "categoryId",
      "currencyId",
      "shippingMode",
      "logisticType",
      "freeShipping",
      "catalogListing",
      "variablePrices",
      "variationCount",
    ];
    const pricingChanged = Boolean(
      existing &&
      contextFields.some(
        (field) => existing.ml?.[field] !== observation[field],
      ),
    );
    const contentFields = [
      "pictures",
      "videoId",
      "attributes",
      "variationDetails",
      "subStatus",
      "health",
      "availableQuantity",
    ];
    const contentChanged =
      !!existing &&
      contentFields.some(
        (field) =>
          JSON.stringify(existing.ml?.[field] ?? null) !==
          JSON.stringify(observation[field] ?? null),
      );
    const changed =
      contentChanged ||
      pricingChanged ||
      !existing ||
      Object.entries(next).some(([k, v]) => existing[k] !== v);
    const row = {
      ...existing,
      ...next,
      organization_id: actor.organization_id,
      store_id: c.store_id,
      product_id: productId,
      ml_id: item.id,
      type: existing?.type || (item.variations.length ? "variation" : "unit"),
      origin: existing?.origin || "import",
      reference_account: existing?.reference_account || null,
      version: (existing?.version || 0) + (changed ? 1 : 0),
      ml: observation,
      ...(existing && changed
        ? {
            ml_last_change: {
              at: now(),
              sellerId: c.external_account,
              authVersion: c.auth_version,
              fields: [
                ...(existing.price !== next.price ? ["Preço"] : []),
                ...(existing.status !== next.status ? ["Situação"] : []),
                ...(existing.title !== next.title ? ["Título"] : []),
                ...(existing.ml?.availableQuantity !==
                observation.availableQuantity
                  ? ["Estoque"]
                  : []),
                ...(contentChanged ? ["Conteúdo e mídia"] : []),
              ],
            },
          }
        : {}),
      updated_at: changed ? now() : existing.updated_at,
    };
    await put("offers", offerId, row);
    const page = await get("ml_sync_pages", c.id);
    if (markPage && page && page.auth_version === c.auth_version)
      await put("ml_sync_pages", c.id, {
        ...page,
        processed_ids: [...new Set([...(page.processed_ids || []), item.id])],
      });
    if (changed)
      await audit(
        actor,
        c.store_id,
        offerId,
        existing ? "ml.observed_update" : "ml.import",
        existing
          ? {
              title: existing.title,
              price: existing.price,
              status: existing.status,
              description: existing.description,
              sku: existing.sku,
              mlContent: Object.fromEntries(
                contentFields.map((field) => [
                  field,
                  existing.ml?.[field] ?? null,
                ]),
              ),
            }
          : null,
        {
          ...next,
          mlContent: Object.fromEntries(
            contentFields.map((field) => [field, observation[field] ?? null]),
          ),
          mlConditions: Object.fromEntries(
            contextFields.map((field) => [field, observation[field]]),
          ),
        },
        "Estado confirmado pela consulta à conta Mercado Livre",
      );
    return { created: !existing, changed };
  });
}
export async function syncListings(
  actor: Actor,
  connectionId: string,
  payload: unknown,
  deadline = Date.now() + 240000,
) {
  return requestDeadline.run(deadline, () =>
    syncListingsInside(actor, connectionId, payload),
  );
}
async function syncListingsInside(
  actor: Actor,
  connectionId: string,
  payload: unknown,
) {
  admin(actor);
  const p = z
    .object({
      requestId: z.uuid(),
      restart: z.boolean().default(false),
      itemIds: z
        .array(z.string().regex(/^MLB\d{1,20}$/))
        .min(1)
        .max(20)
        .optional(),
    })
    .parse(payload);
  let c = await connection(actor, connectionId);
  const logId = key("sync", p.requestId),
    lease = randomUUID();
  const prior = await transaction(async () => {
    const current = await connection(actor, c.id),
      old = await get("sync_logs", logId);
    if (old && old.connection_id !== c.id)
      throw new HttpError(409, "Chave utilizada em outra conexão");
    if (old && old.status !== "running") return old;
    if (current.sync_until > Date.now())
      throw new HttpError(
        429,
        "Já existe uma sincronização desta loja em andamento",
      );
    c = current;
    await put("connections", c.id, {
      ...current,
      sync_lease: lease,
      sync_until: Date.now() + 180000,
    });
    await put("sync_logs", logId, {
      connection_id: c.id,
      operation: "sync",
      status: "running",
      request_id: p.requestId,
      created_at: now(),
      message: "Consulta de até 20 anúncios da conta",
    });
    return null;
  });
  if (prior) return prior;
  let responseResource = "página do catálogo";
  try {
    await applicationConfig(c);
    if (!c.external_account)
      throw new HttpError(401, "Autorize esta conta antes de sincronizar");
    const query = new URLSearchParams({ search_type: "scan", limit: "20" });
    if (!p.restart && c.has_more && c.sync_cursor)
      query.set("scroll_id", c.sync_cursor);
    const schema = z.object({
      results: z.array(z.string().regex(/^MLB\d+$/)).max(20),
      scroll_id: z.string().optional(),
      paging: z.object({ total: z.number().int().nonnegative() }),
    });
    const pending =
      !p.itemIds && !p.restart ? await get("ml_sync_pages", c.id) : null;
    const page = p.itemIds
      ? {
          results: [...new Set(p.itemIds)],
          paging: { total: p.itemIds.length },
          scroll_id: undefined,
        }
      : pending && pending.auth_version === c.auth_version
        ? schema.parse(pending.page)
        : schema.parse(
            await api(c, `/users/${c.external_account}/items/search?${query}`),
          );
    if (!p.itemIds)
      await transaction(async () => {
        const current = await connection(actor, c.id);
        if (
          current.sync_lease !== lease ||
          current.auth_version !== c.auth_version
        )
          throw new HttpError(
            409,
            "A conexão mudou durante a consulta do lote",
          );
        await put("ml_sync_pages", c.id, {
          auth_version: c.auth_version,
          page,
          processed_ids:
            pending && pending.auth_version === c.auth_version
              ? pending.processed_ids || []
              : [],
        });
        await put("connections", c.id, { ...current, pending_batch: true });
      });
    let created = 0,
      updated = 0;
    const categoryCache = new Map<string, Row[] | null>();
    for (const itemId of page.results) {
      if (
        pending &&
        pending.auth_version === c.auth_version &&
        pending.processed_ids?.includes(itemId)
      )
        continue;
      responseResource = `anúncio ${itemId}`;
      const item = itemSchema.parse(await api(c, "/items/" + itemId));
      if (item.currency_id !== "BRL")
        throw new HttpError(
          422,
          "O anúncio utiliza outra moeda; a importação atual aceita apenas BRL",
        );
      if (String(item.seller_id) !== c.external_account || item.id !== itemId)
        throw new HttpError(
          403,
          "A consulta retornou um anúncio de outra conta",
        );
      let description: string | null = null;
      const unavailable: string[] = [];
      try {
        description = z
          .object({ plain_text: z.string().max(15000) })
          .parse(await api(c, `/items/${itemId}/description`)).plain_text;
      } catch {
        unavailable.push("Descrição não consultada");
      }
      if (!categoryCache.has(item.category_id)) {
        try {
          const attrs = z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                tags: z
                  .object({ required: z.boolean().optional() })
                  .passthrough(),
              }),
            )
            .parse(
              await api(
                c,
                `/categories/${encodeURIComponent(item.category_id)}/attributes`,
              ),
            );
          categoryCache.set(
            item.category_id,
            attrs.filter((a) => a.tags.required),
          );
        } catch {
          categoryCache.set(item.category_id, null);
        }
      }
      const required = categoryCache.get(item.category_id);
      if (!required) unavailable.push("Atributos obrigatórios não consultados");
      const observation = {
        sellerId: c.external_account,
        connectionId: c.id,
        authVersion: c.auth_version,
        categoryId: item.category_id,
        currencyId: item.currency_id,
        listingTypeId: item.listing_type_id,
        rawStatus: item.status,
        shippingMode: item.shipping.mode || null,
        logisticType: item.shipping.logistic_type || null,
        freeShipping: item.shipping.free_shipping ?? null,
        shippingDimensions: item.shipping.dimensions ?? null,
        financialAttributes: item.attributes
          .filter((a) =>
            /^(PACKAGE_|SELLER_PACKAGE_)?(HEIGHT|WIDTH|LENGTH|WEIGHT)$/.test(
              a.id,
            ),
          )
          .map((a) => [a.id, a.value_name || a.value_id || null])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        availableQuantity: item.available_quantity,
        soldQuantityLifetime: item.sold_quantity,
        catalogListing: item.catalog_listing || false,
        catalogProductId: item.catalog_product_id || null,
        userProductId: item.user_product_id || null,
        parentItemId: item.parent_item_id || null,
        permalink: safeListingUrl(item.permalink, item.id),
        photoCount: item.pictures.length,
        pictures: item.pictures.map((p) => ({
          id: p.id || null,
          url: safePictureUrl(p.secure_url || p.url),
        })),
        videoId: item.video_id ?? null,
        videoAvailable: item.video_id !== undefined,
        health: item.health ?? null,
        subStatus: item.sub_status || [],
        attributes: item.attributes.map((a) => ({
          id: a.id,
          name: a.name || a.id,
          value: a.value_name || a.value_id || null,
        })),
        variationDetails: item.variations.slice(0, 100).map((v) => ({
          id: String(v.id),
          price: v.price == null ? null : String(v.price),
          stock: v.available_quantity ?? null,
          attributes: v.attribute_combinations || [],
        })),
        variationCount: item.variations.length,
        variablePrices: item.variations.some(
          (v) => v.price !== undefined && !new Decimal(v.price).eq(item.price),
        ),
        missingRequiredAttributes:
          required
            ?.filter(
              (a) =>
                !item.attributes.some(
                  (v) => v.id === a.id && (v.value_id || v.value_name),
                ) &&
                !(
                  item.variations.length &&
                  item.variations.every((v) =>
                    v.attribute_combinations?.some(
                      (x) => x.name === a.name && x.value_name,
                    ),
                  )
                ),
            )
            .map((a) => ({ id: a.id, name: a.name })) || [],
        unavailable,
        observedAt: now(),
      };
      const result = await importItem(
        actor,
        c,
        item,
        observation,
        description,
        lease,
        !p.itemIds,
      );
      if (result.created) created++;
      else if (result.changed) updated++;
    }
    const hasMore = page.results.length > 0 && Boolean(page.scroll_id);
    return transaction(async () => {
      const current = await connection(actor, c.id);
      if (
        current.sync_lease !== lease ||
        current.auth_version !== c.auth_version
      )
        throw new HttpError(409, "A conexão mudou durante a sincronização");
      await put("connections", c.id, {
        ...current,
        status: "connected",
        sync_lease: null,
        sync_until: 0,
        ...(!p.itemIds
          ? {
              sync_cursor: hasMore ? page.scroll_id : null,
              pending_batch: false,
              has_more: hasMore,
            }
          : {}),
        last_sync_at: now(),
        ...(!p.itemIds ? { last_catalog_sync_at: now() } : {}),
        ...(!p.itemIds && !hasMore ? { last_catalog_completed_at: now() } : {}),
        last_error: null,
        ...(!p.itemIds ? { catalog_total: page.paging.total } : {}),
        updated_at: now(),
      });
      if (!p.itemIds) await remove("ml_sync_pages", c.id);
      return put("sync_logs", logId, {
        connection_id: c.id,
        operation: "sync",
        status: "confirmed",
        request_id: p.requestId,
        created_at: now(),
        created,
        updated,
        processed: page.results.length,
        has_more: hasMore,
        message: `${created} importados · ${updated} atualizados · ${page.results.length} consultados${hasMore ? " · continuar próximo lote" : " · consulta concluída"}`,
      });
    });
  } catch (e) {
    const invalidFields =
      e instanceof z.ZodError
        ? [
            ...new Set(
              e.issues.map((issue) => issue.path.join(".") || "resposta"),
            ),
          ].slice(0, 8)
        : [];
    const message =
      e instanceof HttpError
        ? e.message
        : invalidFields.length
          ? `O Mercado Livre retornou dados incompatíveis em ${responseResource} (campos: ${invalidFields.join(", ")}). A consulta pode ser retomada sem perder os anúncios já atualizados.`
          : "O formato de resposta do Mercado Livre precisa ser conferido; consulte o registro da sincronização";
    await transaction(async () => {
      const current = await get("connections", c.id);
      const savedPage = await get("ml_sync_pages", c.id);
      if (current?.sync_lease === lease)
        await put("connections", c.id, {
          ...current,
          sync_lease: null,
          sync_until: 0,
          ...(!p.itemIds &&
          (!savedPage || savedPage.auth_version !== c.auth_version)
            ? { sync_cursor: null, has_more: false }
            : {}),
          last_error: message,
          updated_at: now(),
        });
      await put("sync_logs", logId, {
        connection_id: c.id,
        operation: "sync",
        status: "failed",
        request_id: p.requestId,
        created_at: now(),
        message,
        ...(invalidFields.length
          ? {
              response_resource: responseResource,
              invalid_fields: invalidFields,
            }
          : {}),
      });
    });
    throw new HttpError(e instanceof HttpError ? e.status : 502, message);
  }
}
async function connectedOffer(actor: Actor, offerId: string) {
  const offer = await get("offers", offerId);
  if (!offer) throw new HttpError(404, "Anúncio não encontrado");
  authorizeStore(actor, offer.store_id);
  if (offer.origin === "reference" || !/^MLB\d+$/.test(offer.ml_id || ""))
    throw new HttpError(
      422,
      "Sincronize um anúncio próprio antes de consultar suas condições",
    );
  const c = await connection(actor, key(offer.store_id, "mercadolivre"));
  return { offer, c };
}
export async function quoteTariff(
  actor: Actor,
  offerId: string,
  payload: unknown,
  deadline = Date.now() + 55000,
) {
  return requestDeadline.run(deadline, () =>
    quoteTariffInside(actor, offerId, payload),
  );
}
async function quoteTariffInside(
  actor: Actor,
  offerId: string,
  payload: unknown,
) {
  canWrite(actor);
  const p = z
      .object({
        price: priceAmount.refine((v) => v !== null),
        offerVersion: z.number().int().positive(),
      })
      .parse(payload),
    { offer, c } = await connectedOffer(actor, offerId);
  if (offer.version !== p.offerVersion)
    throw new HttpError(409, "O anúncio mudou; recarregue a precificação");
  const item = itemSchema.parse(await api(c, "/items/" + offer.ml_id));
  if (String(item.seller_id) !== c.external_account || item.id !== offer.ml_id)
    throw new HttpError(403, "O anúncio pertence a outra conta");
  if (
    item.currency_id !== "BRL" ||
    item.variations.some(
      (v) => v.price !== undefined && !new Decimal(v.price).eq(item.price),
    )
  )
    throw new HttpError(
      422,
      "Confira a moeda ou os preços individuais das variações antes de precificar",
    );
  if (
    !new Decimal(item.price).eq(offer.price!) ||
    item.listing_type_id !== offer.ml?.listingTypeId ||
    item.category_id !== offer.ml?.categoryId ||
    item.shipping.mode !== (offer.ml?.shippingMode ?? undefined) ||
    item.shipping.logistic_type !== (offer.ml?.logisticType ?? undefined)
  )
    throw new HttpError(
      409,
      "As condições do anúncio mudaram no Mercado Livre; sincronize a loja novamente",
    );
  const conditions = await readFinancialConditions(
    (path) => api(c, path),
    item,
    c.external_account,
    p.price!,
  );
  const quoteId = randomUUID(),
    quotedAt = now(),
    expiresAt = Date.now() + 300000;
  const quote = {
    id: quoteId,
    offer_id: offerId,
    store_id: offer.store_id,
    offer_version: offer.version,
    connection_id: c.id,
    auth_version: c.auth_version,
    seller_id: c.external_account,
    price: new Decimal(p.price!).toFixed(2),
    listing_type_id: item.listing_type_id,
    category_id: item.category_id,
    shipping_mode: item.shipping.mode || null,
    logistic_type: item.shipping.logistic_type || null,
    ...conditions,
    context: financialContext(offer),
    quoted_at: quotedAt,
    expires_at: expiresAt,
    source: "Mercado Livre · listing_prices",
    shippingVerified: false,
  };
  await transaction(async () => {
    const current = await get("offers", offerId),
      currentConnection = await connection(actor, c.id);
    if (
      current?.version !== offer.version ||
      currentConnection.auth_version !== c.auth_version
    )
      throw new HttpError(
        409,
        "A oferta ou a conexão mudou durante a consulta",
      );
    await put("ml_quotes", quoteId, quote);
    if (new Decimal(p.price!).eq(offer.price))
      await put("ml_current_quotes", offerId, quote);
  });
  return quote;
}
export async function validateQuote(
  actor: Actor,
  offer: Row,
  quoteId: string,
  price: string,
) {
  const q = await get("ml_quotes", quoteId),
    c = await connection(actor, key(offer.store_id, "mercadolivre"));
  if (
    !q ||
    q.offer_id !== offer.id ||
    q.store_id !== offer.store_id ||
    q.offer_version !== offer.version ||
    q.auth_version !== c.auth_version ||
    q.seller_id !== c.external_account ||
    q.expires_at <= Date.now() ||
    !new Decimal(q.price).eq(price)
  )
    throw new HttpError(
      409,
      "A consulta de tarifas expirou ou não corresponde ao cenário; consulte novamente",
    );
  return q;
}
export async function refreshMetrics(
  actor: Actor,
  offerId: string,
  days: 7 | 30 = 30,
  deadline = Date.now() + 240000,
) {
  return requestDeadline.run(deadline, () =>
    refreshMetricsInside(actor, offerId, days),
  );
}
async function refreshMetricsInside(
  actor: Actor,
  offerId: string,
  days: 7 | 30,
) {
  canWrite(actor);
  const { offer, c } = await connectedOffer(actor, offerId);
  const item = itemSchema.parse(await api(c, "/items/" + offer.ml_id));
  if (String(item.seller_id) !== c.external_account || item.id !== offer.ml_id)
    throw new HttpError(403, "O anúncio pertence a outra conta");
  const visit = z
    .object({
      total_visits: z.number().int().nonnegative(),
      date_from: z.string(),
      date_to: z.string(),
    })
    .parse(
      await api(
        c,
        `/items/${offer.ml_id}/visits/time_window?last=${days}&unit=day`,
      ),
    );
  const from = Date.parse(visit.date_from),
    to = Date.parse(visit.date_to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > (days + 2) * 86400000 ||
    to > Date.now() + 86400000
  )
    throw new HttpError(
      502,
      "O período das visitas retornado pelo Mercado Livre é inválido",
    );
  const orderIds = new Set<number>();
  let orders = 0,
    units = 0,
    gross = new Decimal(0),
    offset = 0,
    total = 0;
  do {
    const query = new URLSearchParams({
      seller: c.external_account,
      "order.status": "paid",
      "order.date_created.from": new Date(from).toISOString(),
      "order.date_created.to": new Date(to).toISOString(),
      limit: "50",
      offset: String(offset),
    });
    const page = z
      .object({
        paging: z.object({ total: z.number().int().nonnegative() }),
        results: z.array(
          z.object({
            id: z.number().int(),
            status: z.string(),
            date_created: z.string(),
            seller: z.object({ id: z.number().int() }),
            currency_id: z.string(),
            order_items: z.array(
              z.object({
                item: z.object({ id: z.string() }),
                quantity: z.number().int().positive(),
                unit_price: z.number().finite().nonnegative(),
              }),
            ),
          }),
        ),
      })
      .parse(await api(c, "/orders/search?" + query));
    total = page.paging.total;
    if (total > 1000)
      throw new HttpError(
        422,
        "O período tem mais de 1.000 pedidos; será necessário processamento em lotes para calcular as métricas completas",
      );
    for (const order of page.results) {
      if (String(order.seller.id) !== c.external_account)
        throw new HttpError(403, "A consulta retornou pedidos de outra conta");
      if (orderIds.has(order.id)) continue;
      orderIds.add(order.id);
      const created = Date.parse(order.date_created);
      if (!Number.isFinite(created))
        throw new HttpError(
          502,
          "Pedido com data inválida retornado pelo Mercado Livre",
        );
      if (order.status !== "paid" || created < from || created > to) continue;
      const lines = order.order_items.filter(
        (line) => line.item.id === offer.ml_id,
      );
      if (!lines.length) continue;
      if (order.currency_id !== "BRL")
        throw new HttpError(
          422,
          "Há pedidos em outra moeda; confira antes de calcular a receita",
        );
      orders++;
      for (const line of lines) {
        units += line.quantity;
        gross = gross.plus(new Decimal(line.unit_price).mul(line.quantity));
      }
    }
    offset += page.results.length;
    if (!page.results.length && offset < total)
      throw new HttpError(
        502,
        "A API de pedidos retornou um período incompleto; nenhuma métrica parcial foi salva",
      );
  } while (offset < total);
  let unanswered: number | null = null;
  try {
    unanswered = z.object({ total: z.number().int().nonnegative() }).parse(
      await api(
        c,
        "/questions/search?" +
          new URLSearchParams({
            seller_id: c.external_account,
            item: offer.ml_id,
            status: "UNANSWERED",
            api_version: "4",
          }),
      ),
    ).total;
  } catch {}
  const metrics = {
    store_id: offer.store_id,
    offer_id: offerId,
    seller_id: c.external_account,
    connection_id: c.id,
    auth_version: c.auth_version,
    periodDays: days,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    visits: visit.total_visits,
    paidOrders: orders,
    units,
    grossRevenue: gross.toFixed(2),
    orderVisitRate:
      visit.total_visits > 0
        ? new Decimal(orders).div(visit.total_visits).mul(100).toFixed(2)
        : null,
    unansweredQuestions: unanswered,
    observed_at: now(),
    source: "Mercado Livre · visitas e pedidos pagos criados no período",
  };
  await transaction(async () => {
    const current = await get("offers", offerId),
      currentConnection = await connection(actor, c.id);
    if (
      current?.ml_id !== offer.ml_id ||
      currentConnection.auth_version !== c.auth_version
    )
      throw new HttpError(
        409,
        "A oferta ou a conexão mudou durante a consulta de métricas",
      );
    await put(days === 7 ? "ml_metrics_7d" : "ml_metrics", offerId, metrics);
  });
  return metrics;
}
export async function createQualityTask(
  actor: Actor,
  offerId: string,
  payload: unknown,
) {
  canWrite(actor);
  const p = z.object({ issueKey: z.string().min(1).max(200) }).parse(payload);
  return transaction(async () => {
    const offer = await get("offers", offerId);
    if (!offer) throw new HttpError(404, "Anúncio não encontrado");
    authorizeStore(actor, offer.store_id);
    const product = await get("products", offer.product_id),
      brand = product?.brand_id ? await get("brands", product.brand_id) : null;
    const issue = listingQuality({ ...offer, brand: brand?.name }).find(
      (i) => i.key === p.issueKey,
    );
    if (!issue)
      throw new HttpError(
        409,
        "Esta pendência já não existe; atualize a ficha",
      );
    const taskId = key("ml.quality", offerId, p.issueKey),
      existing = await get("tasks", taskId);
    if (existing && !["done", "cancelled"].includes(existing.status))
      return existing;
    const task = {
      source_quality_key: p.issueKey,
      organization_id: actor.organization_id,
      store_id: offer.store_id,
      offer_id: offerId,
      title: issue.title,
      description: issue.action,
      type: "qualidade",
      priority: issue.priority,
      status: "todo",
      assignee: actor.name,
      due_date: null,
      reason: "Checklist de qualidade do anúncio",
      result: "",
      evidence: "",
      version: (existing?.version || 0) + 1,
      created_at: existing?.created_at || now(),
      updated_at: now(),
    };
    await put("tasks", taskId, task);
    await audit(
      actor,
      offer.store_id,
      offerId,
      "task.quality",
      existing || null,
      task,
      "Pendência convertida em ação",
    );
    return { ...task, id: taskId };
  });
}

// Optional catalogue competition is a separate official resource. Never infer
// winning/losing the catalogue from sales trends or set price from this response.
export async function refreshCompetition(
  actor: Actor,
  offerId: string,
  deadline = Date.now() + 45000,
) {
  canWrite(actor);
  return requestDeadline.run(deadline, async () => {
    const { offer, c } = await connectedOffer(actor, offerId);
    const item = itemSchema.parse(await api(c, "/items/" + offer.ml_id));
    if (
      item.id !== offer.ml_id ||
      String(item.seller_id) !== c.external_account
    )
      throw new HttpError(403, "Anúncio de outro vendedor");
    if (!item.catalog_listing || item.currency_id !== "BRL")
      throw new HttpError(
        422,
        "A competição está disponível para anúncios próprios de catálogo em BRL",
      );
    const price = z.number().finite().positive();
    const result = z
      .object({
        item_id: z.string(),
        status: z.string().min(1).max(100),
        price_to_win: price.nullable().optional(),
        current_price: price.nullable().optional(),
        consistent: z.boolean().optional(),
      })
      .parse(
        await api(
          c,
          `/items/${offer.ml_id}/price_to_win?siteId=MLB&version=v2`,
        ),
      );
    if (result.item_id !== offer.ml_id)
      throw new HttpError(
        502,
        "A competição retornada não corresponde ao anúncio",
      );
    const snapshot = {
      organization_id: actor.organization_id,
      offer_id: offerId,
      store_id: offer.store_id,
      seller_id: c.external_account,
      auth_version: c.auth_version,
      offer_version: offer.version,
      status: result.status,
      priceToWin:
        result.price_to_win == null
          ? null
          : new Decimal(result.price_to_win).toFixed(2),
      currentPrice:
        result.current_price == null
          ? null
          : new Decimal(result.current_price).toFixed(2),
      consistent: result.consistent ?? null,
      observed_at: now(),
      source: "Mercado Livre · price_to_win",
    };
    return transaction(async () => {
      const current = await get("offers", offerId),
        account = await connection(actor, c.id);
      if (
        current?.version !== offer.version ||
        current?.ml_id !== offer.ml_id ||
        account.auth_version !== c.auth_version ||
        account.external_account !== c.external_account
      )
        throw new HttpError(
          409,
          "O contexto mudou; consulte novamente a competição",
        );
      return put("ml_competition", offerId, snapshot);
    });
  });
}
