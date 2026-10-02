export function columnName(columnIndex: number): string {
  let value = columnIndex + 1;
  let name = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

export function quoteSheetTitle(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

export function extractSpreadsheetId(value: string): string | null {
  const fromUrl = value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(value.trim()) ? value.trim() : null;
}
