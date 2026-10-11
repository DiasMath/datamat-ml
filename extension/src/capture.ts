// Self-contained function: Chrome serializes it into the selected tab.
export function capturePage() {
  if (
    location.protocol !== "https:" ||
    !/(^|\.)mercadolivre\.com\.br$/.test(location.hostname)
  )
    throw new Error(
      "Abra um anúncio ou uma pesquisa do Mercado Livre brasileiro.",
    );
  const identity = (url: string) => {
    try {
      const u = new URL(url);
      if (!/(^|\.)mercadolivre\.com\.br$/.test(u.hostname)) return null;
      const id =
        u.pathname.match(/\/MLB-(\d{1,20})(?:\D|$)/i)?.[1] ||
        u.searchParams.get("item_id")?.match(/^MLB(\d{1,20})$/)?.[1];
      return id ? `MLB${id}` : null;
    } catch {
      return null;
    }
  };
  const price = (root: ParentNode) => {
    const box = root.querySelector(
      ".ui-pdp-price__second-line .andes-money-amount, .ui-search-price__second-line .andes-money-amount, .ui-search-item__group--price .andes-money-amount, .poly-price__current .andes-money-amount",
    );
    const fraction = box
      ?.querySelector(".andes-money-amount__fraction")
      ?.textContent?.replace(/\./g, "")
      .trim();
    const cents =
      box?.querySelector(".andes-money-amount__cents")?.textContent?.trim() ||
      "00";
    const currency = box
      ?.querySelector(".andes-money-amount__currency-symbol")
      ?.textContent?.trim();
    if (currency && currency !== "R$") return null;
    return fraction && /^\d+$/.test(fraction) && /^\d{1,2}$/.test(cents)
      ? `${fraction}.${cents.padStart(2, "0")}`
      : null;
  };
  const candidates: Array<{
    itemId: string;
    title: string;
    url: string;
    price: string | null;
  }> = [];
  const itemId = identity(location.href);
  if (itemId) {
    const title = document.querySelector(".ui-pdp-title")?.textContent?.trim();
    if (title)
      candidates.push({
        itemId,
        title: title.slice(0, 200),
        url: location.href,
        price: price(document),
      });
  } else
    for (const row of Array.from(
      document.querySelectorAll(".ui-search-layout__item"),
    ).slice(0, 25)) {
      const anchor = row.querySelector<HTMLAnchorElement>('a[href*="/MLB-"]');
      const id = anchor ? identity(anchor.href) : null;
      const title = row
        .querySelector(".ui-search-item__title, .poly-component__title")
        ?.textContent?.trim();
      if (id && title && anchor)
        candidates.push({
          itemId: id,
          title: title.slice(0, 200),
          url: anchor.href,
          price: price(row),
        });
    }
  return [...new Map(candidates.map((c) => [c.itemId, c])).values()];
}
