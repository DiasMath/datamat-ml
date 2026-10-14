type SearchOffer = {
  id: string;
  title: string;
  sku?: string | null;
  mlId?: string | null;
  storeName?: string;
};
const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
export function quickSearch<T extends SearchOffer>(
  offers: T[],
  input: string,
  limit = 20,
) {
  const needle = normalized(input.trim()),
    words = needle.split(/\s+/).filter(Boolean);
  const code = needle.replace(/[^a-z0-9]/g, "");
  const score = (o: T) =>
    normalized(o.sku || "") === needle ||
    normalized(o.mlId || "").replace(/[^a-z0-9]/g, "") === code
      ? 0
      : normalized(o.title).startsWith(needle)
        ? 1
        : 2;
  return offers
    .filter(
      (o) =>
        !needle ||
        words.every((word) =>
          normalized(
            [o.title, o.sku, o.mlId, o.storeName].filter(Boolean).join(" "),
          ).includes(word),
        ) ||
        (!!code && normalized(o.mlId || "").replace(/[^a-z0-9]/g, "") === code),
    )
    .sort((a, b) => (needle ? score(a) - score(b) : 0))
    .slice(0, limit);
}
