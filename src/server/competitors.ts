import { z } from "zod";
import Decimal from "decimal.js";
import { authorizeStore, canWrite, HttpError, type Actor } from "./access";
import { find, get, put, remove, transaction, key, now } from "./db";
import { priceAmount, amount, percent } from "../domain/finance";
import { saveTask } from "./services";

export const competitorSchema = z
  .object({
    storeId: z.string().min(1).max(200),
    itemId: z.string().regex(/^MLB\d{1,20}$/),
    title: z.string().trim().min(1).max(200),
    url: z
      .url()
      .max(2000)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          /(^|\.)mercadolivre\.com\.br$/.test(url.hostname)
        );
      }, "Use o endereço HTTPS do anúncio no Mercado Livre"),
    price: priceAmount.refine((v) => v !== null, "Informe o preço observado"),
    shipping: amount.optional().default(null),
    seller: z.string().trim().max(200).default(""),
    offerId: z.string().max(200).nullable().default(null),
    threshold: percent
      .refine(
        (v) => v !== null && new Decimal(v).gt(0),
        "Informe um limiar maior que zero",
      )
      .default("5"),
    version: z.number().int().nonnegative().optional(),
  })
  .refine((p) => {
    const url = new URL(p.url);
    const id =
      url.pathname.match(/\/MLB-(\d{1,20})(?:\D|$)/i)?.[1] ||
      url.searchParams.get("item_id")?.match(/^MLB(\d{1,20})$/)?.[1];
    return id && `MLB${id}` === p.itemId;
  }, "A URL precisa corresponder ao código da oferta individual");
export async function competitors(actor: Actor, query: URLSearchParams) {
  const selected = query.get("store") || "all";
  if (selected !== "all") authorizeStore(actor, selected);
  const rows = await Promise.all(
    actor.stores
      .filter((s) => selected === "all" || s.id === selected)
      .map((s) => find("competitors", { store_id: s.id })),
  );
  return rows
    .flat()
    .sort(
      (a, b) =>
        Number(!!b.alert) - Number(!!a.alert) ||
        String(b.updated_at).localeCompare(String(a.updated_at)),
    );
}
export async function saveCompetitor(
  actor: Actor,
  payload: unknown,
  source: "manual" | "extension" = "manual",
) {
  canWrite(actor);
  const p = competitorSchema.parse(payload);
  authorizeStore(actor, p.storeId);
  const id = key(actor.organization_id, p.storeId, p.itemId);
  return transaction(async () => {
    const old = await get("competitors", id);
    if (p.version !== undefined && p.version !== (old?.version || 0))
      throw new HttpError(
        409,
        "Referência alterada; recarregue antes de salvar",
      );
    if (p.offerId) {
      const offer = await get("offers", p.offerId);
      if (
        !offer ||
        offer.store_id !== p.storeId ||
        offer.origin === "reference"
      )
        throw new HttpError(422, "Vincule um anúncio próprio da mesma loja");
    }
    const currentPrice = new Decimal(p.price!).toFixed(2);
    const different = !!old && !new Decimal(old.price).eq(currentPrice);
    const delta = different
      ? new Decimal(currentPrice)
          .minus(old!.price)
          .div(old!.price)
          .mul(100)
          .toFixed(2)
      : null;
    const observed = {
      price: currentPrice,
      shipping: p.shipping,
      source,
      observedAt: now(),
    };
    const history =
      !old || different || old.shipping !== p.shipping
        ? [...(old?.history || []), observed].slice(-100)
        : old.history;
    return put("competitors", id, {
      ...old,
      organization_id: actor.organization_id,
      store_id: p.storeId,
      item_id: p.itemId,
      title: p.title,
      url: p.url,
      price: currentPrice,
      shipping: p.shipping,
      seller: p.seller,
      offer_id: p.offerId,
      threshold: p.threshold,
      version: (old?.version || 0) + 1,
      history,
      source,
      observed_at: now(),
      updated_at: now(),
      created_at: old?.created_at || now(),
      alert:
        delta !== null && new Decimal(delta).abs().gte(p.threshold!)
          ? { previous: old!.price, current: currentPrice, delta, at: now() }
          : old?.alert || null,
    });
  });
}
export async function changeCompetitor(
  actor: Actor,
  id: string,
  payload: unknown,
  action: "delete" | "dismiss",
) {
  canWrite(actor);
  const p = z.object({ version: z.number().int().positive() }).parse(payload);
  return transaction(async () => {
    const row = await get("competitors", id);
    if (!row) throw new HttpError(404, "Referência não encontrada");
    authorizeStore(actor, row.store_id);
    if (row.version !== p.version)
      throw new HttpError(
        409,
        "Referência alterada; recarregue antes de continuar",
      );
    if (action === "delete") {
      await remove("competitors", id);
      return { deleted: true };
    }
    return put("competitors", id, {
      ...row,
      alert: null,
      version: row.version + 1,
      updated_at: now(),
    });
  });
}
export async function competitorTask(actor: Actor, id: string) {
  canWrite(actor);
  return transaction(async () => {
    const row = await get("competitors", id);
    if (!row) throw new HttpError(404, "Referência não encontrada");
    authorizeStore(actor, row.store_id);
    const taskId = key("competitor-task", id, row.alert?.at || row.observed_at);
    const marker = await get("competitor_tasks", taskId);
    if (marker) return get("tasks", marker.task_id);
    const task = await saveTask(actor, {
      storeId: row.store_id,
      offerId: row.offer_id,
      title: `Revisar concorrente: ${row.title}`.slice(0, 200),
      description: `Preço observado: R$ ${row.price}. Compare produto, quantidade e entrega antes de ajustar sua oferta.`,
      priority: "medium",
      status: "todo",
      reason: "Acompanhamento de concorrência",
      evidence: row.url,
      assignee: actor.name,
    });
    await put("competitor_tasks", taskId, {
      task_id: task.id,
      store_id: row.store_id,
    });
    return task;
  });
}
