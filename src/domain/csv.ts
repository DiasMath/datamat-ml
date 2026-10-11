import { spreadsheetTable } from "./spreadsheet";
export function parseCsv(text: string) {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0];
  const delimiter = first.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length)
        throw new Error("Aspas inválidas no CSV");
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV com aspas não fechadas");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2)
    throw new Error("Inclua um cabeçalho e pelo menos uma linha de dados");
  if (rows.slice(1).some((r) => r.length !== rows[0].length))
    throw new Error("Quantidade de colunas inconsistente");
  return spreadsheetTable(rows);
}
export function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  // Neutralize spreadsheet formula injection, including leading whitespace.
  if (/^\s*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
