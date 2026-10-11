import { test } from "node:test";
import assert from "node:assert/strict";
import readXlsxFile from "read-excel-file/node";
import {
  offersWorkbook,
  importTemplateWorkbook,
  offerColumns,
} from "../src/server/spreadsheets";
import {
  assertWorkbookSize,
  spreadsheetTable,
} from "../src/domain/spreadsheet";
import { parseCsv } from "../src/domain/csv";

test("Excel exports round-trip identifiers, zero, null, decimal money and formula-like text", async () => {
  const workbook = await offersWorkbook([
    {
      id: "internal-id",
      version: 2,
      store_id: "juntos-com",
      store_name: "juntos.com",
      product_name: "Produto",
      title: '=HYPERLINK("https://example.test")',
      sku: "000123",
      ml_id: "MLB1",
      type: "unit",
      status: "draft",
      price: "1234.50",
      description: "+texto",
      origin: "manual",
      calculation: { margin: "0", marginPercent: null },
    },
    {
      id: "empty-price",
      version: 1,
      product_name: "Outro",
      title: "Sem preço",
      price: null,
      calculation: { margin: null, marginPercent: null },
    },
  ]);
  assertWorkbookSize(
    workbook.buffer.slice(
      workbook.byteOffset,
      workbook.byteOffset + workbook.byteLength,
    ) as ArrayBuffer,
  );
  const sheets = await readXlsxFile(workbook);
  assert.equal(sheets[0].sheet, "Anúncios");
  const table = spreadsheetTable(sheets[0].data);
  const cell = (row: number, key: string) =>
    table.rows[row][table.headers.indexOf(key)];
  assert.equal(cell(0, "sku"), "000123");
  assert.equal(cell(0, "title"), '=HYPERLINK("https://example.test")');
  assert.equal(cell(0, "price"), "1234.5");
  assert.equal(cell(0, "contribution"), "0");
  assert.equal(cell(0, "contributionPercent"), "");
  assert.equal(cell(1, "price"), "");
  assert.deepEqual(table.headers, offerColumns);
});
test("Excel import model contains only headers and no invented operational records", async () => {
  const sheets = await readXlsxFile(await importTemplateWorkbook());
  assert.equal(sheets[0].data.length, 1);
  assert.ok(sheets[0].data[0].includes("price"));
  assert.ok(sheets[0].data[0].includes("mlId"));
});
test("spreadsheet parsing preserves blanks and zero and rejects duplicate or excessive columns", () => {
  assert.deepEqual(
    spreadsheetTable([
      ["name", "title", "price"],
      ["Produto", "Título", 0],
      ["Outro", "Título", null],
      [],
    ]).rows,
    [
      ["Produto", "Título", "0"],
      ["Outro", "Título", ""],
    ],
  );
  assert.throws(
    () =>
      spreadsheetTable([
        ["Produto", "produto"],
        ["a", "b"],
      ]),
    /duplicados/,
  );
  assert.throws(
    () => spreadsheetTable([["name"], ["a", "extra"]]),
    /inconsistente/,
  );
  assert.equal(
    parseCsv(
      "name;title\n" +
        Array.from({ length: 1000 }, (_, i) => `Produto ${i};Título ${i}`).join(
          "\n",
        ),
    ).rows.length,
    1000,
  );
  assert.throws(
    () =>
      parseCsv(
        "name;title\n" +
          Array.from(
            { length: 1001 },
            (_, i) => `Produto ${i};Título ${i}`,
          ).join("\n"),
      ),
    /1000/,
  );
});
test("invalid, encrypted and excessive expanded workbooks are rejected before decompression", async () => {
  assert.throws(
    () => assertWorkbookSize(new Uint8Array([1, 2, 3]).buffer),
    /inválido/,
  );
  const data = new Uint8Array(await importTemplateWorkbook());
  const view = new DataView(data.buffer),
    end = data.length - 22,
    central = view.getUint32(end + 16, true);
  view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
  assert.throws(() => assertWorkbookSize(data.buffer), /sem senha/);
  view.setUint16(central + 8, 0, true);
  view.setUint32(central + 24, 50_000_000, true);
  assert.throws(() => assertWorkbookSize(data.buffer), /expandida/);
});
