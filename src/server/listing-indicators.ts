import { z } from "zod";
import { canWrite, authorizeStore, HttpError, type Actor } from "./access";
import { get } from "./db";
import { refreshMetrics } from "./mercadolivre";
import { refreshFinancialCosts } from "./ml-financial-sync";
export async function refreshListingIndicators(actor: Actor, payload: unknown) {
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
      !offer.ml?.sellerId ||
      !/^MLB\d+$/.test(offer.ml_id || "")
    )
      throw new HttpError(
        422,
        "Selecione anúncios próprios sincronizados do ML",
      );
  }
  const results: Array<{
    id: string;
    metrics: boolean;
    fees: boolean;
    deferred?: boolean;
    errors: string[];
  }> = [];
  const deadline = Date.now() + 55000;
  for (const offer of offers) {
    if (!offer) continue;
    const result = {
      id: offer.id,
      metrics: false,
      fees: false,
      errors: [] as string[],
    };
    if (Date.now() > deadline - 20000) {
      results.push({ ...result, deferred: true });
      continue;
    }
    try {
      await refreshMetrics(actor, offer.id, 7, deadline);
      result.metrics = true;
    } catch (error) {
      result.errors.push(
        error instanceof HttpError
          ? error.message
          : "Não foi possível consultar as métricas de 7 dias.",
      );
    }
    if (Date.now() < deadline - 20000 && offer.price != null) {
      try {
        const refreshed = await refreshFinancialCosts(
          actor,
          offer.store_id,
          deadline,
          [offer.id],
          true,
        );
        result.fees = refreshed.updated > 0;
        if (!result.fees)
          result.errors.push(
            "Custos ML pendentes; confira a conexão e tente novamente.",
          );
      } catch (error) {
        result.errors.push(
          error instanceof HttpError
            ? error.message
            : "Não foi possível consultar as tarifas atuais.",
        );
      }
    }
    results.push(result);
  }
  return { results };
}
