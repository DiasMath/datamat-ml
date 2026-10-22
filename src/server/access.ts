import { find, type Row } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
export type Actor = {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: "admin" | "approver" | "manager" | "viewer";
  stores: Row[];
};

// Single-operator workspace until the existing portal supplies a verified identity.
// Never accept a role, organization or actor supplied by browser headers/body.
export async function workspaceActor(): Promise<Actor> {
  const organization_id = "datamat";
  const stores = await find("stores", { organization_id, active: 1 });
  return {
    id: "workspace-operator",
    organization_id,
    name: process.env.APP_OPERATOR_NAME?.trim() || "Operador",
    email: "",
    role: "admin",
    stores: stores.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
export function authorizeStore(actor: Actor, storeId: string) {
  if (!actor.stores.some((s) => s.id === storeId))
    throw new HttpError(404, "Loja não encontrada ou acesso indisponível");
}
export function canWrite(actor: Actor) {
  if (actor.role === "viewer")
    throw new HttpError(403, "Sua permissão é somente de consulta");
}
export function canApprove(actor: Actor) {
  if (!["admin", "approver"].includes(actor.role))
    throw new HttpError(403, "A aprovação exige permissão de aprovador");
}
export function admin(actor: Actor) {
  if (actor.role !== "admin")
    throw new HttpError(403, "Ação restrita ao administrador");
}
