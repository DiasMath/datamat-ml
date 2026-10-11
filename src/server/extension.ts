import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { admin, authorizeStore, HttpError, type Actor } from "./access";
import { find, get, put, now, key, transaction } from "./db";
import { saveCompetitor } from "./competitors";
import { offerDetail } from "./services";

const tokenId = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function extensionDevices(actor: Actor) {
  admin(actor);
  const rows = await find("extension_devices", {
    organization_id: actor.organization_id,
  });
  return rows
    .filter((r) => actor.stores.some((s) => s.id === r.store_id))
    .map(
      ({ id, name, store_id, origin, expires_at, revoked_at, created_at }) => ({
        id,
        name,
        store_id,
        origin,
        expires_at,
        revoked_at,
        created_at,
      }),
    );
}
export async function pairExtension(actor: Actor, payload: unknown) {
  admin(actor);
  const p = z
    .object({
      storeId: z.string().max(200),
      name: z.string().trim().min(1).max(80),
      extensionId: z.string().regex(/^[a-p]{32}$/),
    })
    .parse(payload);
  authorizeStore(actor, p.storeId);
  const token = randomBytes(32).toString("base64url"),
    id = tokenId(token),
    expiresAt = Date.now() + 30 * 86400000;
  await put("extension_devices", id, {
    organization_id: actor.organization_id,
    store_id: p.storeId,
    name: p.name,
    origin: `chrome-extension://${p.extensionId}`,
    expires_at: expiresAt,
    created_at: now(),
    revoked_at: null,
  });
  return { token, expiresAt };
}
export async function revokeExtension(actor: Actor, id: string) {
  admin(actor);
  return transaction(async () => {
    const row = await get("extension_devices", id);
    if (!row || row.organization_id !== actor.organization_id)
      throw new HttpError(404, "Dispositivo não encontrado");
    authorizeStore(actor, row.store_id);
    await put("extension_devices", id, { ...row, revoked_at: now() });
    return { revoked: true };
  });
}
export async function extensionActor(
  actor: Actor,
  authorization: string | null,
  origin: string | null,
) {
  const token = authorization?.match(/^Bearer ([a-zA-Z0-9_-]{43})$/)?.[1];
  if (!token) throw new HttpError(401, "Pareie esta extensão pelo site");
  const device = await get("extension_devices", tokenId(token));
  if (
    !device ||
    device.revoked_at ||
    device.expires_at <= Date.now() ||
    device.organization_id !== actor.organization_id ||
    device.origin !== origin
  )
    throw new HttpError(401, "Pareamento ausente, expirado ou revogado");
  authorizeStore(actor, device.store_id);
  return {
    ...actor,
    id: key("extension", device.id),
    name: `Extensão · ${device.name}`,
    role: "manager" as const,
    stores: actor.stores.filter((s) => s.id === device.store_id),
  };
}
export async function extensionOffers(actor: Actor) {
  const store = actor.stores[0];
  return {
    store: { id: store.id, name: store.name },
    offers: (await find("offers", { store_id: store.id }))
      .filter((o) => o.origin !== "reference")
      .map((o) => ({
        id: o.id,
        title: o.title,
        price: o.price,
        mlId: o.ml_id,
        sku: o.sku,
      })),
  };
}
export async function extensionOffer(actor: Actor, id: string) {
  const detail = await offerDetail(actor, id);
  if (detail.offer.origin === "reference")
    throw new HttpError(422, "Selecione um anúncio próprio");
  const savedCosts = await get("costs", id);
  return {
    offer: {
      id: detail.offer.id,
      title: detail.offer.title,
      price: detail.offer.ml?.variablePrices ? null : detail.offer.price,
    },
    costs: detail.costs,
    parameters: detail.parameters,
    costsStale:
      !savedCosts?.updated_at ||
      Date.now() - Date.parse(savedCosts.updated_at) >
        detail.parameters.reviewDays * 86400000,
  };
}
export async function extensionCapture(actor: Actor, payload: unknown) {
  const p = z
    .object({
      storeId: z.string().optional(),
      itemId: z.string(),
      title: z.string(),
      url: z.string(),
      price: z.union([z.string(), z.number()]),
      shipping: z.union([z.string(), z.number()]).nullable().optional(),
      seller: z.string().optional(),
      offerId: z.string().nullable().optional(),
    })
    .parse(payload);
  const store = actor.stores[0];
  if (p.storeId && p.storeId !== store.id)
    throw new HttpError(403, "Esta extensão está pareada com outra loja");
  const previous = await get(
    "competitors",
    key(actor.organization_id, store.id, p.itemId),
  );
  const row = await saveCompetitor(
    actor,
    {
      ...p,
      storeId: store.id,
      threshold: previous?.threshold || "5",
      offerId: p.offerId || previous?.offer_id || null,
      seller: p.seller || previous?.seller || "",
      version: previous?.version || 0,
    },
    "extension",
  );
  return {
    id: row.id,
    itemId: row.item_id,
    url: new URL(
      `/concorrencia?store=${encodeURIComponent(store.id)}`,
      process.env.APP_URL || "http://localhost:3000",
    ).href,
  };
}
