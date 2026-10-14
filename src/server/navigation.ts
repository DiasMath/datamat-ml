import { db, type Row } from "./db";
import { authorizeStore, type Actor } from "./access";
import { safePictureUrl } from "./mercadolivre";

async function projected(
  actor: Actor,
  collection: string,
  ids: string[],
  fields: string[],
  limit?: number,
) {
  const rows: Row[] = [];
  let truncated = false;
  for (let i = 0; i < ids.length; i += 30) {
    let query = db()
      .collection(collection)
      .where("store_id", "in", ids.slice(i, i + 30))
      .select(...fields);
    if (limit !== undefined) query = query.limit(limit + 1 - rows.length);
    const result = await query.get();
    rows.push(
      ...result.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .filter(
          (r: Row) =>
            !r.organization_id || r.organization_id === actor.organization_id,
        ),
    );
    if (limit !== undefined && rows.length > limit) {
      truncated = true;
      rows.length = limit;
      break;
    }
  }
  return { rows, truncated };
}
function stores(actor: Actor, query: URLSearchParams) {
  const selected = query.get("store") || "all";
  if (selected !== "all") authorizeStore(actor, selected);
  return actor.stores.filter((s) => selected === "all" || s.id === selected);
}
export async function navigationReport(actor: Actor, query: URLSearchParams) {
  const selected = stores(actor, query),
    ids = selected.map((s) => s.id);
  const [connections, tasks] = await Promise.all([
    projected(actor, "connections", ids, [
      "organization_id",
      "store_id",
      "provider",
      "status",
    ]),
    projected(actor, "tasks", ids, ["organization_id", "status"]),
  ]);
  return {
    user: actor,
    stores: actor.stores,
    connections: connections.rows.map((c) => ({
      id: c.id,
      store_id: c.store_id,
      provider: c.provider,
      status: c.status,
    })),
    openTasks: tasks.rows.filter(
      (t) => !["done", "cancelled"].includes(t.status),
    ).length,
  };
}
export async function searchOffers(actor: Actor, query: URLSearchParams) {
  const selected = stores(actor, query),
    ids = selected.map((s) => s.id);
  const { rows, truncated } = await projected(
    actor,
    "offers",
    ids,
    [
      "organization_id",
      "store_id",
      "title",
      "sku",
      "ml_id",
      "price",
      "status",
      "origin",
      "updated_at",
      "ml.pictures",
    ],
    5000,
  );
  return {
    truncated,
    offers: rows
      .sort((a, b) =>
        String(b.updated_at || "").localeCompare(String(a.updated_at || "")),
      )
      .map((o) => ({
        id: o.id,
        title: o.title,
        sku: o.sku || null,
        mlId: o.ml_id || null,
        price: o.price,
        status: o.status,
        origin: o.origin,
        storeId: o.store_id,
        storeName: selected.find((s) => s.id === o.store_id)?.name || "",
        thumbnail:
          o.ml?.pictures
            ?.map((p: Row) => safePictureUrl(p.url))
            .find(Boolean) || null,
      })),
  };
}
