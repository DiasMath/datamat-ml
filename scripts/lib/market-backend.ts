import {
  marketFailure,
  marketPath,
  type MarketObservation,
  type MarketResource,
} from "../../src/domain/market-research";
import { type MarketConfig, taskKey } from "./market-queue";

export function backendOrigin(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Informe somente a origem HTTPS do DATAMAT");
  return url.origin;
}
export async function readMarketBackend(
  origin: string,
  config: MarketConfig,
  resource: MarketResource,
): Promise<MarketObservation> {
  try {
    const response = await fetch(
      backendOrigin(origin) + "/api/market-research/read",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(45000),
        headers: {
          "Content-Type": "application/json",
          Origin: backendOrigin(origin),
        },
        body: JSON.stringify({
          storeId: config.store_id,
          applicationId: config.application_id,
          resource,
        }),
      },
    );
    if (!response.ok)
      return marketFailure(resource, { status: response.status });
    const value = (await response.json()) as MarketObservation;
    if (
      !value ||
      ![
        "ok",
        "unavailable",
        "blocked",
        "rate_limited",
        "auth_required",
        "error",
      ].includes(value.status) ||
      taskKey(value.resource) !== taskKey(resource) ||
      value.source !== "https://api.mercadolibre.com" + marketPath(resource) ||
      !Number.isFinite(Date.parse(value.collected_at))
    )
      throw new Error("Resposta do backend não corresponde à consulta");
    return value;
  } catch {
    return marketFailure(resource, {});
  }
}
