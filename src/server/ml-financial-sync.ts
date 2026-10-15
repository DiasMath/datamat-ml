import { randomUUID } from "node:crypto";
import { canWrite, authorizeStore, HttpError, type Actor } from "./access";
import { get, find, put, key, now, transaction, type Row } from "./db";
import { quoteTariff } from "./mercadolivre";
import {
  financialContext,
  financialMatches,
  attachFinancial,
  effectiveMlCosts,
  FINANCIAL_MAX_AGE,
} from "../domain/ml-financial";
import { emptyCosts } from "../domain/finance";

export async function refreshFinancialCosts(
  actor: Actor,
  storeId: string,
  deadline = Date.now() + 55000,
  ids?: string[],
  force = false,
) {
  canWrite(actor);
  authorizeStore(actor, storeId);
  const connectionId = key(storeId, "mercadolivre"),
    connection = await get("connections", connectionId);
  if (connection?.status !== "connected" || !connection.external_account)
    return { updated: 0, failed: 0, pending: 0 };
  const lease = randomUUID(),
    jobId = key(actor.organization_id, storeId),
    job = await transaction(async () => {
      const current = await get("ml_finance_jobs", jobId);
      if (current?.until > Date.now()) return false;
      await put("ml_finance_jobs", jobId, {
        organization_id: actor.organization_id,
        store_id: storeId,
        lease,
        until: deadline + 5000,
      });
      return true;
    });
  if (!job) return { updated: 0, failed: 0, pending: 0 };
  let updated = 0,
    failed = 0,
    pending = 0;
  try {
    const [offers, rows] = await Promise.all([
      ids
        ? Promise.all([...new Set(ids)].map((id) => get("offers", id))).then(
            (rows) => rows.filter((r): r is Row => !!r),
          )
        : find("offers", { store_id: storeId }),
      find("ml_financials", { store_id: storeId }),
    ]);
    if (
      ids &&
      (offers.length !== new Set(ids).size ||
        offers.some(
          (o) =>
            o.organization_id !== actor.organization_id ||
            o.store_id !== storeId,
        ))
    )
      throw new HttpError(404, "Anúncio não encontrado nesta loja");
    const snapshots = new Map(rows.map((r) => [r.offer_id, r]));
    const candidates = offers
      .filter(
        (o) =>
          o.organization_id === actor.organization_id &&
          o.store_id === storeId &&
          o.origin !== "reference" &&
          o.status !== "closed" &&
          /^MLB\d+$/.test(o.ml_id || "") &&
          !o.ml?.variablePrices &&
          o.ml?.sellerId === connection.external_account &&
          o.ml?.authVersion === connection.auth_version &&
          o.price != null,
      )
      .filter((o) => {
        const row = snapshots.get(o.id);
        return (
          force ||
          ((!row ||
            !financialMatches(o, row) ||
            row.expires_at <= Date.now()) &&
            (!row?.next_attempt_at || row.next_attempt_at <= Date.now()))
        );
      })
      .sort((a, b) =>
        String(snapshots.get(a.id)?.attempted_at || "").localeCompare(
          String(snapshots.get(b.id)?.attempted_at || ""),
        ),
      );
    pending = candidates.length;
    for (const offer of candidates.slice(0, 5)) {
      if (Date.now() >= deadline - 22000) break;
      if (offer.ml_apply_until > Date.now()) continue;
      try {
        const quote = await quoteTariff(
          actor,
          offer.id,
          { price: offer.price, offerVersion: offer.version },
          deadline,
        );
        await transaction(async () => {
          const [current, account, previous, costs] = await Promise.all([
            get("offers", offer.id),
            get("connections", connectionId),
            get("ml_financials", offer.id),
            get("costs", offer.id),
          ]);
          if (
            !current ||
            current.version !== offer.version ||
            current.ml_apply_until > Date.now() ||
            financialContext(current) !== quote.context ||
            account?.status !== "connected" ||
            account.auth_version !== quote.auth_version ||
            account.external_account !== quote.seller_id
          )
            throw new HttpError(
              409,
              "O anúncio ou a conta mudou durante a consulta de custos",
            );
          const snapshot = {
            ...quote,
            organization_id: actor.organization_id,
            offer_id: offer.id,
            expires_at: Date.now() + FINANCIAL_MAX_AGE,
            attempted_at: now(),
            next_attempt_at: 0,
            last_error: null,
          };
          const base = costs ? JSON.parse(costs.data_json) : emptyCosts();
          // Compare previous quoted values for versioning, even after expiry.
          // Expired values remain unavailable to all live calculations.
          const before = effectiveMlCosts(
            base,
            attachFinancial(current, previous, account, actor.organization_id),
            0,
          );
          const after = effectiveMlCosts(base, {
            ...current,
            mlFinancial: snapshot,
          });
          const changed = JSON.stringify(before) !== JSON.stringify(after);
          if (changed) {
            await put("offers", offer.id, {
              ...current,
              version: current.version + 1,
              updated_at: now(),
            });
            await put("history", randomUUID(), {
              organization_id: actor.organization_id,
              store_id: storeId,
              offer_id: offer.id,
              actor_id: actor.id,
              actor_name: actor.name,
              field: "ml_costs",
              old_value: JSON.stringify({
                mlPercent: before.mlPercent,
                mlFixed: before.mlFixed,
                shipping: before.shipping,
              }),
              new_value: JSON.stringify({
                mlPercent: after.mlPercent,
                mlFixed: after.mlFixed,
                shipping: after.shipping,
              }),
              reason: "Atualização automática dos custos ML",
              origin: "mercadolivre",
              status: "confirmed",
              created_at: now(),
            });
            // The persisted quote remains usable at the version produced by this observation.
            await put("ml_quotes", quote.id, {
              ...quote,
              offer_version: current.version + 1,
            });
            await put("ml_current_quotes", offer.id, {
              ...quote,
              offer_version: current.version + 1,
            });
          }
          await put("ml_financials", offer.id, snapshot);
        });
        updated++;
        pending--;
      } catch (error) {
        failed++;
        pending--;
        await transaction(async () => {
          const [current, account, old] = await Promise.all([
            get("offers", offer.id),
            get("connections", connectionId),
            get("ml_financials", offer.id),
          ]);
          if (
            !current ||
            !account ||
            account.auth_version !== connection.auth_version ||
            account?.external_account !== connection.external_account
          )
            return;
          await put("ml_financials", offer.id, {
            ...(old &&
            old.organization_id === actor.organization_id &&
            financialMatches(current, old)
              ? old
              : {
                  context: financialContext(current),
                  price: current.price,
                  seller_id: account.external_account,
                  auth_version: account.auth_version,
                  expires_at: 0,
                }),
            organization_id: actor.organization_id,
            store_id: storeId,
            offer_id: offer.id,
            attempted_at: now(),
            next_attempt_at: Date.now() + 5 * 60000,
            last_error:
              error instanceof HttpError
                ? error.message
                : "Não foi possível consultar os custos ML.",
          });
        });
      }
    }
    return { updated, failed, pending };
  } finally {
    await transaction(async () => {
      const current = await get("ml_finance_jobs", jobId);
      if (current?.lease === lease)
        await put("ml_finance_jobs", jobId, {
          ...current,
          lease: null,
          until: 0,
          updated_at: now(),
          updated,
          failed,
          pending,
        });
    });
  }
}
