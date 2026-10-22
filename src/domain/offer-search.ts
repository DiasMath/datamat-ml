type Row = Record<string, any>;
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
export function matchesOfferSearch(offer: Row, query: string) {
  const mlId = /^https?:\/\//i.test(query.trim())
    ? query.match(/\bMLB[- ]?(\d{4,20})\b/i)?.[1]
    : null;
  const tokens =
    normalize(mlId ? "MLB" + mlId : query).match(/[\p{L}\p{N}]+/gu) || [];
  const values = [
    offer.title,
    offer.product_name,
    offer.sku,
    offer.model,
    offer.brand,
    offer.ml_id,
  ]
    .filter(Boolean)
    .map((v) => normalize(String(v)));
  const haystack = values.join(" ");
  const compact = values.map((v) => v.replace(/[^\p{L}\p{N}]/gu, "")).join(" ");
  return tokens.every(
    (token) => haystack.includes(token) || compact.includes(token),
  );
}
