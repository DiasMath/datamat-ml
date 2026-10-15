import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";
const origin = { Origin: "http://localhost:3100" };
let storeId: string;
async function post(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.post(path, { headers: origin, data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}
test.beforeEach(async ({ request }) => {
  storeId = (
    await post(request, "/api/stores", {
      name: "Hoje navegador " + randomUUID(),
    })
  ).id;
});
test.afterEach(async () => {
  if (storeId)
    await db().collection("stores").doc(storeId).update({ active: 0 });
});
async function listings(request: APIRequestContext, count = 12) {
  const rows = [];
  for (let i = 0; i < count; i++)
    rows.push(
      await post(request, "/api/offers", {
        storeId,
        name: `Hoje Produto ${String(i + 1).padStart(2, "0")}`,
        title: `Hoje Anúncio ${String(i + 1).padStart(2, "0")} com um título comprido para conferir a leitura compacta`,
        type: "unit",
        status: "paused",
        price: "100",
      }),
    );
  return rows;
}
test("Hoje is compact, distinguishes preparation from urgency, paginates and loads full workspace only on demand", async ({
  page,
  request,
}) => {
  const offers = await listings(request);
  const report = await (
    await request.get("/api/today?store=" + storeId)
  ).json();
  expect(report.summary).toMatchObject({
    totalOffers: 12,
    urgent: 0,
    prepare: 12,
    decisions: 0,
  });
  const full = await (
    await request.get("/api/workspace?store=" + storeId)
  ).json();
  expect(JSON.stringify(report).length).toBeLessThan(
    JSON.stringify(full).length,
  );
  let workspaceReads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/workspace")) workspaceReads++;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?store=${storeId}&todayFocus=prepare`);
  const queue = page.locator(".today-queue");
  await expect(queue.locator(".today-queue-row")).toHaveCount(5);
  await expect(page.getByRole("tab", { name: "Urgentes 0" })).toBeVisible();
  expect(workspaceReads).toBe(0);
  const cards = await page
    .locator(".today-metric")
    .evaluateAll((elements) =>
      elements.map((e) => e.getBoundingClientRect().height),
    );
  expect(Math.max(...cards)).toBeLessThan(100);
  await page.getByRole("button", { name: "Próximos anúncios da fila" }).click();
  await expect(page).toHaveURL(/todayPage=2/);
  await expect(queue).toContainText("Hoje Anúncio 06");
  expect(workspaceReads).toBe(0);
  await queue
    .getByRole("button", { name: "Completar custos", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/anuncios/${offers[5].id}`));
  await expect(page.getByLabel("Preço proposto (R$)")).toBeVisible();
  expect(workspaceReads).toBe(1);
  await expect(page.locator(".detail-heading")).toHaveCSS("top", "58px");
  await page
    .getByRole("button", { name: "Voltar à Hoje", exact: true })
    .click();
  await expect(page).toHaveURL(/todayPage=2/);
  await expect(queue).toContainText("Hoje Anúncio 06");
  await page.getByRole("tab", { name: /Preparar/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /Revisar/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
test("Hoje preserves postponed reviews across reload and reintroduces them after one hour", async ({
  page,
  request,
}) => {
  await listings(request, 1);
  await page.goto(`/?store=${storeId}`);
  await expect(page.locator(".today-queue-row")).toHaveCount(1);
  await page.clock.install();
  await page.getByRole("button", { name: /Adiar revisão/ }).click();
  await expect(page.locator(".today-queue-row")).toHaveCount(0);
  await expect(
    page.getByText("Revisões adiadas", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".today-queue-row")).toHaveCount(0);
  await page.getByRole("button", { name: "1 adiado(s)", exact: true }).click();
  await expect(page.locator(".today-queue-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Ocultar adiados", exact: true })
    .click();
  await page.clock.fastForward(3600001);
  await expect(page.locator(".today-queue-row")).toHaveCount(1);
});
test("Hoje loads task editing metadata lazily, persists the task, and keeps the summary visible", async ({
  page,
}) => {
  let workspaceReads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/workspace")) workspaceReads++;
  });
  await page.goto(`/?store=${storeId}`);
  await expect(page.locator(".today-dashboard")).toBeVisible();
  expect(workspaceReads).toBe(0);
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova ação", exact: true });
  await dialog
    .getByLabel("Título *", { exact: true })
    .fill("Revisar anúncio prioritário");
  await dialog
    .getByRole("button", { name: "Salvar tarefa", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByText("Ações em aberto", { exact: false }).click();
  await expect(
    page.getByRole("button", { name: /Revisar anúncio prioritário/ }),
  ).toBeVisible();
  expect(workspaceReads).toBe(0);
  expect(
    (await db().collection("tasks").where("store_id", "==", storeId).get())
      .size,
  ).toBe(1);
});
test("Hoje remains readable with five priorities at mobile, tablet and desktop widths and restores scroll on return", async ({
  page,
  request,
}) => {
  await listings(request);
  await page.goto(`/?store=${storeId}&todayFocus=prepare&todayPage=2`);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".today-queue-row")).toHaveCount(5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 560 });
  await page.locator(".today-queue-row").last().scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  expect(scroll).toBeGreaterThan(30);
  const queueScroll = await page
    .locator(".today-queue")
    .evaluate((e) => e.scrollTop);
  expect(queueScroll).toBeGreaterThan(30);
  await page
    .locator(".today-queue-row")
    .last()
    .getByRole("button", { name: "Completar custos", exact: true })
    .click();
  await expect(page.getByLabel("Preço proposto (R$)")).toBeVisible();
  await expect(page.locator(".detail-heading")).toHaveCSS("top", "94px");
  await page
    .getByRole("button", { name: "Voltar à Hoje", exact: true })
    .click();
  await expect(page.locator(".today-queue-row")).toHaveCount(5);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(scroll - 30);
  await expect
    .poll(() => page.locator(".today-queue").evaluate((e) => e.scrollTop))
    .toBeGreaterThan(queueScroll - 3);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/today-compact-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "test-results/today-compact-desktop.png",
    fullPage: true,
  });
});

test("Hoje distinguishes an urgent margin problem from an approved proposal when opening the decisions view", async ({
  page,
  request,
}) => {
  const initial = await (
    await request.get("/api/today?store=" + storeId)
  ).json();
  const fixture = {
    ...initial,
    summary: { totalOffers: 1, urgent: 1, review: 0, prepare: 0, decisions: 1 },
    queuePage: {
      focus: "urgent",
      decisions: false,
      page: 1,
      pages: 1,
      total: 1,
      postponed: 0,
      showDeferred: false,
    },
    portfolio: {
      active: 1,
      paused: 0,
      draft: 0,
      financiallyReady: 1,
      needsCosts: 0,
      overdueTasks: 0,
    },
    queue: [
      {
        id: "fixture-offer",
        title: "Anúncio com contribuição negativa",
        storeId,
        storeName: "Loja",
        thumbnail: null,
        severity: "urgent",
        reason: "Contribuição estimada negativa",
        evidence: "Estimativa de -R$ 10,00 por unidade.",
        action: "Revisar preço",
        tab: "costs",
        reasons: [
          "Contribuição estimada negativa",
          "Proposta pronta para aplicação",
        ],
        proposalId: "p",
        decisionAction: "Abrir proposta",
        decisionReason: "Proposta pronta para aplicação",
        decisionEvidence:
          "A proposta foi aprovada; a aplicação ainda precisa ser confirmada.",
        impact: "0",
        price: "100",
        margin: "-10",
        marginPercent: "-10",
        minPrice: "125",
        stock: 0,
        status: "active",
        mlId: "MLB123",
        pending: [],
      },
    ],
  };
  await page.route("**/api/today?*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/today/queue", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        queue: fixture.queue,
        queuePage: {
          ...fixture.queuePage,
          focus: body.focus,
          decisions: body.decisions,
        },
      },
    });
  });
  await page.goto(`/?store=${storeId}`);
  const row = page.locator(".today-queue-row");
  await expect(row.locator(".today-listing-facts")).toContainText("R$ 100,00");
  await expect(row.locator(".today-listing-facts")).toContainText(
    "Margem -R$ 10,00",
  );
  await expect(row.locator(".today-listing-facts")).toContainText("0 un.");
  await expect(row.locator(".today-listing-facts")).toContainText(
    "Piso R$ 125,00",
  );
  await expect(row.locator(".today-evidence")).toContainText("Estimativa");
  await page.locator(".today-metric.decisions").click();
  await expect(page).toHaveURL(/todayDecisions=yes/);
  await expect(row.locator(".today-reason")).toContainText(
    "Proposta pronta para aplicação",
  );
  await expect(row.locator(".today-evidence")).toContainText("foi aprovada");
  await expect(row.locator(".today-evidence")).not.toContainText("Estimativa");
  await expect(
    row.getByRole("button", { name: "Abrir proposta", exact: true }),
  ).toBeVisible();
});

test("partial sales identifies the unavailable store in an accessible popover without shifting the dashboard", async ({
  page,
  request,
}) => {
  const initial = await (
    await request.get("/api/today?store=" + storeId)
  ).json();
  const observedAt = new Date().toISOString();
  const fixture = {
    ...initial,
    sales: {
      ...initial.sales,
      available: true,
      complete: false,
      revenue: "100.00",
      orders: 2,
      observedAt,
      stores: [
        {
          id: storeId,
          name: "Loja conectada",
          connected: true,
          complete: true,
          observedAt,
          error: null,
          warnings: [],
        },
        {
          id: "fixture-offline",
          name: "Loja sem conexão",
          connected: false,
          complete: false,
          observedAt: null,
          error: null,
          warnings: [],
        },
      ],
    },
  };
  await page.route("**/api/today?*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?store=${storeId}`);
  await expect(page.locator(".today-freshness")).toContainText(
    "Vendas de 1/2 lojas",
  );
  await expect(page.locator(".today-metric.revenue")).toContainText(
    "R$ 100,00",
  );
  const help = page.getByRole("button", {
    name: "Ver cobertura das consultas de vendas",
  });
  const before = await page.locator(".today-metrics").boundingBox();
  await help.click();
  const popover = page.locator(".today-coverage-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Loja sem conexão");
  await expect(popover).toContainText("Conta ML não conectada.");
  const after = await page.locator(".today-metrics").boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 0);
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
  await page.screenshot({
    path: "test-results/today-full-accent-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(popover).toBeVisible();
  const bounds = (await popover.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: "test-results/today-coverage-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
});

test("Nova ação opens before options arrive, preserves typing and animates its loader with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/task-options?*", async (route) => {
    await pending;
    await route.fulfill({
      json: { offerChoices: [], tasks: [], truncated: false },
    });
  });
  await page.goto(`/?store=${storeId}`);
  await expect(page.locator(".today-dashboard")).toBeVisible();
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova ação", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Título *", { exact: true })
    .fill("Digitar durante consulta");
  const spinner = dialog.getByLabel("Carregando anúncios relacionados");
  await expect(spinner).toBeVisible();
  const rotating = await spinner.evaluate(async (element) => {
    const before = getComputedStyle(element).transform;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return getComputedStyle(element).transform !== before;
  });
  expect(rotating).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Salvar tarefa", exact: true }),
  ).toBeEnabled();
  release();
  await expect(spinner).not.toBeVisible();
  await expect(dialog.getByLabel("Título *", { exact: true })).toHaveValue(
    "Digitar durante consulta",
  );
  await dialog
    .getByRole("button", { name: "Salvar tarefa", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});

test.describe("Brasília clock", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("header follows Brasília across midnight, removes redundant blocks and orders its controls", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-15T02:59:00Z") });
    await page.goto(`/?store=${storeId}`);
    await expect(page.locator(".today-dashboard")).toBeVisible();
    const clock = page.getByLabel("Data e hora de Brasília");
    await expect(clock).toContainText("14 de outubro");
    await expect(clock).toContainText("23:59");
    await expect(clock).not.toContainText("Brasília");
    await expect(page.locator(".topbar h1")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Hoje", exact: true }),
    ).toHaveClass("sr-only");
    await expect(page.locator("main .page-heading")).toHaveCount(0);
    await expect(page.locator(".topbar .today-freshness")).toHaveCount(1);
    await expect(page.locator(".today-chart-panel")).toHaveAttribute(
      "open",
      "",
    );
    await page.clock.fastForward(60000);
    await expect(clock).toContainText("15 de outubro");
    await expect(clock).toContainText("00:00");
    await expect(
      page.locator(".breadcrumb,.sidebar-bottom,.user-card"),
    ).toHaveCount(0);
    const controls = await page.locator(".topbar-actions").evaluate((element) =>
      Array.from(element.children)
        .slice(0, 3)
        .map((child) => child.className),
    );
    expect(controls).toEqual([
      "nav-search",
      "global-store",
      "button primary header-new-action",
    ]);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("button", { name: "Nova ação", exact: true }),
      ).toBeVisible();
    }
  });
});

test("Editing an action during options loading preserves its listing and existing details", async ({
  page,
  request,
}) => {
  const [offer] = await listings(request, 1);
  const task = await post(request, "/api/tasks", {
    storeId,
    offerId: offer.id,
    title: "Revisar foto vinculada",
    type: "conteúdo",
    reason: "Foto pouco clara",
    result: "Conferir resolução",
    evidence: "Comparação das fotos",
    priority: "high",
    status: "todo",
    description: "Manter detalhes",
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/task-options?*", async (route) => {
    await pending;
    await route
      .fulfill({ json: { offerChoices: [], tasks: [], truncated: false } })
      .catch(() => {});
  });
  try {
    await page.goto(`/?store=${storeId}`);
    await page.getByText("Ações em aberto", { exact: false }).click();
    await page.getByRole("button", { name: /Revisar foto vinculada/ }).click();
    const dialog = page.getByRole("dialog", {
      name: "Editar ação",
      exact: true,
    });
    await expect(
      dialog.getByLabel("Carregando anúncios relacionados"),
    ).toBeVisible();
    await dialog
      .getByLabel("Título *", { exact: true })
      .fill("Revisar foto vinculada hoje");
    await dialog
      .getByRole("button", { name: "Salvar tarefa", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const saved = (await db().collection("tasks").doc(task.id).get()).data()!;
    expect(saved).toMatchObject({
      offer_id: offer.id,
      title: "Revisar foto vinculada hoje",
      type: "conteúdo",
      reason: "Foto pouco clara",
      result: "Conferir resolução",
      evidence: "Comparação das fotos",
      description: "Manter detalhes",
    });
  } finally {
    release();
  }
});
