import { test, expect, type APIRequestContext } from "@playwright/test";
import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, {
    headers: { Origin: "http://localhost:3100" },
    data,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
const parameters = {
  minMargin: "10",
  desiredMargin: "20",
  taxRate: "0",
  taxBase: "price",
  managementRate: "0",
  managementBase: "price",
  reviewDays: 30,
  enforceSalesMargin: true,
};
const costs = {
  goods: null,
  mlPercent: "0",
  mlFixed: "0",
  shipping: "0",
  packaging: "0",
  advertising: "0",
  other: "0",
  otherDescription: "",
};

test("supplier cost registration, live inherited calculations and per-store blocking settings persist", async ({
  page,
  request,
}) => {
  await post(request, "/api/parameters/juntos-com", parameters);
  await page.goto("/anuncios?store=juntos-com");
  await page.getByRole("button", { name: "Novo anúncio", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Nome do produto *")
    .fill("Produto custo fornecedor UI");
  await dialog.getByLabel("Título do anúncio *").fill("CUSTO-FORNECEDOR-UI");
  await dialog.getByLabel("Custo de compra do fornecedor (R$)").fill("20");
  await dialog.getByLabel("Preço atual (R$)").fill("100");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/offers") && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Cadastrar anúncio", exact: true })
    .click();
  const offer = await (await saved).json();
  expect(offer.product_purchase_cost).toBe("20");
  await expect(dialog).not.toBeVisible();
  await post(request, `/api/offers/${offer.id}/costs`, costs);
  await page.goto(`/anuncios/${offer.id}?store=juntos-com&tab=costs`);
  const panel = page.locator(".calculation-panel");
  await expect(panel.locator(".margin-result")).toContainText("R$ 80,00");
  await expect(panel.getByTestId("sales-margin-policy")).toContainText(
    "Meta atendida",
  );
  await expect(
    page.getByLabel("Mercadoria · oferta inteira", { exact: true }),
  ).toHaveValue("");
  await expect(
    page
      .locator(".ml-cost-source")
      .filter({ hasText: "Custo do produto: R$ 20,00" }),
  ).toBeVisible();
  const price = page.getByLabel("Preço proposto (R$)");
  await price.fill("30");
  await expect(panel.locator(".margin-result")).toContainText("R$ 10,00");
  await expect(panel.getByTestId("sales-margin-policy")).toContainText(
    "Aprovação bloqueada",
  );
  await price.fill("100");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `test-results/product-cost-${width}.png`,
        fullPage: true,
      });
  }
  // Discard only the unsaved scenario, then edit the shared product.
  await page.goto(`/anuncios/${offer.id}?store=juntos-com`);
  await page
    .getByRole("button", { name: "Editar cadastro", exact: true })
    .click();
  await dialog.getByLabel("Editar dados e custo de compra do produto").check();
  await dialog.getByLabel("Custo de compra do fornecedor (R$)").fill("30");
  await dialog
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const detail = await (await request.get(`/api/offers/${offer.id}`)).json();
  expect(detail.calculation.margin).toBe("70.00");
  expect(detail.costs.goods).toBeNull();
  await page.goto("/configuracoes?store=juntos-com");
  const card = page.locator(".store-card").filter({ hasText: "juntos.com" });
  await expect(card).toContainText("Bloquear aprovação e aplicação");
  await card.getByRole("button", { name: "Editar parâmetros" }).click();
  const block = dialog.getByLabel(
    "Bloquear aprovação e aplicação abaixo da meta de margem",
  );
  await expect(block).toBeChecked();
  await expect(
    dialog.getByLabel("Meta de margem sobre a venda (%)"),
  ).toHaveValue("40");
  await block.uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await dialog.evaluate((node) => ({
    width: node.scrollWidth,
    client: node.clientWidth,
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
  }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.client);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(390);
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(card).toContainText("Alertar e sugerir preço");
});

test("Excel Products sheet changes shared purchase cost once while preserving a listing-specific zero", async ({
  page,
  request,
}) => {
  const fixture = {
    storeId: "juntos-com",
    name: "Produto Excel custo UI",
    title: "EXCEL-CUSTO-UI base",
    type: "unit",
    status: "draft",
    price: "100",
    purchaseCost: "17.123456",
  };
  const unit = await post(request, "/api/offers", fixture);
  const linked = await post(request, "/api/offers", {
    ...fixture,
    title: "EXCEL-CUSTO-UI exceção",
    productId: unit.product_id,
  });
  await post(request, `/api/offers/${unit.id}/costs`, costs);
  await post(request, `/api/offers/${linked.id}/costs`, {
    ...costs,
    goods: "0",
  });
  const exported = await request.get(
    "/api/export?store=juntos-com&q=EXCEL-CUSTO-UI&format=xlsx",
  );
  expect(exported.status()).toBe(200);
  const sheets = await readXlsxFile(await exported.body());
  const products = sheets.find((s) => s.sheet === "Produtos")!;
  expect(products.data).toHaveLength(2);
  expect(products.data[1][products.data[0].indexOf("purchaseCost")]).toBe(
    17.123456,
  );
  products.data[1][products.data[0].indexOf("purchaseCost")] = 42.654321;
  const buffer = await writeXlsxFile(
    products.data.map((r) =>
      r.map((v) =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? v
          : null,
      ),
    ),
    { sheet: "Produtos" },
  ).toBuffer();
  await page.goto("/anuncios?store=juntos-com&q=EXCEL-CUSTO-UI");
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Operação", { exact: true }).selectOption("costs");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "custos.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await dialog
    .getByRole("button", { name: "Validar e visualizar prévia" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Prévia · 1 registros" }),
  ).toBeVisible();
  await expect(dialog.locator(".import-preview")).toContainText("R$ 42,65");
  await dialog
    .getByRole("button", { name: "Confirmar importação de 1 produtos" })
    .click();
  await expect(dialog).not.toBeVisible();
  const first = await (await request.get(`/api/offers/${unit.id}`)).json();
  const second = await (await request.get(`/api/offers/${linked.id}`)).json();
  expect(first.offer.product_purchase_cost).toBe("42.654321");
  expect(first.calculation.breakdown.goods).toBe("42.65");
  expect(first.costs.goods).toBeNull();
  expect(second.costs.goods).toBe("0");
  expect(second.calculation.breakdown.goods).toBe("0.00");
});
