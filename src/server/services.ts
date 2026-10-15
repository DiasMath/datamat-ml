import { z } from "zod";
import Decimal from "decimal.js";
import {
  attachFinancial,
  effectiveMlCosts,
  costsAfterProposal,
  financialAfterApplication,
} from "../domain/ml-financial";
import { createHash, randomUUID } from "node:crypto";
import {
  get,
  find,
  put,
  remove,
  transaction,
  claim,
  release,
  id,
  key,
  now,
  type Row,
} from "./db";
import {
  HttpError,
  authorizeStore,
  canWrite,
  canApprove,
  admin,
  type Actor,
} from "./access";
import {
  calculate,
  mlConditionsChanged,
  costSchema,
  parameterSchema,
  simulationSchema,
  emptyCosts,
  type Parameters,
  type Costs,
} from "../domain/finance";
import {
  offerSchema,
  taskSchema,
  noteSchema,
  storeSchema,
  batchSchema,
  proposalSchema,
  decisionSchema,
  importSchema,
  importPreviewSchema,
} from "./schemas";
import { adapters, reportUrl, type Provider } from "./integrations";
import {
  publicConnection,
  syncListings,
  validateQuote,
  safePictureUrl,
} from "./mercadolivre";
import { listingCounts } from "../domain/listing-table";
import { draftMedia } from "./listing-media";
import { listingQuality } from "../domain/marketplace";

const parse = (v: string) => JSON.parse(v),
  nullable = (v: string | null | undefined) => v?.trim() || null;
const sorted = (rows: Row[], field = "created_at") =>
  rows.sort((a, b) =>
    String(b[field] || "").localeCompare(String(a[field] || "")),
  );
function scoped(actor: Actor, storeId?: string | null) {
  if (storeId && storeId !== "all") {
    authorizeStore(actor, storeId);
    return [storeId];
  }
  return actor.stores.map((s) => s.id as string);
}
async function list(actor: Actor, collection: string, storeId?: string | null) {
  const ids = scoped(actor, storeId),
    rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 30)
    rows.push(
      ...(await find(collection, { store_id: { in: ids.slice(i, i + 30) } })),
    );
  if (collection === "history")
    rows.push(
      ...(await find("history", {
        organization_id: actor.organization_id,
        store_id: "",
      })),
    );
  return sorted(rows, collection === "offers" ? "updated_at" : "created_at");
}
async function params(storeId: string): Promise<Parameters> {
  const p = await get("parameters", storeId);
  if (!p) throw new HttpError(409, "Parâmetros da loja não inicializados");
  return parse(p.data_json);
}
async function costs(offerId: string): Promise<Costs> {
  const c = await get("costs", offerId);
  return c ? parse(c.data_json) : emptyCosts();
}
async function log(
  actor: Actor,
  storeId: string,
  offerId: string | null,
  field: string,
  before: unknown,
  after: unknown,
  reason: string,
  origin = "manual",
  status = "confirmed",
  snapshot: unknown = {},
  proposalId: string | null = null,
  requestId: string | null = null,
) {
  await put("history", id(), {
    organization_id: actor.organization_id,
    store_id: storeId,
    offer_id: offerId,
    actor_id: actor.id,
    actor_name: actor.name,
    proposal_id: proposalId,
    field,
    old_value: before == null ? null : JSON.stringify(before),
    new_value: after == null ? null : JSON.stringify(after),
    reason,
    origin,
    status,
    snapshot_json: JSON.stringify(snapshot),
    request_id: requestId,
    created_at: now(),
  });
}
async function operation(
  actor: Actor,
  kind: string,
  requestId: string,
  payload: unknown,
) {
  const documentId = key(kind, requestId),
    hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    existing = await get("operations", documentId);
  if (existing) {
    if (existing.actor_id !== actor.id || existing.payload_hash !== hash)
      throw new HttpError(409, "Chave de operação já usada com outros dados");
    if (existing.store_id) authorizeStore(actor, existing.store_id);
  }
  return { documentId, hash, existing };
}
async function recordOperation(
  actor: Actor,
  op: Awaited<ReturnType<typeof operation>>,
  entityId: string,
  storeId: string,
) {
  await put("operations", op.documentId, {
    actor_id: actor.id,
    payload_hash: op.hash,
    entity_id: entityId,
    store_id: storeId,
    created_at: now(),
  });
}
export async function getOffer(actor: Actor, offerId: string): Promise<Row> {
  const o = await get("offers", offerId);
  if (!o) throw new HttpError(404, "Anúncio não encontrado");
  authorizeStore(actor, o.store_id);
  const [p, s] = await Promise.all([
    get("products", o.product_id),
    get("stores", o.store_id),
  ]);
  if (
    !p ||
    p.organization_id !== actor.organization_id ||
    !s ||
    s.organization_id !== actor.organization_id
  )
    throw new HttpError(404, "Produto ou loja não encontrado");
  const [b, c, financial, account] = await Promise.all([
    p.brand_id ? get("brands", p.brand_id) : undefined,
    p.category_id ? get("categories", p.category_id) : undefined,
    o.ml ? get("ml_financials", offerId) : null,
    o.ml ? get("connections", key(o.store_id, "mercadolivre")) : null,
  ]);
  return {
    ...attachFinancial(o, financial, account, actor.organization_id),
    product_name: p.name,
    model: p.model,
    brand_id: p.brand_id,
    category_id: p.category_id,
    brand: b?.name || null,
    category: c?.name || null,
    store_name: s.name,
  };
}
async function lookup(
  actor: Actor,
  collection: "brands" | "categories",
  name: string | null | undefined,
) {
  if (!name?.trim()) return null;
  const documentId = key(actor.organization_id, collection, name.trim());
  if (!(await get(collection, documentId)))
    await put(collection, documentId, {
      organization_id: actor.organization_id,
      name: name.trim(),
    });
  return documentId;
}
async function product(actor: Actor, p: z.infer<typeof offerSchema>) {
  if (p.productId) {
    const existing = await get("products", p.productId);
    if (!existing || existing.organization_id !== actor.organization_id)
      throw new HttpError(404, "Produto não encontrado");
    if (p.updateProduct) {
      if (p.productVersion !== (existing.version || 1))
        throw new HttpError(
          409,
          "Produto alterado por outra operação; recarregue o cadastro",
        );
      const offers = await find("offers", { product_id: existing.id });
      for (const offer of offers) authorizeStore(actor, offer.store_id);
      if (offers.length > 75)
        throw new HttpError(
          422,
          "Este produto exige atualização em lotes; procure o administrador",
        );
      const updated = await put("products", existing.id, {
        ...existing,
        name: p.name,
        model: nullable(p.model),
        brand_id: await lookup(actor, "brands", p.brand),
        category_id: await lookup(actor, "categories", p.category),
        version: (existing.version || 1) + 1,
        updated_at: now(),
      });
      for (const offer of offers) {
        await put("offers", offer.id, {
          ...offer,
          version: offer.version + 1,
          updated_at: now(),
        });
        await log(
          actor,
          offer.store_id,
          offer.id,
          "product.update",
          existing,
          updated,
          "Correção dos dados compartilhados do produto",
        );
      }
    }
    return p.productId;
  }
  const productId = id();
  await put("products", productId, {
    organization_id: actor.organization_id,
    version: 1,
    name: p.name,
    model: nullable(p.model),
    brand_id: await lookup(actor, "brands", p.brand),
    category_id: await lookup(actor, "categories", p.category),
  });
  return productId;
}
export async function saveOffer(
  actor: Actor,
  payload: unknown,
  offerId?: string,
) {
  canWrite(actor);
  const p = offerSchema.parse(payload);
  authorizeStore(actor, p.storeId);
  return transaction(() => saveOfferInside(actor, p, offerId));
}
async function saveOfferInside(
  actor: Actor,
  p: z.infer<typeof offerSchema>,
  offerId?: string,
) {
  const old = offerId ? await getOffer(actor, offerId) : undefined;
  if (old?.ml_apply_until > Date.now())
    throw new HttpError(
      409,
      "Aplicação de preço em andamento; aguarde a conferência",
    );
  if (old && old.store_id !== p.storeId)
    throw new HttpError(409, "O anúncio não pode ser transferido entre lojas");
  if (old && old.version !== p.version)
    throw new HttpError(
      409,
      "Anúncio alterado por outra operação; recarregue a ficha",
    );
  if (old && old.price !== p.price)
    throw new HttpError(
      409,
      "Mudanças de preço precisam de proposta e confirmação de aplicação",
    );
  if (old?.ml_status_uncertain && old.status !== p.status)
    throw new HttpError(409, "Confira a alteração de situação pendente no ML");
  if (p.type === "kit" && !p.components.length)
    throw new HttpError(
      422,
      "Cadastre a composição do kit. O custo deve ser do kit inteiro",
    );
  if (p.type === "variation" && !p.components.length)
    throw new HttpError(422, "Informe o produto e os atributos da variação");
  for (const c of p.components) {
    const component = await get("products", c.productId);
    if (!component || component.organization_id !== actor.organization_id)
      throw new HttpError(404, "Produto da composição não encontrado");
    if (p.type === "variation" && !c.variation?.trim())
      throw new HttpError(422, "Informe os atributos da variação");
  }
  const offerKey = offerId || id();
  if (p.mlId) await claim("offers.ml." + p.storeId, p.mlId, offerKey);
  if (old?.ml_id && old.ml_id !== p.mlId)
    await release("offers.ml." + p.storeId, old.ml_id, offerKey);
  const rawOld = old ? await get("offers", offerKey) : undefined;
  const productId = await product(actor, p);
  await put("offers", offerKey, {
    ...rawOld,
    organization_id: actor.organization_id,
    store_id: p.storeId,
    product_id: productId,
    title: p.title,
    sku: nullable(p.sku),
    ml_id: nullable(p.mlId),
    type: p.type,
    status: p.status,
    price: p.price,
    description: p.description,
    origin: p.origin,
    reference_account: nullable(p.referenceAccount),
    version: old ? old.version + 1 : 1,
    updated_at: now(),
  });
  for (const c of await find("components", { offer_id: offerKey }))
    await remove("components", c.id);
  for (const c of p.components)
    await put("components", id(), {
      offer_id: offerKey,
      product_id: c.productId,
      quantity: c.quantity,
      variation: nullable(c.variation),
    });
  if (!old)
    await put("costs", offerKey, {
      offer_id: offerKey,
      store_id: p.storeId,
      data_json: JSON.stringify(emptyCosts()),
      updated_at: now(),
    });
  await log(
    actor,
    p.storeId,
    offerKey,
    old ? "offer.update" : "offer.create",
    old,
    p,
    "Cadastro de anúncio",
    p.origin,
  );
  return getOffer(actor, offerKey);
}
export async function offerDetail(actor: Actor, offerId: string) {
  const offer = await getOffer(actor, offerId),
    [c, parametersRow, components, tasks, notes, proposals, history] =
      await Promise.all([
        costs(offerId),
        get("parameters", offer.store_id),
        find("components", { offer_id: offerId }),
        find("tasks", { offer_id: offerId }),
        find("notes", { offer_id: offerId }),
        find("proposals", { offer_id: offerId }),
        find("history", { offer_id: offerId }),
      ]);
  if (!parametersRow)
    throw new HttpError(409, "Parâmetros da loja não inicializados");
  const p: Parameters = parse(parametersRow.data_json);
  const productIds = [...new Set(components.map((c) => c.product_id))],
    names = new Map(
      (await Promise.all(productIds.map((p) => get("products", p))))
        .filter(Boolean)
        .map((p) => [p!.id, p!.name]),
    );
  const actors = new Map(
    (
      await Promise.all(
        [
          ...new Set(
            history.filter((h) => !h.actor_name).map((h) => h.actor_id),
          ),
        ].map((u) => get("users", u)),
      )
    )
      .filter(Boolean)
      .map((u) => [u!.id, u!.name]),
  );
  return {
    offer,
    costs: c,
    parameters: p,
    parametersRevision: parametersRow?.version || 1,
    calculation: calculate(
      offer.ml?.variablePrices ? null : offer.price,
      effectiveMlCosts(c, offer),
      p,
    ),
    quality: listingQuality(offer),
    mlMetrics: (await get("ml_metrics", offerId)) || null,
    draftMedia:
      offer.origin !== "reference" ? await draftMedia(actor, offerId) : [],
    mlCompetition: (await get("ml_competition", offerId)) || null,
    competitorTitles: (await find("competitors", { offer_id: offerId }))
      .filter(
        (r) =>
          r.store_id === offer.store_id &&
          r.organization_id === actor.organization_id,
      )
      .slice(0, 40)
      .map((r) => ({ title: r.title, observedAt: r.observed_at })),
    mlConnection: ((connection) =>
      connection ? publicConnection(connection) : null)(
      await get("connections", key(offer.store_id, "mercadolivre")),
    ),
    components: components.map((c): Row => ({
      ...c,
      product_name: names.get(c.product_id),
    })),
    tasks: sorted(tasks),
    notes: sorted(notes),
    proposals: sorted(proposals).map((x) => ({
      ...x,
      snapshot: parse(x.snapshot_json),
    })),
    history: sorted(history).map((h) => ({
      ...h,
      actor_name: h.actor_name || actors.get(h.actor_id) || h.actor_id,
    })),
  };
}
export async function saveCosts(
  actor: Actor,
  offerId: string,
  payload: unknown,
) {
  canWrite(actor);
  const { offerVersion, ...p } = costSchema
    .extend({ offerVersion: z.number().int().positive().optional() })
    .parse(payload);
  if (p.other !== null && Number(p.other) > 0 && !p.otherDescription.trim())
    throw new HttpError(422, "Descreva os outros custos");
  return transaction(async () => {
    const o = await getOffer(actor, offerId),
      before = await costs(offerId);
    if (o.ml_apply_until > Date.now())
      throw new HttpError(
        409,
        "Aplicação de preço em andamento; aguarde a conferência",
      );
    if (offerVersion !== undefined && offerVersion !== o.version)
      throw new HttpError(
        409,
        "Custos alterados por outra operação; recarregue antes de salvar",
      );
    await put("costs", offerId, {
      offer_id: offerId,
      store_id: o.store_id,
      data_json: JSON.stringify(p),
      updated_at: now(),
    });
    await put("offers", offerId, {
      ...(await get("offers", offerId)),
      version: o.version + 1,
      updated_at: now(),
    });
    await log(
      actor,
      o.store_id,
      offerId,
      "costs",
      before,
      p,
      "Atualização dos custos da oferta",
    );
    return offerDetail(actor, offerId);
  });
}
export async function saveParameters(
  actor: Actor,
  storeId: string,
  payload: unknown,
) {
  admin(actor);
  authorizeStore(actor, storeId);
  const p = parameterSchema.parse(payload);
  return transaction(async () => {
    const row = await get("parameters", storeId),
      before = await params(storeId);
    if (
      (await find("offers", { store_id: storeId })).some(
        (o) => o.ml_apply_until > Date.now(),
      )
    )
      throw new HttpError(
        409,
        "Uma aplicação de preço está em andamento nesta loja; tente novamente em instantes",
      );
    await put("parameters", storeId, {
      store_id: storeId,
      data_json: JSON.stringify(p),
      version: (row?.version || 1) + 1,
      updated_at: now(),
    });
    await log(
      actor,
      storeId,
      null,
      "parameters",
      before,
      p,
      "Parâmetros financeiros da loja",
    );
    return p;
  });
}
export async function simulate(
  actor: Actor,
  offerId: string,
  payload: unknown,
  save = false,
) {
  if (save) canWrite(actor);
  return transaction(() => simulateInside(actor, offerId, payload, save));
}
async function simulateInside(
  actor: Actor,
  offerId: string,
  payload: unknown,
  save: boolean,
) {
  const o = await getOffer(actor, offerId),
    input = simulationSchema.parse(payload),
    [c, p, parametersRow] = await Promise.all([
      costs(offerId),
      params(o.store_id),
      get("parameters", o.store_id),
    ]);
  if (
    (input.mode === "price" && input.price == null) ||
    (input.mode === "discount" && input.discount == null)
  )
    throw new HttpError(
      422,
      "Informe preço ou desconto conforme o modo escolhido",
    );
  if (o.ml?.variablePrices)
    throw new HttpError(
      422,
      "Precifique individualmente as variações com preços diferentes",
    );
  let quote: Row | null = null;
  const manualShipping =
    input.mlShippingMode !== "automatic" &&
    (input.shipping !== undefined ||
      (input.costOverrides ?? c).shipping != null);
  if (input.mlShippingMode === "automatic" && !input.mlQuoteId)
    throw new HttpError(422, "Consulte o ML para usar o frete automático.");
  if (input.mlQuoteId) {
    const provisional = calculate(o.price, c, p, input);
    if (!provisional.price)
      throw new HttpError(
        422,
        "Informe um preço válido para consultar a tarifa",
      );
    quote = await validateQuote(actor, o, input.mlQuoteId, provisional.price);
    input.mlPercent = quote.mlPercent;
    input.mlFixed = quote.mlFixed;
    if (!manualShipping && quote.shipping?.amount != null)
      input.shipping = quote.shipping.amount;
    if (input.mlShippingMode === "automatic" && quote.shipping?.amount == null)
      throw new HttpError(
        422,
        "Frete automático indisponível nesta consulta; confira ou informe uma condição manual.",
      );
  }
  const scenarioPrice = calculate(o.price, c, p, input).price;
  const effective = effectiveMlCosts(c, o, Date.now(), scenarioPrice);
  const proposed = calculate(o.price, effective, p, {
    ...input,
    ...(input.costOverrides
      ? {
          costOverrides: effectiveMlCosts(
            input.costOverrides,
            o,
            Date.now(),
            scenarioPrice,
          ),
        }
      : {}),
  });
  if (!proposed.price)
    throw new HttpError(422, "O preço proposto deve ser maior que zero");
  const snapshot = {
    offer: {
      id: o.id,
      title: o.title,
      description: o.description,
      price: o.price,
      version: o.version,
    },
    input,
    costs: c,
    parameters: p,
    parametersRevision: parametersRow?.version || 1,
    current: calculate(o.price, effectiveMlCosts(c, o), p),
    proposed,
    mlShippingApplied:
      !!quote && !manualShipping && quote.shipping?.amount != null,
    calculatedAt: now(),
    mlQuote: quote,
  };
  if (save) {
    canWrite(actor);
    await put("simulations", id(), {
      store_id: o.store_id,
      offer_id: offerId,
      author_id: actor.id,
      snapshot_json: JSON.stringify(snapshot),
      created_at: now(),
    });
  }
  return snapshot;
}
export async function createProposal(
  actor: Actor,
  payload: unknown,
): Promise<Row> {
  canWrite(actor);
  const p = proposalSchema.parse(payload);
  return transaction(async () => {
    const offer = await getOffer(actor, p.offerId);
    if (offer.origin === "reference")
      throw new HttpError(
        422,
        "Uma referência externa não é um anúncio operacional",
      );
    const op = await operation(actor, "proposal", p.requestId, {
      offerId: p.offerId,
      input: simulationSchema.parse(p.input),
      reason: p.reason,
      offerVersion: p.offerVersion,
      parametersVersion: p.parametersVersion,
    });
    if (op.existing) {
      const existing = (await get("proposals", op.existing.entity_id))!;
      return { ...existing, snapshot: parse(existing.snapshot_json) };
    }
    const snapshot = await simulate(actor, p.offerId, p.input),
      proposalId = id();
    if (
      (p.offerVersion !== undefined &&
        p.offerVersion !== snapshot.offer.version) ||
      (p.parametersVersion !== undefined &&
        p.parametersVersion !== snapshot.parametersRevision)
    )
      throw new HttpError(
        409,
        "Os dados mudaram desde o cálculo. Calcule novamente antes de salvar a proposta",
      );
    const row = await put("proposals", proposalId, {
      store_id: offer.store_id,
      offer_id: offer.id,
      author_id: actor.id,
      status: "review",
      reason: p.reason,
      snapshot_json: JSON.stringify(snapshot),
      base_version: offer.version,
      request_id: p.requestId,
      created_at: now(),
      updated_at: now(),
    });
    await recordOperation(actor, op, proposalId, offer.store_id);
    await log(
      actor,
      offer.store_id,
      offer.id,
      "proposal",
      null,
      snapshot.proposed,
      p.reason,
      "manual",
      "review",
      snapshot,
      proposalId,
      p.requestId,
    );
    return { ...row, snapshot };
  });
}
export async function decideProposal(
  actor: Actor,
  proposalId: string,
  payload: unknown,
) {
  canWrite(actor);
  const p = decisionSchema.parse(payload);
  return transaction(async () => {
    const proposal = await get("proposals", proposalId);
    if (!proposal) throw new HttpError(404, "Proposta não encontrada");
    authorizeStore(actor, proposal.store_id);
    if (["applying_ml", "application_uncertain"].includes(proposal.status))
      throw new HttpError(
        409,
        "Confira a aplicação no ML antes de alterar a etapa",
      );
    const op = await operation(actor, "decision", p.requestId, {
      proposalId,
      action: p.action,
      comment: p.comment,
    });
    if (op.existing) return proposal;
    const snapshot = parse(proposal.snapshot_json),
      offer = await getOffer(actor, proposal.offer_id);
    let status = "";
    if (p.action === "approve" || p.action === "reject") {
      canApprove(actor);
      if (proposal.status !== "review")
        throw new HttpError(409, "A proposta não está aguardando revisão");
      status = p.action === "approve" ? "approved" : "rejected";
      await put("approvals", id(), {
        proposal_id: proposalId,
        user_id: actor.id,
        decision: p.action,
        comment: p.comment,
        created_at: now(),
      });
    } else if (p.action === "cancel") {
      if (proposal.author_id !== actor.id) canApprove(actor);
      if (
        ["applied_manual", "applied_ml", "rejected", "cancelled"].includes(
          proposal.status,
        )
      )
        throw new HttpError(409, "Esta proposta já está encerrada");
      status = "cancelled";
    } else if (p.action === "request") {
      if (!["approved", "failed"].includes(proposal.status))
        throw new HttpError(
          409,
          "A proposta precisa estar aprovada para solicitar aplicação",
        );
      status = "pending_application";
    } else if (p.action === "fail") {
      if (proposal.status !== "pending_application")
        throw new HttpError(409, "Não há aplicação pendente");
      status = "failed";
      await put("applications", id(), {
        proposal_id: proposalId,
        request_id: p.requestId,
        actor_id: actor.id,
        result: status,
        evidence: p.comment,
        created_at: now(),
      });
    } else {
      if (proposal.status !== "pending_application")
        throw new HttpError(409, "Solicite a aplicação após a aprovação");
      const pr = await get("parameters", offer.store_id);
      if (
        offer.version !== proposal.base_version ||
        (snapshot.parametersRevision !== undefined
          ? snapshot.parametersRevision !== (pr?.version || 1)
          : JSON.stringify(snapshot.parameters) !== pr?.data_json)
      )
        throw new HttpError(
          409,
          "Dados atuais mudaram após a proposta; prepare uma nova proposta",
        );
      const priceChanged =
        offer.price === null ||
        !new Decimal(snapshot.proposed.price).eq(offer.price);
      const costsChanged =
        !!snapshot.input.costOverrides ||
        ["mlPercent", "mlFixed", "shipping", "advertising"].some(
          (k) => snapshot.input[k] !== undefined,
        );
      const conditionsChanged = mlConditionsChanged(
        snapshot.costs,
        snapshot.input,
      );
      if ((priceChanged || costsChanged) && snapshot.proposed.pending.length)
        throw new HttpError(
          422,
          "Complete os dados financeiros antes de aplicar mudanças de preço ou custos",
        );
      if (
        (priceChanged || conditionsChanged) &&
        !snapshot.input.conditionsVerified
      )
        throw new HttpError(
          422,
          "Revalide tarifa e frete antes de preparar a proposta",
        );
      const nextTitle = snapshot.input.proposedTitle?.trim() || offer.title,
        nextDescription =
          snapshot.input.proposedDescription ?? offer.description;
      await put("offers", offer.id, {
        ...(await get("offers", offer.id)),
        price: snapshot.proposed.price,
        title: nextTitle,
        description: nextDescription,
        version: offer.version + 1,
        updated_at: now(),
      });
      const updated = costsAfterProposal(snapshot);
      const financial = financialAfterApplication(
        snapshot,
        offer,
        actor.organization_id,
      );
      if (financial) await put("ml_financials", offer.id, financial);
      await put("costs", offer.id, {
        offer_id: offer.id,
        store_id: offer.store_id,
        data_json: JSON.stringify(updated),
        updated_at: now(),
      });
      status = "applied_manual";
      await claim("applications.success", proposalId, p.requestId);
      await put("applications", id(), {
        proposal_id: proposalId,
        request_id: p.requestId,
        actor_id: actor.id,
        result: status,
        evidence: p.comment,
        created_at: now(),
      });
      for (const [field, before, after] of [
        ["price", offer.price, snapshot.proposed.price],
        ["title", offer.title, nextTitle],
        ["description", offer.description, nextDescription],
      ])
        if (before !== after)
          await log(
            actor,
            offer.store_id,
            offer.id,
            field,
            before,
            after,
            p.comment,
            "manual_confirmation",
            status,
            snapshot,
            proposalId,
          );
    }
    const next = await put("proposals", proposalId, {
      ...proposal,
      status,
      updated_at: now(),
    });
    await recordOperation(actor, op, proposalId, proposal.store_id);
    await log(
      actor,
      proposal.store_id,
      proposal.offer_id,
      "proposal." + p.action,
      proposal.status,
      status,
      p.comment,
      p.action === "apply_manual" ? "manual_confirmation" : "manual",
      status,
      snapshot,
      proposalId,
      p.requestId,
    );
    return next;
  });
}
export async function saveTask(
  actor: Actor,
  payload: unknown,
  taskId?: string,
) {
  canWrite(actor);
  const p = taskSchema.parse(payload);
  authorizeStore(actor, p.storeId);
  return transaction(async () => {
    if (p.offerId && (await getOffer(actor, p.offerId)).store_id !== p.storeId)
      throw new HttpError(
        422,
        "Anúncio e tarefa precisam pertencer à mesma loja",
      );
    const old = taskId ? await get("tasks", taskId) : undefined;
    if (taskId && !old) throw new HttpError(404, "Tarefa não encontrada");
    if (old) {
      authorizeStore(actor, old.store_id);
      if (old.store_id !== p.storeId)
        throw new HttpError(422, "A tarefa não pode mudar de loja");
    }
    if (old && p.version !== undefined && p.version !== (old.version || 1))
      throw new HttpError(409, "Tarefa alterada; recarregue antes de salvar");
    const documentId = taskId || id(),
      row = await put("tasks", documentId, {
        ...old,
        organization_id: actor.organization_id,
        store_id: p.storeId,
        offer_id: nullable(p.offerId),
        source_note_id: old?.source_note_id || null,
        version: old ? (old.version || 1) + 1 : 1,
        title: p.title,
        description: p.description,
        type: p.type,
        priority: p.priority,
        status: p.status,
        assignee: p.assignee,
        due_date: p.dueDate || null,
        reason: p.reason,
        result: p.result,
        evidence: p.evidence,
        created_at: old?.created_at || now(),
        updated_at: now(),
      });
    await log(
      actor,
      p.storeId,
      p.offerId || null,
      "task",
      old,
      row,
      p.reason || "Organização do trabalho",
    );
    return row;
  });
}
export async function saveNote(
  actor: Actor,
  payload: unknown,
  noteId?: string,
) {
  canWrite(actor);
  const p = noteSchema.parse(payload);
  if (p.storeId) authorizeStore(actor, p.storeId);
  return transaction(async () => {
    if (p.offerId && (await getOffer(actor, p.offerId)).store_id !== p.storeId)
      throw new HttpError(
        422,
        "Anúncio e nota precisam pertencer à mesma loja",
      );
    const old = noteId ? await get("notes", noteId) : undefined;
    if (noteId && (!old || old.organization_id !== actor.organization_id))
      throw new HttpError(404, "Nota não encontrada");
    if (old?.store_id) authorizeStore(actor, old.store_id);
    if (old && p.version !== undefined && p.version !== (old.version || 1))
      throw new HttpError(409, "Nota alterada; recarregue antes de salvar");
    const row = await put("notes", noteId || id(), {
      ...old,
      organization_id: actor.organization_id,
      store_id: nullable(p.storeId),
      offer_id: nullable(p.offerId),
      author_id: old?.author_id || actor.id,
      version: old ? (old.version || 1) + 1 : 1,
      updated_at: now(),
      kind: p.kind,
      title: p.title,
      body: p.body,
      sources: p.sources,
      practical_use: p.practicalUse,
      created_at: old?.created_at || now(),
    });
    await log(
      actor,
      p.storeId || "",
      p.offerId || null,
      old ? "note.update" : "note.create",
      old,
      row,
      "Anotação salva",
    );
    return row;
  });
}
export async function noteToTask(
  actor: Actor,
  noteId: string,
  payload: unknown,
) {
  canWrite(actor);
  const p = z.object({ storeId: z.string().min(1) }).parse(payload);
  authorizeStore(actor, p.storeId);
  return transaction(async () => {
    const note = await get("notes", noteId);
    if (!note || note.organization_id !== actor.organization_id)
      throw new HttpError(404, "Nota não encontrada");
    if (note.store_id) {
      authorizeStore(actor, note.store_id);
      if (note.store_id !== p.storeId)
        throw new HttpError(422, "A tarefa precisa usar a loja da nota");
    }
    const taskId = key("note-task", noteId),
      existing = await get("tasks", taskId);
    if (existing) {
      authorizeStore(actor, existing.store_id);
      if (existing.store_id !== p.storeId)
        throw new HttpError(
          409,
          "Esta nota já tem uma tarefa vinculada a outra loja",
        );
      return existing;
    }
    const row = await put("tasks", taskId, {
      organization_id: actor.organization_id,
      store_id: p.storeId,
      offer_id: note.offer_id,
      source_note_id: noteId,
      version: 1,
      title: note.title,
      description: note.body,
      type: "estudo",
      priority: "medium",
      status: "todo",
      assignee: actor.name,
      due_date: null,
      reason: "Criada a partir de nota",
      result: "",
      evidence: note.sources,
      created_at: now(),
      updated_at: now(),
    });
    await log(
      actor,
      p.storeId,
      note.offer_id,
      "note.to_task",
      noteId,
      taskId,
      "Nota transformada em tarefa sem perder vínculo",
    );
    return row;
  });
}
export async function workspace(actor: Actor, query: URLSearchParams) {
  const selected = query.get("store"),
    ids = scoped(actor, selected);
  const [
    rawOffers,
    products,
    brands,
    categories,
    costRows,
    parameterRows,
    tasks,
    allNotes,
    proposals,
    history,
    connections,
    metricsRows,
    currentQuotes,
    financialRows,
  ] = await Promise.all([
    list(actor, "offers", selected),
    find("products", { organization_id: actor.organization_id }),
    find("brands", { organization_id: actor.organization_id }),
    find("categories", { organization_id: actor.organization_id }),
    list(actor, "costs", selected),
    Promise.all(ids.map((s) => get("parameters", s))),
    list(actor, "tasks", selected),
    find("notes", { organization_id: actor.organization_id }),
    list(actor, "proposals", selected),
    list(actor, "history", selected),
    list(actor, "connections", selected),
    list(actor, "ml_metrics_7d", selected),
    list(actor, "ml_current_quotes", selected),
    list(actor, "ml_financials", selected),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p])),
    metricsMap = new Map(metricsRows.map((m) => [m.offer_id, m])),
    quoteMap = new Map(currentQuotes.map((m) => [m.offer_id, m])),
    financialMap = new Map(financialRows.map((m) => [m.offer_id, m])),
    connectionMap = new Map(
      connections
        .filter((c) => c.provider === "mercadolivre")
        .map((c) => [c.store_id, c]),
    ),
    brandMap = new Map(brands.map((b) => [b.id, b.name])),
    categoryMap = new Map(categories.map((c) => [c.id, c.name])),
    costMap = new Map(costRows.map((c) => [c.id, c])),
    parameterMap = new Map(
      parameterRows
        .filter(Boolean)
        .map((p) => [p!.store_id, parse(p!.data_json)]),
    );
  const offers = rawOffers.map(
    (o): Row & { calculation: ReturnType<typeof calculate> } => {
      const p = productMap.get(o.product_id);
      if (!p) throw new HttpError(409, "Produto de uma oferta não encontrado");
      const c = costMap.get(o.id),
        parameter = parameterMap.get(o.store_id);
      const enriched = attachFinancial(
        o,
        financialMap.get(o.id),
        connectionMap.get(o.store_id),
        actor.organization_id,
      );
      const effective = effectiveMlCosts(
        c ? parse(c.data_json) : emptyCosts(),
        enriched,
      );
      const calculation = calculate(
        o.ml?.variablePrices ? null : o.price,
        effective,
        parameter,
      );
      const brand = brandMap.get(p.brand_id) || null,
        category = categoryMap.get(p.category_id) || null;
      const account = connectionMap.get(o.store_id),
        metric = metricsMap.get(o.id),
        quote = quoteMap.get(o.id);
      const matching = (snapshot: Row | undefined) =>
        !!snapshot &&
        account?.status === "connected" &&
        snapshot.seller_id === account.external_account &&
        snapshot.auth_version === account.auth_version;
      const metrics7d =
        matching(metric) && metric?.periodDays === 7
          ? {
              visits: metric.visits,
              paidOrders: metric.paidOrders,
              units: metric.units,
              orderVisitRate: metric.orderVisitRate,
              from: metric.from,
              to: metric.to,
              observedAt: metric.observed_at,
            }
          : null;
      const tariff =
        quote &&
        matching(quote) &&
        quote?.offer_version === o.version &&
        quote.expires_at > Date.now() &&
        o.price != null &&
        new Decimal(quote.price).eq(o.price)
          ? quote
          : enriched.mlFinancial?.expires_at > Date.now()
            ? enriched.mlFinancial
            : null;
      const shipping = effective.shipping;
      return {
        ...enriched,
        metrics7d,
        settlementEstimate:
          tariff && shipping != null
            ? {
                amount: new Decimal(o.price)
                  .minus(tariff.total)
                  .minus(shipping)
                  .toFixed(2),
                fee: tariff.total,
                shipping,
                quotedAt: tariff.quoted_at,
                estimated: true,
              }
            : null,
        // Full media and technical attributes are loaded in the individual ficha.
        ...(o.ml
          ? {
              ml: (({
                pictures,
                attributes,
                variationDetails,
                ...summary
              }: Row) => ({
                ...summary,
                thumbnailUrl:
                  pictures
                    ?.map((p: Row) => safePictureUrl(p.url))
                    .find(Boolean) || null,
              }))(o.ml),
            }
          : {}),
        product_name: p.name,
        model: p.model,
        brand,
        category,
        store_name: actor.stores.find((s) => s.id === o.store_id)?.name,
        costs_updated_at: c?.updated_at || null,
        pending: [
          ...(o.ml_status_uncertain ? ["Conferir situação no ML"] : []),
          ...(!brand ? ["Sem marca"] : []),
          ...(!category ? ["Sem categoria"] : []),
          ...(!o.ml_id ? ["Sem código ML"] : []),
          ...(!o.sku ? ["Sem SKU"] : []),
          ...calculation.pending,
        ],
        calculation,
        quality: listingQuality({ ...o, brand }),
        costs_stale:
          !c?.updated_at ||
          Date.now() - Date.parse(c.updated_at) >
            parameter.reviewDays * 86400000,
      };
    },
  );
  const filtered = offers.filter((o) => {
    const q = query.get("q")?.toLocaleLowerCase("pt-BR") || "";
    if (
      q &&
      ![o.title, o.product_name, o.sku, o.ml_id, o.model, o.brand]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(q)
    )
      return false;
    for (const field of ["brand", "category", "status", "type"]) {
      const values = query.getAll(field);
      if (values.length && !values.includes((o as Row)[field] || "__missing"))
        return false;
    }
    const listing = query.get("listingKind");
    if (listing === "catalog" && !o.ml?.catalogListing) return false;
    if (listing === "traditional" && (!o.ml?.sellerId || o.ml.catalogListing))
      return false;
    if (listing === "local" && o.ml?.sellerId && o.origin !== "reference")
      return false;
    if (query.get("pending") === "yes" && !o.pending.length) return false;
    if (
      query.get("pending") === "costs" &&
      !o.costs_stale &&
      !o.calculation.pending.length
    )
      return false;
    return true;
  });
  const visibleIds = new Set(filtered.map((o) => o.id)),
    related = (rows: Row[]) =>
      query.has("brand") || query.has("category")
        ? rows.filter((r) => !r.offer_id || visibleIds.has(r.offer_id))
        : rows;
  const notes = sorted(
    allNotes.filter((n) => !n.store_id || ids.includes(n.store_id)),
  );
  const actorNames = new Map(
    (
      await Promise.all(
        [
          ...new Set(
            history.filter((h) => !h.actor_name).map((h) => h.actor_id),
          ),
        ].map((u) => get("users", u)),
      )
    )
      .filter(Boolean)
      .map((u) => [u!.id, u!.name]),
  );
  const logs: Row[] = [];
  for (const c of connections)
    logs.push(
      ...(await find("sync_logs", { connection_id: c.id })).map((l) => ({
        ...l,
        store_id: c.store_id,
        provider: c.provider,
      })),
    );
  return {
    user: actor,
    stores: actor.stores,
    offers: filtered,
    listingCounts: listingCounts(filtered),
    offerChoices: offers,
    products: products.map((p) => ({
      ...p,
      brand: brandMap.get(p.brand_id) || null,
      category: categoryMap.get(p.category_id) || null,
    })),
    tasks: related(tasks),
    notes: related(notes),
    proposals: related(proposals).map((p) => ({
      ...p,
      snapshot: parse(p.snapshot_json),
    })),
    history: related(history).map((h): Row => ({
      ...h,
      actor_name: h.actor_name || actorNames.get(h.actor_id) || h.actor_id,
    })),
    connections: connections.map((c) =>
      c.provider === "mercadolivre"
        ? publicConnection(c)
        : {
            ...c,
            configured: adapters[c.provider as Provider].configured(),
            status: adapters[c.provider as Provider].configured()
              ? "unauthorized"
              : "unconfigured",
          },
    ),
    logs: sorted(logs).slice(0, 100),
    parameters: ids.map((storeId) => ({
      storeId,
      ...parameterMap.get(storeId),
    })),
    powerBiUrl: reportUrl(),
    summary: {
      totalOffers: offers.length,
      pendingOffers: offers.filter((o) => o.pending.length).length,
      staleCosts: offers.filter(
        (o) => o.costs_stale || o.calculation.pending.length,
      ).length,
      reviewProposals: proposals.filter((p) => p.status === "review").length,
    },
  };
}
export async function batchOffers(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = batchSchema.parse(payload);
  return transaction(async () => {
    const op = await operation(actor, "batch-edit", p.requestId, p);
    if (op.existing) return { count: new Set(p.ids).size };
    const rows = await Promise.all(
      [...new Set(p.ids)].map((offerId) => getOffer(actor, offerId)),
    );
    for (const o of rows) {
      if (o.ml_apply_until > Date.now())
        throw new HttpError(
          409,
          "Uma operação ML está em andamento; aguarde a conferência",
        );
      if (p.status && o.ml_status_uncertain)
        throw new HttpError(
          409,
          "Confira a alteração de situação pendente no ML",
        );
      if (p.versions[o.id] !== o.version)
        throw new HttpError(
          409,
          "Um anúncio mudou; recarregue antes de editar o lote",
        );
      const title = [p.titlePrefix, o.title, p.titleSuffix]
        .filter(Boolean)
        .join(" ");
      if (title.length > 200)
        throw new HttpError(
          422,
          "Um título excederia 200 caracteres; reduza o prefixo ou sufixo",
        );
    }
    for (const o of rows) {
      const offerId = o.id;
      const changes: Row = {};
      if (p.status) changes.status = p.status;
      if (p.description !== undefined) changes.description = p.description;
      if (p.titlePrefix || p.titleSuffix)
        changes.title = [p.titlePrefix, o.title, p.titleSuffix]
          .filter(Boolean)
          .join(" ");
      await put("offers", offerId, {
        ...(await get("offers", offerId)),
        ...changes,
        version: o.version + 1,
        updated_at: now(),
      });
      for (const [field, value] of Object.entries(changes))
        await log(
          actor,
          o.store_id,
          offerId,
          field,
          o[field],
          value,
          "Alteração em lote confirmada",
        );
    }
    await recordOperation(actor, op, p.ids[0], rows[0].store_id);
    return { count: new Set(p.ids).size };
  });
}
export async function batchDeleteOffers(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = z
    .object({
      ids: z.array(z.string().min(1)).min(1).max(40),
      versions: z.record(z.string(), z.number().int().positive()),
      requestId: z.uuid(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(payload);
  return transaction(async () => {
    const op = await operation(actor, "batch-delete", p.requestId, p);
    if (op.existing) return { count: new Set(p.ids).size };
    let writes = 1;
    for (const offerId of [...new Set(p.ids)]) {
      await getOffer(actor, offerId);
      const children = await Promise.all([
        find("components", { offer_id: offerId }),
        find("simulations", { offer_id: offerId }),
        find("competitors", { offer_id: offerId }),
      ]);
      writes += 6 + children.reduce((n, rows) => n + rows.length, 0);
    }
    if (writes > 400)
      throw new HttpError(
        422,
        "O lote possui muitos registros vinculados; selecione menos anúncios para excluir",
      );
    let store = "";
    for (const offerId of [...new Set(p.ids)]) {
      const row = await getOffer(actor, offerId);
      if (row.ml_apply_until > Date.now())
        throw new HttpError(
          409,
          "Uma operação ML está em andamento; aguarde a conferência",
        );
      if (!p.versions[offerId])
        throw new HttpError(409, "Confira a versão de todos os anúncios");
      store = row.store_id;
      await deleteRecord(actor, "offers", offerId, {
        requestId: randomUUID(),
        version: p.versions[offerId],
      });
    }
    await recordOperation(actor, op, p.ids[0], store);
    return { count: new Set(p.ids).size };
  });
}
export async function createStore(actor: Actor, payload: unknown) {
  admin(actor);
  const p = storeSchema.parse(payload);
  return transaction(async () => {
    const storeId = id();
    await claim("stores.name." + actor.organization_id, p.name, storeId);
    const row = await put("stores", storeId, {
      organization_id: actor.organization_id,
      name: p.name,
      active: 1,
    });
    await put("parameters", storeId, {
      store_id: storeId,
      data_json: JSON.stringify({
        minMargin: null,
        desiredMargin: null,
        taxRate: null,
        taxBase: null,
        managementRate: "1",
        managementBase: null,
        reviewDays: 30,
      }),
      version: 1,
      updated_at: now(),
    });
    for (const provider of ["mercadolivre", "bling", "ai"])
      await put("connections", key(storeId, provider), {
        store_id: storeId,
        provider,
        status: "unconfigured",
        external_account: null,
        updated_at: now(),
      });
    return row;
  });
}
export async function updateStore(
  actor: Actor,
  storeId: string,
  payload: unknown,
) {
  admin(actor);
  authorizeStore(actor, storeId);
  const p = storeSchema.parse(payload);
  return transaction(async () => {
    const old = await get("stores", storeId);
    if (!old || old.organization_id !== actor.organization_id)
      throw new HttpError(404, "Loja não encontrada");
    await claim("stores.name." + actor.organization_id, p.name, storeId);
    if (old.name !== p.name)
      await release("stores.name." + actor.organization_id, old.name, storeId);
    const row = await put("stores", storeId, { ...old, name: p.name });
    await log(
      actor,
      storeId,
      null,
      "store.update",
      old.name,
      p.name,
      "Nome da loja atualizado",
    );
    return row;
  });
}
export async function deleteRecord(
  actor: Actor,
  collection: "offers" | "tasks" | "notes",
  documentId: string,
  payload: unknown,
) {
  canWrite(actor);
  const p = z
    .object({ requestId: z.uuid(), version: z.number().int().positive() })
    .parse(payload);
  return transaction(async () => {
    const op = await operation(actor, "delete", p.requestId, {
      collection,
      documentId,
      version: p.version,
    });
    if (op.existing) return { deleted: true, id: documentId };
    const row = await get(collection, documentId);
    if (!row || row.organization_id !== actor.organization_id)
      throw new HttpError(404, "Registro não encontrado");
    if (row.store_id) authorizeStore(actor, row.store_id);
    if (p.version !== (row.version || 1))
      throw new HttpError(
        409,
        "Registro alterado; recarregue antes de excluir",
      );
    if (collection === "offers") {
      if (
        (await find("listing_media", { offer_id: documentId })).some((r) =>
          ["ready", "uploading", "deleting"].includes(r.status),
        )
      )
        throw new HttpError(
          409,
          "Remova a mídia em rascunho antes de excluir o anúncio",
        );
      if (row.ml_apply_until > Date.now() || row.ml_status_uncertain)
        throw new HttpError(
          409,
          "Confira a operação ML pendente antes de excluir",
        );
      if (row.status !== "draft" && row.origin !== "reference")
        throw new HttpError(
          409,
          "Para retirar um anúncio da operação, altere a situação para Encerrado. Apenas rascunhos sem vínculos podem ser excluídos",
        );
      const [tasks, notes, proposals] = await Promise.all([
        find("tasks", { offer_id: documentId }),
        find("notes", { offer_id: documentId }),
        find("proposals", { offer_id: documentId }),
      ]);
      if (tasks.length || notes.length || proposals.length)
        throw new HttpError(
          409,
          "Este anúncio possui tarefas, notas ou propostas. Use a situação Encerrado para preservar os vínculos",
        );
      for (const collectionName of ["components", "simulations"])
        for (const child of await find(collectionName, {
          offer_id: documentId,
        }))
          await remove(collectionName, child.id);
      await remove("costs", documentId);
      for (const reference of await find("competitors", {
        offer_id: documentId,
      }))
        await put("competitors", reference.id, {
          ...reference,
          offer_id: null,
          version: reference.version + 1,
          updated_at: now(),
        });
      if (row.ml_id)
        await release("offers.ml." + row.store_id, row.ml_id, documentId);
    }
    if (
      collection === "notes" &&
      (await find("tasks", { source_note_id: documentId })).length
    )
      throw new HttpError(
        409,
        "Esta nota originou uma tarefa. Exclua a tarefa primeiro para preservar o vínculo",
      );
    await remove(collection, documentId);
    const storeId = row.store_id || "";
    await log(
      actor,
      storeId,
      collection === "offers" ? documentId : row.offer_id || null,
      collection.slice(0, -1) + ".delete",
      row,
      null,
      "Exclusão confirmada pelo usuário",
      "manual",
      "deleted",
    );
    await recordOperation(actor, op, documentId, storeId);
    return { deleted: true, id: documentId };
  });
}
export async function importPreview(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = importPreviewSchema.parse(payload);
  authorizeStore(actor, p.storeId);
  const seen = new Set<string>(),
    existing = await find("offers", { store_id: p.storeId });
  const rows = await Promise.all(
    p.rows.map(async (row, index) => {
      const errors: string[] = [];
      if (row.type !== "unit")
        errors.push(
          "Kits e variações exigem cadastro da composição pela ficha",
        );
      if (row.origin === "reference" && !row.referenceAccount)
        errors.push("Conta de origem obrigatória");
      const identity =
        p.mode === "update" && row.id
          ? "id:" + row.id
          : row.mlId
            ? "ml:" + row.mlId
            : `sku:${row.sku || ""}|${row.title}`;
      if (seen.has(identity)) errors.push("Duplicidade dentro do arquivo");
      seen.add(identity);
      if (
        p.mode === "create" &&
        existing.some((o) =>
          row.mlId
            ? o.ml_id === row.mlId
            : (o.sku || "") === (row.sku || "") && o.title === row.title,
        )
      )
        errors.push("Oferta já cadastrada na loja; atualize pela ficha");
      if (row.storeId && row.storeId !== p.storeId)
        errors.push("A loja original da planilha difere da loja de destino");
      if (p.mode === "update") {
        const current = existing.find((o) => o.id === row.id);
        if (!row.id || !current)
          errors.push(
            "ID não encontrado nesta loja; use uma planilha exportada pelo sistema",
          );
        else {
          if (row.version !== current.version)
            errors.push("Registro alterado; exporte uma planilha atualizada");
          if (row.price !== current.price)
            errors.push(
              "Mudança de preço exige proposta e confirmação pela ficha",
            );
          if (row.type !== current.type)
            errors.push(
              "Mudança de tipo exige edição da composição pela ficha",
            );
          const product = await getOffer(actor, current.id);
          if (
            ["name", "model", "brand", "category"].some(
              (k) =>
                (row as Row)[k] !== undefined &&
                String((row as Row)[k] || "") !==
                  String(product[k === "name" ? "product_name" : k] || ""),
            )
          )
            errors.push("Corrija os dados do produto compartilhado pela ficha");
          if (
            row.mlId &&
            existing.some((o) => o.id !== current.id && o.ml_id === row.mlId)
          )
            errors.push("Código ML pertence a outro anúncio nesta loja");
        }
      }
      return {
        line: index + 2,
        data: row,
        errors,
        pending: [
          ...(!row.brand ? ["Sem marca"] : []),
          ...(!row.category ? ["Sem categoria"] : []),
          ...(row.price === null ? ["Sem preço"] : []),
          ...(!row.mlId ? ["Sem código ML"] : []),
        ],
      };
    }),
  );
  return {
    storeId: p.storeId,
    mode: p.mode,
    rows,
    total: rows.length,
    valid: rows.every((r) => !r.errors.length),
    pending: rows.filter((r) => r.pending.length).length,
  };
}
export async function confirmImport(actor: Actor, payload: unknown) {
  const p = importSchema.extend({ requestId: z.uuid() }).parse(payload);
  canWrite(actor);
  authorizeStore(actor, p.storeId);
  return transaction(async () => {
    const op = await operation(actor, "import", p.requestId, {
      storeId: p.storeId,
      mode: p.mode,
      rows: p.rows,
    });
    if (op.existing) {
      const old = (await get("imports", op.existing.entity_id))!;
      return { count: old.count, id: old.id };
    }
    const preview = await importPreview(actor, p);
    if (!preview.valid)
      throw new HttpError(422, "Resolva os erros da prévia antes de importar");
    for (const row of p.rows) {
      const current =
        p.mode === "update" ? await getOffer(actor, row.id!) : undefined;
      await saveOfferInside(
        actor,
        offerSchema.parse({
          ...row,
          storeId: p.storeId,
          components: [],
          ...(current
            ? {
                productId: current.product_id,
                origin: current.origin,
                referenceAccount: current.reference_account,
              }
            : {}),
        }),
        current?.id,
      );
    }
    const importId = id();
    await put("imports", importId, {
      store_id: p.storeId,
      request_id: p.requestId,
      payload_hash: op.hash,
      count: p.rows.length,
      created_at: now(),
    });
    await recordOperation(actor, op, importId, p.storeId);
    return { count: p.rows.length, id: importId };
  });
}
export async function sync(
  actor: Actor,
  connectionId: string,
  payload: unknown,
) {
  admin(actor);
  const p = z.object({ requestId: z.uuid() }).parse(payload);
  const c = await get("connections", connectionId);
  if (!c) throw new HttpError(404, "Conexão não encontrada");
  authorizeStore(actor, c.store_id);
  if (c.provider === "mercadolivre")
    return syncListings(actor, connectionId, payload);
  const logId = key("sync", p.requestId),
    old = await get("sync_logs", logId);
  if (old) {
    if (old.connection_id !== connectionId)
      throw new HttpError(409, "Chave utilizada em outra conexão");
    return old;
  }
  try {
    await adapters[c.provider as Provider].sync(c.external_account || "");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha de integração";
    await transaction(async () => {
      const existing = await get("sync_logs", logId);
      if (existing && existing.connection_id !== connectionId)
        throw new HttpError(409, "Chave utilizada em outra conexão");
      if (!existing)
        await put("sync_logs", logId, {
          connection_id: connectionId,
          operation: "sync",
          status: "failed",
          message,
          external_request_id: null,
          request_id: p.requestId,
          created_at: now(),
        });
    });
    throw new HttpError(503, message);
  }
}
export async function insights(actor: Actor, offerId: string) {
  const o = await getOffer(actor, offerId),
    r = calculate(
      o.price,
      effectiveMlCosts(await costs(offerId), o),
      await params(o.store_id),
    );
  return {
    kind: "deterministic",
    title: "Verificação por regras • IA indisponível",
    sources: ["Cadastro da oferta", "Custos informados", "Parâmetros da loja"],
    period: `Retrato em ${now()}`,
    limitations:
      "Sem dados de vendas ou comparação temporal. Não estabelece causalidade e não presume aumento de vendas.",
    items: r.pending.map((p) => `Investigar: ${p}`).concat(r.warnings),
  };
}
