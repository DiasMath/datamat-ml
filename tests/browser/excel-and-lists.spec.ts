import { test, expect, type Page } from "@playwright/test";
import writeXlsxFile from "write-excel-file/node";
import readXlsxFile from "read-excel-file/node";
import { readFile } from "node:fs/promises";
import { db } from "../../src/server/db";
const origin = "http://localhost:3100";
async function post(page: Page, path: string, data: unknown) {
  const r = await page.request.post(path, {
    headers: { Origin: origin },
    data,
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
const row = (i: number, prefix: string) => ({
  name: `Produto ${prefix} ${i}`,
  title: `${prefix} ${i}`,
  sku: `000${i}`,
  mlId: `MLB-${prefix}-${i}`,
  type: "unit",
  status: "draft",
  price: "123.45",
  brand: "Marca planilha",
  category: "Categoria planilha",
});
async function upload(page: Page, buffer: Buffer, name = "arquivo.xlsx") {
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  return dialog;
}

test("Excel supports multiple sheets, preserves leading-zero SKUs and exports every filtered row", async ({
  page,
}) => {
  const workbook = await writeXlsxFile([
    { sheet: "Instruções", data: [["Texto"], ["Escolha a aba Anúncios"]] },
    {
      sheet: "Anúncios",
      data: [
        [
          "Produto",
          "Título",
          "SKU",
          "Código ML",
          "Preço",
          "Marca",
          "Categoria",
        ],
        [
          "Produto XLSX UI",
          "Oferta XLSX UI",
          "000987",
          "MLB-XLSX-UI",
          123.45,
          "Marca XLSX UI",
          "Categoria XLSX UI",
        ],
      ],
    },
  ]).toBuffer();
  await page.goto("/anuncios?store=juntos-com");
  const dialog = await upload(page, workbook);
  await dialog.getByLabel("Aba da planilha").selectOption("1");
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
  const data = await (
    await page.request.get("/api/workspace?store=juntos-com&q=Oferta+XLSX+UI")
  ).json();
  expect(data.offers[0].sku).toBe("000987");
  expect(data.offers[0].price).toBe("123.45");
  expect(
    (await db().collection("offers").doc(data.offers[0].id).get()).exists,
  ).toBe(true);
  await page.goto("/anuncios?store=juntos-com&q=Oferta+XLSX+UI");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar Excel", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("datamat-anuncios.xlsx");
  const sheets = await readXlsxFile(await readFile((await download.path())!));
  expect(sheets[0].data).toHaveLength(2);
  const headers = sheets[0].data[0];
  expect(sheets[0].data[1][headers.indexOf("sku")]).toBe("000987");
  expect(sheets[0].data[1][headers.indexOf("price")]).toBe(123.45);
  const template = await page.request.get("/api/export/template");
  expect(template.headers()["content-type"]).toContain("spreadsheetml");
  expect((await readXlsxFile(await template.body()))[0].data).toHaveLength(1);
});

test("an exported Excel can update a record without losing costs or creating a duplicate", async ({
  page,
}) => {
  const created = await post(page, "/api/offers", {
    ...row(1, "ROUNDTRIP-XLSX"),
    storeId: "juntos-com",
  });
  await page.goto("/anuncios?store=juntos-com&q=ROUNDTRIP-XLSX");
  const result = await page.request.get(
    "/api/export?store=juntos-com&q=ROUNDTRIP-XLSX&format=xlsx",
  );
  const sheets = await readXlsxFile(await result.body());
  const data = sheets[0].data;
  data[1][data[0].indexOf("title")] = "ROUNDTRIP-XLSX corrigido";
  data[1][data[0].indexOf("status")] = "paused";
  const workbook = await writeXlsxFile(
    data.map((r) =>
      r.map((v) =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? v
          : null,
      ),
    ),
    { sheet: "Anúncios" },
  ).toBuffer();
  const dialog = await upload(page, workbook);
  await dialog.getByLabel("Operação", { exact: true }).selectOption("update");
  await dialog
    .getByRole("button", { name: "Validar e visualizar prévia" })
    .click();
  await dialog
    .getByRole("button", { name: "Confirmar importação de 1 anúncios" })
    .click();
  await expect(dialog).not.toBeVisible();
  const changed = (
    await db().collection("offers").doc(created.id).get()
  ).data()!;
  expect(changed.title).toBe("ROUNDTRIP-XLSX corrigido");
  expect(changed.status).toBe("paused");
  expect(changed.price).toBe("123.45");
  expect(changed.origin).toBe("manual");
  expect(changed.product_id).toBe(created.product_id);
  expect(
    (
      await db()
        .collection("offers")
        .where("ml_id", "==", row(1, "ROUNDTRIP-XLSX").mlId)
        .get()
    ).size,
  ).toBe(1);
});

test("large imports page their preview and resume a lost response without duplicate writes", async ({
  page,
}) => {
  test.setTimeout(90000);
  const values = Array.from({ length: 45 }, (_, i) => row(i, "RESUME-XLSX"));
  const columns = Object.keys(values[0]);
  const workbook = await writeXlsxFile([
    columns,
    ...values.map((r) => columns.map((k) => (r as any)[k])),
  ]).toBuffer();
  let calls = 0;
  const ids: string[] = [];
  await page.route("**/api/imports/confirm", async (route) => {
    calls++;
    ids.push(route.request().postDataJSON().requestId);
    if (calls === 2) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Resposta perdida após gravação" }),
      });
    } else await route.continue();
  });
  await page.goto("/anuncios?store=juntos-com");
  const dialog = await upload(page, workbook);
  await dialog
    .getByRole("button", { name: "Validar e visualizar prévia" })
    .click();
  await expect(dialog.locator("tbody tr")).toHaveCount(20);
  await dialog
    .getByRole("button", { name: "Próxima página: Prévia da importação" })
    .click();
  await expect(page).toHaveURL(/importPage=2/);
  await expect(dialog.locator("tbody tr").first()).toContainText(
    "RESUME-XLSX 20",
  );
  await dialog
    .getByRole("button", { name: "Confirmar importação de 45 anúncios" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retomar importação" }),
  ).toBeVisible();
  await expect(dialog).toContainText("40 de 45 registros concluídos");
  await dialog.getByRole("button", { name: "Retomar importação" }).click();
  await expect(dialog).not.toBeVisible();
  expect(ids[2]).toBe(ids[1]);
  const actual = (
    await page.request.get("/api/workspace?store=juntos-com&q=RESUME-XLSX")
  ).json();
  expect((await actual).offers).toHaveLength(45);
  const history = await db()
    .collection("history")
    .where("field", "==", "offer.create")
    .get();
  expect(
    history.docs.filter((d) => JSON.stringify(d.data()).includes("RESUME-XLSX"))
      .length,
  ).toBe(45);
});

test("tables keep headers visible and pagination does not reload the Firestore workspace", async ({
  page,
}) => {
  const rows = Array.from({ length: 61 }, (_, i) => row(i, "SCROLL-LIST"));
  for (let i = 0; i < rows.length; i += 40)
    await post(page, "/api/imports/confirm", {
      storeId: "juntos-com",
      rows: rows.slice(i, i + 40),
      requestId: crypto.randomUUID(),
    });
  let loads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/workspace")) loads++;
  });
  await page.goto("/anuncios?store=juntos-com&q=SCROLL-LIST");
  await expect(page.getByLabel("Anúncios por página")).toHaveValue("50");
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(50);
  const before = loads;
  const viewport = page.locator(".offers-panel > .table-wrap");
  const header = page.locator(".offers-table th").nth(1);
  const top = (await header.boundingBox())!.y;
  const scroll = await viewport.evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
  }));
  expect(scroll.content).toBeGreaterThan(scroll.height);
  await viewport.evaluate((el) => el.scrollTo({ top: 350 }));
  expect(Math.abs((await header.boundingBox())!.y - top)).toBeLessThan(2);
  await page
    .getByRole("button", { name: "Próxima página", exact: true })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(11);
  await page.getByLabel("Anúncios por página").selectOption("20");
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(20);
  expect(loads).toBe(before);
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [844, 390],
    [768, 700],
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const table = document.querySelector(".offers-panel > .table-wrap")!;
      const pagination = document
        .querySelector(".offers-panel > .pagination")!
        .getBoundingClientRect();
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        tableHeight: table.clientHeight,
        tableContent: table.scrollHeight,
        paginationBottom: pagination.bottom,
      };
    });
    expect(
      geometry.width,
      `${width}x${height}: largura da página`,
    ).toBeLessThanOrEqual(width);
    expect(
      geometry.height,
      `${width}x${height}: altura da página`,
    ).toBeLessThanOrEqual(height);
    expect(
      geometry.tableHeight,
      `${width}x${height}: tabela visível`,
    ).toBeGreaterThan(70);
    expect(geometry.tableContent).toBeGreaterThan(geometry.tableHeight);
    expect(geometry.paginationBottom).toBeLessThanOrEqual(height);
    for (const [menuSelector, popupSelector] of [
      [".multi-filter", ":scope > div"],
      [".offers-counts", ".offers-counts-popover"],
    ]) {
      const menu = page.locator(menuSelector).first();
      await menu.locator("summary").click();
      const popup = menu.locator(popupSelector);
      await expect(popup).toHaveCSS("position", "fixed");
      const box = (await popup.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight),
      ).toBeLessThanOrEqual(height);
      await page.keyboard.press("Escape");
      await expect(menu).not.toHaveAttribute("open", "");
    }
    await viewport.evaluate((el) =>
      el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth }),
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByLabel("Anúncios por página")).toBeInViewport();
    if ([1440, 320].includes(width))
      await page.screenshot({
        path: `test-results/listings-viewport-${width}.png`,
        fullPage: true,
      });
  }
  const exported = await page.request.get(
    "/api/export?store=juntos-com&q=SCROLL-LIST&page=2&pageSize=20&format=xlsx",
  );
  expect((await readXlsxFile(await exported.body()))[0].data).toHaveLength(62);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("tasks, notes and history have bounded scroll areas and independent pagination", async ({
  page,
}) => {
  const batch = db().batch();
  for (let i = 0; i < 65; i++) {
    const base = {
      organization_id: "datamat",
      store_id: "juntos-com",
      offer_id: null,
      created_at: new Date(Date.UTC(2026, 9, 10, 3, i)).toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
    batch.set(db().collection("tasks").doc(`paged-task-${i}`), {
      ...base,
      title: `PAGED TASK ${i}`,
      description: "Descrição para testar rolagem",
      assignee: "Operador",
      type: "melhoria",
      priority: "medium",
      status: "todo",
      due_date: null,
      reason: "",
      result: "",
      evidence: "",
    });
    batch.set(db().collection("notes").doc(`paged-note-${i}`), {
      ...base,
      title: `PAGED NOTE ${i}`,
      body: "Texto para verificar notas paginadas",
      kind: "study",
      author_id: "workspace-operator",
      sources: "",
      practical_use: "",
    });
    batch.set(db().collection("history").doc(`paged-history-${i}`), {
      ...base,
      actor_id: "workspace-operator",
      actor_name: "Operador",
      field: "ui.pagination",
      status: "confirmed",
      reason: "Histórico paginado",
      origin: "manual",
      old_value: null,
      new_value: '"valor"',
      snapshot_json: "{}",
    });
  }
  await batch.commit();
  for (const scenario of [
    {
      path: "/acoes?store=juntos-com&taskQ=PAGED",
      item: ".task-item",
      label: "Ações",
    },
    { path: "/estudos?store=juntos-com", item: ".note-card", label: "Notas" },
    {
      path: "/historico?store=juntos-com&historyField=ui.pagination",
      item: ".history-item",
      label: "Histórico",
    },
  ]) {
    await page.goto(scenario.path);
    await expect(page.locator(scenario.item)).toHaveCount(20);
    const viewport = page.getByRole("region", {
      name: scenario.label,
      exact: true,
    });
    const size = await viewport.evaluate((el) => ({
      height: el.clientHeight,
      content: el.scrollHeight,
    }));
    expect(size.content).toBeGreaterThan(size.height);
    await viewport.evaluate((el) => el.scrollTo({ top: 250 }));
    await page
      .getByRole("button", { name: "Próxima página: " + scenario.label })
      .click();
    await expect(page).toHaveURL(/Page=2/);
    await expect(page.locator(".collection-pagination")).toContainText("2 /");
    await expect(page.locator(scenario.item)).toHaveCount(20);
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await page.setViewportSize({ width: 360, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});
