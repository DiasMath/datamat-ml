import { test, expect } from "@playwright/test";
test("complete persisted offer → costs → proposal → approval → manual application → history workflow", async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible();
  await page.getByRole("button", { name: "Anúncios", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Anúncios", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Novo anúncio", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Loja *", { exact: true }).selectOption("juntos-com");
  await dialog.getByLabel("Nome do produto *").fill("Fone de ouvido teste");
  await dialog.getByLabel("Marca", { exact: true }).fill("Marca do teste");
  await dialog.getByLabel("Categoria", { exact: true }).fill("Áudio");
  await dialog.getByLabel("Modelo", { exact: true }).fill("FT-100");
  await dialog.getByLabel("Título do anúncio *").fill("Fone teste FT-100");
  await dialog.getByLabel("SKU", { exact: true }).fill("FONE-001");
  await dialog.getByLabel("Código Mercado Livre").fill("MLB-TESTE");
  await dialog.getByLabel("Preço atual (R$)").fill("100");
  await dialog
    .getByRole("button", { name: "Cadastrar anúncio", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Anúncios", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Anúncios", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Loja global").selectOption("juntos-com");
  await page.getByLabel("Buscar anúncios").fill("FT-100");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL(/q=FT-100/);
  await page
    .getByRole("button", { name: "Fone teste FT-100", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Custos e preço", exact: true })
    .click();
  for (const [label, value] of [
    ["Mercadoria · oferta inteira", "40"],
    ["Tarifa ML (%)", "10"],
    ["Cobrança fixa ML (R$)", "2"],
    ["Frete da loja (R$)", "5"],
    ["Embalagem (R$)", "1"],
    ["Publicidade por venda (R$)", "2"],
    ["Outros custos (R$)", "0"],
  ])
    await page
      .getByRole("spinbutton", { name: label, exact: true })
      .fill(value);
  await page
    .getByLabel("Impostos (%)", { exact: true })
    .selectOption("override");
  await page.locator('input[name="taxRate"]').fill("5");
  await page
    .getByLabel("Base dos impostos", { exact: true })
    .selectOption("price");
  await page
    .getByLabel("Base da comissão", { exact: true })
    .selectOption("price");
  await page.getByRole("button", { name: "Salvar custos" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Custos salvos" }),
  ).toBeVisible();
  await page.getByLabel("Preço proposto (R$)").fill("90");
  await page.getByLabel("Conferi as tarifas").check();
  await expect(page.getByText("R$ 25,60", { exact: false })).toBeVisible();
  await page
    .getByLabel("Motivo da proposta *")
    .fill("Condição de teste validada com o cliente");
  await page.getByRole("button", { name: "Salvar para revisão" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Proposta salva" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await expect(page.locator(".metric").first()).toContainText("100,00");
  await page.getByRole("button", { name: "Revisar / avançar etapa" }).click();
  await dialog
    .getByLabel("Comentário / justificativa *")
    .fill("Aprovado pelo cliente no teste");
  await dialog.getByRole("button", { name: "Registrar etapa" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Revisar / avançar etapa" }).click();
  await dialog
    .getByLabel("Comentário / justificativa *")
    .fill("Solicitada execução manual ao cliente");
  await dialog.getByRole("button", { name: "Registrar etapa" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Revisar / avançar etapa" }).click();
  await dialog
    .getByLabel("Resultado e evidência da aplicação *")
    .fill("Alteração realizada e conferida no ML · teste");
  await dialog.getByRole("button", { name: "Registrar etapa" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".metric").first()).toContainText("90,00");
  await page.reload();
  await expect(page.locator(".metric").first()).toContainText("90,00");
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  const otherDevice = await context.newPage();
  await otherDevice.goto(page.url());
  await expect(otherDevice.locator(".metric").first()).toContainText("90,00");
  await context.close();
  await page
    .getByRole("button", { name: "Histórico", exact: true })
    .last()
    .click();
  await expect(
    page.getByText("Aplicação manual", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voltar aos anúncios" }).click();
  await expect(page.getByLabel("Buscar anúncios")).toHaveValue("FT-100");
  await expect(page.getByLabel("Loja global")).toHaveValue("juntos-com");
  await page.screenshot({
    path: "test-results/announcements-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Loja global")).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({
    path: "test-results/announcements-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("API preserves origin checks and validation without a local login", async ({
  request,
}) => {
  expect((await request.get("/api/workspace")).status()).toBe(200);
  expect(
    (
      await request.post("/api/offers", { data: { storeId: "juntos-com" } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/auth/login", {
        headers: { Origin: "http://localhost:3100" },
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/offers", {
        headers: { Origin: "http://localhost:3100" },
        data: { storeId: "juntos-com", price: "-10" },
      })
    ).status(),
  ).toBe(422);
  expect(
    (await request.get("/api/workspace?store=unauthorized")).status(),
  ).toBe(404);
});
