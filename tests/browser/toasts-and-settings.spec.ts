import { test, expect } from "@playwright/test";
import { db, key } from "../../src/server/db";

test("notifications overlay the page, count down, pause for pointer/keyboard and dismiss without moving content", async ({
  page,
}) => {
  await page.goto("/acoes?store=juntos-com");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page.clock.install();
  const heading = page.locator(".page-heading");
  const before = (await heading.boundingBox())!;
  await page.getByLabel("Loja global").selectOption("juntos-data");
  const toast = page.locator(".toast").filter({ hasText: "Loja atualizada" });
  await expect(toast).toBeVisible();
  expect(
    await page
      .locator(".toast-viewport")
      .evaluate((el) => getComputedStyle(el).position),
  ).toBe("fixed");
  expect((await heading.boundingBox())!.y).toBe(before.y);
  const progress = toast.locator(".toast-progress");
  await page.mouse.move(0, 0);
  const width = (await progress.boundingBox())!.width;
  await page.waitForTimeout(350);
  expect((await progress.boundingBox())!.width).toBeLessThan(width);
  await toast.hover();
  await page.clock.fastForward(12000);
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Fechar aviso" }).focus();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(12000);
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: "Nova ação", exact: true }).focus();
  await page.clock.fastForward(6000);
  await expect(toast).not.toBeVisible();
  expect((await heading.boundingBox())!.y).toBe(before.y);
});

test("modal errors preserve form position and focus; mobile toasts remain usable in the dialog top layer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let respond: () => void = () => {};
  await page.route("**/api/tasks", async (route) => {
    await new Promise<void>((resolve) => {
      respond = resolve;
    });
    await route.fulfill({
      status: 409,
      json: { error: "Conflito de teste: atualize antes de salvar." },
    });
  });
  await page.goto("/acoes?store=juntos-com");
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Título *", { exact: true })
    .fill("Tarefa com conflito controlado");
  const button = dialog.getByRole("button", { name: "Salvar tarefa" });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(
    dialog.getByRole("button", { name: "Salvando…", exact: true }),
  ).toBeDisabled();
  const title = dialog.getByLabel("Título *", { exact: true });
  await title.focus();
  const box = (await dialog.boundingBox())!;
  const fieldBox = (await title.boundingBox())!;
  respond();
  const toast = dialog
    .getByRole("alert")
    .filter({ hasText: "Conflito de teste" });
  await expect(toast).toBeVisible();
  await expect(title).toBeFocused();
  expect((await dialog.boundingBox())!.height).toBe(box.height);
  expect((await title.boundingBox())!.y).toBe(fieldBox.y);
  const toastBox = (await toast.boundingBox())!;
  expect(toastBox.x).toBeGreaterThanOrEqual(0);
  expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/toast-modal-mobile.png",
    fullPage: true,
  });
  await toast.getByRole("button", { name: "Fechar aviso" }).click();
  await expect(toast).not.toBeVisible();
  await expect(dialog).toBeVisible();
});

test("saving refreshes records without replacing the page with a loading panel", async ({
  page,
}) => {
  await page.goto("/acoes?store=juntos-com");
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Título *", { exact: true })
    .fill("Atualização sem salto");
  await page.route("**/api/workspace?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Salvar tarefa" }).click();
  await saved;
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Carregando dados da operação…", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Atualização sem salto", exact: true }),
  ).toBeVisible();
});

test("a new store is created and configured from the site with credentials encrypted and hidden on reload", async ({
  page,
}) => {
  await page.goto("/configuracoes?store=all");
  await page
    .getByRole("button", { name: "Adicionar loja", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const name = "Loja integração pelo site";
  await dialog.getByLabel("Nome da loja").fill(name);
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  let workspace = await (await page.request.get("/api/workspace")).json();
  const store = workspace.stores.find((s: any) => s.name === name);
  await page.getByLabel("Loja global").selectOption(store.id);
  await page.getByRole("button", { name: "Integrações", exact: true }).click();
  await page
    .getByRole("button", { name: "Configurar integração", exact: true })
    .click();
  await dialog.getByLabel("ID do aplicativo *").fill("123987654321");
  const secret = "browser-only-fake-application-secret";
  await dialog.getByLabel("Chave secreta *").fill(secret);
  await expect(dialog.getByLabel("Chave secreta *")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(
    dialog.getByLabel("URI de redirect", { exact: true }),
  ).toHaveValue("http://localhost:3100/api/mercadolivre/callback");
  await dialog
    .getByRole("button", { name: "Salvar integração", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conectar conta ML", exact: true }),
  ).toBeEnabled();
  const row = (
    await db()
      .collection("ml_applications")
      .doc(key(store.id, "mercadolivre"))
      .get()
  ).data()!;
  expect(row.client_id).toBe("123987654321");
  expect(JSON.stringify(row)).not.toContain(secret);
  workspace = await (await page.request.get("/api/workspace")).json();
  expect(JSON.stringify(workspace)).not.toContain(secret);
  expect(JSON.stringify(workspace)).not.toContain(row.encrypted);
  await page.reload();
  await page
    .getByRole("button", { name: "Editar credenciais", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Nova chave secreta", { exact: true }),
  ).toHaveValue("");
  await expect(dialog.getByLabel("ID do aplicativo *")).toHaveValue(
    "123987654321",
  );
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await dialog
    .getByRole("button", { name: "Salvar integração", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(
    (
      await db()
        .collection("ml_applications")
        .doc(key(store.id, "mercadolivre"))
        .get()
    ).data()?.version,
  ).toBe(1);
});

test("application configuration rejects writes from an unrelated origin", async ({
  page,
}) => {
  const response = await page.request.post(
    `/api/connections/${key("juntos-data", "mercadolivre")}/application`,
    {
      headers: { Origin: "https://unrelated.example" },
      data: { clientId: "123", clientSecret: "synthetic-secret", version: 0 },
    },
  );
  expect(response.status()).toBe(403);
});
