import Decimal from "decimal.js";
type Row = Record<string, any>;
export const RECENT_ML_CHANGE_AGE = 7 * 86400000;
export type ListingChangeDetail = {
  field: string;
  label: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};
export function observedListingChanges(
  previous: Row,
  next: Row,
  observation: Row,
): ListingChangeDetail[] {
  const result: ListingChangeDetail[] = [];
  const add = (field: string, label: string, before: any, after: any) => {
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null))
      result.push({
        field,
        label,
        before: before ?? null,
        after: after ?? null,
      });
  };
  add(
    "price",
    "Preço",
    previous.price == null ? null : new Decimal(previous.price).toFixed(2),
    next.price == null ? null : new Decimal(next.price).toFixed(2),
  );
  for (const [field, label] of [
    ["status", "Situação"],
    ["title", "Título"],
    ["sku", "SKU"],
  ])
    add(field, label, previous[field], next[field]);
  add(
    "stock",
    "Estoque",
    previous.ml?.availableQuantity,
    observation.availableQuantity,
  );
  add(
    "listingType",
    "Modalidade",
    previous.ml?.listingTypeId,
    observation.listingTypeId,
  );
  add(
    "freeShipping",
    "Frete grátis",
    previous.ml?.freeShipping,
    observation.freeShipping,
  );
  add(
    "category",
    "Categoria ML",
    previous.ml?.categoryId,
    observation.categoryId,
  );
  for (const [field, label] of [
    ["currencyId", "Moeda"],
    ["shippingMode", "Modalidade de envio"],
    ["logisticType", "Logística"],
    ["catalogListing", "Catálogo"],
    ["variablePrices", "Preços por variação"],
    ["variationCount", "Quantidade de variações"],
  ])
    add(field, label, previous.ml?.[field], observation[field]);
  add("quality", "Qualidade ML", previous.ml?.health, observation.health);
  if (
    JSON.stringify(previous.ml?.pictures || []) !==
    JSON.stringify(observation.pictures || [])
  )
    result.push({
      field: "pictures",
      label: "Fotos",
      before: `${previous.ml?.pictures?.length || 0} fotos`,
      after: `${observation.pictures?.length || 0} fotos · arquivos ou ordem alterados`,
    });
  add("video", "Vídeo", previous.ml?.videoId, observation.videoId);
  if ((previous.description || "") !== (next.description || ""))
    result.push({
      field: "description",
      label: "Descrição",
      before: `${(previous.description || "").length} caracteres`,
      after: `${(next.description || "").length} caracteres · conteúdo alterado`,
    });
  for (const [field, label] of [
    ["attributes", "Ficha técnica"],
    ["variationDetails", "Variações"],
    ["subStatus", "Restrições"],
  ]) {
    if (
      JSON.stringify(previous.ml?.[field] || []) !==
      JSON.stringify(observation[field] || [])
    )
      result.push({
        field,
        label,
        before: `${previous.ml?.[field]?.length || 0} registros`,
        after: `${observation[field]?.length || 0} registros · conteúdo alterado`,
      });
  }
  return result;
}
export function recentListingChange(
  offer: Row,
  connection?: Row,
  clock = Date.now(),
) {
  const change = offer.ml_last_change,
    time = Date.parse(change?.at);
  if (
    offer.origin === "reference" ||
    !change ||
    connection?.status !== "connected" ||
    change.sellerId !== connection.external_account ||
    change.authVersion !== connection.auth_version ||
    offer.ml?.sellerId !== connection.external_account ||
    offer.ml?.authVersion !== connection.auth_version ||
    !Number.isFinite(time) ||
    time > clock ||
    clock - time > RECENT_ML_CHANGE_AGE
  )
    return null;
  return {
    at: change.at as string,
    fields: Array.isArray(change.fields)
      ? (change.fields
          .filter((f: unknown) => typeof f === "string")
          .slice(0, 20) as string[])
      : [],
    details: Array.isArray(change.details)
      ? (change.details.slice(0, 20) as ListingChangeDetail[])
      : [],
  };
}
