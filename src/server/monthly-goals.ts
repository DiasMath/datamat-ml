import { z } from "zod";
import Decimal from "decimal.js";
import { get, put, remove, transaction, key, now, id, type Row } from "./db";
import { authorizeStore, canWrite, HttpError, type Actor } from "./access";
import { analyticsSources, refreshAnalytics } from "./analytics";
import {
  aggregateAnalytics,
  analysisRange,
  businessDay,
} from "../domain/analytics";

const schema = z.object({
  storeId: z.string().min(1).max(200),
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  target: z
    .string()
    .max(30)
    .refine(
      (v) =>
        /^\d+(\.\d{1,2})?$/.test(v) &&
        new Decimal(v).gt(0) &&
        new Decimal(v).lte("999999999999"),
      "Informe uma meta maior que zero, com até duas casas decimais.",
    ),
  version: z.number().int().nonnegative(),
});
export async function saveMonthlyGoal(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = schema.parse(payload);
  authorizeStore(actor, p.storeId);
  return transaction(async () => {
    const goalId = key(actor.organization_id, p.storeId, p.month);
    const current = await get("monthly_goals", goalId);
    if (current && current.organization_id !== actor.organization_id)
      throw new HttpError(404, "Meta indisponível");
    if ((current?.version || 0) !== p.version)
      throw new HttpError(409, "A meta mudou. Atualize antes de salvar.");
    const goal = await put("monthly_goals", goalId, {
      organization_id: actor.organization_id,
      store_id: p.storeId,
      month: p.month,
      target: new Decimal(p.target).toFixed(2),
      version: p.version + 1,
      updated_at: now(),
    });
    await put("history", id(), {
      organization_id: actor.organization_id,
      store_id: p.storeId,
      offer_id: null,
      field: "goal.monthly",
      old_value: current ? JSON.stringify(current.target) : null,
      new_value: JSON.stringify(goal.target),
      origin: "manual",
      status: "confirmed",
      snapshot_json: "{}",
      actor_name: actor.name,
      reason: "Meta mensal de faturamento",
      created_at: now(),
      actor_id: actor.id,
    });
    return goal;
  });
}
export async function deleteMonthlyGoal(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = schema.omit({ target: true }).parse(payload);
  authorizeStore(actor, p.storeId);
  await transaction(async () => {
    const goalId = key(actor.organization_id, p.storeId, p.month);
    const current = await get("monthly_goals", goalId);
    if (!current || current.organization_id !== actor.organization_id)
      throw new HttpError(404, "Meta indisponível");
    if (current.version !== p.version)
      throw new HttpError(409, "A meta mudou. Atualize antes de remover.");
    await remove("monthly_goals", goalId);
    await put("history", id(), {
      organization_id: actor.organization_id,
      store_id: p.storeId,
      offer_id: null,
      field: "goal.monthly",
      old_value: JSON.stringify(current.target),
      new_value: null,
      origin: "manual",
      status: "confirmed",
      snapshot_json: "{}",
      actor_name: actor.name,
      reason: "Meta mensal removida",
      created_at: now(),
      actor_id: actor.id,
    });
  });
  return { removed: true };
}
export async function monthlyGoalReport(
  actor: Actor,
  store: string,
  clock = new Date(),
) {
  if (store !== "all") authorizeStore(actor, store);
  const day = businessDay(clock),
    month = day.slice(0, 7);
  const stores = actor.stores.filter((s) => store === "all" || s.id === store);
  const goals = (
    await Promise.all(
      stores.map((s) =>
        get("monthly_goals", key(actor.organization_id, s.id, month)),
      ),
    )
  ).filter((g): g is Row => !!g && g.organization_id === actor.organization_id);
  const ids = new Set(goals.map((g) => g!.store_id));
  const scoped = { ...actor, stores: stores.filter((s) => ids.has(s.id)) };
  const sources = goals.length
    ? await analyticsSources(
        scoped,
        new URLSearchParams({ from: month + "-01", to: day }),
        clock,
      )
    : [];
  const report = aggregateAnalytics(
    sources,
    analysisRange(month + "-01", day, clock),
  );
  const target = goals.reduce<Decimal>(
    (sum, g) => sum.plus(g!.target),
    new Decimal(0),
  );
  const available = goals.length > 0 && report.available;
  const revenue = available ? new Decimal(report.current.revenue) : null;
  const complete = available && report.complete;
  const daysInMonth = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  ).getUTCDate();
  const remainingDays = daysInMonth - Number(day.slice(8)) + 1;
  const remaining = revenue ? Decimal.max(0, target.minus(revenue)) : null;
  return {
    month,
    day,
    configured: goals.length,
    totalStores: stores.length,
    goals: goals.map((g) => ({
      storeId: g!.store_id,
      target: g!.target,
      version: g!.version,
    })),
    target: goals.length ? target.toFixed(2) : null,
    available,
    complete,
    revenue: revenue?.toFixed(2) ?? null,
    percent: complete ? revenue!.div(target).times(100).toFixed(2) : null,
    remaining: complete ? remaining!.toFixed(2) : null,
    perDay: complete ? remaining!.div(remainingDays).toFixed(2) : null,
    remainingDays,
    observedAt:
      sources
        .map((s) => s.observedAt)
        .filter(Boolean)
        .sort()[0] || null,
    stores: sources.map((s) => ({
      id: s.storeId,
      name: s.storeName,
      connected: s.connected,
      complete: s.complete,
      error: s.error,
    })),
  };
}
export async function refreshMonthlyGoals(
  actor: Actor,
  store: string,
  force = false,
) {
  canWrite(actor);
  const report = await monthlyGoalReport(actor, store);
  const ids = new Set(report.goals.map((g) => g.storeId));
  if (
    ids.size &&
    (force ||
      !report.observedAt ||
      Date.now() - Date.parse(report.observedAt) >= 600000)
  )
    await refreshAnalytics(
      { ...actor, stores: actor.stores.filter((s) => ids.has(s.id)) },
      new URLSearchParams({ from: report.month + "-01", to: report.day }),
      Date.now() + 40000,
      true,
    );
}
