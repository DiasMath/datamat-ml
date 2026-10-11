import { randomUUID, timingSafeEqual } from "node:crypto";
import { authorizeStore, canWrite, HttpError, type Actor } from "./access";
import { get, find, put, key, now, transaction } from "./db";
import {
  analyticsReport,
  analyticsSources,
  refreshAnalytics,
  rangeFromQuery,
} from "./analytics";
import { syncListings, withSellerData } from "./mercadolivre";
import { aggregateAnalytics, businessDay, shiftDay } from "../domain/analytics";
import { financialSales, stockCoverage } from "../domain/routine";
import { z } from "zod";
import { saveTask } from "./services";

function stores(actor: Actor, query: URLSearchParams) {
  const selected = query.get("store") || "all";
  if (selected !== "all") authorizeStore(actor, selected);
  return actor.stores.filter((s) => selected === "all" || s.id === selected);
}
function windows(store: string) {
  const today = businessDay();
  return {
    today: new URLSearchParams({ store, from: today, to: today }),
    stock: new URLSearchParams({
      store,
      from: shiftDay(today, -7),
      to: shiftDay(today, -1),
    }),
  };
}
export async function routineReport(actor: Actor, query: URLSearchParams) {
  const selected = stores(actor, query);
  const window = windows(query.get("store") || "all");
  const [sources, stockSources, offers] = await Promise.all([
    analyticsSources(actor, window.today),
    analyticsSources(actor, window.stock),
    Promise.all(selected.map((s) => find("offers", { store_id: s.id }))).then(
      (rows) => rows.flat(),
    ),
  ]);
  const report = aggregateAnalytics(sources, rangeFromQuery(window.today));
  const updates = await Promise.all(
    selected.map(async (s) => {
      const connectionId = key(s.id, "mercadolivre");
      const row = await get("ml_routine", connectionId);
      const c = await get("connections", connectionId);
      return {
        storeId: s.id,
        storeName: s.name,
        connected: c?.status === "connected",
        lastSuccess:
          row?.auth_version === c?.auth_version
            ? row?.last_success_at || null
            : null,
        running: !!row && row.until > Date.now(),
        error:
          row?.auth_version === c?.auth_version ? row?.error || null : null,
        nextAttempt:
          row?.auth_version === c?.auth_version
            ? row?.next_attempt_at || null
            : null,
      };
    }),
  );
  return {
    report,
    sales: financialSales(
      sources.flatMap((s) => s.orders),
      rangeFromQuery(window.today),
    ),
    stock: stockCoverage(offers, stockSources, rangeFromQuery(window.stock)),
    updates,
  };
}
export async function refreshRoutine(
  actor: Actor,
  query: URLSearchParams,
  budget = 180000,
) {
  canWrite(actor);
  const deadline = Date.now() + Math.min(budget, 220000);
  for (const store of stores(actor, query)) {
    if (Date.now() >= deadline - 5000) break;
    const connectionId = key(store.id, "mercadolivre");
    const c = await get("connections", connectionId);
    if (c?.status !== "connected" || !c.external_account) continue;
    const lease = randomUUID();
    const acquired = await transaction(async () => {
      const job = await get("ml_routine", connectionId);
      if (
        job?.until > Date.now() ||
        (job?.auth_version === c.auth_version &&
          job?.next_attempt_at > Date.now())
      )
        return false;
      await put("ml_routine", connectionId, {
        ...job,
        lease,
        until: deadline + 5000,
        auth_version: c.auth_version,
      });
      return true;
    });
    if (!acquired) continue;
    try {
      const inbox = await get("ml_notification_inbox", connectionId);
      const events = (inbox?.events || [])
        .filter(
          (e: any) =>
            !e.verified &&
            !e.rejected &&
            (!e.next_attempt_at || e.next_attempt_at <= Date.now()),
        )
        .slice(0, 10);
      const items = events
        .filter((e: any) => e.topic === "items")
        .map((e: any) => String(e.resource).split("/").pop());
      const verified = new Set<string>();
      const outcomes = new Map<string, Record<string, unknown>>();
      const signalErrors: string[] = [];
      const retrySignal = (event: any, error: unknown) => {
        const attempts = (event.attempts || 0) + 1;
        const rejected = error instanceof HttpError && error.status === 403;
        outcomes.set(event.id, {
          attempts,
          rejected: rejected || attempts >= 5,
          next_attempt_at:
            Date.now() + Math.min(15 * 60000, 30000 * 2 ** attempts),
        });
        signalErrors.push(
          rejected
            ? "Notificação descartada: não corresponde à conta autorizada"
            : "Notificação pendente; nova tentativa programada",
        );
      };
      for (const event of events.filter((e: any) => e.topic !== "items")) {
        try {
          await withSellerData(
            actor,
            connectionId,
            async (request, account) => {
              const result = (await request(event.resource)) as Record<
                string,
                any
              >;
              const seller =
                event.topic === "orders_v2"
                  ? result.seller?.id
                  : result.seller_id;
              if (
                String(seller) !== account.external_account ||
                String(result.id) !== String(event.resource).split("/").pop()
              )
                throw new HttpError(
                  403,
                  "A notificação não corresponde à conta autorizada",
                );
            },
            deadline,
          );
          verified.add(event.id);
        } catch (e) {
          if (e instanceof HttpError && e.status === 401) throw e;
          retrySignal(event, e);
        }
      }
      if (items.length) {
        try {
          await syncListings(
            actor,
            connectionId,
            { requestId: randomUUID(), itemIds: items },
            deadline,
          );
          for (const event of events.filter((e: any) => e.topic === "items"))
            verified.add(event.id);
        } catch (e) {
          if (e instanceof HttpError && e.status === 401) throw e;
          for (const event of events.filter((e: any) => e.topic === "items"))
            retrySignal(event, e);
        }
      }
      // One resumable batch per invocation; never pretend all catalog pages were read.
      if (
        !items.length &&
        (!c.last_catalog_sync_at ||
          c.has_more ||
          c.pending_batch ||
          Date.now() - Date.parse(c.last_catalog_sync_at) >= 15 * 60000)
      )
        await syncListings(
          actor,
          connectionId,
          { requestId: randomUUID() },
          deadline,
        );
      const window = windows(store.id);
      await refreshAnalytics(actor, window.today, deadline);
      const history = await analyticsReport(actor, window.stock);
      const observed = history.stores[0]?.observedAt;
      if (!observed || Date.now() - Date.parse(observed) > 6 * 3600000)
        await refreshAnalytics(actor, window.stock, deadline);
      const current = await analyticsReport(actor, window.today);
      if (current.stores.some((s) => s.error || !s.observedAt))
        throw new HttpError(
          502,
          "A consulta de vendas falhou; os últimos dados foram preservados",
        );
      await transaction(async () => {
        const job = await get("ml_routine", connectionId),
          account = await get("connections", connectionId);
        if (
          job?.lease !== lease ||
          !account ||
          account.auth_version !== c.auth_version ||
          account.external_account !== c.external_account
        )
          throw new HttpError(409, "A conta mudou durante a atualização");
        const fresh = await get("ml_notification_inbox", connectionId);
        if (fresh)
          await put("ml_notification_inbox", connectionId, {
            ...fresh,
            events: fresh.events.map((e: any) =>
              verified.has(e.id)
                ? { ...e, verified: true, verified_at: now() }
                : outcomes.has(e.id)
                  ? { ...e, ...outcomes.get(e.id) }
                  : e,
            ),
            updated_at: now(),
          });
        await put("connections", connectionId, {
          ...account,
          notification_hint: !!fresh?.events.some(
            (e: any) =>
              !e.verified &&
              !e.rejected &&
              !verified.has(e.id) &&
              !outcomes.get(e.id)?.rejected,
          ),
        });
        await put("ml_routine", connectionId, {
          lease: null,
          until: 0,
          auth_version: c.auth_version,
          last_success_at: now(),
          error: signalErrors.length
            ? [...new Set(signalErrors)].join(" · ")
            : null,
          failures: 0,
          next_attempt_at: Date.now() + 45000,
        });
      });
    } catch (e) {
      await transaction(async () => {
        const job = await get("ml_routine", connectionId);
        if (job?.lease !== lease) return;
        const failures = Math.min((job.failures || 0) + 1, 6);
        await put("ml_routine", connectionId, {
          ...job,
          lease: null,
          until: 0,
          error:
            e instanceof HttpError
              ? e.message
              : "Não foi possível atualizar a loja; nova tentativa agendada",
          failures,
          next_attempt_at:
            Date.now() + Math.min(15 * 60000, 30000 * 2 ** failures),
        });
      });
    }
  }
  return routineReport(actor, query);
}
export function authorizeCron(header: string | null) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret)
    throw new HttpError(503, "Agendamento do servidor ainda não configurado");
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(header || "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new HttpError(401, "Agendamento não autorizado");
}
export async function routineTask(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = z
    .object({
      storeId: z.string().min(1).max(200),
      kind: z.enum(["question", "shipment", "stock", "sale"]),
      reference: z.string().max(200),
    })
    .parse(payload);
  authorizeStore(actor, p.storeId);
  const report = await routineReport(
    actor,
    new URLSearchParams({ store: p.storeId }),
  );
  let title = "",
    description = "",
    offerId: string | null = null;
  if (p.kind === "question") {
    const count = report.report.stores[0]?.unanswered;
    if (!count)
      throw new HttpError(
        409,
        "Nenhuma pergunta pendente disponível; atualize a loja",
      );
    title = "Responder perguntas no Mercado Livre";
    description = `${count} pergunta(s) sem resposta na última consulta.`;
  } else if (p.kind === "shipment") {
    const shipment = report.report.stores[0]?.shipping?.entries?.find(
      (s) => s.id === p.reference,
    );
    if (!shipment || (!shipment.late && shipment.status !== "ready_to_ship"))
      throw new HttpError(409, "Envio pendente indisponível; atualize a loja");
    title = `Conferir despacho do envio ${shipment.id}`;
    description = `Situação observada: ${shipment.status}. ${shipment.handlingDeadline ? `Limite de despacho: ${shipment.handlingDeadline}.` : "Sem prazo informado."}`;
  } else if (p.kind === "stock") {
    const stock = report.stock.find(
      (s) => s.offerId === p.reference && s.urgency !== "normal",
    );
    if (!stock)
      throw new HttpError(
        409,
        "Prioridade de estoque indisponível; atualize a loja",
      );
    offerId = stock.offerId;
    title = `Repor estoque: ${stock.title}`;
    description = `Estoque observado: ${stock.quantity}. Cobertura estimada: ${stock.coverage ?? "indisponível"} dias. Conferir mercadoria compartilhada, kits e prazo de reposição.`;
  } else {
    const sale = report.sales.find((s) => s.id === p.reference && s.lowMargin);
    if (!sale)
      throw new HttpError(
        409,
        "Venda abaixo da margem indisponível; atualize a loja",
      );
    offerId = sale.offerId;
    title = `Revisar margem do pedido ${sale.id}`;
    description = `Receita: R$ ${sale.revenue}. Contribuição com tarifa observada e demais custos estimados: R$ ${sale.observed ?? "indisponível"}.`;
  }
  return transaction(async () => {
    const id = key(
      "routine-task",
      p.storeId,
      p.kind,
      p.kind === "question" ? "unanswered" : p.reference,
    );
    const old = await get("ml_routine_tasks", id);
    if (old) {
      const existing = await get("tasks", old.task_id);
      if (existing) return existing;
    }
    const task = await saveTask(actor, {
      storeId: p.storeId,
      offerId,
      title: title.slice(0, 200),
      description,
      priority: "high",
      status: "todo",
      reason: "Prioridade identificada pelos dados da loja ML",
      assignee: actor.name,
    });
    await put("ml_routine_tasks", id, {
      store_id: p.storeId,
      task_id: task.id,
      created_at: now(),
    });
    return task;
  });
}
