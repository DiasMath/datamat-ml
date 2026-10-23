import Decimal from "decimal.js";
import { calculate, type Costs, type Parameters } from "./finance";
import { effectiveMlCosts } from "./ml-financial";

// Receipt excludes seller-owned costs. Missing charges must remain pending.
export function currentCosts(
  offer: Record<string, any>,
  saved: Costs,
  parameters: Parameters,
  clock = Date.now(),
) {
  const costs = effectiveMlCosts(saved, offer, clock);
  const calculation = calculate(offer.price, costs, parameters);
  const charges = ["mlPercent", "mlFixed", "shipping"].map(
    (key) => calculation.breakdown[key],
  );
  const receipt =
    calculation.price != null && charges.every((v) => v != null)
      ? charges
          .reduce<Decimal>(
            (sum, v) => sum.sub(v!),
            new Decimal(calculation.price),
          )
          .toFixed(2)
      : null;
  return { costs, calculation, receipt };
}
