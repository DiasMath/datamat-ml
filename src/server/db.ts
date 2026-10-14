import { randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  readFirebaseConfiguration,
  FirebaseConfigurationError,
} from "./firebase-configuration";
import {
  initializeApp,
  getApps,
  applicationDefault,
  cert,
} from "firebase-admin/app";
import {
  initializeFirestore,
  FieldValue,
  type Firestore,
  type Transaction,
  type Query,
  type DocumentData,
} from "firebase-admin/firestore";

export type Row = Record<string, any>;
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const key = (...parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export class DatabaseConfigurationError extends Error {}
type Context = {
  transaction: Transaction;
  writes: Map<string, Row | null>;
  reads: Map<string, Row | undefined>;
};
const context = new AsyncLocalStorage<Context>();
let database: Firestore | undefined;
export function db() {
  if (database) return database;
  let configuration: ReturnType<typeof readFirebaseConfiguration>;
  let credential;
  try {
    configuration = readFirebaseConfiguration();
    if (configuration.account) credential = cert(configuration.account);
    else if (configuration.mode === "application-default")
      credential = applicationDefault();
  } catch (error) {
    throw new DatabaseConfigurationError(
      error instanceof FirebaseConfigurationError
        ? error.message
        : "Não foi possível carregar a credencial administrativa. Confira FIREBASE_SERVICE_ACCOUNT_JSON ou a credencial local configurada.",
    );
  }
  const { projectId } = configuration;
  const app =
    getApps().find((a) => a.name === "datamat-server") ||
    initializeApp(
      { projectId, ...(credential ? { credential } : {}) },
      "datamat-server",
    );
  database = initializeFirestore(app, { preferRest: false });
  return database;
}
function doc(collection: string, documentId: string) {
  if (!documentId || documentId.includes("/"))
    throw new Error("Identificador de documento inválido");
  return db().collection(collection).doc(documentId);
}
function clean(row: Row): Row {
  return JSON.parse(JSON.stringify(row));
}
export async function get(
  collection: string,
  documentId: string,
): Promise<Row | undefined> {
  const ref = doc(collection, documentId),
    c = context.getStore();
  if (c?.writes.has(ref.path)) return c.writes.get(ref.path) || undefined;
  if (c?.reads.has(ref.path)) return c.reads.get(ref.path);
  const snapshot = c ? await c.transaction.get(ref) : await ref.get();
  const row = snapshot.exists
    ? { ...snapshot.data(), id: snapshot.id }
    : undefined;
  c?.reads.set(ref.path, row);
  return row;
}
export type Filters = Record<
  string,
  string | number | boolean | null | { in: string[] }
>;
function matches(row: Row, filters: Filters) {
  return Object.entries(filters).every(([field, value]) =>
    value !== null && typeof value === "object"
      ? value.in.includes(row[field])
      : row[field] === value,
  );
}
export async function find(
  collection: string,
  filters: Filters = {},
  limit?: number,
): Promise<Row[]> {
  let q: Query<DocumentData> = db().collection(collection);
  for (const [field, value] of Object.entries(filters)) {
    if (value !== null && typeof value === "object" && !value.in.length)
      return [];
    q = q.where(
      field,
      value !== null && typeof value === "object" ? "in" : "==",
      value !== null && typeof value === "object" ? value.in : value,
    );
  }
  const c = context.getStore();
  if (limit && !c) q = q.limit(limit);
  const snapshot = c ? await c.transaction.get(q) : await q.get();
  const rows = new Map<string, Row>(
    snapshot.docs.map((d) => [d.id, { ...d.data(), id: d.id }]),
  );
  if (c) {
    for (const d of snapshot.docs)
      c.reads.set(d.ref.path, { ...d.data(), id: d.id });
    for (const [path, row] of c.writes) {
      if (path.split("/")[0] !== collection) continue;
      const documentId = path.split("/")[1];
      if (row && matches(row, filters))
        rows.set(documentId, { ...row, id: documentId });
      else rows.delete(documentId);
    }
  }
  return [...rows.values()].slice(0, limit);
}
const todayCollections = new Set([
  "offers",
  "costs",
  "parameters",
  "connections",
  "ml_analytics",
  "ml_competition",
  "proposals",
  "tasks",
  "monthly_goals",
  "stores",
]);
function affectedStore(
  collection: string,
  documentId: string,
  row?: Row | null,
) {
  if (!todayCollections.has(collection)) return undefined;
  return collection === "stores" ? documentId : row?.store_id;
}
function revisionWrite(storeId: string) {
  return db().collection("_today_revisions").doc(storeId);
}
export async function put(collection: string, documentId: string, row: Row) {
  const data = clean({ ...row, id: documentId }),
    c = context.getStore();
  if (c) c.writes.set(doc(collection, documentId).path, data);
  else {
    const storeId = affectedStore(collection, documentId, data);
    const batch = db().batch();
    batch.set(doc(collection, documentId), data);
    if (storeId)
      batch.set(
        revisionWrite(storeId),
        { revision: FieldValue.increment(1) },
        { merge: true },
      );
    await batch.commit();
  }
  return data;
}
export async function remove(collection: string, documentId: string) {
  const c = context.getStore();
  if (c) c.writes.set(doc(collection, documentId).path, null);
  else {
    const previous = todayCollections.has(collection)
      ? await get(collection, documentId)
      : undefined;
    const storeId = affectedStore(collection, documentId, previous);
    const batch = db().batch();
    batch.delete(doc(collection, documentId));
    if (storeId)
      batch.set(
        revisionWrite(storeId),
        { revision: FieldValue.increment(1) },
        { merge: true },
      );
    await batch.commit();
  }
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (context.getStore()) return fn();
  return db().runTransaction(
    async (tx) => {
      const c: Context = {
        transaction: tx,
        writes: new Map(),
        reads: new Map(),
      };
      return context.run(c, async () => {
        const result = await fn();
        if (c.writes.size > 450)
          throw new Error(
            "Operação excede o limite transacional; reduza o lote",
          );
        const changedStores = new Set<string>();
        for (const [path, row] of c.writes) {
          const [collection, documentId] = path.split("/");
          for (const candidate of [row, c.reads.get(path)]) {
            const storeId = affectedStore(collection, documentId, candidate);
            if (storeId) changedStores.add(storeId);
          }
        }
        if (c.writes.size + changedStores.size > 500)
          throw new Error(
            "Operação excede o limite transacional; reduza o lote",
          );
        // Stage writes: Firestore requires ALL reads to precede ALL writes.
        for (const [path, row] of c.writes) {
          const ref = db().doc(path);
          if (row === null) tx.delete(ref);
          else tx.set(ref, row);
        }
        for (const storeId of changedStores)
          tx.set(
            revisionWrite(storeId),
            { revision: FieldValue.increment(1) },
            { merge: true },
          );
        return result;
      });
    },
    { maxAttempts: 5 },
  );
}
export async function claim(namespace: string, value: string, ownerId: string) {
  if (!context.getStore()) throw new Error("Reservas únicas exigem transação");
  const documentId = key(namespace, value),
    existing = await get("unique_keys", documentId);
  if (existing && existing.owner_id !== ownerId)
    throw new Error("UNIQUE constraint: identificação já cadastrada");
  await put("unique_keys", documentId, { namespace, owner_id: ownerId });
}
export async function release(
  namespace: string,
  value: string,
  ownerId: string,
) {
  const documentId = key(namespace, value),
    existing = await get("unique_keys", documentId);
  if (existing?.owner_id === ownerId) await remove("unique_keys", documentId);
}
let initialization: Promise<unknown> | undefined;
export function initializeDatabase() {
  if (!initialization)
    initialization = initializeDatabaseInside().catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
async function initializeDatabaseInside() {
  return transaction(async () => {
    if (await get("_datamat_schema", "001_initial")) return;
    if (!(await get("organizations", "datamat")))
      await put("organizations", "datamat", { name: "Gestão DATAMAT" });
    for (const [storeId, name] of [
      ["juntos-com", "juntos.com"],
      ["juntos-data", "juntos.data"],
    ]) {
      if (!(await get("stores", storeId)))
        await put("stores", storeId, {
          organization_id: "datamat",
          name,
          active: 1,
        });
      await claim("stores.name.datamat", name, storeId);
      if (!(await get("parameters", storeId)))
        await put("parameters", storeId, {
          store_id: storeId,
          data_json: JSON.stringify({
            minMargin: null,
            desiredMargin: null,
            taxRate: null,
            taxBase: null,
            managementRate: "1",
            managementBase: null,
            reviewDays: 30,
          }),
          version: 1,
          updated_at: now(),
        });
      for (const provider of ["mercadolivre", "bling", "ai"]) {
        const connectionId = key(storeId, provider);
        if (!(await get("connections", connectionId)))
          await put("connections", connectionId, {
            store_id: storeId,
            provider,
            status: "unconfigured",
            external_account: null,
            updated_at: now(),
          });
      }
    }
    await put("_datamat_schema", "001_initial", {
      version: 1,
      applied_at: now(),
      database: "firestore",
    });
  });
}
