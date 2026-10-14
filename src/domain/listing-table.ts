type Row = Record<string, any>;
export function listingCounts(offers: Row[]) {
  const own = offers.filter(
    (o) =>
      o.origin !== "reference" &&
      o.ml?.sellerId &&
      /^MLB\d+$/.test(o.ml_id || ""),
  );
  return {
    records: offers.length,
    mlIds: new Set(own.map((o) => o.store_id + ":" + o.ml_id)).size,
    titles: new Set(
      own.map(
        (o) => o.store_id + ":" + o.title.trim().toLocaleLowerCase("pt-BR"),
      ),
    ).size,
    catalog: own.filter((o) => o.ml.catalogListing).length,
    traditional: own.filter((o) => !o.ml.catalogListing).length,
    local: offers.length - own.length,
  };
}
export function listingType(value: string | null | undefined) {
  return (
    (
      {
        gold_special: "Clássico",
        gold_pro: "Premium",
        free: "Grátis",
      } as Record<string, string>
    )[value || ""] ||
    value ||
    "Não consultado"
  );
}
