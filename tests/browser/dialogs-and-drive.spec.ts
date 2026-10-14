import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, key } from "../../src/server/db";
const confirmation = "Descartar alterações?";
test("discard dialogs preserve unsaved inputs on cancel and Escape and discard only on confirmation", async ({
  page,
}) => {
  let nativeDialogs = 0;
  page.on("dialog", (d) => {
    nativeDialogs++;
    void d.dismiss();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/anuncios?store=juntos-com");
  await page.getByRole("button", { name: "Novo anúncio", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Novo anúncio", exact: true });
  await form.getByLabel("Nome do produto *").fill("Edição preservada");
  await form.getByRole("button", { name: "Fechar", exact: true }).click();
  const decision = page.getByRole("dialog", { name: confirmation });
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "Continuar editando" }).click();
  await expect(form.getByLabel("Nome do produto *")).toHaveValue(
    "Edição preservada",
  );
  await page.keyboard.press("Escape");
  await expect(decision).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(decision).not.toBeVisible();
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Fechar", exact: true }).click();
  await decision.getByRole("button", { name: "Descartar e continuar" }).click();
  await expect(form).not.toBeVisible();
  expect(nativeDialogs).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const records = await db()
    .collection("products")
    .where("name", "==", "Edição preservada")
    .get();
  expect(records.size).toBe(0);
});
test("browser back protects child module drafts, keeps the route on cancel, and leaves on confirmation", async ({
  page,
}) => {
  await page.goto("/anuncios?store=juntos-com");
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("button", { name: "Concorrência", exact: true })
    .click();
  await expect(page).toHaveURL(/concorrencia/);
  await page
    .getByRole("button", { name: "Adicionar referência", exact: true })
    .first()
    .click();
  const form = page.getByRole("dialog", {
    name: "Adicionar referência",
    exact: true,
  });
  await form
    .getByLabel("Título *", { exact: true })
    .fill("Não perder esta edição");
  await form.getByRole("button", { name: "Fechar", exact: true }).click();
  const decision = page.getByRole("dialog", { name: confirmation });
  await decision.getByRole("button", { name: "Continuar editando" }).click();
  await page.evaluate(() => history.back());
  await decision.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page).toHaveURL(/concorrencia/);
  await expect(form.getByLabel("Título *", { exact: true })).toHaveValue(
    "Não perder esta edição",
  );
  await page.evaluate(() => history.back());
  await decision.getByRole("button", { name: "Descartar e continuar" }).click();
  await expect(page).toHaveURL(/anuncios/);
  await expect(form).not.toBeVisible();
});
test("Google Drive is configured per store through the site, hides secrets and completes denied OAuth without reloading", async ({
  page,
  context,
  request,
}) => {
  const response = await request.post("/api/stores", {
    headers: { Origin: "http://localhost:3100" },
    data: { name: "Google Drive UI " + randomUUID() },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const store = await response.json();
  await page.goto(`/configuracoes?store=${store.id}&configTab=integrations`);
  const card = page.locator(".integration-card").filter({
    has: page.getByRole("heading", { name: "Google Drive", exact: true }),
  });
  await card
    .getByRole("button", { name: "Configurar Google Drive", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Configurar Google Drive",
    exact: true,
  });
  await form
    .getByLabel("Client ID Google *")
    .fill("test-client.apps.googleusercontent.com");
  const secret = "browser-test-only-google-secret";
  await form.getByLabel("Segredo OAuth Google *").fill(secret);
  await expect(
    form.getByLabel("URI de retorno Google", { exact: true }),
  ).toHaveValue("http://localhost:3100/api/google-drive/callback");
  await form
    .getByRole("button", { name: "Salvar configuração Google" })
    .click();
  await expect(form).not.toBeVisible();
  await expect(
    card.getByRole("button", { name: "Conectar Google Drive" }),
  ).toBeEnabled();
  const projections = await (
    await request.get(`/api/google-drive?store=${store.id}`)
  ).json();
  expect(JSON.stringify(projections)).not.toContain(secret);
  const stored = (
    await db()
      .collection("drive_integrations")
      .doc(key("datamat", store.id, "google-drive"))
      .get()
  ).data()!;
  expect(stored.application).not.toContain(secret);
  expect(stored.tokens).toBeNull();
  await page.reload();
  await card
    .getByRole("button", { name: "Configurar Google Drive", exact: true })
    .click();
  await expect(form.getByLabel("Novo segredo OAuth Google")).toHaveValue("");
  await form.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__driveSentinel = "still-here";
  });
  await context.route(
    "https://accounts.google.com/o/oauth2/**",
    async (route) => {
      const authorization = new URL(route.request().url());
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({
        state: authorization.searchParams.get("state")!,
        error: "access_denied",
      }).toString();
      await route.fulfill({
        status: 302,
        headers: { location: callback.toString() },
        body: "",
      });
    },
  );
  await card.getByRole("button", { name: "Conectar Google Drive" }).click();
  await expect(
    page
      .locator(".toast")
      .filter({ hasText: "Autorização do Google Drive cancelada" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__driveSentinel)).toBe(
    "still-here",
  );
  await expect(page).toHaveURL(new RegExp(`store=${store.id}`));
  await expect(
    card.getByRole("button", { name: "Conectar Google Drive" }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
