import Decimal from "decimal.js";
type Row = Record<string, any>;
export const COMPETITION_MAX_AGE = 15 * 60000;
export function listingCompetition(
  offer: Row,
  account: Row | undefined,
  snapshot: Row | undefined,
  clock = Date.now(),
) {
  const missing = (reason: string, observedAt: string | null = null) => ({
    available: false,
    status: null,
    priceToWin: null,
    currentPrice: null,
    observedAt,
    reason,
  });
  if (!offer.ml?.catalogListing || offer.origin === "reference")
    return missing("Fora do catálogo próprio");
  if (
    account?.status !== "connected" ||
    account.external_account !== offer.ml.sellerId ||
    account.auth_version !== offer.ml.authVersion
  )
    return missing("Conexão ou autorização a conferir");
  if (
    !snapshot ||
    snapshot.offer_id !== offer.id ||
    snapshot.store_id !== offer.store_id ||
    snapshot.seller_id !== account.external_account ||
    snapshot.auth_version !== account.auth_version ||
    snapshot.offer_version !== offer.version ||
    (snapshot.organization_id &&
      snapshot.organization_id !== offer.organization_id)
  )
    return missing("Consulta pendente para a versão atual");
  const age = clock - Date.parse(snapshot.observed_at);
  if (!Number.isFinite(age) || age < 0)
    return missing("Data da consulta inválida; atualize a competitividade");
  if (age > COMPETITION_MAX_AGE)
    return missing(
      "Consulta vencida; atualize a competitividade",
      snapshot.observed_at,
    );
  if (snapshot.consistent === false)
    return missing(
      "O ML sinalizou condições inconsistentes",
      snapshot.observed_at,
    );
  if (
    snapshot.currentPrice != null &&
    offer.price != null &&
    !new Decimal(snapshot.currentPrice).eq(offer.price)
  )
    return missing("Preço mudou; consulte novamente", snapshot.observed_at);
  if (
    ![
      "winning",
      "losing",
      "sharing_first_place",
      "listed",
      "not_listed",
      "challenging",
    ].includes(snapshot.status)
  )
    return missing(
      "Situação não reconhecida na resposta do ML",
      snapshot.observed_at,
    );
  return {
    available: true,
    status: snapshot.status as string,
    priceToWin: snapshot.priceToWin ?? null,
    currentPrice: snapshot.currentPrice ?? null,
    observedAt: snapshot.observed_at as string,
    reason: null,
  };
}
export function listingOverview(
  offers: Row[],
  stores: Row[],
  accounts: Row[],
  snapshots: Row[],
  clock = Date.now(),
) {
  const accountMap = new Map(
    accounts
      .filter((c) => c.provider === "mercadolivre")
      .map((c) => [c.store_id, c]),
  );
  const snapshotMap = new Map(snapshots.map((s) => [s.offer_id, s]));
  const catalogue = offers.filter(
    (o) => o.origin !== "reference" && o.ml?.sellerId && o.ml.catalogListing,
  );
  const rows = catalogue.map((o) => {
    const result = listingCompetition(
      o,
      accountMap.get(o.store_id),
      snapshotMap.get(o.id),
      clock,
    );
    return {
      id: o.id,
      title: o.title,
      mlId: o.ml_id,
      storeId: o.store_id,
      storeName: o.store_name,
      ...result,
      minPrice: o.calculation?.minPrice ?? null,
      belowFloor:
        result.priceToWin != null && o.calculation?.minPrice != null
          ? new Decimal(result.priceToWin).lt(o.calculation.minPrice)
          : null,
    };
  });
  return {
    generatedAt: new Date(clock).toISOString(),
    competition: {
      total: rows.length,
      available: rows.filter((r) => r.available).length,
      winning: rows.filter((r) => r.status === "winning").length,
      losing: rows.filter((r) => r.status === "losing").length,
      sharing: rows.filter((r) => r.status === "sharing_first_place").length,
      other: rows.filter(
        (r) =>
          r.available &&
          !["winning", "losing", "sharing_first_place"].includes(r.status!),
      ).length,
      unavailable: rows.filter((r) => !r.available).length,
      rows,
    },
    sync: stores.map((s) => {
      const c = accountMap.get(s.id);
      return {
        storeId: s.id,
        storeName: s.name,
        status: c?.status || "unconfigured",
        lastCatalogSync: c?.last_catalog_completed_at || null,
        lastItemSync: c?.last_sync_at || null,
        lastNotification: c?.last_notification_at || null,
        partial: !!c?.has_more,
        running: !!c?.sync_running,
        error: c?.last_error || null,
        imported: offers.filter(
          (o) =>
            o.store_id === s.id && o.origin !== "reference" && o.ml?.sellerId,
        ).length,
        catalogTotal: c?.catalog_total ?? null,
      };
    }),
  };
}
