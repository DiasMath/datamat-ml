import { createHash } from "node:crypto";
import { z } from "zod";
import { authorizeStore, canWrite, HttpError, type Actor } from "./access";
import { find, get, put, remove, transaction, key, now, type Row } from "./db";
import { campaignSchema, campaignIndicators } from "../domain/campaigns";
import { saveTask } from "./services";
export async function campaigns(actor: Actor, query: URLSearchParams) {
  const store = query.get("store") || "all";
  if (store !== "all") authorizeStore(actor, store);
  const rows = (
    await Promise.all(
      actor.stores
        .filter((s) => store === "all" || s.id === store)
        .map((s) => find("campaign_reports", { store_id: s.id })),
    )
  )
    .flat()
    .filter((r) => r.organization_id === actor.organization_id);
  const from = query.get("from"),
    to = query.get("to");
  if (
    (from || to) &&
    (!from ||
      !to ||
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to)
  )
    throw new HttpError(422, "Informe um intervalo válido");
  const included = rows.filter((r) => !from || (r.from >= from && r.to <= to!));
  return {
    rows: included
      .sort((a, b) => b.to.localeCompare(a.to) || a.name.localeCompare(b.name))
      .map((r) => ({ ...r, indicators: campaignIndicators(r as any) })),
    excluded: rows.filter(
      (r) => !!from && r.from <= to! && r.to >= from && !included.includes(r),
    ).length,
  };
}
export async function saveCampaigns(actor: Actor, payload: unknown) {
  canWrite(actor);
  const p = z
    .object({
      requestId: z.uuid(),
      rows: z.array(campaignSchema).min(1).max(40),
      source: z.enum(["manual", "spreadsheet"]).default("manual"),
    })
    .strict()
    .parse(payload);
  p.rows.forEach((r) => authorizeStore(actor, r.storeId));
  const ids = p.rows.map((r) =>
    key(actor.organization_id, r.storeId, r.campaignKey, r.from, r.to),
  );
  if (new Set(ids).size !== ids.length)
    throw new HttpError(422, "A campanha e o período estão duplicados no lote");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(p))
    .digest("hex");
  return transaction(async () => {
    const opId = key(actor.organization_id, "campaign-save", p.requestId),
      op = await get("campaign_operations", opId);
    if (op) {
      if (op.fingerprint !== fingerprint)
        throw new HttpError(409, "Operação reutilizada com outros dados");
      return { count: p.rows.length };
    }
    for (let i = 0; i < p.rows.length; i++) {
      const row = p.rows[i],
        old = await get("campaign_reports", ids[i]);
      if (row.version !== (old?.version || 0))
        throw new HttpError(
          409,
          "Relatório alterado ou já cadastrado; exporte a versão atual antes de atualizar",
        );
      const existing = await find("campaign_reports", {
        store_id: row.storeId,
        campaignKey: row.campaignKey,
      });
      if (
        existing.some(
          (r) => r.id !== ids[i] && r.from <= row.to && r.to >= row.from,
        ) ||
        p.rows.some(
          (r, j) =>
            j !== i &&
            r.storeId === row.storeId &&
            r.campaignKey === row.campaignKey &&
            r.from <= row.to &&
            r.to >= row.from,
        )
      )
        throw new HttpError(
          409,
          "Períodos da mesma campanha se sobrepõem; use intervalos separados para não duplicar resultados",
        );
      const next = {
        ...row,
        organization_id: actor.organization_id,
        store_id: row.storeId,
        version: row.version + 1,
        source: p.source,
        observed_at: now(),
        created_at: old?.created_at || now(),
        updated_at: now(),
      };
      await put("campaign_reports", ids[i], next);
      await put("history", key(opId, ids[i]), {
        organization_id: actor.organization_id,
        store_id: row.storeId,
        offer_id: null,
        actor_id: actor.id,
        actor_name: actor.name,
        field: "campaign.report",
        old_value: old ? JSON.stringify(old) : null,
        new_value: JSON.stringify(next),
        origin: p.source,
        status: "confirmed",
        reason: `Relatório: ${row.name} (${row.from} a ${row.to})`,
        snapshot_json: "{}",
        created_at: now(),
      });
    }
    await put("campaign_operations", opId, {
      organization_id: actor.organization_id,
      fingerprint,
      created_at: now(),
    });
    return { count: p.rows.length };
  });
}
export async function deleteCampaign(
  actor: Actor,
  id: string,
  payload: unknown,
) {
  canWrite(actor);
  const p = z
    .object({
      version: z.number().int().positive(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(payload);
  return transaction(async () => {
    const old = await get("campaign_reports", id);
    if (!old || old.organization_id !== actor.organization_id)
      throw new HttpError(404, "Relatório não encontrado");
    authorizeStore(actor, old.store_id);
    if (old.version !== p.version)
      throw new HttpError(
        409,
        "Relatório alterado; recarregue antes de excluir",
      );
    await remove("campaign_reports", id);
    await put("history", key("campaign-delete", id, old.version), {
      organization_id: actor.organization_id,
      store_id: old.store_id,
      offer_id: null,
      actor_id: actor.id,
      actor_name: actor.name,
      field: "campaign.deleted",
      old_value: JSON.stringify(old),
      new_value: null,
      origin: "manual",
      status: "deleted",
      reason: "Exclusão do relatório local de campanha",
      snapshot_json: "{}",
      created_at: now(),
    });
    return { deleted: true };
  });
}
export async function campaignTask(actor: Actor, id: string) {
  canWrite(actor);
  return transaction(async () => {
    const row = await get("campaign_reports", id);
    if (!row || row.organization_id !== actor.organization_id)
      throw new HttpError(404, "Relatório não encontrado");
    authorizeStore(actor, row.store_id);
    const insights = campaignIndicators(row as any).insights;
    if (!insights.length)
      throw new HttpError(409, "Nenhum alerta disponível para esta campanha");
    const taskId = key("campaign-task", id),
      link = await get("campaign_task_links", taskId),
      old = link ? await get("tasks", link.task_id) : null;
    if (old && !["done", "cancelled"].includes(old.status)) return old;
    const task = await saveTask(actor, {
      storeId: row.store_id,
      offerId: null,
      title: `Revisar campanha: ${row.name}`,
      description: `${row.from} a ${row.to}\n${insights.map((i) => i.title + ": " + i.action).join("\n")}`,
      assignee: actor.name,
      type: "melhoria",
      priority: "high",
      status: "todo",
      dueDate: null,
      reason: "Diagnóstico do relatório de publicidade",
      result: "",
      evidence: "",
    });
    await put("campaign_task_links", taskId, {
      task_id: task.id,
      store_id: row.store_id,
    });
    return task;
  });
}
