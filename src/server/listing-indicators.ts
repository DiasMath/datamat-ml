import { z } from "zod";
import { canWrite, authorizeStore, HttpError, type Actor } from "./access";
import { get } from "./db";
import {
  refreshMetrics,
  refreshCompetition,
  withMlReadBatch,
} from "./mercadolivre";
import { mapConcurrent } from "./concurrent";
import { LISTING_INDICATOR_BATCH_SIZE } from "../domain/listing-batches";
import {
  refreshFinancialCosts,
  type FinancialRefreshResult,
} from "./ml-financial-sync";
export async function refreshListingCompetition(
  actor: Actor,
  payload: unknown,
  selectedStore?: string | null,
) {
  canWrite(actor);
  const p = z
    .object({ ids: z.array(z.string().min(1).max(200)).min(1).max(5) })
    .strict()
    .parse(payload);
  const offers = await Promise.all(
    [...new Set(p.ids)].map((id) => get("offers", id)),
  );
  for (const offer of offers) {
    if (!offer || offer.organization_id !== actor.organization_id)
      throw new HttpError(404, "Anúncio não encontrado");
    authorizeStore(actor, offer.store_id);
    if (
      offer.origin === "reference" ||
      !offer.ml?.catalogListing ||
      !offer.ml.sellerId ||
      !/^MLB\d+$/.test(offer.ml_id || "")
    )
      throw new HttpError(422, "Selecione anúncios próprios de catálogo");
  }
  validateScope(offers, selectedStore);
  const deadline = Date.now() + 55000;
  const results = [];
  for (const offer of offers) {
    if (!offer) continue;
    if (Date.now() > deadline - 10000) {
      results.push({
        id: offer.id,
        updated: false,
        deferred: true,
        error: "Consulta pendente; continue a atualização.",
      });
      continue;
    }
    try {
      await refreshCompetition(actor, offer.id, deadline);
      results.push({ id: offer.id, updated: true });
    } catch (error) {
      results.push({
        id: offer.id,
        updated: false,
        error:
          error instanceof HttpError
            ? error.message
            : "Competitividade indisponível no ML.",
      });
    }
  }
  return { results };
}
export async function refreshListingIndicators(
  actor: Actor,
  payload: unknown,
  selectedStore?: string | null,
) {
  canWrite(actor);
  const p = z
    .object({
      ids: z
        .array(z.string().min(1).max(200))
        .min(1)
        .max(LISTING_INDICATOR_BATCH_SIZE),
    })
    .strict()
    .parse(payload);
  const offers = await Promise.all(
    [...new Set(p.ids)].map((id) => get("offers", id)),
  );
  for (const offer of offers) {
    if (!offer || offer.organization_id !== actor.organization_id)
      throw new HttpError(404, "Anúncio não encontrado");
    authorizeStore(actor, offer.store_id);
    if (
      offer.origin === "reference" ||
      !offer.ml?.sellerId ||
      !/^MLB\d+$/.test(offer.ml_id || "")
    )
      throw new HttpError(
        422,
        "Selecione anúncios próprios sincronizados do ML",
      );
  }
  validateScope(offers, selectedStore);
  return withMlReadBatch(async () => {
    const deadline = Date.now() + 55000;
    const results: Array<{
      id: string;
      metrics: boolean;
      fees: boolean;
      deferred?: boolean;
      errors: string[];
    }> = offers.map((offer) => ({
      id: offer!.id,
      metrics: false,
      fees: false,
      errors: [],
    }));
    const metricsDeferred = new Set<string>();
    const financial = new Map<string, FinancialRefreshResult>();
    const stores = new Map<string, string[]>();
    for (const offer of offers) {
      if (!offer) continue;
      stores.set(offer.store_id, [
        ...(stores.get(offer.store_id) || []),
        offer.id,
      ]);
      financial.set(offer.id, { id: offer.id, status: "deferred" });
    }
    // Two metrics workers and two financial workers share authorized GETs.
    // Financial work keeps one lease per store, avoiding competing per-item jobs.
    await Promise.all([
      mapConcurrent(results, 2, async (result) => {
        if (Date.now() > deadline - 20000) {
          metricsDeferred.add(result.id);
          return;
        }
        try {
          await refreshMetrics(actor, result.id, 7, deadline);
          result.metrics = true;
        } catch (error) {
          result.errors.push(
            error instanceof HttpError
              ? error.message
              : "Não foi possível consultar as métricas de 7 dias.",
          );
        }
      }),
      mapConcurrent([...stores], 1, async ([storeId, ids]) => {
        if (Date.now() > deadline - 22000) return;
        try {
          const refreshed = await refreshFinancialCosts(
            actor,
            storeId,
            deadline,
            ids,
            true,
            {
              maxItems: LISTING_INDICATOR_BATCH_SIZE,
              concurrency: 2,
              reportPerOffer: true,
            },
          );
          for (const record of refreshed.results || [])
            financial.set(record.id, record);
        } catch (error) {
          for (const id of ids)
            financial.set(id, {
              id,
              status: "failed",
              error:
                error instanceof HttpError
                  ? error.message
                  : "Não foi possível consultar as tarifas atuais.",
            });
        }
      }),
    ]);
    for (const result of results) {
      const fees = financial.get(result.id);
      result.fees = fees?.status === "updated";
      if (!result.fees)
        result.errors.push(
          fees?.error ||
            "Custos ML pendentes; confira a conexão e tente novamente.",
        );
      if (metricsDeferred.has(result.id) || fees?.status === "deferred")
        result.deferred = true;
    }
    return { results };
  });
}

function validateScope(
  offers: Array<Record<string, any> | null | undefined>,
  selectedStore?: string | null,
) {
  const stores = new Set(offers.map((o) => o?.store_id));
  if (selectedStore === "all" || stores.size !== 1)
    throw new HttpError(
      422,
      "Selecione anúncios de uma única loja para atualizar",
    );
  if (selectedStore && !stores.has(selectedStore))
    throw new HttpError(422, "Os anúncios não pertencem à loja selecionada");
}
