import { purchaseCost } from "../domain/purchase-cost";
import { find, get, type Row } from "./db";
import type { Actor } from "./access";

// Fetch only referenced products in bounded queries, never one query per listing.
export async function purchaseCostCatalog(actor: Actor, offers: Row[]) {
  const components = await purchaseComponents(offers);
  const ids = [
    ...new Set(
      [
        ...offers.map((o) => o.product_id),
        ...components.map((c) => c.product_id),
      ].filter(Boolean),
    ),
  ];
  const products: Row[] = [];
  for (let i = 0; i < ids.length; i += 30)
    products.push(
      ...(await find("products", {
        id: { in: ids.slice(i, i + 30) },
      })),
    );
  const productMap = new Map(
    products
      .filter((p) => p.organization_id === actor.organization_id)
      .map((p) => [p.id, p]),
  );
  return (offer: Row) => ({
    ...offer,
    purchaseCost: purchaseCost(offer, productMap, components),
  });
}
export async function purchaseComponents(offers: Row[]) {
  const ids = offers
    .filter((o) => o.type !== "unit")
    .map((o) => o.id as string);
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 30)
    rows.push(
      ...(await find("components", { offer_id: { in: ids.slice(i, i + 30) } })),
    );
  return rows;
}

export async function offerPurchaseCost(
  actor: Actor,
  offer: Row,
  product: Row,
) {
  const components =
    offer.type === "unit"
      ? []
      : await find("components", { offer_id: offer.id });
  const products = await Promise.all(
    [...new Set(components.map((c) => c.product_id))].map((id) =>
      get("products", id),
    ),
  );
  const map = new Map(
    products
      .filter(
        (p): p is Row => !!p && p.organization_id === actor.organization_id,
      )
      .map((p) => [p.id, p]),
  );
  map.set(product.id, product);
  return purchaseCost(offer, map, components);
}
