import {
  randomBytes,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { admin, authorizeStore, HttpError, type Actor } from "./access";
import { get, put, find, key, now, transaction, type Row } from "./db";
import { encryptSecret, decryptSecret, integrationUrls } from "./mercadolivre";
import type { MediaStorage } from "./listing-media";
const API = "https://www.googleapis.com/drive/v3";
const scope = "openid email https://www.googleapis.com/auth/drive.file";
const fileId = z.string().regex(/^[\w-]{5,200}$/);
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string().toLowerCase().pipe(z.literal("bearer")),
});
export function redirectUri() {
  return new URL(
    "/api/google-drive/callback",
    integrationUrls().redirectUri,
  ).toString();
}
function connectionId(actor: Actor, storeId: string) {
  return key(actor.organization_id, storeId, "google-drive");
}
async function own(actor: Actor, storeId: string) {
  authorizeStore(actor, storeId);
  const id = connectionId(actor, storeId),
    row = await get("drive_integrations", id);
  if (row && row.organization_id !== actor.organization_id)
    throw new HttpError(404, "Integração não encontrada");
  return { id, row };
}
function projection(storeId: string, row?: Row) {
  return {
    store_id: storeId,
    version: row?.version || 0,
    clientId: row?.client_id || "",
    folderName: row?.folder_name || "",
    configured: !!row?.application,
    status: row?.status || "unconfigured",
    email: row?.email || null,
    folderUrl: row?.folder_id
      ? "https://drive.google.com/drive/folders/" + row.folder_id
      : null,
    redirectUri: redirectUri(),
  };
}
export async function list(actor: Actor, store = "all") {
  if (store !== "all") authorizeStore(actor, store);
  return Promise.all(
    actor.stores
      .filter((s) => store === "all" || s.id === store)
      .map(async (s) => projection(s.id, (await own(actor, s.id)).row)),
  );
}
export async function configure(
  actor: Actor,
  storeId: string,
  values: unknown,
) {
  admin(actor);
  const p = z
    .object({
      clientId: z
        .string()
        .trim()
        .max(200)
        .regex(/^[\w-]+\.apps\.googleusercontent\.com$/),
      clientSecret: z.string().trim().max(512).default(""),
      folderName: z.string().trim().min(1).max(100),
      version: z.number().int().nonnegative(),
    })
    .parse(values);
  const { id } = await own(actor, storeId);
  return transaction(async () => {
    const current = (await own(actor, storeId)).row;
    if ((current?.version || 0) !== p.version)
      throw new HttpError(409, "A integração mudou; atualize antes de salvar");
    const credentials = current?.application
      ? decryptSecret(current.application, "drive-app:" + id)
      : null;
    const secret =
      p.clientSecret ||
      (current?.client_id === p.clientId ? credentials?.clientSecret : "");
    if (!secret) throw new HttpError(422, "Informe o segredo OAuth do Google");
    const changed =
      current?.client_id !== p.clientId ||
      (p.clientSecret && p.clientSecret !== credentials?.clientSecret);
    if (
      current?.client_id &&
      current.client_id !== p.clientId &&
      (await find("listing_media", { store_id: storeId })).some(
        (r) =>
          r.organization_id === actor.organization_id &&
          ["ready", "uploading", "deleting"].includes(r.status),
      )
    )
      throw new HttpError(
        409,
        "Esta loja possui rascunhos no cliente Google anterior. Remova os rascunhos antes de trocar o Client ID.",
      );
    const row = {
      ...current,
      id,
      organization_id: actor.organization_id,
      store_id: storeId,
      client_id: p.clientId,
      application: encryptSecret({ clientSecret: secret }, "drive-app:" + id),
      folder_name: p.folderName,
      version: p.version + 1,
      tokens: changed ? null : current?.tokens || null,
      status: changed ? "unauthorized" : current?.status || "unauthorized",
      updated_at: now(),
    };
    await put("drive_integrations", id, row);
    return projection(storeId, row);
  });
}
async function google(url: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HttpError(
      503,
      "O Google Drive não respondeu. Tente novamente em instantes.",
    );
  }
  if (!response.ok) {
    if (response.status === 404)
      throw new HttpError(
        404,
        "Arquivo ou pasta não encontrado no Google Drive",
      );
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.error === "invalid_grant")
      throw new HttpError(
        401,
        "A autorização do Google Drive expirou ou foi revogada. Conecte novamente.",
      );
    throw new HttpError(
      response.status === 429 ? 429 : 503,
      response.status === 429
        ? "O Google Drive limitou as consultas; aguarde e tente novamente."
        : "Não foi possível acessar o Google Drive. Confira a API ativada, as permissões da conta e o espaço disponível.",
    );
  }
  return response;
}
async function exchange(row: Row, values: Record<string, string>) {
  const credentials = decryptSecret(row.application, "drive-app:" + row.id);
  const response = await google("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: row.client_id,
      client_secret: credentials.clientSecret,
      ...values,
    }),
  });
  const result = tokenSchema.safeParse(await response.json());
  if (!result.success)
    throw new HttpError(
      502,
      "O Google não retornou credenciais válidas; conecte novamente a conta.",
    );
  return result.data;
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export async function startAuthorization(
  actor: Actor,
  storeId: string,
  channel: string,
) {
  admin(actor);
  z.uuid().parse(channel);
  const { id, row } = await own(actor, storeId);
  if (!row?.application)
    throw new HttpError(
      422,
      "Configure primeiro as credenciais OAuth do Google Drive",
    );
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  await put("drive_oauth_states", digest(state), {
    organization_id: actor.organization_id,
    actor_id: actor.id,
    store_id: storeId,
    connection_id: id,
    version: row.version,
    channel,
    verifier: encryptSecret(verifier, "drive-state:" + digest(state)),
    expires_at: Date.now() + 600000,
    status: "pending",
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: row.client_id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    include_granted_scopes: "true",
  }).toString();
  return { state, url: url.toString() };
}
export async function authorizationContext(
  actor: Actor,
  params: URLSearchParams,
  cookie: string | undefined,
) {
  const state = params.get("state");
  if (
    !state ||
    state.length > 200 ||
    !cookie ||
    !timingSafeEqual(Buffer.from(digest(state)), Buffer.from(digest(cookie)))
  )
    throw new HttpError(
      403,
      "A autorização não pertence a este navegador; conecte novamente",
    );
  const row = await get("drive_oauth_states", digest(state));
  if (
    !row ||
    row.organization_id !== actor.organization_id ||
    row.actor_id !== actor.id ||
    row.expires_at < Date.now()
  )
    throw new HttpError(
      403,
      "A autorização do Drive expirou; conecte novamente",
    );
  authorizeStore(actor, row.store_id);
  return row;
}
async function apiWithToken(
  token: string,
  path: string,
  options: RequestInit = {},
) {
  return google(API + path, {
    ...options,
    headers: { ...options.headers, Authorization: "Bearer " + token },
  });
}
async function generatedId(token: string) {
  const data = await (
    await apiWithToken(
      token,
      "/files/generateIds?count=1&space=drive&type=files",
    )
  ).json();
  return fileId.parse(data.ids?.[0]);
}
export async function finishAuthorization(
  actor: Actor,
  params: URLSearchParams,
  cookie: string | undefined,
) {
  admin(actor);
  const state = await authorizationContext(actor, params, cookie);
  if (params.get("error")) {
    await transaction(async () => {
      const current = await get("drive_oauth_states", state.id);
      if (current?.status === "pending")
        await put("drive_oauth_states", state.id, {
          ...current,
          status: "cancelled",
          verifier: null,
        });
    });
    throw new HttpError(422, "Autorização do Google Drive cancelada");
  }
  const code = z.string().min(1).max(4000).parse(params.get("code"));
  await transaction(async () => {
    const current = await get("drive_oauth_states", state.id),
      integration = (await own(actor, state.store_id)).row;
    if (current?.status !== "pending" || integration?.version !== state.version)
      throw new HttpError(
        409,
        "Esta autorização já foi usada ou a configuração mudou",
      );
    await put("drive_oauth_states", state.id, {
      ...current,
      status: "processing",
      verifier: null,
    });
  });
  const { row } = await own(actor, state.store_id);
  const tokens = await exchange(row!, {
    code,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: decryptSecret(state.verifier, "drive-state:" + state.id),
  });
  if (!tokens.refresh_token)
    throw new HttpError(
      422,
      "O Google não retornou acesso offline. Revogue o acesso anterior ao Datamat no Google e conecte novamente para renovar a autorização.",
    );
  const identity = z
    .object({
      sub: z.string().min(1),
      email: z.email(),
      email_verified: z.literal(true),
    })
    .parse(
      await (
        await google("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: "Bearer " + tokens.access_token },
        })
      ).json(),
    );
  if (
    row?.subject &&
    row.subject !== identity.sub &&
    (await find("listing_media", { store_id: state.store_id })).some(
      (r) =>
        r.organization_id === actor.organization_id &&
        ["ready", "uploading", "deleting"].includes(r.status),
    )
  )
    throw new HttpError(
      409,
      "Esta loja possui arquivos na conta anterior. Use a mesma conta Google ou remova os rascunhos antes de trocar.",
    );
  let folderId = row?.subject === identity.sub ? row.folder_id : null;
  if (folderId) {
    const folder = await (
      await apiWithToken(
        tokens.access_token,
        "/files/" +
          encodeURIComponent(folderId) +
          "?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true",
      )
    ).json();
    if (
      folder.trashed ||
      folder.mimeType !== "application/vnd.google-apps.folder" ||
      folder.capabilities?.canAddChildren !== true
    )
      throw new HttpError(
        422,
        "A pasta do Datamat não está disponível para envio; restaure a pasta e conecte novamente",
      );
  } else {
    folderId = await generatedId(tokens.access_token);
    await apiWithToken(
      tokens.access_token,
      "/files?fields=id&supportsAllDrives=true",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: folderId,
          name: row!.folder_name,
          mimeType: "application/vnd.google-apps.folder",
          appProperties: { datamat_connection: row!.id },
        }),
      },
    );
  }
  return transaction(async () => {
    const current = (await own(actor, state.store_id)).row;
    if (!current || current.version !== state.version)
      throw new HttpError(
        409,
        "A configuração mudou durante a autorização; conecte novamente",
      );
    if (
      current.subject &&
      current.subject !== identity.sub &&
      (await find("listing_media", { store_id: state.store_id })).some(
        (r) =>
          r.organization_id === actor.organization_id &&
          ["ready", "uploading", "deleting"].includes(r.status),
      )
    )
      throw new HttpError(
        409,
        "Esta loja possui arquivos na conta anterior; conecte a mesma conta Google",
      );
    const updated = {
      ...current,
      version: current.version + 1,
      tokens: encryptSecret(
        { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 },
        "drive-tokens:" + current.id,
      ),
      token_version: randomUUID(),
      subject: identity.sub,
      email: identity.email,
      folder_id: folderId,
      status: "connected",
      updated_at: now(),
    };
    await put("drive_integrations", current.id, updated);
    await put("drive_oauth_states", state.id, {
      ...state,
      status: "completed",
      verifier: null,
    });
    return projection(state.store_id, updated);
  });
}
export async function disconnect(
  actor: Actor,
  storeId: string,
  version: unknown,
) {
  admin(actor);
  const p = z.number().int().positive().parse(version);
  return transaction(async () => {
    const { id, row } = await own(actor, storeId);
    if (row?.version !== p)
      throw new HttpError(
        409,
        "A integração mudou; atualize antes de desconectar",
      );
    const updated = {
      ...row,
      tokens: null,
      status: "unauthorized",
      version: p + 1,
      token_version: randomUUID(),
      updated_at: now(),
    };
    await put("drive_integrations", id, updated);
    return projection(storeId, updated);
  });
}
async function access(
  actor: Actor,
  storeId: string,
): Promise<{ row: Row; token: string }> {
  const { row } = await own(actor, storeId);
  if (!row?.tokens || row.status !== "connected")
    throw new HttpError(
      422,
      "Conecte o Google Drive desta loja em Configurações → Integrações",
    );
  const tokens = decryptSecret(row.tokens, "drive-tokens:" + row.id);
  if (tokens.expires_at > Date.now() + 60000)
    return { row, token: tokens.access_token as string };
  let refreshed;
  try {
    refreshed = await exchange(row, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      await transaction(async () => {
        const current = (await own(actor, storeId)).row;
        if (current?.token_version === row.token_version)
          await put("drive_integrations", row.id, {
            ...current,
            status: "unauthorized",
          });
      });
    throw error;
  }
  const updated: Row = await transaction(async () => {
    const current = (await own(actor, storeId)).row;
    if (
      !current ||
      current.version !== row.version ||
      current.status !== "connected"
    )
      throw new HttpError(409, "A conexão do Drive mudou durante a renovação");
    // Google usually omits refresh_token on refresh; preserve the existing one.
    if (current.token_version !== row.token_version) return current;
    const updated = {
      ...current,
      tokens: encryptSecret(
        {
          ...refreshed,
          refresh_token: refreshed.refresh_token || tokens.refresh_token,
          expires_at: Date.now() + refreshed.expires_in * 1000,
        },
        "drive-tokens:" + row.id,
      ),
      token_version: randomUUID(),
    };
    await put("drive_integrations", row.id, updated);
    return updated;
  });
  return {
    row: updated,
    token: decryptSecret(updated.tokens, "drive-tokens:" + row.id)
      .access_token as string,
  };
}
export async function storageStatus(actor: Actor, storeId: string) {
  const { row } = await own(actor, storeId);
  return {
    status: row?.status === "connected" ? "ready" : "missing",
    provider: "google-drive",
    configureUrl:
      "/configuracoes?" +
      new URLSearchParams({ store: storeId, configTab: "integrations" }),
    folderUrl: row?.folder_id
      ? "https://drive.google.com/drive/folders/" + row.folder_id
      : null,
  };
}
// Logical object paths never leave the server. A reserved Google ID allows
// confirmation after a lost upload acknowledgement without uploading twice.
export function driveStorage(actor: Actor, storeId: string): MediaStorage {
  const mappingId = (path: string) => key(actor.organization_id, storeId, path);
  async function ownedObject(path: string, row: Row) {
    const object = await get("drive_objects", mappingId(path));
    if (
      !object ||
      object.organization_id !== actor.organization_id ||
      object.store_id !== storeId ||
      object.subject !== row.subject ||
      object.client_id !== row.client_id
    )
      throw new HttpError(
        409,
        "O arquivo pertence à conexão anterior do Google Drive",
      );
    return object;
  }
  async function metadata(token: string, object: Row) {
    const meta = await (
      await apiWithToken(
        token,
        "/files/" +
          encodeURIComponent(fileId.parse(object.file_id)) +
          "?fields=id,trashed,appProperties,size,mimeType,md5Checksum&supportsAllDrives=true",
      )
    ).json();
    if (
      meta.appProperties?.datamat_path !== object.path_hash ||
      meta.appProperties?.datamat_store !== storeId
    )
      throw new HttpError(403, "O arquivo não pertence ao Datamat desta loja");
    return meta;
  }
  return {
    async save(path, bytes, type, name) {
      const { row, token } = await access(actor, storeId);
      const id = await generatedId(token),
        pathHash = digest(path);
      const object = {
        organization_id: actor.organization_id,
        store_id: storeId,
        subject: row.subject,
        client_id: row.client_id,
        file_id: id,
        path_hash: pathHash,
        bytes: bytes.length,
        md5: createHash("md5").update(bytes).digest("hex"),
        type,
        created_at: now(),
      };
      await put("drive_objects", mappingId(path), object);
      const boundary = "datamat-" + randomUUID();
      const meta = {
        id,
        name: name || path.split("/").slice(-2).join("-"),
        mimeType: type,
        parents: [fileId.parse(row.folder_id)],
        appProperties: { datamat_path: pathHash, datamat_store: storeId },
      };
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      try {
        const created = await (
          await google(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true",
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "multipart/related; boundary=" + boundary,
              },
              body: new Uint8Array(body),
            },
          )
        ).json();
        if (created.id !== id)
          throw new HttpError(
            502,
            "O Google Drive retornou um arquivo diferente do reservado",
          );
      } catch (error) {
        const observed = await metadata(token, object).catch(() => null);
        if (
          !observed ||
          observed.trashed ||
          Number(observed.size) !== bytes.length ||
          observed.mimeType !== type ||
          observed.md5Checksum !== object.md5
        )
          throw error;
      }
    },
    async read(path) {
      const { row, token } = await access(actor, storeId),
        object = await ownedObject(path, row);
      const meta = await metadata(token, object);
      if (
        meta.trashed ||
        Number(meta.size) !== object.bytes ||
        meta.mimeType !== object.type ||
        meta.md5Checksum !== object.md5
      )
        throw new HttpError(
          409,
          "O arquivo foi alterado no Drive; prepare um novo rascunho",
        );
      const response = await apiWithToken(
        token,
        "/files/" +
          encodeURIComponent(object.file_id) +
          "?alt=media&supportsAllDrives=true",
      );
      const reader = response.body?.getReader();
      if (!reader) throw new HttpError(502, "O Drive não retornou o arquivo");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 3 * 1024 * 1024 || size > object.bytes) {
          await reader.cancel();
          throw new HttpError(413, "O arquivo excede o tamanho registrado");
        }
        chunks.push(part.value);
      }
      if (size !== object.bytes)
        throw new HttpError(502, "O arquivo do Drive chegou incompleto");
      const bytes = Buffer.concat(chunks);
      if (createHash("md5").update(bytes).digest("hex") !== object.md5)
        throw new HttpError(
          409,
          "O conteúdo do arquivo foi alterado no Google Drive",
        );
      return bytes;
    },
    async remove(path) {
      const { row, token } = await access(actor, storeId),
        object = await ownedObject(path, row);
      try {
        await metadata(token, object);
        await apiWithToken(
          token,
          "/files/" +
            encodeURIComponent(object.file_id) +
            "?supportsAllDrives=true",
          { method: "DELETE" },
        );
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 404)) throw error;
      }
    },
  };
}
