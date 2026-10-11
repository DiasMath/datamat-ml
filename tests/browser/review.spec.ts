import { test, expect, type Page } from "@playwright/test";
import { db } from "../../src/server/db";
const origin = "http://localhost:3100";
async function post(page: Page, path: string, data: unknown) {
  const result = await page.request.post(path, {
    headers: { Origin: origin },
    data,
  });
  expect(result.status(), await result.text()).toBe(200);
  return result.json();
}
const offerPayload = (extra: Record<string, unknown> = {}) => ({
  storeId: "juntos-com",
  name: "Produto da revisão",
  title: "Anúncio da revisão",
  model: "REV-100",
  brand: "Marca revisão",
  category: "Categoria revisão",
  type: "unit",
  status: "draft",
  price: "100",
  sku: "REV-100",
  ...extra,
});

test("UI creates, edits and deletes offers and shared product metadata in Firestore", async ({
  page,
}) => {
  await page.goto("/anuncios?store=juntos-com");
  await page.getByRole("button", { name: "Novo anúncio", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Nome do produto *").fill("Produto CRUD UI");
  await modal.getByLabel("Título do anúncio *").fill("Rascunho CRUD UI");
  await modal.getByLabel("Código Mercado Livre").fill("MLB-CRUD-UI");
  await modal.getByLabel("Preço atual (R$)").fill("100");
  await modal.getByRole("button", { name: "Cadastrar anúncio" }).click();
  await expect(modal).not.toBeVisible();
  let workspace = await (
    await page.request.get("/api/workspace?store=juntos-com")
  ).json();
  const created = workspace.offers.find(
    (o: any) => o.title === "Rascunho CRUD UI",
  );
  expect(created).toBeTruthy();
  expect((await db().collection("offers").doc(created.id).get()).exists).toBe(
    true,
  );
  await page
    .getByRole("button", { name: "Rascunho CRUD UI", exact: true })
    .click();
  await page.getByRole("button", { name: "Editar cadastro" }).click();
  await modal
    .getByLabel("Corrigir nome, modelo, marca e categoria do produto")
    .check();
  await modal.getByLabel("Nome do produto *").fill("Produto CRUD corrigido");
  await modal.getByLabel("Marca", { exact: true }).fill("Marca corrigida UI");
  await modal.getByLabel("Título do anúncio *").fill("Rascunho corrigido UI");
  await modal.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Rascunho corrigido UI", exact: true }),
  ).toBeVisible();
  expect(
    (await db().collection("products").doc(created.product_id).get()).data()
      ?.name,
  ).toBe("Produto CRUD corrigido");
  await page.getByRole("button", { name: "Editar cadastro" }).click();
  await modal.getByRole("button", { name: "Excluir rascunho" }).click();
  await expect(modal).toHaveAccessibleName("Confirmar exclusão");
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect((await db().collection("offers").doc(created.id).get()).exists).toBe(
    true,
  );
  await page.getByRole("button", { name: "Editar cadastro" }).click();
  await modal.getByRole("button", { name: "Excluir rascunho" }).click();
  await modal
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await expect(page).toHaveURL(/\/anuncios\?store=juntos-com$/);
  await expect(modal).not.toBeVisible();
  expect((await db().collection("offers").doc(created.id).get()).exists).toBe(
    false,
  );
  expect((await db().collection("costs").doc(created.id).get()).exists).toBe(
    false,
  );
  workspace = await (
    await page.request.get("/api/workspace?store=juntos-com")
  ).json();
  expect(workspace.offers.some((o: any) => o.id === created.id)).toBe(false);
  expect(
    workspace.history.some(
      (h: any) => h.field === "offer.delete" && h.offer_id === created.id,
    ),
  ).toBe(true);
});

test("UI edits and removes tasks and notes, preserving audit records", async ({
  page,
}) => {
  await page.goto("/acoes?store=juntos-com");
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Título *").fill("Tarefa CRUD UI");
  await modal.getByRole("button", { name: "Salvar tarefa" }).click();
  await expect(modal).not.toBeVisible();
  await page
    .getByRole("button", { name: "Tarefa CRUD UI", exact: true })
    .click();
  await modal.getByLabel("Título *").fill("Tarefa corrigida UI");
  await modal.getByLabel("Situação", { exact: true }).selectOption("done");
  await modal
    .getByLabel("Resultado", { exact: true })
    .fill("Resultado conferido");
  await modal.getByRole("button", { name: "Salvar tarefa" }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Tarefa corrigida UI", exact: true }),
  ).toBeVisible();
  let data = await (
    await page.request.get("/api/workspace?store=juntos-com")
  ).json();
  const t = data.tasks.find((t: any) => t.title === "Tarefa corrigida UI");
  expect((await db().collection("tasks").doc(t.id).get()).data()?.status).toBe(
    "done",
  );
  await page
    .getByRole("button", { name: "Tarefa corrigida UI", exact: true })
    .click();
  await modal.getByRole("button", { name: "Excluir tarefa" }).click();
  await modal
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await expect(modal).not.toBeVisible();
  expect((await db().collection("tasks").doc(t.id).get()).exists).toBe(false);
  await page.goto("/estudos?store=juntos-com");
  await page.getByRole("button", { name: "Nova nota", exact: true }).click();
  await modal.getByLabel("Título *").fill("Nota CRUD UI");
  await modal.getByLabel("Anotação *").fill("Anotação inicial");
  await modal.getByRole("button", { name: "Salvar nota" }).click();
  await expect(modal).not.toBeVisible();
  await page
    .locator(".note-card")
    .filter({ hasText: "Nota CRUD UI" })
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  await modal.getByLabel("Anotação *").fill("Anotação corrigida");
  await modal.getByRole("button", { name: "Salvar nota" }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Anotação corrigida", { exact: true }),
  ).toBeVisible();
  data = await (
    await page.request.get("/api/workspace?store=juntos-com")
  ).json();
  const n = data.notes.find((n: any) => n.title === "Nota CRUD UI");
  expect((await db().collection("notes").doc(n.id).get()).data()?.body).toBe(
    "Anotação corrigida",
  );
  await page
    .locator(".note-card")
    .filter({ hasText: "Nota CRUD UI" })
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  await modal.getByRole("button", { name: "Excluir nota" }).click();
  await modal
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await expect(modal).not.toBeVisible();
  expect((await db().collection("notes").doc(n.id).get()).exists).toBe(false);
});

test("configuration persists store names and financial parameters", async ({
  page,
}) => {
  await page.goto("/configuracoes?store=all");
  const modal = page.getByRole("dialog");
  await page
    .getByRole("button", { name: "Adicionar loja", exact: true })
    .click();
  await expect(modal).toHaveAccessibleName("Adicionar loja");
  await modal.getByLabel("Nome da loja").fill("Loja da revisão UI");
  await modal.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(modal).not.toBeVisible();
  const storeCard = page
    .locator(".store-card")
    .filter({ hasText: "Loja da revisão UI" });
  await storeCard.getByRole("button", { name: "Editar nome da loja" }).click();
  await expect(modal.getByLabel("Nome da loja")).toHaveValue(
    "Loja da revisão UI",
  );
  await modal.getByLabel("Nome da loja").fill("Loja da revisão renomeada");
  await modal.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page
    .locator(".store-card")
    .filter({ hasText: "Loja da revisão renomeada" })
    .getByRole("button", { name: "Editar parâmetros" })
    .click();
  await modal.getByLabel("Margem mínima (%)").fill("10");
  await modal.getByLabel("Margem desejada (%)").fill("20");
  await modal.getByLabel("Impostos (%)").fill("5");
  await modal.getByLabel("Base de impostos").selectOption("price");
  await modal.getByLabel("Base da comissão").selectOption("price");
  await modal.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await expect(
    page
      .locator(".store-card")
      .filter({ hasText: "Loja da revisão renomeada" }),
  ).toContainText("10%");
});

test("all screens, detail tabs and forms fit desktop, tablet and small phones with long content", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const o = await post(
    page,
    "/api/offers",
    offerPayload({
      title: "Oferta extensa " + "x".repeat(175),
      mlId: "MLB-RESPONSIVE-UI",
    }),
  );
  await post(page, "/api/tasks", {
    storeId: "juntos-com",
    offerId: o.id,
    title: "Tarefa extensa " + "x".repeat(170),
    assignee: "Responsável " + "x".repeat(170),
    description: "Descrição " + "x".repeat(300),
    priority: "high",
    status: "todo",
    dueDate: "2026-10-01",
  });
  await post(page, "/api/notes", {
    storeId: "juntos-com",
    offerId: o.id,
    title: "Nota extensa " + "x".repeat(170),
    body: "https://example.test/" + "x".repeat(300),
    kind: "study",
  });
  const paths = [
    "/",
    "/anuncios?store=juntos-com",
    "/acoes?store=juntos-com",
    "/estudos?store=juntos-com",
    "/historico?store=juntos-com",
    "/concorrencia?store=juntos-com",
    ...["stores", "integrations", "sync", "extension"].map(
      (t) => "/configuracoes?store=juntos-com&configTab=" + t,
    ),
    ...["overview", "content", "costs", "performance", "tasks", "history"].map(
      (t) => `/anuncios/${o.id}?store=juntos-com&tab=${t}`,
    ),
    `/precificacao?store=juntos-com&offer=${o.id}`,
  ];
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator("main")).toBeVisible();
      const size = await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
      }));
      const overflow =
        size.width > size.viewport
          ? await page.evaluate(() =>
              Array.from(document.querySelectorAll("main *"))
                .map((el) => ({
                  tag: el.tagName,
                  class: el.className,
                  right: Math.round(el.getBoundingClientRect().right),
                  width: Math.round(el.getBoundingClientRect().width),
                }))
                .filter((el) => el.right > innerWidth)
                .slice(-12),
            )
          : [];
      expect(
        size.width,
        `Overflow ${width}px: ${path}; ${JSON.stringify(overflow)}`,
      ).toBeLessThanOrEqual(size.viewport);
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: `test-results/review/${width}-${path.split("?")[0].replaceAll("/", "_") || "today"}-${new URL(origin + path).searchParams.get("tab") || new URL(origin + path).searchParams.get("configTab") || "main"}.png`,
          fullPage: true,
        });
    }
    await page.goto("/anuncios?store=juntos-com");
    for (const filter of ["Categoria", "Marca", "Situação", "Tipo"]) {
      const popup = page.locator(".multi-filter").filter({
        has: page.locator("summary", { hasText: filter }),
      });
      await popup.locator("summary").click();
      const box = await popup.locator(":scope > div").boundingBox();
      expect(box!.x, `${filter} popup at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await popup.locator("summary").click();
    }
    await page
      .getByRole("button", { name: "Novo anúncio", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal).toHaveAccessibleName("Novo anúncio");
    const geometry = await modal.evaluate((node) => ({
      width: node.scrollWidth,
      client: node.clientWidth,
      top: node.getBoundingClientRect().top,
      bottom: node.getBoundingClientRect().bottom,
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.client);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(900);
    await modal.getByRole("button", { name: "Fechar", exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test("editing kit and variation components preserves their composition, and changing to unit clears it", async ({
  page,
}) => {
  const component = await post(
    page,
    "/api/offers",
    offerPayload({ name: "Componente UI" }),
  );
  const kit = await post(
    page,
    "/api/offers",
    offerPayload({
      title: "Kit composição UI",
      type: "kit",
      components: [{ productId: component.product_id, quantity: 2 }],
    }),
  );
  await page.goto(`/anuncios/${kit.id}?store=juntos-com`);
  await page.getByRole("button", { name: "Editar cadastro" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Produto 1", { exact: true })).toHaveValue(
    component.product_id,
  );
  await expect(modal.getByLabel("Quantidade 1")).toHaveValue("2");
  await modal.getByLabel("Tipo de oferta").selectOption("variation");
  await modal.getByLabel("Atributos 1").fill("Cor: preto");
  await modal.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(modal).not.toBeVisible();
  let detail = await (await page.request.get(`/api/offers/${kit.id}`)).json();
  expect(detail.components[0].quantity).toBe(2);
  expect(detail.components[0].variation).toBe("Cor: preto");
  await page.getByRole("button", { name: "Editar cadastro" }).click();
  await expect(modal.getByLabel("Atributos 1")).toHaveValue("Cor: preto");
  await modal.getByLabel("Tipo de oferta").selectOption("unit");
  await expect(
    modal.getByLabel("Produto 1", { exact: true }),
  ).not.toBeVisible();
  await modal.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(modal).not.toBeVisible();
  detail = await (await page.request.get(`/api/offers/${kit.id}`)).json();
  expect(detail.offer.type).toBe("unit");
  expect(detail.components).toEqual([]);
});

test("combined UI filters and batch status changes persist only the selected records", async ({
  page,
}) => {
  const first = await post(
    page,
    "/api/offers",
    offerPayload({
      title: "Lote UI primeiro",
      brand: "Marca Lote UI",
      category: "Categoria Lote UI",
    }),
  );
  const second = await post(
    page,
    "/api/offers",
    offerPayload({
      title: "Lote UI segundo",
      brand: "Marca Lote UI",
      category: "Categoria Lote UI",
    }),
  );
  const outside = await post(
    page,
    "/api/offers",
    offerPayload({
      title: "Fora do lote UI",
      brand: "Outra marca lote",
      category: "Categoria Lote UI",
    }),
  );
  await page.goto("/anuncios?store=juntos-com");
  const category = page
    .locator(".multi-filter")
    .filter({ has: page.locator("summary", { hasText: "Categoria" }) });
  await category.locator("summary").click();
  await category.getByLabel("Categoria Lote UI", { exact: true }).click();
  await expect(page).toHaveURL(/category=Categoria/);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await category.locator("summary").click();
  const brand = page
    .locator(".multi-filter")
    .filter({ has: page.locator("summary", { hasText: "Marca" }) });
  await brand.locator("summary").click();
  await brand.getByLabel("Marca Lote UI", { exact: true }).click();
  await expect(page).toHaveURL(/brand=Marca/);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await brand.locator("summary").click();
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  await page.getByLabel("Selecionar anúncios desta página").check();
  await page
    .getByRole("button", { name: "Alterar situação em lote", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Nova situação").selectOption("closed");
  await modal
    .getByRole("button", { name: "Confirmar alteração em lote" })
    .click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  for (const id of [first.id, second.id])
    expect((await db().collection("offers").doc(id).get()).data()?.status).toBe(
      "closed",
    );
  expect(
    (await db().collection("offers").doc(outside.id).get()).data()?.status,
  ).toBe("draft");
});

test("mobile navigation closes with Escape and does not leave background controls focusable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Abrir navegação" });
  await toggle.click();
  await expect(page.locator(".sidebar")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".main-shell")).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "Fechar navegação" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole("button", { name: "Ações", exact: true }).click();
  await expect(page).toHaveURL(/acoes/);
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("heading", { name: "Ações", exact: true }),
  ).toBeVisible();
});

test("load failures clear stale data and provide a working retry", async ({
  page,
}) => {
  await page.goto("/anuncios?store=juntos-com");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Falha de teste controlada" }),
    }),
  );
  await page.getByLabel("Loja global").selectOption("juntos-data");
  await expect(
    page.getByRole("heading", { name: "Não foi possível carregar" }),
  ).toBeVisible();
  expect(await page.locator(".offers-table tbody tr").count()).toBe(0);
  await page.unroute("**/api/workspace*");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("heading", { name: "Não foi possível carregar" }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Loja global")).toHaveValue("juntos-data");
});

test("workspace needs no login and browser-supplied identities cannot change server scope", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.goto("/login");
  await expect(fresh).toHaveURL(origin + "/");
  await expect(
    fresh.getByRole("heading", { name: "Hoje", exact: true }),
  ).toBeVisible();
  await expect(fresh.getByLabel("Senha", { exact: true })).toHaveCount(0);
  await expect(
    fresh.getByRole("button", { name: "Sair", exact: true }),
  ).toHaveCount(0);
  const response = await fresh.request.get("/api/workspace", {
    headers: {
      "X-User-Id": "forged-user",
      "X-Organization-Id": "other-org",
      Cookie: "datamat_session=forged",
    },
  });
  const data = await response.json();
  expect(data.user.id).toBe("workspace-operator");
  expect(data.user.organization_id).toBe("datamat");
  expect(
    (await fresh.request.get("/api/workspace?store=outside")).status(),
  ).toBe(404);
  await context.close();
});

test("unused proposals can be cancelled through the workflow without changing the current price", async ({
  page,
}) => {
  const o = await post(
    page,
    "/api/offers",
    offerPayload({ title: "Proposta para cancelar UI", mlId: "MLB-CANCEL-UI" }),
  );
  const proposal = await post(page, "/api/proposals", {
    offerId: o.id,
    input: { mode: "price", price: "90" },
    reason: "Cenário substituído na revisão",
    requestId: crypto.randomUUID(),
  });
  await page.goto(`/anuncios/${o.id}?store=juntos-com`);
  await page.getByRole("button", { name: "Revisar / avançar etapa" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Próxima etapa").selectOption("cancel");
  await modal
    .getByLabel("Comentário / justificativa *")
    .fill("Cancelado para preparar um cenário novo");
  await modal.getByRole("button", { name: "Registrar etapa" }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".proposal-card")).toContainText("Cancelada");
  expect((await db().collection("offers").doc(o.id).get()).data()?.price).toBe(
    "100",
  );
  expect(
    (await db().collection("proposals").doc(proposal.id).get()).data()?.status,
  ).toBe("cancelled");
});

test("all dialogs and direct entry remain readable within small mobile viewports", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const dialogs = [
    { path: "/acoes?store=juntos-com", button: "Nova ação" },
    { path: "/estudos?store=juntos-com", button: "Nova nota" },
    { path: "/anuncios?store=juntos-com", button: "Importar" },
    { path: "/configuracoes?store=juntos-com", button: "Editar parâmetros" },
    { path: "/configuracoes?store=all", button: "Adicionar loja" },
  ];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scenario of dialogs) {
      await page.goto(scenario.path);
      await page
        .getByRole("button", { name: scenario.button, exact: true })
        .first()
        .click();
      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      const box = await modal.evaluate((el) => ({
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(box.left, scenario.button).toBeGreaterThanOrEqual(0);
      expect(box.right, scenario.button).toBeLessThanOrEqual(width);
      expect(box.scroll, scenario.button).toBeLessThanOrEqual(box.client);
      await modal.getByRole("button", { name: "Fechar", exact: true }).click();
    }
    const context = await browser.newContext({
      viewport: { width, height: 844 },
    });
    const login = await context.newPage();
    await login.goto("/login");
    await expect(
      login.getByRole("heading", { name: "Hoje", exact: true }),
    ).toBeVisible();
    expect(
      await login.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width === 390 || width === 1440)
      await login.screenshot({
        path: `test-results/review/login-${width}.png`,
        fullPage: true,
      });
    await context.close();
  }
});
