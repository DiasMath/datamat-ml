import { randomUUID } from "node:crypto";
import { purchaseCostCatalog } from "./purchase-cost";
import Decimal from "decimal.js";
import { attachFinancial, effectiveMlCosts } from "../domain/ml-financial";
import { z } from "zod";
import {
  analysisRange,
  aggregateAnalytics,
  businessDay,
  type AnalysisRange,
  type SaleOrder,
  type StoreAnalysis,
  type VisitPoint,
} from "../domain/analytics";
import { calculate, emptyCosts } from "../domain/finance";
import { authorizeStore, canWrite, HttpError, type Actor } from "./access";
import { get, find, put, key, now, transaction, type Row } from "./db";
import { withSellerData, mlConfigured } from "./mercadolivre";

const orderSchema = z.object({
  id: z.number().int().positive(),
  seller: z.object({ id: z.number().int().positive() }),
  date_created: z.string().refine((v) => Number.isFinite(Date.parse(v))),
  status: z.string(),
  currency_id: z.string(),
  shipping: z
    .object({ id: z.number().int().positive().nullable().optional() })
    .nullish(),
  order_items: z
    .array(
      z.object({
        item: z.object({
          id: z.string().regex(/^MLB\d+$/),
          title: z.string().max(500).optional(),
        }),
        quantity: z.number().int().positive(),
        unit_price: z.number().finite().nonnegative(),
        sale_fee: z.number().finite().nonnegative().nullish(),
      }),
    )
    .max(100),
});
const pageSchema = z.object({
  paging: z.object({ total: z.number().int().nonnegative() }),
  results: z.array(orderSchema).max(50),
});
export function rangeFromQuery(query: URLSearchParams, clock = new Date()) {
  const today = businessDay(clock);
  try {
    return analysisRange(
      query.get("from") ?? today,
      query.get("to") ?? today,
      clock,
    );
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
}
function selectedStores(actor: Actor, query: URLSearchParams) {
  const store = query.get("store");
  if (store && store !== "all") {
    authorizeStore(actor, store);
    return actor.stores.filter((s) => s.id === store);
  }
  return actor.stores;
}
function snapshotKey(
  actor: Actor,
  storeId: string,
  range: AnalysisRange,
  connection: Row,
) {
  return key(
    actor.organization_id,
    storeId,
    range.from,
    range.to,
    String(connection.auth_version || 0),
    String(connection.external_account || ""),
  );
}
function blank(store: Row, connection?: Row): StoreAnalysis {
  return {
    storeId: store.id,
    storeName: store.name,
    connected:
      !!connection?.external_account &&
      connection.status === "connected" &&
      mlConfigured(connection),
    sellerId: connection?.external_account || null,
    authVersion: connection?.auth_version ?? null,
    observedAt: null,
    complete: false,
    totalReported: null,
    orders: [],
    visits: null,
    unanswered: null,
    reputation: null,
    shipping: null,
    warnings: [],
    error: null,
  };
}
export async function analyticsSources(
  actor: Actor,
  query: URLSearchParams,
  clock = new Date(),
) {
  const range = rangeFromQuery(query, clock);
  const sources: StoreAnalysis[] = [];
  for (const store of selectedStores(actor, query)) {
    const connection = await get("connections", key(store.id, "mercadolivre"));
    const base = blank(store, connection);
    if (!base.connected || !connection) {
      sources.push(base);
      continue;
    }
    const snapshot = await get(
      "ml_analytics",
      snapshotKey(actor, store.id, range, connection),
    );
    const source = snapshot
      ? (JSON.parse(snapshot.data_json) as StoreAnalysis)
      : base;
    sources.push({
      ...source,
      storeName: store.name,
      error: snapshot?.last_error || null,
    });
  }
  return sources;
}
export async function analyticsReport(actor: Actor, query: URLSearchParams) {
  return aggregateAnalytics(
    await analyticsSources(actor, query),
    rangeFromQuery(query),
  );
}
async function collectStore(
  actor: Actor,
  store: Row,
  connectionId: string,
  range: AnalysisRange,
  deadline: number,
  salesOnly = false,
) {
  return withSellerData(
    actor,
    connectionId,
    async (request, connection) => {
      const source = blank(store, connection);
      source.connected = true;
      source.collectedThrough = new Date(range.end).toISOString();
      const [offers, costRows, parameters, financialRows] = await Promise.all([
        find("offers", { store_id: store.id }),
        find("costs", { store_id: store.id }),
        get("parameters", store.id),
        find("ml_financials", { store_id: store.id }),
      ]);
      const financialMap = new Map(financialRows.map((r) => [r.offer_id, r]));
      const costMap = new Map(costRows.map((c) => [c.id, c]));
      const withPurchaseCost = await purchaseCostCatalog(
        actor,
        offers.filter((o) => {
          const row = costMap.get(o.id);
          return !row || JSON.parse(row.data_json).goods == null;
        }),
      );
      const offerMap = new Map(
        offers
          .filter(
            (o) =>
              o.ml?.sellerId === connection.external_account &&
              o.ml?.authVersion === connection.auth_version,
          )
          .map((o) => [
            o.ml_id,
            attachFinancial(
              withPurchaseCost(o),
              financialMap.get(o.id),
              connection,
              actor.organization_id,
            ),
          ]),
      );
      const p = parameters ? JSON.parse(parameters.data_json) : null;
      const orderIds = new Set<string>();
      let offset = 0,
        total = 0;
      do {
        const query = new URLSearchParams({
          seller: connection.external_account,
          "order.date_created.from": new Date(
            range.previousStart,
          ).toISOString(),
          "order.date_created.to": new Date(range.end - 1).toISOString(),
          sort: "date_desc",
          limit: "50",
          offset: String(offset),
        });
        const page = pageSchema.parse(await request("/orders/search?" + query));
        total = page.paging.total;
        for (const order of page.results) {
          if (String(order.seller.id) !== connection.external_account)
            throw new HttpError(
              403,
              "A análise recebeu pedidos de outra conta",
            );
          const id = String(order.id),
            created = Date.parse(order.date_created);
          if (
            orderIds.has(id) ||
            created < range.previousStart ||
            created >= range.end
          )
            continue;
          orderIds.add(id);
          if (order.currency_id !== "BRL") {
            source.warnings.push(
              "Pedidos fora de BRL foram excluídos; os valores são parciais.",
            );
            continue;
          }
          const normalized: SaleOrder = {
            id,
            storeId: store.id,
            created: order.date_created,
            status: order.status,
            shipmentId: order.shipping?.id ? String(order.shipping.id) : null,
            lines: order.order_items.map((line) => {
              const offer = offerMap.get(line.item.id),
                costs = offer ? costMap.get(offer.id) : null;
              const stale =
                !costs?.updated_at ||
                !p ||
                Date.now() - Date.parse(costs.updated_at) >
                  p.reviewDays * 86400000;
              const calculation =
                offer && p && !stale && !offer.ml?.variablePrices
                  ? calculate(
                      String(line.unit_price),
                      effectiveMlCosts(
                        costs ? JSON.parse(costs.data_json) : emptyCosts(),
                        offer,
                      ),
                      p,
                    )
                  : null;
              const actualFeeCalculation =
                calculation && line.sale_fee != null
                  ? calculate(
                      String(line.unit_price),
                      {
                        ...effectiveMlCosts(
                          JSON.parse(costs!.data_json),
                          offer!,
                        ),
                        mlPercent: "0",
                        mlFixed: String(line.sale_fee),
                      },
                      p,
                    )
                  : null;
              return {
                itemId: line.item.id,
                title: line.item.title || offer?.title || line.item.id,
                quantity: line.quantity,
                price: new Decimal(line.unit_price).toFixed(2),
                fee:
                  line.sale_fee == null
                    ? null
                    : new Decimal(line.sale_fee).toFixed(2),
                contribution:
                  calculation && !calculation.pending.length
                    ? calculation.margin
                    : null,
                offerId: offer?.id || null,
                actualFeeContribution:
                  actualFeeCalculation && !actualFeeCalculation.pending.length
                    ? actualFeeCalculation.margin
                    : null,
                minMargin: p?.minMargin ?? null,
              };
            }),
          };
          source.orders.push(normalized);
        }
        offset += page.results.length;
        if (!page.results.length && offset < total)
          throw new HttpError(
            502,
            "A API retornou uma página de pedidos incompleta; tente novamente",
          );
        if (Buffer.byteLength(JSON.stringify(source.orders)) > 650000) {
          source.orders.splice(
            Math.max(0, source.orders.length - page.results.length),
          );
          source.warnings.push(
            "O volume excedeu o limite deste painel; reduza o período para uma análise completa.",
          );
          break;
        }
      } while (offset < total && offset < 1000);
      source.totalReported = total;
      source.complete =
        orderIds.size === total && !source.warnings.length && offset >= total;
      if (!source.complete && offset >= total && !source.warnings.length)
        source.warnings.push(
          "Pedidos duplicados ou fora da janela retornada: confira o período e atualize novamente.",
        );
      if (offset < total)
        source.warnings.push(
          "Consulta parcial: até 1.000 pedidos por loja, incluindo a comparação. Reduza o período.",
        );
      if (salesOnly) {
        source.observedAt = now();
        return source;
      }
      const optional = await Promise.allSettled([
        request(`/users/${connection.external_account}`),
        request(
          "/questions/search?" +
            new URLSearchParams({
              seller_id: connection.external_account,
              status: "UNANSWERED",
              api_version: "4",
              limit: "1",
            }),
        ),
        request(
          `/users/${connection.external_account}/items_visits?` +
            new URLSearchParams({ date_from: range.from, date_to: range.to }),
        ),
      ]);
      if (optional[0].status === "fulfilled") {
        const user = z
          .object({
            id: z.number(),
            seller_reputation: z
              .object({
                level_id: z.string().nullable().optional(),
                power_seller_status: z.string().nullable().optional(),
                transactions: z
                  .object({
                    completed: z.number().nonnegative().optional(),
                    canceled: z.number().nonnegative().optional(),
                    period: z.string().optional(),
                  })
                  .optional(),
              })
              .optional(),
          })
          .safeParse(optional[0].value);
        if (
          user.success &&
          String(user.data.id) === connection.external_account &&
          user.data.seller_reputation
        ) {
          const r = user.data.seller_reputation;
          source.reputation = {
            level: r.level_id || null,
            powerSeller: r.power_seller_status || null,
            completed: r.transactions?.completed ?? null,
            cancelled: r.transactions?.canceled ?? null,
            period: r.transactions?.period || null,
          };
        }
      }
      if (optional[1].status === "fulfilled") {
        const questions = z
          .object({ total: z.number().int().nonnegative() })
          .safeParse(optional[1].value);
        if (questions.success) source.unanswered = questions.data.total;
      }
      if (optional[2].status === "fulfilled") {
        // The seller endpoint returns daily rows. Never accept an unscoped or mismatched period.
        const visits = z
          .array(
            z.object({
              date: z.string(),
              total: z.number().int().nonnegative(),
            }),
          )
          .safeParse(optional[2].value);
        if (visits.success) {
          const points: VisitPoint[] = visits.data.map((v) => ({
            day: v.date.slice(0, 10),
            visits: v.total,
          }));
          const unique = new Set(points.map((v) => v.day));
          if (
            points.length === range.days &&
            unique.size === range.days &&
            points.every((v) => v.day >= range.from && v.day <= range.to)
          )
            source.visits = points;
        }
      }
      if (!source.visits)
        source.warnings.push(
          "Visitas não disponíveis para o período; pedidos/visitas não foi calculado.",
        );
      const shipmentIds = [
        ...new Set(
          source.orders
            .filter(
              (o) =>
                o.status === "paid" &&
                Date.parse(o.created) >= range.start &&
                o.shipmentId,
            )
            .map((o) => o.shipmentId!),
        ),
      ];
      const statuses: Record<string, number> = {};
      const entries: NonNullable<StoreAnalysis["shipping"]>["entries"] = [];
      let sampled = 0;
      for (let i = 0; i < Math.min(shipmentIds.length, 20); i += 5) {
        const shipments = await Promise.allSettled(
          shipmentIds
            .slice(i, Math.min(i + 5, 20))
            .map((id) => request("/shipments/" + id)),
        );
        shipments.forEach((result, index) => {
          if (result.status !== "fulfilled") return;
          const shipping = z
            .object({
              id: z.number(),
              sender_id: z.number(),
              status: z.string().min(1),
              substatus: z.string().nullish(),
              shipping_option: z
                .object({
                  estimated_handling_limit: z
                    .object({ date: z.string().nullish() })
                    .nullish(),
                })
                .nullish(),
            })
            .safeParse(result.value);
          if (
            shipping.success &&
            String(shipping.data.sender_id) === connection.external_account &&
            String(shipping.data.id) === shipmentIds[i + index]
          ) {
            sampled++;
            statuses[shipping.data.status] =
              (statuses[shipping.data.status] || 0) + 1;
            const rawDeadline =
              shipping.data.shipping_option?.estimated_handling_limit?.date;
            const handlingDeadline =
              rawDeadline && Number.isFinite(Date.parse(rawDeadline))
                ? rawDeadline
                : null;
            entries.push({
              id: String(shipping.data.id),
              status: shipping.data.status,
              substatus: shipping.data.substatus || null,
              handlingDeadline,
              late:
                !!handlingDeadline &&
                Date.parse(handlingDeadline) < Date.now() &&
                ["handling", "ready_to_ship"].includes(shipping.data.status),
            });
          }
        });
      }
      if (sampled > 0 || shipmentIds.length === 0)
        source.shipping = {
          sampled,
          total: shipmentIds.length,
          statuses,
          entries,
        };
      if (sampled < shipmentIds.length)
        source.warnings.push(
          "Logística: amostra de até 20 envios recentes por loja; não representa todos os envios.",
        );
      source.observedAt = now();
      return source;
    },
    deadline,
  );
}
export async function refreshAnalytics(
  actor: Actor,
  query: URLSearchParams,
  deadline = Date.now() + 220000,
  salesOnly = false,
) {
  canWrite(actor);
  const range = rangeFromQuery(query);
  for (const store of selectedStores(actor, query)) {
    const connectionId = key(store.id, "mercadolivre"),
      connection = await get("connections", connectionId);
    if (!connection || !blank(store, connection).connected) continue;
    const snapshotId = snapshotKey(actor, store.id, range, connection),
      lease = randomUUID();
    const acquired = await transaction(async () => {
      const lock = await get("ml_analytics_locks", connectionId),
        snapshot = await get("ml_analytics", snapshotId);
      if (
        lock?.until > Date.now() ||
        (snapshot?.updated_at &&
          Date.now() - Date.parse(snapshot.updated_at) < 45000 &&
          (salesOnly || !snapshot.sales_only))
      )
        return false;
      await put("ml_analytics_locks", connectionId, {
        lease,
        until: Date.now() + 240000,
      });
      return true;
    });
    if (!acquired) continue;
    try {
      const source = await collectStore(
        actor,
        store,
        connectionId,
        range,
        deadline,
        salesOnly,
      );
      await transaction(async () => {
        const current = await get("connections", connectionId),
          lock = await get("ml_analytics_locks", connectionId);
        if (
          current?.auth_version !== connection.auth_version ||
          current?.external_account !== connection.external_account ||
          lock?.lease !== lease
        )
          throw new HttpError(409, "A conexão mudou durante a análise");
        await put("ml_analytics", snapshotId, {
          store_id: store.id,
          seller_id: connection.external_account,
          auth_version: connection.auth_version,
          data_json: JSON.stringify(source),
          sales_only: salesOnly,
          updated_at: source.observedAt,
          last_error: null,
        });
      });
    } catch (e) {
      const message =
        e instanceof HttpError
          ? e.message
          : "Não foi possível validar os dados do Mercado Livre; tente atualizar novamente.";
      const previous = await get("ml_analytics", snapshotId);
      await put("ml_analytics", snapshotId, {
        ...(previous || {}),
        store_id: store.id,
        seller_id: connection.external_account,
        auth_version: connection.auth_version,
        data_json:
          previous?.data_json ||
          JSON.stringify({ ...blank(store, connection), error: message }),
        last_error: message,
      });
    } finally {
      await transaction(async () => {
        const lock = await get("ml_analytics_locks", connectionId);
        if (lock?.lease === lease)
          await put("ml_analytics_locks", connectionId, {
            until: 0,
            lease: null,
          });
      });
    }
  }
  return analyticsReport(actor, query);
}
