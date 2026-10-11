import { test, expect } from "@playwright/test";
import { db, key } from "../../src/server/db";
const headers = { Origin: "http://localhost:3100" };
const make = (title: string, price: string | null = "100") => ({
  storeId: "juntos-com",
  name: title,
  title,
  type: "unit",
  status: "draft",
  price,
  sku: "SKU-" + title,
});

test("headers sort the complete data before pagination, preserve selection and resize/reset persistently", async ({
  page,
  request,
}) => {
  const prefix = "COLUNAS-" + Date.now();
  const rows = [];
  for (let i = 0; i < 31; i++) {
    const response = await request.post("/api/offers", {
      headers,
      data: make(
        `${prefix} Produto ${i}`,
        i === 0
          ? "10"
          : i === 1
            ? "2"
            : i === 2
              ? "100"
              : i === 3
                ? null
                : String(100 + i),
      ),
    });
    expect(response.ok()).toBe(true);
    rows.push(await response.json());
  }
  await page.goto("/anuncios?store=juntos-com&q=" + prefix);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page
    .getByLabel(`Selecionar ${prefix} Produto 30`, { exact: true })
    .check();
  let reads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/workspace") reads++;
  });
  const price = page.getByRole("button", {
    name: "Ordenar por: Preço atual",
    exact: true,
  });
  await price.click();
  await expect(page.locator(".offers-table tbody tr").first()).toContainText(
    `${prefix} Produto 1`,
  );
  await expect(price.locator("..")).toHaveAttribute("aria-sort", "ascending");
  await page.getByLabel("Próxima página", { exact: true }).click();
  await expect(page.locator(".offers-table tbody tr").last()).toContainText(
    `${prefix} Produto 3`,
  );
  await expect(
    page.getByLabel(`Selecionar ${prefix} Produto 30`, { exact: true }),
  ).toBeChecked();
  await price.click();
  await expect(page.locator(".offers-table tbody tr").first()).toContainText(
    `${prefix} Produto 30`,
  );
  await expect(price.locator("..")).toHaveAttribute("aria-sort", "descending");
  expect(reads).toBe(0);
  const handle = page.getByRole("separator", {
    name: "Largura da coluna: Preço atual",
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const original = Number(await handle.getAttribute("aria-valuenow"));
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 75, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", String(original + 75));
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await expect(handle).toHaveAttribute("aria-valuenow", String(original + 75));
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", String(original));
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", String(original + 10));
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", String(original));
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("bulk local edits and deletes persist with price intact and no hidden selection", async ({
  page,
  request,
}) => {
  const prefix = "EDICAO-" + Date.now();
  const rows = [];
  for (const suffix of ["A", "B"]) {
    const r = await request.post("/api/offers", {
      headers,
      data: make(prefix + " " + suffix),
    });
    expect(r.ok()).toBe(true);
    rows.push(await r.json());
  }
  await page.goto("/anuncios?store=juntos-com&q=" + prefix);
  await page.getByLabel("Selecionar anúncios desta página").check();
  await page
    .getByRole("button", { name: "Ações em lote", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Título e descrição", { exact: true }).click();
  await modal.getByLabel("Adicionar antes do título").fill("Novo");
  await modal.getByLabel("Adicionar depois do título").fill("2026");
  await modal.getByLabel("Substituir descrição nos selecionados").check();
  await modal
    .getByLabel("Nova descrição", { exact: true })
    .fill("Descrição comum revisada");
  await modal
    .getByRole("button", { name: "Confirmar alteração em lote" })
    .click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  for (const row of rows) {
    const saved = (await db().collection("offers").doc(row.id).get()).data()!;
    expect(saved.title).toBe(`Novo ${row.title} 2026`);
    expect(saved.description).toBe("Descrição comum revisada");
    expect(saved.price).toBe("100");
    expect(saved.status).toBe("draft");
    expect(saved.version).toBe(row.version + 1);
  }
  await page.getByLabel("Selecionar anúncios desta página").check();
  await page
    .getByRole("button", { name: "Ações em lote", exact: true })
    .click();
  await modal.getByLabel("Operação em lote").selectOption("delete");
  page.once("dialog", (d) => d.accept());
  await modal
    .getByRole("button", { name: "Confirmar exclusão em lote" })
    .click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(0);
  for (const row of rows)
    expect((await db().collection("offers").doc(row.id).get()).exists).toBe(
      false,
    );
});

test("ML bulk interface shows partial results, resumes the same operation and supports activation after pause", async ({
  page,
  request,
}) => {
  const connection = key("juntos-com", "mercadolivre"),
    ref = db().collection("connections").doc(connection),
    original = (await ref.get()).data()!;
  const prefix = "ML-LOTE-" + Date.now(),
    offers: Record<string, any>[] = [];
  for (let i = 0; i < 3; i++) {
    const response = await request.post("/api/offers", {
      headers,
      data: {
        ...make(prefix + " " + i),
        mlId: "MLB" + (991000 + i),
        status: "active",
      },
    });
    expect(response.ok()).toBe(true);
    const offer = await response.json();
    offers.push(offer);
    await db()
      .collection("offers")
      .doc(offer.id)
      .update({ ml: { sellerId: "111", authVersion: 910 } });
  }
  await ref.set({
    ...original,
    status: "connected",
    external_account: "111",
    auth_version: 910,
  });
  const calls: any[] = [];
  await page.route("**/api/offers/batch-ml-status", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    expect(body.confirmed).toBe(true);
    expect(body.ids).toEqual(offers.map((o) => o.id).reverse());
    const results = [];
    for (let i = 0; i < body.ids.length; i++) {
      const id = body.ids[i],
        doc = db().collection("offers").doc(id),
        row = (await doc.get()).data()!;
      const outcome =
        calls.length === 1
          ? i === 0
            ? "verified"
            : i === 1
              ? "uncertain"
              : "failed"
          : "verified";
      let version = row.version;
      if (outcome === "verified" && row.status !== body.status) {
        version++;
        await doc.update({ status: body.status, version });
      }
      results.push({
        id,
        result: outcome,
        version,
        message:
          outcome === "verified"
            ? "Situação confirmada no ML"
            : outcome === "uncertain"
              ? "Resposta incerta; conferir sem reenviar"
              : "Não permitido no ML",
      });
    }
    await route.fulfill({ json: { results } });
  });
  try {
    await page.goto("/anuncios?store=juntos-com&q=" + prefix);
    await page.getByLabel("Selecionar anúncios desta página").check();
    await page
      .getByRole("button", { name: "Ações em lote", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Operação em lote").selectOption("ml-paused");
    page.once("dialog", (d) => d.accept());
    await modal.getByRole("button", { name: "Confirmar pausa no ML" }).click();
    await expect(modal.getByText("Conferir", { exact: true })).toBeVisible();
    await expect(modal.getByText("Falhou", { exact: true })).toBeVisible();
    await expect(modal.getByLabel("Operação em lote")).toBeDisabled();
    await modal
      .getByRole("button", { name: "Conferir / retomar lote" })
      .click();
    await expect(modal.locator(".bulk-results .green")).toHaveCount(3);
    expect(calls[1]).toEqual(calls[0]);
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    await modal.getByLabel("Operação em lote").selectOption("ml-active");
    page.once("dialog", (d) => d.accept());
    await modal
      .getByRole("button", { name: "Confirmar ativação no ML" })
      .click();
    await expect.poll(() => calls.length).toBe(3);
    await expect(modal.locator(".bulk-results .green")).toHaveCount(3);
    expect(calls[2].status).toBe("active");
    expect(calls[2].requestId).not.toBe(calls[1].requestId);
    expect(Object.values(calls[2].versions)).toEqual([2, 2, 2]);
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/bulk-ml-mobile.png",
      fullPage: true,
    });
    await modal.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.reload();
    for (const o of offers)
      expect(
        (await db().collection("offers").doc(o.id).get()).data()!.status,
      ).toBe("active");
  } finally {
    await ref.set(original);
  }
});
