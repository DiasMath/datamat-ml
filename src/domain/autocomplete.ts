const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
// Only previously supplied business text; suggestions never select a record ID or change prices.
export function autocompleteSuggestions(
  values: (string | null | undefined)[],
  query: string,
  limit = 25,
) {
  const needle = normalize(query.trim());
  const seen = new Set<string>();
  return values
    .flatMap((value) => {
      const text = value?.trim();
      if (!text) return [];
      const key = normalize(text);
      if (seen.has(key) || !key.includes(needle)) return [];
      seen.add(key);
      return [text];
    })
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .slice(0, limit);
}
