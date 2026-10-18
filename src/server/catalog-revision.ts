import { authorizeStore, HttpError, type Actor } from "./access";
import { get, key } from "./db";
export const AUTOMATIC_CATALOG_INTERVAL = 30 * 60000;
export async function storeRevision(ids: string[]) {
  const rows = await Promise.all(
    [...new Set(ids)]
      .sort()
      .map(async (id) => [
        id,
        (await get("_today_revisions", id))?.revision || 0,
      ]),
  );
  return JSON.stringify(rows);
}
export async function catalogRevision(
  actor: Actor,
  query: URLSearchParams,
  clock = Date.now(),
) {
  const store = query.get("store") || "all";
  if (store !== "all") authorizeStore(actor, store);
  const ids = actor.stores
    .filter((s) => store === "all" || s.id === store)
    .map((s) => s.id);
  const [revision, account] = await Promise.all([
    storeRevision(ids),
    store !== "all"
      ? get("connections", key(store, "mercadolivre"))
      : undefined,
  ]);
  let refreshed =
    account?.last_catalog_completed_at ||
    (!account?.has_more && !account?.pending_batch
      ? account?.last_catalog_sync_at
      : null);
  if (query.get("offerId")) {
    const offer = await get("offers", query.get("offerId")!);
    if (
      !offer ||
      offer.organization_id !== actor.organization_id ||
      offer.store_id !== store
    )
      throw new HttpError(404, "Anúncio não encontrado nesta loja");
    refreshed = offer.ml?.observedAt;
  }
  const observed = Date.parse(refreshed);
  return {
    revision,
    refreshDue:
      store !== "all" &&
      account?.status === "connected" &&
      !(account?.sync_until > clock) &&
      (!Number.isFinite(observed) ||
        clock - observed >= AUTOMATIC_CATALOG_INTERVAL),
    running: !!account && account.sync_until > clock,
  };
}
