import { test, expect } from "@playwright/test";

test("import/export, general tasks, notes and integration failure are usable through the UI", async ({
  page,
}) => {
  const origin = "http://localhost:3100";
  await page.goto("/anuncios?store=juntos-data");
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "teste.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name;title;sku;mlId;brand;category;price;type;status\nProduto CSV;Oferta importada CSV;CSV-01;MLB-CSV-UI;Marca CSV;Categoria CSV;120,50;unit;draft",
    ),
  });
  await dialog
    .getByRole("button", { name: "Validar e visualizar prévia" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Prévia · 1 registros" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirmar importação de 1 anúncios" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Oferta importada CSV", exact: true }),
  ).toBeVisible();
  const exportResponse = await page.request.get(
    "/api/export?store=juntos-data",
  );
  expect(exportResponse.status()).toBe(200);
  expect(await exportResponse.text()).toContain("Oferta importada CSV");
  expect(await exportResponse.text()).not.toContain("Fone teste FT-100");
  await page.getByRole("button", { name: "Ações", exact: true }).click();
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  await dialog
    .getByLabel("Título *", { exact: true })
    .fill("Revisar regra geral da loja");
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Tarefa geral, sem anúncio relacionado.");
  await dialog.getByLabel("Prazo", { exact: true }).fill("2026-10-20");
  await dialog.getByRole("button", { name: "Salvar tarefa" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Revisar regra geral da loja",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Estudos e notas", exact: true })
    .click();
  await page.getByRole("button", { name: "Nova nota", exact: true }).click();
  await dialog
    .getByLabel("Título *", { exact: true })
    .fill("Estudo de custos CSV");
  await dialog
    .getByLabel("Anotação *")
    .fill("Investigar tarifas com base no cadastro importado.");
  await dialog.getByRole("button", { name: "Salvar nota" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Transformar em tarefa" }).click();
  await dialog
    .getByRole("button", { name: "Criar tarefa", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Ações", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Estudo de custos CSV", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page.getByRole("button", { name: "Integrações", exact: true }).click();
  await page
    .getByRole("button", { name: "Verificar disponibilidade" })
    .first()
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "credenciais" }),
  ).toContainText("credenciais");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Registros de integração" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/integrations-desktop.png",
    fullPage: true,
  });
});
