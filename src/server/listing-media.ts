import { createHash, randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { canWrite, authorizeStore, HttpError, type Actor } from "./access";
import { db, get, find, put, transaction, key, now, type Row } from "./db";
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export type MediaStorage = {
  save: (path: string, bytes: Buffer, type: string) => Promise<void>;
  read: (path: string) => Promise<Buffer>;
  remove: (path: string) => Promise<void>;
};
const storage: MediaStorage = {
  async save(path, bytes, type) {
    await bucket()
      .file(path)
      .save(bytes, {
        resumable: false,
        metadata: { contentType: type, cacheControl: "private, max-age=300" },
      });
  },
  async read(path) {
    return (await bucket().file(path).download())[0];
  },
  async remove(path) {
    await bucket().file(path).delete({ ignoreNotFound: true });
  },
};
function bucket() {
  if (process.env.FIRESTORE_EMULATOR_HOST)
    throw new HttpError(503, "Uploads de teste usam armazenamento isolado");
  db();
  const app = getApp("datamat-server");
  return getStorage(app).bucket(
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
      `${app.options.projectId}.firebasestorage.app`,
  );
}
export async function mediaStorageStatus(actor: Actor) {
  canWrite(actor);
  let status: "ready" | "missing" | "unavailable" = "ready";
  try {
    await bucket().getMetadata();
  } catch (error) {
    status =
      (error as { code?: number }).code === 404 ? "missing" : "unavailable";
  }
  return {
    status,
    consoleUrl: `https://console.firebase.google.com/project/${encodeURIComponent(process.env.FIREBASE_PROJECT_ID || "")}/storage`,
  };
}
async function ownOffer(actor: Actor, offerId: string) {
  const offer = await get("offers", offerId);
  if (!offer || offer.organization_id !== actor.organization_id)
    throw new HttpError(404, "Anúncio não encontrado");
  authorizeStore(actor, offer.store_id);
  if (offer.origin === "reference")
    throw new HttpError(
      422,
      "Arquivos são preparados somente para anúncios próprios",
    );
  return offer;
}
function publicMedia(row: Row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    kind: row.kind,
    bytes: row.bytes,
    status: "draft",
    createdAt: row.created_at,
    url: `/api/listing-media/${row.id}`,
  };
}
export async function draftMedia(actor: Actor, offerId: string) {
  await ownOffer(actor, offerId);
  return (await find("listing_media", { offer_id: offerId }))
    .filter(
      (r) =>
        r.organization_id === actor.organization_id && r.status === "ready",
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(publicMedia);
}
function mediaType(bytes: Buffer, claimed: string) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  const mp4 = bytes.toString("ascii", 4, 8) === "ftyp";
  const webm = bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  const found = jpeg
    ? "image/jpeg"
    : png
      ? "image/png"
      : webp
        ? "image/webp"
        : mp4
          ? "video/mp4"
          : webm
            ? "video/webm"
            : null;
  if (!found || found !== claimed)
    throw new HttpError(
      422,
      "Selecione uma foto JPG, PNG ou WebP, ou vídeo MP4/WebM válido. SVG e arquivos executáveis não são aceitos.",
    );
  return found;
}
export async function uploadMedia(
  actor: Actor,
  offerId: string,
  values: { file: File; requestId: unknown; offerVersion: unknown },
  files: MediaStorage = storage,
) {
  canWrite(actor);
  const p = z
    .object({
      requestId: z.uuid(),
      offerVersion: z.coerce.number().int().positive(),
    })
    .parse(values);
  if (
    !(values.file instanceof File) ||
    !values.file.size ||
    values.file.size > MAX_MEDIA_BYTES
  )
    throw new HttpError(413, "Cada foto ou vídeo deve ter até 3 MB");
  const offer = await ownOffer(actor, offerId);
  if (offer.version !== p.offerVersion)
    throw new HttpError(
      409,
      "O anúncio mudou; atualize a ficha antes de anexar mídia",
    );
  const bytes = Buffer.from(await values.file.arrayBuffer()),
    type = mediaType(bytes, values.file.type);
  const mediaId = key(offerId, p.requestId),
    hash = createHash("sha256").update(bytes).digest("hex");
  const lease = randomUUID();
  const row = {
    id: mediaId,
    organization_id: actor.organization_id,
    store_id: offer.store_id,
    offer_id: offerId,
    actor_id: actor.id,
    hash,
    type,
    kind: type.startsWith("image/") ? "image" : "video",
    bytes: bytes.length,
    name: values.file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 150),
    object_path: `datamat-media/${encodeURIComponent(actor.organization_id)}/${encodeURIComponent(offer.store_id)}/${offerId}/${mediaId}/${lease}`,
    status: "ready",
    created_at: now(),
  };
  const ready = await transaction(async () => {
    const previous = await get("listing_media", mediaId);
    if (
      previous &&
      (previous.hash !== hash ||
        previous.type !== type ||
        previous.actor_id !== actor.id)
    )
      throw new HttpError(409, "Chave de envio utilizada para outro arquivo");
    if (previous?.status === "ready") return previous;
    if (previous?.status === "deleted")
      throw new HttpError(
        409,
        "Este envio já foi removido; inicie um novo envio",
      );
    if (previous?.status === "deleting")
      throw new HttpError(409, "Este arquivo está sendo removido; aguarde");
    if (previous?.status === "uploading" && previous.lease_until > Date.now())
      throw new HttpError(429, "Este arquivo já está sendo enviado; aguarde");
    if (
      (await find("listing_media", { offer_id: offerId })).filter((r) =>
        ["ready", "uploading"].includes(r.status),
      ).length >= 30
    )
      throw new HttpError(422, "Limite de 30 arquivos em rascunho por anúncio");
    await put("listing_media", mediaId, {
      ...row,
      status: "uploading",
      lease,
      lease_until: Date.now() + 180000,
    });
    return null;
  });
  if (ready) return publicMedia(ready);
  async function failed() {
    const cleanup = await transaction(async () => {
      const current = await get("listing_media", mediaId);
      if (current?.lease === lease && current.status !== "ready") {
        await put("listing_media", mediaId, {
          ...current,
          status: "failed",
          lease_until: 0,
        });
        return true;
      }
      // A commit can succeed even if its acknowledgement is lost. Preserve
      // any ready file; each attempt owns a distinct physical object path.
      return current?.object_path !== row.object_path;
    });
    if (cleanup) await files.remove(row.object_path).catch(() => {});
  }
  try {
    await files.save(row.object_path, bytes, type);
  } catch {
    await failed();
    throw new HttpError(
      503,
      "Não foi possível enviar o arquivo. Confira se o Firebase Storage está ativo no projeto e a conta de serviço possui acesso ao bucket.",
    );
  }
  try {
    return await transaction(async () => {
      const current = await ownOffer(actor, offerId),
        saved = await get("listing_media", mediaId);
      if (current.version !== offer.version)
        throw new HttpError(
          409,
          "O anúncio mudou durante o envio; atualize a ficha",
        );
      if (saved?.status === "ready") {
        if (saved.hash !== hash)
          throw new HttpError(409, "Outro arquivo ocupa este envio");
        return publicMedia(saved);
      }
      if (saved?.lease !== lease)
        throw new HttpError(409, "O envio mudou; atualize a ficha");
      await put("listing_media", mediaId, row);
      await put("history", key("media.uploaded", mediaId), {
        organization_id: actor.organization_id,
        store_id: offer.store_id,
        offer_id: offerId,
        actor_id: actor.id,
        actor_name: actor.name,
        field: "media.uploaded",
        old_value: "null",
        new_value: JSON.stringify({
          name: row.name,
          kind: row.kind,
          status: "draft",
        }),
        origin: "manual",
        status: "confirmed",
        snapshot_json: "{}",
        reason: "Arquivo preparado em rascunho; não publicado no Mercado Livre",
        created_at: now(),
      });
      return publicMedia(row);
    });
  } catch (error) {
    await failed();
    throw error;
  }
}
export async function readMedia(
  actor: Actor,
  mediaId: string,
  range: string | null,
  files: MediaStorage = storage,
) {
  const row = await get("listing_media", mediaId);
  if (
    !row ||
    row.status !== "ready" ||
    row.organization_id !== actor.organization_id
  )
    throw new HttpError(404, "Arquivo não encontrado");
  await ownOffer(actor, row.offer_id);
  let bytes: Buffer;
  try {
    bytes = await files.read(row.object_path);
  } catch {
    throw new HttpError(
      503,
      "Não foi possível carregar o arquivo no Firebase Storage",
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": row.type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300",
    "Accept-Ranges": "bytes",
  };
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = parts?.[1]
      ? Number(parts[1])
      : Math.max(0, bytes.length - Number(parts?.[2]));
    const end =
      parts?.[1] && parts?.[2]
        ? Math.min(bytes.length - 1, Number(parts[2]))
        : bytes.length - 1;
    if (
      !parts ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      end >= bytes.length
    )
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${bytes.length}` },
      });
    headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
    bytes = bytes.subarray(start, end + 1);
    headers["Content-Length"] = String(bytes.length);
    return new Response(new Uint8Array(bytes), { status: 206, headers });
  }
  headers["Content-Length"] = String(bytes.length);
  return new Response(new Uint8Array(bytes), { headers });
}
export async function deleteMedia(
  actor: Actor,
  mediaId: string,
  files: MediaStorage = storage,
) {
  canWrite(actor);
  const row = await get("listing_media", mediaId);
  if (!row || row.organization_id !== actor.organization_id)
    throw new HttpError(404, "Arquivo não encontrado");
  await ownOffer(actor, row.offer_id);
  if (row.status === "deleted") return { deleted: true };
  const deleteLease = randomUUID();
  await transaction(async () => {
    const current = await get("listing_media", mediaId);
    if (!current || current.organization_id !== actor.organization_id)
      throw new HttpError(404, "Arquivo não encontrado");
    if (current?.status === "uploading" || current?.status === "deleting")
      throw new HttpError(
        409,
        "Uma operação deste arquivo está em andamento; aguarde",
      );
    await put("listing_media", mediaId, {
      ...current,
      status: "deleting",
      delete_lease: deleteLease,
    });
  });
  try {
    await files.remove(row.object_path);
  } catch {
    await transaction(async () => {
      const current = await get("listing_media", mediaId);
      if (current?.delete_lease === deleteLease)
        await put("listing_media", mediaId, row);
    });
    throw new HttpError(
      503,
      "Não foi possível remover o arquivo no Firebase Storage",
    );
  }
  await transaction(async () => {
    const current = await get("listing_media", mediaId);
    if (current?.status === "deleted") return;
    if (current?.delete_lease !== deleteLease)
      throw new HttpError(409, "A remoção mudou; atualize a ficha");
    await put("listing_media", mediaId, {
      ...row,
      status: "deleted",
      deleted_at: now(),
    });
    await put("history", key("media.deleted", mediaId), {
      organization_id: actor.organization_id,
      store_id: row.store_id,
      offer_id: row.offer_id,
      actor_id: actor.id,
      actor_name: actor.name,
      field: "media.deleted",
      old_value: JSON.stringify({ name: row.name }),
      new_value: "null",
      origin: "manual",
      status: "confirmed",
      snapshot_json: "{}",
      reason: "Rascunho removido; mídia publicada no ML preservada",
      created_at: now(),
    });
  });
  return { deleted: true };
}
