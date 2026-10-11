import { calculate, simulationSchema } from "../../src/domain/finance";
declare const chrome: any;
const appUrl = "https://datamat-ml.vercel.app";
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const select = (id: string) => $(id) as HTMLSelectElement;
const status = (text: string) => {
  $("status").textContent = text;
};
let token = "",
  detail: any = null,
  captures: any[] = [];
let offerSequence = 0;
const currency = (v: string | null) =>
  v === null
    ? "Indisponível"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(Number(v));
async function request(path: string, body?: unknown) {
  const response = await fetch(appUrl + "/api/extension/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Datamat-Extension": chrome.runtime.id,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir");
  return data;
}
function preview() {
  if (!detail) return;
  const parsed = simulationSchema.safeParse({
    mode: "price",
    price: input("price").value.replace(",", ".") || null,
  });
  if (!parsed.success) {
    $("margin").textContent = "Confira o preço";
    $("minimum").textContent = "—";
    return;
  }
  const value = calculate(
    detail.offer.price,
    detail.costs,
    detail.parameters,
    parsed.data,
  );
  $("margin").textContent = currency(value.margin);
  $("minimum").textContent = currency(value.minPrice);
  $("pending").textContent = value.pending.length
    ? value.pending.join(" · ")
    : "Tarifa, frete e demais condições precisam de conferência antes da aplicação.";
}
async function chooseOffer() {
  const sequence = ++offerSequence;
  detail = null;
  $("margin").textContent = "—";
  $("minimum").textContent = "—";
  $("pending").textContent = "";
  if (!select("offers").value) return;
  const id = select("offers").value;
  const received = await request("offers/" + encodeURIComponent(id));
  if (sequence !== offerSequence || select("offers").value !== id) return;
  detail = received;
  input("price").value = detail.offer.price || "";
  $("open-offer").setAttribute(
    "href",
    `${appUrl}/anuncios/${encodeURIComponent(id)}?tab=costs`,
  );
  status(
    detail.costsStale
      ? "Custos desatualizados: revise no site antes de decidir."
      : "Custos da loja carregados.",
  );
  preview();
}
async function connect() {
  const data = await request("offers");
  $("store").textContent = data.store.name;
  select("offers").replaceChildren(
    new Option("Selecione sua oferta", ""),
    ...data.offers.map((o: any) => new Option(o.title, o.id)),
  );
  $("connected").hidden = false;
  $("pairing").hidden = true;
  status("Extensão conectada à loja.");
}
$("pair-link").setAttribute(
  "href",
  `${appUrl}/configuracoes?configTab=extension&extensionId=${chrome.runtime.id}`,
);
$("pair").addEventListener("click", async () => {
  const previous = token;
  token = input("token").value.trim();
  try {
    await connect();
    await chrome.storage.local.set({ datamatToken: token });
    input("token").value = "";
  } catch (e) {
    token = previous;
    status((e as Error).message);
  }
});
$("disconnect").addEventListener("click", async () => {
  offerSequence++;
  await chrome.storage.local.remove("datamatToken");
  token = "";
  detail = null;
  $("connected").hidden = true;
  $("pairing").hidden = false;
  status("Pareamento removido deste navegador.");
});
select("offers").addEventListener("change", () =>
  chooseOffer().catch((e) => status(e.message)),
);
input("price").addEventListener("input", preview);
$("capture").addEventListener("click", async () => {
  try {
    const value = await chrome.runtime.sendMessage({ type: "capture" });
    if (value.error) throw new Error(value.error);
    captures = value.rows;
    select("references").replaceChildren(
      ...captures.map((c: any, i: number) => new Option(c.title, String(i))),
    );
    $("capture-form").hidden = !captures.length;
    input("capture-price").value = captures[0]?.price || "";
    status(
      captures.length
        ? `${captures.length} referência(s) encontrada(s). Confira o preço antes de salvar.`
        : "Não identifiquei um anúncio individual nesta página. Abra a oferta do vendedor ou cadastre pelo site.",
    );
  } catch (e) {
    status((e as Error).message);
  }
});
select("references").addEventListener("change", () => {
  input("capture-price").value =
    captures[Number(select("references").value)]?.price || "";
});
$("save-capture").addEventListener("click", async () => {
  const button = $("save-capture") as HTMLButtonElement;
  button.disabled = true;
  try {
    const reference = captures[Number(select("references").value)];
    if (!reference) throw new Error("Capture uma referência primeiro.");
    const result = await request("captures", {
      ...reference,
      price: input("capture-price").value,
      offerId: select("offers").value || null,
    });
    $("open-references").setAttribute("href", result.url);
    status("Referência e histórico salvos no site.");
  } catch (e) {
    status((e as Error).message);
  } finally {
    button.disabled = false;
  }
});
chrome.storage.local.get("datamatToken").then(async (value: any) => {
  if (value.datamatToken) {
    token = value.datamatToken;
    try {
      await connect();
    } catch (e) {
      token = "";
      status((e as Error).message);
    }
  }
});
