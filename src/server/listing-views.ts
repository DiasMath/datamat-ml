import { z } from "zod";
import { authorizeStore, canWrite, HttpError, type Actor } from "./access";
import { find, get, put, remove, transaction, id, now, type Row } from "./db";
import {
  listingViewConfigSchema,
  type ListingView,
} from "../domain/listing-views";
const schema = z
  .object({
    storeId: z.string().min(1).max(200),
    name: z
      .string()
      .trim()
      .min(1, "Informe o nome da visão")
      .max(60)
      .transform((v) => v.replace(/\s+/g, " ")),
    config: listingViewConfigSchema,
    version: z.number().int().nonnegative(),
  })
  .strict();
const publicView = (row: Row): ListingView => ({
  id: row.id,
  name: row.name,
  config: row.config,
  version: row.version,
  updatedAt: row.updated_at,
});
export async function listingViews(actor: Actor, storeId: string) {
  authorizeStore(actor, storeId);
  const rows = await find("listing_views", {
    organization_id: actor.organization_id,
    store_id: storeId,
  });
  return {
    views: rows
      .map(publicView)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
export async function saveListingView(
  actor: Actor,
  payload: unknown,
  viewId?: string,
) {
  canWrite(actor);
  const p = schema.parse(payload);
  authorizeStore(actor, p.storeId);
  const recordId = viewId || id();
  return transaction(async () => {
    const [current, rows] = await Promise.all([
      get("listing_views", recordId),
      find("listing_views", {
        organization_id: actor.organization_id,
        store_id: p.storeId,
      }),
    ]);
    if (
      viewId &&
      (!current ||
        current.organization_id !== actor.organization_id ||
        current.store_id !== p.storeId)
    )
      throw new HttpError(404, "Visão não encontrada nesta loja");
    if ((current?.version || 0) !== p.version)
      throw new HttpError(
        409,
        "A visão mudou. Feche o formulário e abra novamente antes de salvar.",
      );
    if (!current && rows.length >= 30)
      throw new HttpError(
        422,
        "Limite de 30 visões por loja. Remova uma visão antes de criar outra.",
      );
    if (
      rows.some(
        (row) =>
          row.id !== recordId &&
          row.name.toLocaleLowerCase("pt-BR") ===
            p.name.toLocaleLowerCase("pt-BR"),
      )
    )
      throw new HttpError(409, "Esta loja já possui uma visão com esse nome.");
    return publicView(
      await put("listing_views", recordId, {
        organization_id: actor.organization_id,
        store_id: p.storeId,
        name: p.name,
        config: p.config,
        version: p.version + 1,
        created_at: current?.created_at || now(),
        updated_at: now(),
        updated_by: actor.id,
      }),
    );
  });
}
export async function deleteListingView(
  actor: Actor,
  viewId: string,
  payload: unknown,
) {
  canWrite(actor);
  const p = schema.pick({ storeId: true, version: true }).parse(payload);
  authorizeStore(actor, p.storeId);
  await transaction(async () => {
    const current = await get("listing_views", viewId);
    if (
      !current ||
      current.organization_id !== actor.organization_id ||
      current.store_id !== p.storeId
    )
      throw new HttpError(404, "Visão não encontrada nesta loja");
    if (current.version !== p.version)
      throw new HttpError(
        409,
        "A visão mudou. Atualize a lista antes de excluir.",
      );
    await remove("listing_views", viewId);
  });
  return { removed: true };
}
