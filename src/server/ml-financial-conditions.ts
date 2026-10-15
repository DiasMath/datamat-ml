import Decimal from "decimal.js";
import { z } from "zod";
import { normalizeTariff } from "../domain/marketplace";
import {
  normalizeShipping,
  normalizeSalePrice,
  normalizePromotions,
} from "../domain/ml-financial";
import { HttpError } from "./access";
type Row = Record<string, any>;
export async function readFinancialConditions(
  request: (path: string) => Promise<unknown>,
  item: Row,
  seller: string,
  price: string,
) {
  const feesQuery = new URLSearchParams({
    price,
    category_id: item.category_id,
    listing_type_id: item.listing_type_id,
    currency_id: "BRL",
    quantity: "1",
  });
  if (item.shipping.mode) feesQuery.set("shipping_mode", item.shipping.mode);
  if (item.shipping.logistic_type)
    feesQuery.set("logistic_type", item.shipping.logistic_type);
  const shippingQuery = new URLSearchParams({
    item_id: item.id,
    item_price: price,
  });
  const results = await Promise.allSettled([
    request("/sites/MLB/listing_prices?" + feesQuery).then((r) =>
      normalizeTariff(r, item.listing_type_id, price),
    ),
    request(
      `/users/${encodeURIComponent(seller)}/shipping_options/free?` +
        shippingQuery,
    ).then((r) => normalizeShipping(r, item.shipping.free_shipping)),
    request(
      `/items/${encodeURIComponent(item.id)}/sale_price?context=channel_marketplace`,
    ).then(normalizeSalePrice),
    request(
      `/seller-promotions/items/${encodeURIComponent(item.id)}?app_version=v2`,
    ).then(normalizePromotions),
  ]);
  const fees = results[0];
  if (fees.status === "rejected") {
    if (fees.reason instanceof HttpError) throw fees.reason;
    throw new HttpError(
      502,
      fees.reason instanceof Error && !(fees.reason instanceof z.ZodError)
        ? fees.reason.message
        : "A resposta de tarifas precisa de validação; confira no Mercado Livre",
    );
  }
  // Authentication failure invalidates the whole observation, including fees.
  for (const r of results)
    if (
      r.status === "rejected" &&
      r.reason instanceof HttpError &&
      r.reason.status === 401
    )
      throw r.reason;
  const shipping = results[1].status === "fulfilled" ? results[1].value : null;
  const salePrice = results[2].status === "fulfilled" ? results[2].value : null;
  const campaigns = results[3].status === "fulfilled" ? results[3].value : null;
  const original =
    item.original_price != null && Number.isFinite(item.original_price)
      ? String(item.original_price)
      : null;
  const discounted =
    !!(
      salePrice?.regularAmount &&
      new Decimal(salePrice.regularAmount).gt(salePrice.amount)
    ) || !!(original && new Decimal(original).gt(item.price));
  const active =
    discounted ||
    !!salePrice?.promotionId ||
    !!campaigns?.some((p) => p.status === "started")
      ? true
      : salePrice && campaigns
        ? false
        : null;
  const warnings: string[] = [];
  if (salePrice && !new Decimal(salePrice.amount).eq(item.price))
    warnings.push(
      "O preço vigente da API difere do cadastro do anúncio; confira as condições promocionais no ML.",
    );
  if (!shipping)
    warnings.push("Frete não consultado; informe ou confira o custo da loja.");
  else if (shipping.reason) warnings.push(shipping.reason);
  if (!salePrice) warnings.push("Preço promocional não consultado.");
  if (!campaigns) warnings.push("Participação em campanhas não consultada.");
  return {
    ...fees.value,
    shipping,
    promotions: {
      active,
      salePrice,
      campaigns: campaigns?.slice(0, 20) ?? null,
      totalCampaigns: campaigns?.length ?? null,
      originalPrice: original,
      subsidyAmount: null,
      source: "Mercado Livre · sale_price / seller-promotions",
    },
    warnings,
  };
}
