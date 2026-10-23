import { test, expect, type APIRequestContext } from "@playwright/test";
import { db, key } from "../../src/server/db";
const costs = {
  goods: null,
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
async function fixture(request: APIRequestContext, purchaseCost = "40") {
  await post(request, "/api/parameters/juntos-com", {
    minMargin: "10",
    desiredMargin: "20",
    taxRate: "5",
    taxBase: "price",
    managementRate: "1",
    managementBase: "price",
    reviewDays: 30,
  });
  const o = await post(request, "/api/offers", {
    storeId: "juntos-com",
    name: "Produto custo atual " + crypto.randomUUID(),
    title: "Anúncio custos " + crypto.randomUUID(),
    purchaseCost,
    price: "100",
    type: "unit",
    status: "draft",
  });
  await post(request, `/api/offers/${o.id}/costs`, costs);
  return o;
}

test("current costs show receipt and net margin; actual edits are protected and scenarios do not persist", async ({
  page,
  request,
}) => {
  const o = await fixture(request);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=costs`);
  const current = page.getByRole("region", {
    name: "Custos atuais do anúncio",
  });
  await expect(current).toBeVisible();
  const results = page.getByLabel("Resultado com os custos atuais", {
    exact: true,
  });
  await expect(results).toContainText("R$ 83,00");
  await expect(results).toContainText("R$ 34,00");
  await expect(results).toContainText("34%");
  await expect(page.getByLabel("Preço proposto (R$)")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Salvar para revisão", exact: true }),
  ).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `test-results/current-costs-${width}.png`,
        fullPage: true,
      });
  }
  await current
    .getByRole("button", { name: "Editar custos", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Editar custos atuais",
    exact: true,
  });
  await dialog.getByLabel("Embalagem (R$)", { exact: true }).fill("3,00");
  await expect(dialog.getByLabel("Prévia dos custos ao digitar")).toContainText(
    "R$ 32,00",
  );
  await page.mouse.click(2, 2);
  const confirm = page.getByRole("dialog", { name: "Descartar alterações?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Descartar e continuar" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    (await (await request.get(`/api/offers/${o.id}`)).json()).costs.packaging,
  ).toBe("1");
  await current
    .getByRole("button", { name: "Editar custos", exact: true })
    .click();
  await dialog.getByLabel("Embalagem (R$)", { exact: true }).fill("3,00");
  await dialog
    .getByRole("button", { name: "Salvar custos", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(results).toContainText("R$ 32,00");
  await current
    .getByRole("button", { name: "Simular alteração", exact: true })
    .click();
  await expect(page.getByLabel("Preço proposto (R$)")).toHaveValue(
    "R$\u00a0100,00",
  );
  await expect(
    page.getByRole("button", { name: "Salvar custos", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Editar produto", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Preço proposto (R$)").fill("150,00");
  await page
    .getByLabel("Mercadoria neste anúncio (R$)", { exact: true })
    .fill("20,00");
  await expect(page.locator(".margin-result")).toContainText("R$ 94,00");
  const saved = await (await request.get(`/api/offers/${o.id}`)).json();
  expect(saved.offer.price).toBe("100");
  expect(saved.offer.product_purchase_cost).toBe("40");
  expect(saved.costs.goods).toBeNull();
  await page.getByRole("button", { name: "Custos", exact: true }).click();
  await confirm.getByRole("button", { name: "Descartar e continuar" }).click();
  await expect(results).toContainText("R$ 32,00");
  expect(errors).toEqual([]);
});

test("BRL fields type cents live, paste amounts, clear and preserve untouched supplier precision", async ({
  page,
  request,
  context,
}) => {
  const o = await fixture(request, "40.123456");
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=costs`);
  await page
    .getByRole("button", { name: "Editar produto", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Cadastro do produto",
    exact: true,
  });
  await expect(dialog.getByLabel("Preço de custo (R$)")).toHaveValue(
    "R$\u00a040,12",
  );
  await dialog
    .getByLabel("Nome do produto *")
    .fill("Produto com precisão preservada");
  await dialog
    .getByRole("button", { name: "Salvar produto", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(
    (await (await request.get(`/api/offers/${o.id}`)).json()).offer
      .product_purchase_cost,
  ).toBe("40.123456");
  await page
    .getByRole("button", { name: "Simular alteração", exact: true })
    .click();
  const amount = page.getByLabel("Preço proposto (R$)");
  await amount.fill("");
  for (const [digit, display] of [
    ["1", "0,01"],
    ["5", "0,15"],
    ["0", "1,50"],
    ["0", "15,00"],
  ]) {
    await amount.pressSequentially(digit);
    await expect(amount).toHaveValue(`R$\u00a0${display}`);
    await expect(page.locator(".price-comparison")).toContainText(
      `R$ ${display}`,
    );
    await expect(amount).toBeFocused();
  }
  await amount.press("Backspace");
  await expect(amount).toHaveValue("R$\u00a01,50");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("R$ 1.234,56"));
  await amount.press("ControlOrMeta+a");
  await amount.press("ControlOrMeta+v");
  await expect(amount).toHaveValue("R$\u00a01.234,56");
  await expect(page.locator(".price-comparison")).toContainText("R$ 1.234,56");
  const goods = page.getByLabel("Mercadoria neste anúncio (R$)", {
    exact: true,
  });
  await goods.fill("");
  await goods.pressSequentially("0");
  await expect(goods).toHaveValue("R$\u00a00,00");
  await expect(page.getByLabel("Prévia dos custos ao digitar")).toContainText(
    "R$ 74,00",
  );
  await goods.fill("");
  await expect(goods).toHaveValue("");
  await expect(
    page
      .locator(".ml-cost-source")
      .filter({ hasText: "Custo do produto: R$ 40,12" }),
  ).toBeVisible();
  await amount.fill("");
  await expect(page.locator(".margin-result")).toContainText("Indisponível");
  await expect(
    page.getByRole("button", { name: "Salvar para revisão", exact: true }),
  ).toBeDisabled();
});

test("global pricing opens current costs and ML cost refresh stays scoped to the selected listing and store", async ({
  page,
  request,
}) => {
  const o = await fixture(request);
  const connectionId = key("juntos-com", "mercadolivre");
  const ref = db().collection("offers").doc(o.id);
  await ref.update({
    ml_id: "MLB987654321",
    ml: {
      sellerId: "111",
      authVersion: 77,
      connectionId,
      categoryId: "MLB100",
      listingTypeId: "gold_special",
      freeShipping: true,
      currencyId: "BRL",
    },
  });
  await db().collection("connections").doc(connectionId).set({
    store_id: "juntos-com",
    provider: "mercadolivre",
    external_account: "111",
    status: "connected",
    auth_version: 77,
  });
  let refreshes = 0,
    quotes = 0;
  await page.route("**/api/catalog/indicators?*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("store")).toBe(
      "juntos-com",
    );
    expect(route.request().postDataJSON()).toEqual({
      ids: [o.id],
      parts: { [o.id]: ["fees"] },
    });
    refreshes++;
    await route.fulfill({
      json: {
        results: [
          {
            id: o.id,
            fees: false,
            metrics: false,
            errors: ["Frete indisponível no teste"],
          },
        ],
      },
    });
  });
  page.on("request", (r) => {
    if (r.url().includes("/ml-quote")) quotes++;
  });
  await page.goto(`/precificacao?store=juntos-com&offer=${o.id}`);
  const current = page.getByRole("region", {
    name: "Custos atuais do anúncio",
  });
  await expect(current).toContainText("Clássico");
  await expect(current).toContainText("Frete grátis para o comprador");
  await current
    .getByRole("button", { name: "Consultar custos do ML", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Frete indisponível no teste" }),
  ).toBeVisible();
  await expect(
    current.getByRole("button", {
      name: "Consultar custos do ML",
      exact: true,
    }),
  ).toBeEnabled();
  expect(refreshes).toBe(1);
  expect(quotes).toBe(0);
  await db()
    .collection("connections")
    .doc(connectionId)
    .update({ status: "unauthorized", external_account: null });
});
