import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";
const headers = { Origin: "http://localhost:3100" };
let stores: string[];
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { headers, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test.beforeEach(async ({ request }) => {
  stores = [];
  for (const name of ["Visões A ", "Visões B "])
    stores.push(
      (await post(request, "/api/stores", { name: name + randomUUID() })).id,
    );
  for (const storeId of stores)
    for (const [i, price] of ["10", "2"].entries())
      await post(request, "/api/offers", {
        storeId,
        name: "VISÃO Produto " + i,
        title: "VISÃO Produto " + i,
        sku: "SKU-" + i,
        price,
        type: "unit",
        status: "draft",
      });
});
test.afterEach(async () => {
  for (const storeId of stores) {
    const views = await db()
      .collection("listing_views")
      .where("store_id", "==", storeId)
      .get();
    await Promise.all(views.docs.map((doc) => doc.ref.delete()));
    await db().collection("stores").doc(storeId).update({ active: 0 });
  }
});
async function menu(page: Page, name: "Visões salvas" | "Colunas visíveis") {
  const summary = page.getByLabel(name, { exact: true });
  await summary.click();
}
test("views persist in Firestore and another browser restores filters, sort, columns and pagination within the selected shop", async ({
  page,
  request,
  browser,
}) => {
  await page.goto(
    `/anuncios?store=${stores[0]}&q=VISÃO&status=draft&sort=price&sortDir=asc&pageSize=20`,
  );
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  await menu(page, "Colunas visíveis");
  await page
    .getByLabel("Escolher colunas")
    .getByLabel("SKU", { exact: true })
    .uncheck();
  await page.keyboard.press("Escape");
  await menu(page, "Visões salvas");
  await page
    .getByRole("button", { name: "Salvar nova visão", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Salvar visão",
    exact: true,
  });
  await dialog.getByLabel("Nome da visão").fill("Revisar preços");
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/api/listing-views", async (route) => {
    await saveGate;
    await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Salvar visão", exact: true })
    .click();
  try {
    await expect(dialog.getByLabel("Nome da visão")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Salvando…", exact: true }),
    ).toBeDisabled();
  } finally {
    releaseSave();
  }
  await expect(dialog).toHaveCount(0);
  const saved = (
    await (await request.get(`/api/listing-views?store=${stores[0]}`)).json()
  ).views[0];
  expect(saved.config.hiddenColumns).toEqual(["sku"]);
  expect(saved.config.filters.q).toBe("VISÃO");
  expect(saved.config.filters.sort).toBe("price");
  expect(
    (await (await request.get(`/api/listing-views?store=${stores[1]}`)).json())
      .views,
  ).toEqual([]);
  const other = await browser.newContext({ baseURL: "http://localhost:3100" });
  try {
    const tab = await other.newPage();
    await tab.goto(`/anuncios?store=${stores[0]}&page=9&sort=name`);
    await expect(tab.getByRole("columnheader", { name: /SKU/ })).toBeVisible();
    await menu(tab, "Visões salvas");
    await tab
      .getByRole("button", {
        name: "Aplicar visão Revisar preços",
        exact: true,
      })
      .click();
    await expect(tab.getByLabel("Buscar anúncios")).toHaveValue("VISÃO");
    await expect(tab.getByLabel("Anúncios por página")).toHaveValue("20");
    await expect(tab.getByRole("columnheader", { name: /SKU/ })).toHaveCount(0);
    await expect(tab.locator(".offers-table tbody tr").first()).toContainText(
      "Produto 1",
    );
    expect(new URL(tab.url()).searchParams.get("store")).toBe(stores[0]);
    expect(new URL(tab.url()).searchParams.has("page")).toBe(false);
    await tab.reload();
    await expect(
      tab.getByLabel("Visões salvas", { exact: true }),
    ).toContainText("Revisar preços");
    await expect(tab.getByRole("columnheader", { name: /SKU/ })).toHaveCount(0);
    await tab.getByLabel("Loja global").selectOption(stores[1]);
    await menu(tab, "Visões salvas");
    await expect(
      tab.getByRole("button", { name: "Aplicar visão Revisar preços" }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});
test("view rename, overwrite and confirmed delete persist, and closing a modified form protects its draft", async ({
  page,
  request,
}) => {
  await page.goto(
    `/anuncios?store=${stores[0]}&q=VISÃO&sort=price&sortDir=asc`,
  );
  await menu(page, "Visões salvas");
  await page
    .getByRole("button", { name: "Salvar nova visão", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Salvar visão", exact: true });
  await dialog.getByLabel("Nome da visão").fill("Pendências");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  const discard = page.getByRole("dialog", {
    name: "Descartar alterações?",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Continuar editando" }).click();
  await expect(dialog.getByLabel("Nome da visão")).toHaveValue("Pendências");
  await dialog
    .getByRole("button", { name: "Salvar visão", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (
    await (await request.get(`/api/listing-views?store=${stores[0]}`)).json()
  ).views[0];
  await menu(page, "Visões salvas");
  await page
    .getByRole("button", { name: "Renomear visão Pendências", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Editar visão salva",
    exact: true,
  });
  await dialog.getByLabel("Nome da visão").fill("Revisão mensal");
  await dialog
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  let row = (
    await db().collection("listing_views").doc(saved.id).get()
  ).data()!;
  expect(row.name).toBe("Revisão mensal");
  expect(row.config).toEqual(saved.config);
  expect(row.version).toBe(2);
  await page
    .getByRole("button", { name: "Ordenar por: Preço atual", exact: true })
    .click();
  await menu(page, "Visões salvas");
  await page.getByLabel("Atualizar visão salva").selectOption(saved.id);
  await dialog
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  row = (await db().collection("listing_views").doc(saved.id).get()).data()!;
  expect(row.config.filters.sortDir).toBe("desc");
  expect(row.version).toBe(3);
  await menu(page, "Visões salvas");
  await page
    .getByRole("button", { name: "Excluir visão Revisão mensal", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Excluir visão salva?",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(confirmation).not.toBeVisible();
  expect(
    (await db().collection("listing_views").doc(saved.id).get()).exists,
  ).toBe(true);
  // The outside click closes the toolbar menu as well.
  await menu(page, "Visões salvas");
  await page
    .getByRole("button", { name: "Excluir visão Revisão mensal", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Excluir visão", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db().collection("listing_views").doc(saved.id).get()).exists,
    )
    .toBe(false);
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
});
test("column preferences are separate by shop and mode, preserve selection and keep products pinned on mobile and desktop", async ({
  page,
}) => {
  await page.goto(`/anuncios?store=${stores[0]}&q=VISÃO`);
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  await page.getByLabel("Selecionar VISÃO Produto 0", { exact: true }).check();
  let reads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/workspace") reads++;
  });
  const top = (await page.locator(".offers-panel").boundingBox())!.y;
  await menu(page, "Colunas visíveis");
  const chooser = page.getByLabel("Escolher colunas");
  await expect(
    chooser.getByRole("checkbox", { name: /Anúncio \/ produto/ }),
  ).toBeDisabled();
  await chooser.getByLabel("Marca / categoria", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("columnheader", { name: /Marca \/ categoria/ }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Selecionar VISÃO Produto 0", { exact: true }),
  ).toBeChecked();
  expect((await page.locator(".offers-panel").boundingBox())!.y).toBe(top);
  expect(reads).toBe(0);
  await page.reload();
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("columnheader", { name: /Marca \/ categoria/ }),
  ).toHaveCount(0);
  await page.getByLabel("Visão da tabela").selectOption("operational");
  await menu(page, "Colunas visíveis");
  await chooser.getByLabel("Qualidade", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await page.getByLabel("Visão da tabela").selectOption("registry");
  await expect(
    page.getByRole("columnheader", { name: /Marca \/ categoria/ }),
  ).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    // Resize closes open menus; wait for the browser to deliver that event
    // before opening the next menu at the new viewport size.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const scroll = page.getByRole("region", {
      name: "Lista de anúncios",
      exact: true,
    });
    await scroll.evaluate((e) => {
      e.scrollLeft = 0;
    });
    const product = page
      .locator(".offers-table tbody tr")
      .first()
      .locator('[data-column="name"]');
    const before = (await product.boundingBox())!;
    await scroll.evaluate((e) => {
      e.scrollLeft = 700;
    });
    await expect
      .poll(async () => Math.abs((await product.boundingBox())!.x - before.x))
      .toBeLessThan(2);
    const bounds = (await product.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThan(width - 30);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await menu(page, "Colunas visíveis");
    await expect
      .poll(async () => {
        const box = await chooser.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width;
      })
      .toBe(true);
    await page.keyboard.press("Escape");
    if (width === 390)
      await page.screenshot({
        path: "test-results/listing-pinned-mobile.png",
        fullPage: true,
      });
  }
  await page.getByLabel("Loja global").selectOption(stores[1]);
  await expect(
    page.getByRole("columnheader", { name: /Marca \/ categoria/ }),
  ).toBeVisible();
  await page.getByLabel("Loja global").selectOption(stores[0]);
  await menu(page, "Colunas visíveis");
  await chooser
    .getByRole("button", { name: "Mostrar todas as colunas" })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("columnheader", { name: /Marca \/ categoria/ }),
  ).toBeVisible();
});
test("saved-view loading and retry stay inside the menu and all-store overview requires selecting a shop", async ({
  page,
}) => {
  let fail = true,
    release = () => {};
  await page.route("**/api/listing-views?*", async (route) => {
    if (fail) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        status: 503,
        json: { error: "Consulta indisponível" },
      });
    } else await route.continue();
  });
  try {
    await page.goto(`/anuncios?store=${stores[0]}&q=VISÃO`);
    await menu(page, "Visões salvas");
    await expect(page.getByLabel("Carregando visões")).toBeVisible();
    release();
    await expect(page.getByLabel("Visões salvas da loja")).toContainText(
      "Consulta indisponível",
    );
    expect(new URL(page.url()).searchParams.get("store")).toBe(stores[0]);
    fail = false;
    await page
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Salvar nova visão", exact: true }),
    ).toBeEnabled();
    await page.goto("/anuncios?store=all");
    await menu(page, "Visões salvas");
    await expect(page.getByLabel("Visões salvas da loja")).toContainText(
      "Selecione uma loja",
    );
    await expect(
      page.getByRole("button", { name: "Salvar nova visão", exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});
