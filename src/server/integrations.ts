import { HttpError } from "./access";
import { mlConfigured } from "./mercadolivre";

export type Provider = "mercadolivre" | "bling" | "ai";
export interface IntegrationAdapter {
  provider: Provider;
  configured(): boolean;
  sync(accountId: string): Promise<never>;
}
// A configured application is NOT an authorized seller account. Adapters never
// make speculative external calls or overwrite fields owned by another system.
class PendingAdapter implements IntegrationAdapter {
  constructor(
    public provider: Provider,
    private variables: string[],
  ) {}
  configured() {
    return this.variables.every((k) => Boolean(process.env[k]));
  }
  async sync(_accountId: string): Promise<never> {
    throw new HttpError(
      503,
      this.configured()
        ? "Autorização por conta e adapter externo ainda não implementados"
        : "Integração sem credenciais configuradas",
    );
  }
}
export const adapters: Record<Provider, IntegrationAdapter> = {
  mercadolivre: {
    provider: "mercadolivre",
    configured: mlConfigured,
    async sync() {
      throw new HttpError(409, "Use a sincronização da conta autorizada");
    },
  },
  bling: new PendingAdapter("bling", [
    "BLING_CLIENT_ID",
    "BLING_CLIENT_SECRET",
    "BLING_REDIRECT_URI",
  ]),
  ai: new PendingAdapter("ai", ["AI_API_KEY"]),
};
export function reportUrl() {
  const value = process.env.POWER_BI_REPORT_URL;
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
