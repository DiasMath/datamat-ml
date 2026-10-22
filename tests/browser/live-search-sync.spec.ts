import { test, expect, type APIRequestContext } from "@playwright/test";
import { db, key } from "../../src/server/db";
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, {
    headers: { Origin: "http://localhost:3100" },
    data,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function fixtures(request: APIRequestContext) {
  const stamp = String(Date.now());
  const base = {
    storeId: "juntos-com",
    type: "unit",
    status: "draft",
    price: "100",
    brand: "Busca " + stamp,
    category: "Áudio",
    model: "MOD-0009",
  };
  const a = await post(request, "/api/offers", {
    ...base,
    name: "Áudio de estúdio",
    title: "Fone Azul " + stamp,
    sku: "SKU-0009",
    mlId: "MLB" + stamp,
  });
  const b = await post(request, "/api/offers", {
    ...base,
    name: "Cabo de conexão",
    title: "Cabo Vermelho " + stamp,
    sku: "CABO-0010",
  });
  return { a, b, brand: base.brand };
}
test("Anúncios searches as text is typed or pasted, preserves scope and avoids extra workspace reads", async ({
  page,
  request,
}) => {
  const { a, b, brand } = await fixtures(request);
  await page.goto(
    "/anuncios?" + new URLSearchParams({ store: "juntos-com", brand }),
  );
  const search = page.getByLabel("Buscar anúncios", { exact: true });
  await expect(page.locator(".offers-panel tbody")).toContainText(a.title);
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/workspace")) reads++;
  });
  await search.pressSequentially("audio azul", { delay: 15 });
  await expect(page.locator(".offers-panel tbody")).toContainText(a.title);
  await expect(page.locator(".offers-panel tbody")).not.toContainText(b.title);
  await expect(page).toHaveURL(/q=audio\+azul/);
  await expect(search).toBeFocused();
  const url = `https://produto.mercadolivre.com.br/MLB-${a.ml_id.slice(3)}-texto-que-nao-e-o-titulo?tracking=outro`;
  await search.evaluate((element, text) => {
    const input = element as HTMLInputElement;
    input.select();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text", text);
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, url);
  await expect(search).toHaveValue(url);
  await expect(page.locator(".offers-panel tbody")).toContainText(a.title);
  await expect(page.getByLabel("Loja global")).toHaveValue("juntos-com");
  expect(new URL(page.url()).searchParams.get("brand")).toBe(brand);
  await search.fill("cabo vermelho");
  await expect(page.locator(".offers-panel tbody")).toContainText(b.title);
  await expect(page.locator(".offers-panel tbody")).not.toContainText(a.title);
  await page
    .getByRole("button", { name: "Limpar pesquisa", exact: true })
    .click();
  await expect(page.locator(".offers-panel tbody")).toContainText(a.title);
  await expect(page.locator(".offers-panel tbody")).toContainText(b.title);
  expect(reads).toBe(0);
});
test("Precificação finds products by SKU or name locally and keeps the selected listing until an explicit choice", async ({
  page,
  request,
}) => {
  const { a, b } = await fixtures(request);
  await page.goto("/precificacao?store=juntos-com");
  const input = page.getByLabel("Buscar produto para precificar");
  await expect(input).toBeVisible();
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/workspace")) reads++;
  });
  await input.fill("sku0009");
  const select = page.getByLabel("Selecione uma oferta");
  await expect(select.locator(`option[value="${a.id}"]`)).toHaveCount(1);
  await expect(select.locator(`option[value="${b.id}"]`)).toHaveCount(0);
  await select.selectOption(a.id);
  await expect(page.locator(".calculation-panel")).toBeVisible();
  await input.fill("cabo vermelho");
  await expect(select).toHaveValue(a.id);
  await expect(select.locator(`option[value="${b.id}"]`)).toHaveCount(1);
  await select.selectOption(b.id);
  await expect(page).toHaveURL(new RegExp("offer=" + b.id));
  await expect(page.locator(".calculation-panel")).toBeVisible();
  expect(reads).toBe(0);
});
test("one integration click continues all pages and automatically resumes after an ML 429 without switching stores", async ({
  page,
  request,
}) => {
  await request.get("/api/workspace");
  const connection = db()
    .collection("connections")
    .doc(key("juntos-com", "mercadolivre"));
  const previous = (await connection.get()).data()!;
  await connection.set({
    ...previous,
    status: "connected",
    external_account: "111",
    auth_version: 100,
    has_more: true,
  });
  let requests = 0;
  try {
    await page.route("**/api/catalog/refresh?*", async (route) => {
      expect(new URL(route.request().url()).searchParams.get("store")).toBe(
        "juntos-com",
      );
      requests++;
      if (requests === 1)
        return route.fulfill({
          status: 429,
          json: { error: "Limite temporário de consultas", retryAfterMs: 1000 },
        });
      const partial = requests === 2;
      if (!partial)
        await connection.set(
          {
            has_more: false,
            pending_batch: false,
            last_catalog_completed_at: new Date().toISOString(),
            last_error: null,
          },
          { merge: true },
        );
      await route.fulfill({
        json: {
          partial,
          results: [
            {
              storeId: "juntos-com",
              status: "confirmed",
              processed: partial ? 20 : 0,
              has_more: partial,
            },
          ],
        },
      });
    });
    await page.goto("/configuracoes?store=juntos-com&configTab=integrations");
    await page
      .getByRole("button", { name: "Sincronizar anúncios", exact: true })
      .click();
    await expect(
      page.getByText(/Aguardando o ML.*retomada automática/),
    ).toBeVisible();
    await expect(page.locator(".toast-viewport")).toContainText(
      "Catálogo da loja sincronizado · 20 anúncios consultados",
    );
    expect(requests).toBe(3);
    await expect(page.getByLabel("Loja global")).toHaveValue("juntos-com");
    await expect(
      page.getByRole("button", { name: "Sincronizar anúncios", exact: true }),
    ).toBeEnabled();
  } finally {
    await connection.set(previous);
  }
});
