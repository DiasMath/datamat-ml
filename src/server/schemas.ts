import { z } from "zod";
import { priceAmount, percent, amount } from "../domain/finance";
export const text = z.string().trim().min(1).max(200);
export const optionalText = z.string().trim().max(200).nullable().optional();
export const productSchema = z.object({
  name: text,
  model: optionalText,
  brand: optionalText,
  category: optionalText,
  purchaseCost: amount,
  version: z.number().int().positive(),
});
export const offerSchema = z
  .object({
    storeId: text,
    productId: optionalText,
    updateProduct: z.boolean().default(false),
    productVersion: z.number().int().positive().optional(),
    purchaseCost: amount.optional(),
    name: text,
    model: optionalText,
    brand: optionalText,
    category: optionalText,
    title: text,
    sku: optionalText,
    mlId: optionalText,
    type: z.enum(["unit", "kit", "variation"]),
    status: z.enum(["draft", "active", "paused", "closed"]),
    price: priceAmount,
    description: z.string().max(15000).default(""),
    origin: z.enum(["manual", "import", "reference"]).default("manual"),
    referenceAccount: optionalText,
    components: z
      .array(
        z.object({
          productId: text,
          quantity: z.number().int().min(1).max(10000),
          variation: z.string().max(200).nullable().optional(),
        }),
      )
      .max(100)
      .default([]),
    version: z.number().int().optional(),
  })
  .refine(
    (v) => v.origin !== "reference" || !!v.referenceAccount,
    "Informe a conta de origem da referência",
  )
  .refine(
    (v) => v.type !== "unit" || v.components.length === 0,
    "Um anúncio unitário não pode ter composição",
  );
export const taskSchema = z.object({
  version: z.number().int().positive().optional(),
  storeId: text,
  offerId: optionalText,
  title: text,
  description: z.string().max(10000).default(""),
  type: text.default("melhoria"),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["todo", "doing", "done", "cancelled"]),
  assignee: z.string().max(200).default(""),
  dueDate: z.iso.date().nullable().optional(),
  reason: z.string().max(3000).default(""),
  result: z.string().max(10000).default(""),
  evidence: z.string().max(3000).default(""),
});
export const noteSchema = z
  .object({
    storeId: optionalText,
    version: z.number().int().positive().optional(),
    offerId: optionalText,
    kind: z.enum(["question", "study", "learning", "idea", "insight"]),
    title: text,
    body: z.string().trim().min(1).max(15000),
    sources: z.string().max(3000).default(""),
    practicalUse: z.string().max(5000).default(""),
  })
  .refine(
    (v) => !v.offerId || !!v.storeId,
    "Uma nota de anúncio precisa identificar sua loja",
  );
export const storeSchema = z.object({ name: text });
export const batchSchema = z
  .object({
    ids: z.array(text).min(1).max(100),
    status: z.enum(["paused", "active", "draft", "closed"]).optional(),
    titlePrefix: z.string().trim().max(80).optional(),
    titleSuffix: z.string().trim().max(80).optional(),
    description: z.string().max(15000).optional(),
    versions: z.record(z.string(), z.number().int().positive()),
    requestId: z.uuid(),
  })
  .strict()
  .refine(
    (p) =>
      p.status || p.titlePrefix || p.titleSuffix || p.description !== undefined,
    "Escolha uma alteração para o lote",
  );
export const proposalSchema = z.object({
  offerId: text,
  input: z.unknown(),
  reason: z.string().trim().min(3).max(3000),
  requestId: z.uuid(),
  offerVersion: z.number().int().positive().optional(),
  parametersVersion: z.number().int().positive().optional(),
});
export const decisionSchema = z.object({
  action: z.enum([
    "approve",
    "reject",
    "request",
    "apply_manual",
    "fail",
    "cancel",
  ]),
  comment: z.string().trim().min(3).max(3000),
  requestId: z.uuid(),
});
export const importRowSchema = z.object({
  purchaseCost: amount.optional(),
  id: optionalText,
  version: z.number().int().positive().optional(),
  storeId: optionalText,
  title: text,
  name: text,
  sku: optionalText,
  mlId: optionalText,
  brand: optionalText,
  category: optionalText,
  model: optionalText,
  price: priceAmount,
  type: z.enum(["unit", "kit", "variation"]),
  status: z.enum(["draft", "active", "paused", "closed"]),
  description: z.string().max(15000).default(""),
  origin: z.enum(["import", "reference"]).default("import"),
  referenceAccount: optionalText,
});
export const importSchema = z.object({
  storeId: text,
  mode: z.enum(["create", "update"]).default("create"),
  rows: z.array(importRowSchema).min(1).max(40),
  requestId: z.uuid().optional(),
});
export const importPreviewSchema = importSchema.extend({
  rows: z.array(importRowSchema).min(1).max(1000),
});
export const productCostImportSchema = z.object({
  storeId: text,
  mode: z.literal("costs"),
  requestId: z.uuid().optional(),
  rows: z
    .array(
      z.object({
        productId: text,
        productVersion: z.number().int().positive(),
        purchaseCost: amount,
      }),
    )
    .min(1)
    .max(1000),
});
export { percent };
