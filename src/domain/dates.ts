const timeZone = "America/Sao_Paulo";
export function calendarDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function displayDate(value: string | null | undefined): string {
  if (!value) return "Sem prazo";
  return new Date(
    value.length === 10 ? value + "T12:00:00-03:00" : value,
  ).toLocaleDateString("pt-BR", { timeZone });
}
