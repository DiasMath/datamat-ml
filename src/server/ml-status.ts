import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canWrite, authorizeStore, HttpError, type Actor } from "./access";
import { get, put, key, now, transaction } from "./db";
import { withSellerData, writeSellerStatus } from "./mercadolivre";

export const statusBatchSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(20),
    versions: z.record(z.string(), z.number().int().positive()),
    status: z.enum(["active", "paused"]),
    requestId: z.uuid(),
    confirmed: z.literal(true),
  })
  .strict();

async function applyStatus(
  actor: Actor,
  offerId: string,
  p: z.infer<typeof statusBatchSchema>,
  deadline: number,
) {
  const applicationId = key(
      actor.organization_id,
      "ml-status",
      p.requestId,
      offerId,
    ),
    lease = randomUUID();
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        status: p.status,
        version: p.versions[offerId],
      }),
    )
    .digest("hex");
  const context = await transaction(async () => {
    const offer = await get("offers", offerId);
    if (!offer || offer.organization_id !== actor.organization_id)
      throw new HttpError(404, "Anúncio não encontrado");
    authorizeStore(actor, offer.store_id);
    const previous = await get("ml_status_applications", applicationId);
    if (previous && previous.payload_hash !== hash)
      throw new HttpError(409, "Operação reutilizada com outros dados");
    if (previous?.status === "verified") return { completed: true, offer };
    if (
      offer.ml_status_uncertain &&
      offer.ml_status_uncertain !== applicationId
    )
      throw new HttpError(
        409,
        "Confira a alteração anterior antes de iniciar outra ação no ML",
      );
    if (previous?.until > Date.now() || offer.ml_apply_until > Date.now())
      throw new HttpError(
        409,
        "Uma operação ML está em andamento neste anúncio",
      );
    const verifyOnly = previous?.phase === "writing";
    const account = await get(
      "connections",
      key(offer.store_id, "mercadolivre"),
    );
    if (
      offer.origin === "reference" ||
      !/^MLB\d+$/.test(offer.ml_id || "") ||
      account?.status !== "connected" ||
      !account.external_account ||
      account.external_account !== offer.ml?.sellerId ||
      account.auth_version !== offer.ml?.authVersion
    )
      throw new HttpError(
        422,
        "Sincronize um anúncio próprio da conta autorizada antes de ativar ou pausar",
      );
    if (!verifyOnly && p.versions[offerId] !== offer.version)
      throw new HttpError(409, "Anúncio alterado; recarregue o lote");
    if (
      previous &&
      verifyOnly &&
      (previous.seller_id !== account.external_account ||
        previous.auth_version !== account.auth_version)
    )
      throw new HttpError(
        409,
        "A conta mudou; confira a operação diretamente no ML",
      );
    await put("offers", offerId, {
      ...offer,
      ml_apply_lease: lease,
      ml_apply_until: Date.now() + 120000,
    });
    await put("ml_status_applications", applicationId, {
      ...previous,
      organization_id: actor.organization_id,
      store_id: offer.store_id,
      offer_id: offerId,
      target: p.status,
      payload_hash: hash,
      request_id: p.requestId,
      expected_version: p.versions[offerId],
      initiator_id: previous?.initiator_id || actor.id,
      initiator_name: previous?.initiator_name || actor.name,
      auth_version: account.auth_version,
      seller_id: account.external_account,
      lease,
      until: Date.now() + 120000,
      status: "running",
      phase: verifyOnly ? "writing" : "reading",
      created_at: previous?.created_at || now(),
    });
    return { completed: false, offer, account, verifyOnly };
  });
  if (context.completed)
    return {
      id: offerId,
      result: "verified",
      version: context.offer.version,
      message: "Operação já confirmada no ML",
    };
  const { offer, account, verifyOnly } = context;
  let attempted = !!verifyOnly;
  const read = () =>
    withSellerData(
      actor,
      account!.id,
      async (request) => {
        const item = z
          .object({
            id: z.string(),
            seller_id: z.number(),
            status: z.string(),
            available_quantity: z.number().int().nonnegative().optional(),
          })
          .parse(await request(`/items/${offer.ml_id}`));
        if (
          item.id !== offer.ml_id ||
          String(item.seller_id) !== account!.external_account
        )
          throw new HttpError(
            403,
            "O anúncio não pertence ao vendedor autorizado",
          );
        return item;
      },
      deadline,
    );
  try {
    let remote = await read();
    if (remote.status !== p.status && !verifyOnly) {
      if (!["active", "paused"].includes(remote.status))
        throw new HttpError(
          422,
          "O ML não permite esta ação para a situação atual; confira o anúncio",
        );
      if (
        p.status === "active" &&
        (remote.available_quantity == null || remote.available_quantity <= 0)
      )
        throw new HttpError(
          422,
          "Não é possível ativar sem estoque disponível confirmado no ML",
        );
      if (Date.now() >= deadline - 15000)
        throw new HttpError(
          503,
          "Tempo de execução insuficiente; retome o lote para continuar",
        );
      await transaction(async () => {
        const job = await get("ml_status_applications", applicationId),
          connection = await get("connections", account!.id);
        if (
          job?.lease !== lease ||
          connection?.auth_version !== account!.auth_version ||
          connection?.external_account !== account!.external_account
        )
          throw new HttpError(409, "A conta mudou antes da alteração");
        await put("ml_status_applications", applicationId, {
          ...job,
          phase: "writing",
        });
      });
      attempted = true;
      await writeSellerStatus(actor, account!.id, offer.ml_id, p.status);
      remote = await read();
    }
    if (remote.status !== p.status)
      throw new HttpError(
        409,
        "Alteração ainda não confirmada; confira sem reenviar",
      );
    await transaction(async () => {
      const current = await get("offers", offerId),
        job = await get("ml_status_applications", applicationId),
        connection = await get("connections", account!.id);
      if (
        job?.lease !== lease ||
        current?.ml_apply_lease !== lease ||
        current.version !== offer.version ||
        connection?.auth_version !== account!.auth_version ||
        connection?.external_account !== account!.external_account
      )
        throw new HttpError(
          409,
          "O contexto mudou após a alteração; confira no ML",
        );
      await put("offers", offerId, {
        ...current,
        status: p.status,
        version: current.version + 1,
        updated_at: now(),
        ml_apply_until: 0,
        ml_apply_lease: null,
        ml_status_uncertain: null,
        ml_status_target: null,
        ml:
          remote.available_quantity == null
            ? current.ml
            : {
                ...current.ml,
                availableQuantity: remote.available_quantity,
                stockObservedAt: now(),
              },
      });
      await put("history", key("ml-status-history", applicationId), {
        organization_id: actor.organization_id,
        store_id: offer.store_id,
        offer_id: offerId,
        actor_id: job.initiator_id,
        actor_name: job.initiator_name,
        verified_by: actor.id,
        field: "status",
        old_value: JSON.stringify(offer.status),
        new_value: JSON.stringify(p.status),
        reason: "Ativação/pausa confirmada pelo operador",
        origin: "mercadolivre",
        status: "confirmed",
        created_at: now(),
      });
      await put("ml_status_applications", applicationId, {
        ...job,
        status: "verified",
        lease: null,
        until: 0,
        verified_at: now(),
      });
    });
    return {
      id: offerId,
      result: "verified",
      version: offer.version + 1,
      message:
        p.status === "active"
          ? "Ativado e confirmado no ML"
          : "Pausado e confirmado no ML",
    };
  } catch (error) {
    await transaction(async () => {
      const job = await get("ml_status_applications", applicationId),
        current = await get("offers", offerId);
      if (job?.lease !== lease) return;
      await put("ml_status_applications", applicationId, {
        ...job,
        status: attempted ? "uncertain" : "failed",
        lease: null,
        until: 0,
      });
      if (current?.ml_apply_lease === lease)
        await put("offers", offerId, {
          ...current,
          ml_apply_until: 0,
          ml_apply_lease: null,
          ml_status_uncertain: attempted
            ? applicationId
            : current.ml_status_uncertain || null,
          ml_status_target: attempted
            ? p.status
            : current.ml_status_target || null,
        });
    });
    if (attempted)
      return {
        id: offerId,
        result: "uncertain",
        message:
          "Resposta incerta. Conferir apenas consulta o ML; não reenvia a alteração.",
      };
    throw error;
  }
}
export async function batchListingStatus(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = statusBatchSchema.parse(payload),
    deadline = Date.now() + 55000;
  const results: Array<{
    id: string;
    result: string;
    message: string;
    version?: number;
  }> = [];
  for (const offerId of [...new Set(p.ids)]) {
    if (Date.now() >= deadline - 5000) {
      results.push({
        id: offerId,
        result: "pending",
        message: "Lote pausado por tempo; retome para continuar",
      });
      continue;
    }
    try {
      const offer = await get("offers", offerId);
      if (!offer || offer.organization_id !== actor.organization_id)
        throw new HttpError(404, "Anúncio não encontrado");
      authorizeStore(actor, offer.store_id);
      const pending = offer.ml_status_uncertain
        ? await get("ml_status_applications", offer.ml_status_uncertain)
        : null;
      // Recover after closing/reloading the UI. Recovery only reads the same
      // pending target; a different requested action remains blocked.
      const actual =
        pending?.target === p.status && pending.phase === "writing"
          ? {
              ...p,
              requestId: pending.request_id,
              versions: { ...p.versions, [offerId]: pending.expected_version },
            }
          : p;
      results.push(await applyStatus(actor, offerId, actual, deadline));
    } catch (error) {
      results.push({
        id: offerId,
        result: "failed",
        message:
          error instanceof HttpError
            ? error.message
            : "Não foi possível consultar o ML; tente novamente",
      });
    }
  }
  return { results };
}
