import { test, expect, type APIRequestContext } from "@playwright/test";
import { db } from "../../src/server/db";
const params = {
  minMargin: "10",
  desiredMargin: "20",
  taxRate: "5",
  taxBase: "price",
  managementRate: "1",
  managementBase: "price",
  reviewDays: 30,
  enforceSalesMargin: false,
};
const costs = {
  goods: "40",
  mlPercent: "10",
  mlFixed: "2",
  shipping: "5",
  packaging: "1",
  advertising: "2",
  other: "0",
  otherDescription: "",
};
async function post(request: APIRequestContext, path: string, data: unknown) {
  const r = await request.post(path, {
    headers: { Origin: "http://localhost:3100" },
    data,
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
async function fixture(request: APIRequestContext, title: string) {
  await post(request, "/api/parameters/juntos-com", params);
  const o = await post(request, "/api/offers", {
    storeId: "juntos-com",
    name: "Produto precificação live",
    title,
    brand: "Áudio Live",
    category: "Eletrônicos Live",
    model: "LIVE-001",
    sku: "000LIVE",
    type: "unit",
    status: "draft",
    price: "100",
  });
  await post(request, `/api/offers/${o.id}/costs`, costs);
  return o;
}

test("prices and unsaved costs recalculate on each keystroke without Enter, blur, saving or requests", async ({
  page,
  request,
}) => {
  const o = await fixture(request, "LIVE TYPING");
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=costs`);
  const panel = page.locator(".calculation-panel");
  await expect(panel.locator(".margin-result")).toContainText("R$ 34,00");
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) writes.push(r.url());
  });
  const price = page.getByLabel("Preço proposto (R$)");
  await price.fill("");
  await price.pressSequentially("1");
  await expect(panel.locator(".price-comparison")).toContainText("R$ 1,00");
  await expect(panel.locator(".margin-result")).toContainText("-R$ 49,16");
  await price.pressSequentially("5");
  await expect(price).toBeFocused();
  await expect(panel.locator(".price-comparison")).toContainText("R$ 15,00");
  await expect(panel.locator(".margin-result")).toContainText("-R$ 37,40");
  const goods = page.getByLabel("Mercadoria · oferta inteira", { exact: true });
  await goods.fill("");
  await goods.pressSequentially("1");
  await expect(panel.locator(".margin-result")).toContainText("R$ 1,60");
  await goods.pressSequentially("5");
  await expect(goods).toBeFocused();
  await expect(panel.locator(".margin-result")).toBeInViewport();
  await expect(panel.locator(".margin-result")).toContainText("-R$ 12,40");
  await expect(
    page.getByRole("region", { name: "Prévia dos custos ao digitar" }),
  ).toContainText("R$ 59,00");
  expect(writes).toEqual([]);
  const stored = (await db().collection("costs").doc(o.id).get()).data()!;
  expect(JSON.parse(stored.data_json).goods).toBe("40");
  expect((await db().collection("offers").doc(o.id).get()).data()!.price).toBe(
    "100",
  );
  const authoritative = await post(request, `/api/offers/${o.id}/simulate`, {
    mode: "price",
    price: "15",
    costOverrides: { ...costs, goods: "15" },
  });
  expect(authoritative.proposed.margin).toBe("-12.40");
  await price.fill("");
  await expect(panel.locator(".margin-result")).toContainText("Indisponível");
  await expect(
    panel.getByRole("button", { name: "Salvar para revisão" }),
  ).toBeDisabled();
  await price.fill("101.001");
  await expect(
    page.getByRole("alert").filter({ hasText: "2 casas decimais" }),
  ).toBeVisible();
  await price.fill("90");
  await page
    .getByRole("button", { name: "Percentual de desconto", exact: true })
    .click();
  const discount = page.getByLabel("Desconto financiado pela loja (%)");
  await discount.fill("");
  await discount.pressSequentially("1");
  await expect(panel.locator(".price-comparison")).toContainText("R$ 99,00");
  await discount.pressSequentially("5");
  await expect(panel.locator(".price-comparison")).toContainText("R$ 85,00");
  await discount.fill("100");
  await expect(
    panel.getByRole("button", { name: "Salvar para revisão" }),
  ).toBeDisabled();
  await discount.fill("15");
  await page.setViewportSize({ width: 390, height: 844 });
  await goods.fill("");
  await goods.pressSequentially("1");
  const mobileSummary = page.getByRole("region", {
    name: "Resumo da precificação ao digitar",
  });
  await expect(mobileSummary).toBeInViewport();
  await expect(mobileSummary).toContainText("60,40");
  await goods.pressSequentially("5");
  await expect(mobileSummary).toBeInViewport();
  await expect(mobileSummary).toContainText("46,40");
  await page.screenshot({
    path: "test-results/pricing-live-mobile.png",
    fullPage: true,
  });
});

test("a global pricing scenario can save draft costs for review without modifying current values", async ({
  page,
  request,
}) => {
  const o = await fixture(request, "LIVE GLOBAL");
  await page.goto(`/precificacao?store=juntos-com&offer=${o.id}`);
  await expect(page.locator(".margin-result")).toContainText("R$ 34,00");
  await page
    .getByLabel("Mercadoria · oferta inteira", { exact: true })
    .fill("15");
  await page.getByLabel("Preço proposto (R$)").fill("90");
  await expect(page.locator(".margin-result")).toContainText("R$ 50,60");
  await page.getByLabel("Conferi as tarifas").check();
  await page
    .getByLabel("Motivo da proposta *")
    .fill("Conferência do novo custo sem sobrescrever o atual");
  await page.getByRole("button", { name: "Salvar para revisão" }).click();
  await expect(page.getByRole("status")).toContainText("Proposta salva");
  const proposals = await db()
    .collection("proposals")
    .where("offer_id", "==", o.id)
    .get();
  expect(proposals.size).toBe(1);
  const snapshot = JSON.parse(proposals.docs[0].data().snapshot_json);
  expect(snapshot.proposed.margin).toBe("50.60");
  expect(snapshot.input.costOverrides.goods).toBe("15");
  expect(
    JSON.parse(
      (await db().collection("costs").doc(o.id).get()).data()!.data_json,
    ).goods,
  ).toBe("40");
  expect((await db().collection("offers").doc(o.id).get()).data()!.price).toBe(
    "100",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page.screenshot({
    path: "test-results/pricing-live-desktop.png",
    fullPage: true,
  });
});

test("autocomplete reuses known product text and task assignees, allows new text and keeps record identity explicit", async ({
  page,
  request,
}) => {
  await fixture(request, "AUTOCOMPLETE LIVE");
  await post(request, "/api/tasks", {
    storeId: "juntos-com",
    title: "Conferir embalagem live",
    assignee: "Pessoa Live",
    priority: "medium",
    status: "todo",
    type: "revisão live",
  });
  await page.goto("/anuncios?store=juntos-com");
  await page.getByRole("button", { name: "Novo anúncio", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const brand = dialog.getByLabel("Marca", { exact: true });
  await brand.fill("audio");
  const list = await brand.getAttribute("list");
  expect(list).toBeTruthy();
  await expect(
    dialog
      .locator("datalist")
      .filter({ has: page.locator('option[value="Áudio Live"]') }),
  ).toHaveCount(1);
  await brand.fill("Áudio Live");
  await dialog.getByLabel("Nome do produto *").fill("Produto livre digitado");
  await dialog.getByLabel("Título do anúncio *").fill("AUTOCOMPLETE NOVO");
  await dialog.getByLabel("SKU", { exact: true }).fill("000NOVO");
  await brand.fill("Marca nova livre");
  await dialog
    .getByRole("button", { name: "Cadastrar anúncio", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const saved = await (
    await page.request.get(
      "/api/workspace?store=juntos-com&q=AUTOCOMPLETE+NOVO",
    )
  ).json();
  expect(saved.offers[0].brand).toBe("Marca nova livre");
  expect(saved.offers[0].sku).toBe("000NOVO");
  await page.goto("/acoes?store=juntos-com");
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const assignee = dialog.getByLabel("Responsável", { exact: true });
  await assignee.fill("Pessoa");
  await expect(
    dialog.locator('datalist option[value="Pessoa Live"]'),
  ).toHaveCount(1);
  const type = dialog.getByLabel("Tipo", { exact: true });
  await type.fill("revisao");
  await expect(
    dialog.locator('datalist option[value="revisão live"]'),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
});

test("live costs and proposed costs agree when a stored zero override is changed to inheritance", async ({
  page,
  request,
}) => {
  const o = await fixture(request, "LIVE INHERITANCE");
  await post(request, `/api/offers/${o.id}/costs`, {
    ...costs,
    taxRate: "0",
    managementRate: "0",
  });
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=costs`);
  await expect(page.locator(".margin-result")).toContainText("R$ 40,00");
  await page
    .getByRole("combobox", { name: "Impostos (%)", exact: true })
    .selectOption("inherit");
  await expect(page.locator(".margin-result")).toContainText("R$ 35,00");
  await page
    .getByRole("combobox", { name: "Comissão de gestão (%)", exact: true })
    .selectOption("inherit");
  await expect(page.locator(".margin-result")).toContainText("R$ 34,00");
  await expect(
    page.getByRole("region", { name: "Prévia dos custos ao digitar" }),
  ).toContainText("R$ 34,00");
  await page
    .getByLabel("Motivo da proposta *")
    .fill("Voltar à configuração da loja");
  await page.getByRole("button", { name: "Salvar para revisão" }).click();
  await expect(page.getByRole("status")).toContainText("Proposta salva");
  const proposals = await db()
    .collection("proposals")
    .where("offer_id", "==", o.id)
    .get();
  const proposal = proposals.docs[0],
    snapshot = JSON.parse(proposal.data().snapshot_json);
  expect(snapshot.proposed.margin).toBe("34.00");
  expect(snapshot.input.costOverrides.taxRate).toBeUndefined();
  for (const action of ["approve", "request", "apply_manual"])
    await post(request, `/api/proposals/${proposal.id}`, {
      action,
      comment: "Configuração revisada e aplicada",
      requestId: crypto.randomUUID(),
    });
  await page.reload();
  await expect(page.locator(".margin-result")).toContainText("R$ 34,00");
  expect(
    JSON.parse(
      (await db().collection("costs").doc(o.id).get()).data()!.data_json,
    ).taxRate,
  ).toBeUndefined();
});
