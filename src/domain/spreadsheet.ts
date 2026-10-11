export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 2_000_000;
export type ImportTable = { headers: string[]; rows: string[][] };

export function assertWorkbookSize(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let end = view.byteLength - 22;
  for (; end >= Math.max(0, view.byteLength - 65557); end--)
    if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50)
    throw new Error("Arquivo Excel inválido; use .xlsx");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true),
    total = 0;
  if (count > 2000) throw new Error("Planilha contém arquivos internos demais");
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > view.byteLength ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error("Arquivo Excel inválido");
    if (view.getUint16(offset + 8, true) & 1)
      throw new Error("Use uma planilha sem senha");
    total += view.getUint32(offset + 24, true);
    if (total > 32_000_000)
      throw new Error("A planilha expandida é grande demais; divida o arquivo");
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
}

export function spreadsheetTable(values: unknown[][]): ImportTable {
  const text = (v: unknown) =>
    v == null
      ? ""
      : v instanceof Date
        ? v.toISOString().slice(0, 10)
        : String(v);
  const nonempty = values.filter((r) => r.some((v) => text(v).trim()));
  if (nonempty.length < 2)
    throw new Error("Inclua um cabeçalho e pelo menos uma linha de dados");
  if (nonempty.length > MAX_IMPORT_ROWS + 1)
    throw new Error(`Importe até ${MAX_IMPORT_ROWS} linhas por arquivo`);
  const headers = nonempty[0].map((v) => text(v).trim());
  if (!headers.length || headers.some((h) => !h))
    throw new Error("Todas as colunas precisam de cabeçalho");
  if (
    new Set(headers.map((h) => h.toLocaleLowerCase("pt-BR"))).size !==
    headers.length
  )
    throw new Error("O arquivo contém cabeçalhos duplicados");
  return {
    headers,
    rows: nonempty.slice(1).map((r) => {
      if (r.slice(headers.length).some((v) => text(v).trim()))
        throw new Error("Quantidade de colunas inconsistente");
      return headers.map((_, i) => text(r[i]));
    }),
  };
}
