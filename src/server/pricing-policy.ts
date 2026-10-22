import { HttpError } from "./access";
import type { Row } from "./db";

export function enforcePricingPolicy(snapshot: Row, parameters: Row) {
  if (parameters.enforceSalesMargin === false) return;
  if (
    snapshot.proposed.salesMarginMet !== true ||
    snapshot.proposed.salesMarginTarget !==
      (parameters.salesMarginTarget ?? "40")
  )
    throw new HttpError(
      422,
      `A margem sobre o preço de venda precisa ser maior que ${parameters.salesMarginTarget ?? "40"}%. Confira os custos e o preço sugerido; o bloqueio pode ser desativado nas configurações da loja.`,
    );
}
