import writeXlsxFile, {
  type SheetData,
  type Sheet,
} from "write-excel-file/node";
import type { Row } from "./db";

export const offerColumns = [
  "id",
  "version",
  "storeId",
  "store",
  "name",
  "title",
  "model",
  "brand",
  "category",
  "sku",
  "mlId",
  "type",
  "status",
  "price",
  "description",
  "origin",
  "referenceAccount",
  "updatedAt",
  "contribution",
  "contributionPercent",
];
export const offerValues = (o: Row) => [
  o.id,
  o.version,
  o.store_id,
  o.store_name,
  o.product_name,
  o.title,
  o.model,
  o.brand,
  o.category,
  o.sku,
  o.ml_id,
  o.type,
  o.status,
  o.price == null ? null : Number(o.price),
  o.description,
  o.origin,
  o.reference_account,
  o.updated_at,
  o.calculation.margin == null ? null : Number(o.calculation.margin),
  o.calculation.marginPercent == null
    ? null
    : Number(o.calculation.marginPercent),
];

function sheet(
  name: string,
  columns: string[],
  values: unknown[][],
): Sheet<never> {
  const data: SheetData = [
    columns.map((value) => ({
      value,
      fontWeight: "bold",
      color: "#FFFFFF",
      backgroundColor: "#29292D",
    })),
    ...values.map((r) =>
      r.map((v, i) => {
        if (v == null) return null;
        if (typeof v === "number" && Number.isFinite(v))
          return {
            value: v,
            type: Number,
            format: ["price", "contribution", "contributionPercent"].includes(
              columns[i],
            )
              ? "0.00"
              : "0",
          };
        // Explicit String cells: text beginning with '=' remains text, never a formula.
        return { value: String(v), type: String, wrap: true };
      }),
    ),
  ];
  return {
    sheet: name,
    data,
    stickyRowsCount: 1,
    columns: columns.map((c) => ({
      width: ["description", "title", "body", "reason"].includes(c) ? 45 : 22,
    })),
  };
}
export async function offersWorkbook(offers: Row[]) {
  return writeXlsxFile([
    sheet("Anúncios", offerColumns, offers.map(offerValues)),
  ]).toBuffer();
}
export async function importTemplateWorkbook() {
  return writeXlsxFile([
    sheet(
      "Anúncios",
      [
        "name",
        "title",
        "sku",
        "mlId",
        "brand",
        "category",
        "model",
        "price",
        "type",
        "status",
        "description",
        "origin",
        "referenceAccount",
      ],
      [],
    ),
  ]).toBuffer();
}
