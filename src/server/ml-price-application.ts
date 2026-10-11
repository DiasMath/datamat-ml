import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { canApprove, authorizeStore, HttpError, type Actor } from "./access";
import { get, put, key, now, transaction, claim } from "./db";
import { withSellerData, quoteTariff, writeSellerPrice } from "./mercadolivre";

export async function applyApprovedPrice(
  actor: Actor,
  proposalId: string,
  payload: unknown,
) {
  canApprove(actor);
  const p = z.object({ confirmed: z.literal(true) }).parse(payload);
  void p;
  const lease = randomUUID(),
    applicationId = key("ml-price", proposalId);
  const context = await transaction(async () => {
    const proposal = await get("proposals", proposalId);
    if (!proposal) throw new HttpError(404, "Proposta não encontrada");
    authorizeStore(actor, proposal.store_id);
    const previous = await get("ml_price_applications", applicationId);
    const verifyOnly =
      previous?.phase === "writing" || previous?.status === "uncertain";
    if (previous?.status === "verified") return { completed: true, proposal };
    if (previous?.until > Date.now())
      throw new HttpError(409, "Aplicação em andamento; aguarde a conferência");
    if (
      ![
        "approved",
        "pending_application",
        "applying_ml",
        "application_uncertain",
      ].includes(proposal.status)
    )
      throw new HttpError(
        409,
        "A proposta precisa estar aprovada antes de aplicar no ML",
      );
    const offer = await get("offers", proposal.offer_id),
      parameters = await get("parameters", proposal.store_id),
      snapshot = JSON.parse(proposal.snapshot_json);
    const connection = await get(
      "connections",
      key(proposal.store_id, "mercadolivre"),
    );
    if (offer?.ml_apply_until > Date.now())
      throw new HttpError(
        409,
        "Outra aplicação está em andamento neste anúncio",
      );
    if (offer?.ml_status_uncertain)
      throw new HttpError(
        409,
        "Confira a ativação ou pausa pendente antes de aplicar preço",
      );
    if (
      !offer ||
      offer.origin === "reference" ||
      !/^MLB\d+$/.test(offer.ml_id || "") ||
      !connection ||
      connection.status !== "connected" ||
      offer.ml?.sellerId !== connection.external_account ||
      offer.ml?.authVersion !== connection.auth_version
    )
      throw new HttpError(
        422,
        "Sincronize um anúncio próprio da conta autorizada antes de aplicar",
      );
    if (
      !verifyOnly &&
      (offer.version !== proposal.base_version ||
        snapshot.parametersRevision !== (parameters?.version || 1))
    )
      throw new HttpError(
        409,
        "Os dados mudaram após a proposta; prepare uma nova proposta",
      );
    if (
      !snapshot.input.conditionsVerified ||
      snapshot.proposed.pending.length ||
      !snapshot.proposed.price
    )
      throw new HttpError(
        422,
        "Complete os custos e confira tarifa e frete antes de aplicar",
      );
    if (
      snapshot.input.proposedTitle ||
      snapshot.input.proposedDescription ||
      snapshot.input.promotion ||
      new Decimal(snapshot.input.mlContribution || 0).gt(0) ||
      offer.ml.variablePrices ||
      offer.ml.variationCount ||
      offer.ml.catalogListing
    )
      throw new HttpError(
        422,
        "Aplicação automática disponível apenas para preço de anúncio individual, sem catálogo, promoção ou alteração de conteúdo",
      );
    if (!verifyOnly && new Decimal(offer.price).eq(snapshot.proposed.price))
      throw new HttpError(422, "O preço proposto já é o preço atual");
    if (
      previous &&
      verifyOnly &&
      (previous.auth_version !== connection.auth_version ||
        previous.seller_id !== connection.external_account)
    )
      throw new HttpError(
        409,
        "A conta mudou; confira a aplicação diretamente no ML",
      );
    await put("offers", offer.id, {
      ...offer,
      ml_apply_until: Date.now() + 240000,
      ml_apply_lease: lease,
    });
    await put("proposals", proposalId, {
      ...proposal,
      status: "applying_ml",
      updated_at: now(),
    });
    await put("ml_price_applications", applicationId, {
      ...previous,
      lease,
      until: Date.now() + 240000,
      status: "running",
      phase: verifyOnly ? "writing" : "reading",
      auth_version: connection.auth_version,
      seller_id: connection.external_account,
    });
    return {
      completed: false,
      proposal,
      offer,
      snapshot,
      connection,
      verifyOnly,
    };
  });
  if (context.completed) return { status: "applied_ml", verified: true };
  const { offer, snapshot, connection, proposal, verifyOnly } = context;
  let attempted = !!verifyOnly;
  const read = async () =>
    withSellerData(actor, connection!.id, async (request) => {
      const item = z
        .object({
          id: z.string(),
          seller_id: z.number(),
          price: z.number().positive(),
          status: z.string(),
          original_price: z.number().nullish(),
          variations: z.array(z.unknown()).optional(),
          catalog_listing: z.boolean().optional(),
        })
        .parse(await request(`/items/${offer!.ml_id}`));
      if (
        item.id !== offer!.ml_id ||
        String(item.seller_id) !== connection!.external_account
      )
        throw new HttpError(
          403,
          "A consulta retornou outro anúncio ou vendedor",
        );
      return item;
    });
  try {
    let remote = await read();
    if (!verifyOnly) {
      if (!new Decimal(remote.price).eq(offer!.price))
        throw new HttpError(
          409,
          "O preço mudou no ML; sincronize e prepare uma nova proposta",
        );
      if (
        !["active", "paused"].includes(remote.status) ||
        remote.catalog_listing ||
        remote.variations?.length ||
        (remote.original_price && remote.original_price > remote.price)
      )
        throw new HttpError(
          422,
          "Confira situação, catálogo, variações e promoção no Mercado Livre antes de aplicar",
        );
      const quote = await quoteTariff(actor, offer!.id, {
        price: snapshot.proposed.price,
        offerVersion: offer!.version,
      });
      const approvedFee = new Decimal(
        snapshot.proposed.breakdown.mlPercent,
      ).plus(snapshot.proposed.breakdown.mlFixed);
      if (approvedFee.minus(quote.total).abs().gt("0.02"))
        throw new HttpError(
          409,
          "A tarifa atual difere da proposta aprovada; consulte novamente e prepare nova proposta",
        );
      await transaction(async () => {
        const job = await get("ml_price_applications", applicationId),
          account = await get("connections", connection!.id);
        if (
          job?.lease !== lease ||
          account?.auth_version !== connection!.auth_version
        )
          throw new HttpError(409, "A conta mudou antes da aplicação");
        await put("ml_price_applications", applicationId, {
          ...job,
          phase: "writing",
        });
      });
      attempted = true;
      await writeSellerPrice(
        actor,
        connection!.id,
        offer!.ml_id,
        snapshot.proposed.price,
      );
      remote = await read();
    }
    if (!new Decimal(remote.price).eq(snapshot.proposed.price))
      throw new HttpError(
        409,
        "A aplicação ainda não foi confirmada no ML; confira novamente sem reenviar o preço",
      );
    await transaction(async () => {
      const current = await get("offers", offer!.id),
        currentProposal = await get("proposals", proposalId),
        job = await get("ml_price_applications", applicationId),
        account = await get("connections", connection!.id);
      if (
        !current ||
        !currentProposal ||
        job?.lease !== lease ||
        current.ml_apply_lease !== lease ||
        account?.auth_version !== connection!.auth_version ||
        current.version !== offer!.version
      )
        throw new HttpError(
          409,
          "O contexto mudou após a aplicação; confira o estado no ML",
        );
      const costs = { ...(snapshot.input.costOverrides ?? snapshot.costs) };
      for (const field of ["mlPercent", "mlFixed", "shipping", "advertising"])
        if (snapshot.input[field] !== undefined)
          costs[field] = snapshot.input[field];
      const parameterRow = await get("parameters", offer!.store_id);
      if (
        offer!.version === proposal.base_version &&
        snapshot.parametersRevision === (parameterRow?.version || 1)
      )
        await put("costs", offer!.id, {
          offer_id: offer!.id,
          store_id: offer!.store_id,
          data_json: JSON.stringify(costs),
          updated_at: now(),
        });
      await put("offers", offer!.id, {
        ...current,
        price: snapshot.proposed.price,
        version: current.version + 1,
        ml_apply_lease: null,
        ml_apply_until: 0,
        updated_at: now(),
      });
      await put("proposals", proposalId, {
        ...currentProposal,
        status: "applied_ml",
        updated_at: now(),
      });
      await claim("applications.success", proposalId, applicationId);
      await put("applications", applicationId, {
        proposal_id: proposalId,
        request_id: applicationId,
        actor_id: actor.id,
        result: "applied_ml",
        evidence: "Preço consultado na API oficial após envio",
        created_at: now(),
      });
      await put("history", key("ml-price-history", proposalId), {
        organization_id: actor.organization_id,
        store_id: offer!.store_id,
        offer_id: offer!.id,
        actor_id: actor.id,
        actor_name: actor.name,
        field: "price",
        old_value: JSON.stringify(snapshot.current.price),
        new_value: JSON.stringify(snapshot.proposed.price),
        reason: proposal.reason,
        origin: "mercadolivre",
        status: "applied_ml",
        snapshot_json: proposal.snapshot_json,
        created_at: now(),
      });
      await put("ml_price_applications", applicationId, {
        ...job,
        status: "verified",
        until: 0,
        lease: null,
        verified_at: now(),
      });
    });
    return { status: "applied_ml", verified: true };
  } catch (e) {
    await transaction(async () => {
      const job = await get("ml_price_applications", applicationId),
        current = await get("offers", offer!.id),
        currentProposal = await get("proposals", proposalId);
      if (job?.lease !== lease) return;
      await put("ml_price_applications", applicationId, {
        ...job,
        status: attempted ? "uncertain" : "failed",
        until: 0,
        lease: null,
      });
      if (current?.ml_apply_lease === lease)
        await put("offers", offer!.id, {
          ...current,
          ml_apply_until: 0,
          ml_apply_lease: null,
        });
      if (currentProposal?.status === "applying_ml")
        await put("proposals", proposalId, {
          ...currentProposal,
          status: attempted ? "application_uncertain" : "approved",
          updated_at: now(),
        });
    });
    if (attempted)
      throw new HttpError(
        409,
        "A aplicação precisa de conferência. Use Conferir aplicação no ML; o preço não será reenviado automaticamente",
      );
    throw e;
  }
}
