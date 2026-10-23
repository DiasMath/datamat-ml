import Decimal from "decimal.js";

export function centsInput(text: string) {
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  return new Decimal(digits).div(100).toFixed(2);
}
export function pastedMoney(text: string): string | null {
  let value = text.replace(/R\$/gi, "").replace(/[\s\u00a0]/g, "");
  if (!value) return "";
  if (value.includes(",")) value = value.replaceAll(".", "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replaceAll(".", "");
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return null;
  return new Decimal(value).toFixed(2);
}
export function moneyInputDisplay(value: string | null | undefined) {
  if (value == null || value === "") return "";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}
