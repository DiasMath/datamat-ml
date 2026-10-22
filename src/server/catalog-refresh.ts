import { AUTOMATIC_CATALOG_INTERVAL } from "./catalog-revision";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { admin, authorizeStore, HttpError, type Actor } from "./access";
import { get, key } from "./db";
import { syncListings } from "./mercadolivre";
export async function refreshCatalog(
  actor: Actor,
  query: URLSearchParams,
  payload: unknown,
) {
  admin(actor);
  const p = z
      .object({
        offerId: z.string().min(1).max(200).optional(),
        automatic: z.boolean().default(false),
        restart: z.boolean().default(false),
        completedStoreIds: z
          .array(z.string().min(1).max(200))
          .max(100)
          .default([]),
      })
      .strict()
      .parse(payload),
    store = query.get("store") || "all";
  if (store !== "all") authorizeStore(actor, store);
  for (const completed of p.completedStoreIds) {
    authorizeStore(actor, completed);
    if (store !== "all" && store !== completed)
      throw new HttpError(422, "Loja concluída fora do filtro selecionado");
  }
  if (p.offerId && p.completedStoreIds.length)
    throw new HttpError(422, "A consulta isolada não pode ignorar lojas");
  const offer = p.offerId ? await get("offers", p.offerId) : null;
  if (p.offerId) {
    if (!offer || offer.organization_id !== actor.organization_id)
      throw new HttpError(404, "Anúncio não encontrado");
    authorizeStore(actor, offer.store_id);
    if (store !== "all" && store !== offer.store_id)
      throw new HttpError(422, "Loja divergente");
    if (offer.origin === "reference" || !/^MLB\d+$/.test(offer.ml_id || ""))
      throw new HttpError(422, "Selecione um anúncio próprio do ML");
  }
  const selectedStore = offer?.store_id || store;
  if (selectedStore === "all")
    throw new HttpError(422, "Selecione uma loja para atualizar o catálogo");
  const results: Array<Record<string, any>> = [],
    deadline = Date.now() + 55000;
  const selected = actor.stores.filter(
    (s) =>
      (!offer || s.id === offer.store_id) &&
      s.id === selectedStore &&
      !p.completedStoreIds.includes(s.id),
  );
  const accounts = (
    await Promise.all(
      selected.map((s) => get("connections", key(s.id, "mercadolivre"))),
    )
  )
    .filter((c) => c?.status === "connected")
    .sort((a, b) =>
      String(a?.last_catalog_sync_at || "").localeCompare(
        String(b?.last_catalog_sync_at || ""),
      ),
    );
  let truncated = false;
  for (const c of accounts) {
    if (Date.now() > deadline - 5000) {
      truncated = true;
      break;
    }
    if (!c) continue;
    const observed = Date.parse(
      offer
        ? offer.ml?.observedAt
        : c.last_catalog_completed_at ||
            (!c.has_more && !c.pending_batch ? c.last_catalog_sync_at : null),
    );
    if (
      p.automatic &&
      !p.restart &&
      !c.has_more &&
      !c.pending_batch &&
      Number.isFinite(observed) &&
      Date.now() - observed < AUTOMATIC_CATALOG_INTERVAL
    ) {
      results.push({
        storeId: c.store_id,
        status: "confirmed",
        has_more: false,
        processed: 0,
        skipped: true,
      });
      continue;
    }

    if (!offer && c.sync_until > Date.now()) {
      results.push({ storeId: c.store_id, status: "running", has_more: true });
      continue;
    }
    if (
      offer &&
      (offer.ml?.sellerId !== c.external_account ||
        offer.ml?.authVersion !== c.auth_version)
    )
      throw new HttpError(
        409,
        "A autorização mudou; sincronize a loja antes de consultar este anúncio",
      );
    const result = await syncListings(
      actor,
      c.id,
      {
        requestId: randomUUID(),
        restart: p.restart,
        ...(offer ? { itemIds: [offer.ml_id] } : {}),
      },
      deadline,
    );
    if (result.status !== "confirmed")
      throw new HttpError(
        502,
        result.message || "Consulta do catálogo incompleta; tente novamente",
      );
    results.push({ storeId: c.store_id, ...result });
  }
  if (!results.length && !p.completedStoreIds.includes(selectedStore))
    throw new HttpError(
      401,
      "Autorize a conta ML desta loja antes de consultar",
    );
  return {
    results,
    partial:
      truncated || results.some((r) => r.has_more || r.status !== "confirmed"),
  };
}
