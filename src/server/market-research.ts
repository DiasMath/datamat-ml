import { randomUUID } from "node:crypto";
import { z } from "zod";
import { admin, authorizeStore, HttpError, type Actor } from "./access";
import { get, key, put, transaction, type Row } from "./db";
import { withSellerData, withMLAccessDiagnostics } from "./mercadolivre";
import { safeAccessDiagnostic } from "../domain/ml-access-diagnostic";
import {
  marketResourceSchema,
  marketPath,
  normalizeMarketData,
  marketFailure,
  type MarketResource,
  type MarketObservation,
} from "../domain/market-research";

export const marketRequestSchema = z
  .object({
    storeId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    applicationId: z.string().regex(/^\d{1,30}$/),
    resource: marketResourceSchema,
  })
  .strict();
export const diagnosticRequestSchema = marketRequestSchema.omit({
  resource: true,
});
function assertConnectionSnapshot(account: Row, expected: Row) {
  if (
    account.auth_version !== expected.auth_version ||
    account.external_account !== expected.external_account ||
    account.application_id !== expected.application_id
  )
    throw new HttpError(409, "A conta ou aplicação mudou durante a consulta");
}

async function marketConnection(
  actor: Actor,
  storeId: string,
  applicationId: string,
) {
  authorizeStore(actor, storeId);
  admin(actor);
  const connection = await get("connections", key(storeId, "mercadolivre"));
  if (
    !connection ||
    connection.store_id !== storeId ||
    connection.provider !== "mercadolivre" ||
    connection.application_id !== applicationId ||
    connection.status !== "connected" ||
    !connection.external_account
  )
    throw new HttpError(
      409,
      "Esta loja não tem conexão ativa com a aplicação esperada",
    );
  return connection;
}
// One operation per connection across processes/server instances. No cache can
// silently substitute a different observation date for a market snapshot.
async function marketOperation<T>(
  connection: Row,
  read: () => Promise<T>,
  pause: (result: T) => boolean,
): Promise<T> {
  const owner = randomUUID(),
    id = connection.id;
  await transaction(async () => {
    const current = await get("connections", id);
    const state = await get("ml_market_operations", id);
    if (
      !current ||
      current.status !== "connected" ||
      current.auth_version !== connection.auth_version ||
      current.external_account !== connection.external_account ||
      current.application_id !== connection.application_id
    )
      throw new HttpError(409, "A conexão mudou; consulte novamente a loja");
    if (
      state &&
      state.auth_version === connection.auth_version &&
      (state.lease_until > Date.now() || state.next_at > Date.now())
    )
      throw new HttpError(
        429,
        "Já existe uma consulta ou pausa nesta loja; aguarde antes de retomar",
      );
    await put("ml_market_operations", id, {
      owner,
      auth_version: connection.auth_version,
      lease_until: Date.now() + 90000,
      next_at: 0,
    });
  });
  let delay = 2000;
  try {
    const result = await read();
    if (pause(result)) delay = 60000;
    return result;
  } finally {
    await transaction(async () => {
      const state = await get("ml_market_operations", id);
      if (state?.owner === owner)
        await put("ml_market_operations", id, {
          ...state,
          lease_until: 0,
          next_at: Date.now() + delay,
        });
    });
  }
}

export async function readMarketResource(
  actor: Actor,
  storeId: string,
  applicationId: string,
  input: MarketResource,
): Promise<MarketObservation> {
  authorizeStore(actor, storeId);
  const resource = marketResourceSchema.parse(input);
  const connection = await marketConnection(actor, storeId, applicationId);
  return marketOperation(
    connection,
    async () => {
      try {
        const data = await withSellerData(
          actor,
          connection.id,
          async (request, account) => {
            assertConnectionSnapshot(account, connection);
            return normalizeMarketData(
              resource,
              await request(marketPath(resource)),
            );
          },
          Date.now() + 30000,
        );
        return {
          resource,
          source: `https://api.mercadolibre.com${marketPath(resource)}`,
          collected_at: new Date().toISOString(),
          status: "ok",
          http_status: 200,
          data,
          note: null,
        };
      } catch (error) {
        return marketFailure(resource, error);
      }
    },
    (result) => !["ok", "unavailable"].includes(result.status),
  );
}

export async function diagnoseMarketAccess(actor: Actor, payload: unknown) {
  const p = diagnosticRequestSchema.parse(payload);
  const connection = await marketConnection(actor, p.storeId, p.applicationId);
  return marketOperation(
    connection,
    async () => {
      const startedAt = new Date().toISOString();
      const observations: Awaited<ReturnType<typeof safeAccessDiagnostic>>[] =
        [];
      try {
        const response = await fetch("https://api.mercadolibre.com/sites/MLB", {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        observations.push(
          await safeAccessDiagnostic(response, "/sites/MLB", false),
        );
      } catch {
        /* Own-account verification remains useful after a network failure. */
      }
      const measured = await withMLAccessDiagnostics(async () => {
        try {
          return await withSellerData(
            actor,
            connection.id,
            async (request, account) => {
              assertConnectionSnapshot(account, connection);
              const value = await request("/users/me");
              if (!value || typeof value !== "object" || !("id" in value))
                return null;
              return String(value.id) === String(account.external_account);
            },
            Date.now() + 30000,
          );
        } catch {
          return null;
        }
      });
      observations.push(...measured.observations);
      return {
        store_id: p.storeId,
        application_id: p.applicationId,
        started_at: startedAt,
        collected_at: new Date().toISOString(),
        account_matches_connected_seller: measured.result,
        observations,
        note:
          measured.result === true
            ? "A própria conta respondeu corretamente neste servidor. O acesso aos recursos de mercado precisa ser validado separadamente."
            : "A própria conta não pôde ser confirmada neste servidor. HTML 403 sem erro JSON não identifica a causa da negativa.",
      };
    },
    (result) => result.account_matches_connected_seller !== true,
  );
}
