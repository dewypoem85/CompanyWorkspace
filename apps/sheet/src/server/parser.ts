import { createHash } from 'node:crypto';

export interface ParsedImportRange {
  sourceUrl: string;
  sourceSpreadsheetId: string;
  sourceSheetTitle: string;
  sourceCell: string;
}

export function parseImportRange(formula: string): ParsedImportRange | null {
  const match = formula.match(
    /^=IMPORTRANGE\s*\(\s*"([^"]+)"\s*[,;]\s*"([^"]+)"\s*\)\s*$/i,
  );
  if (!match) return null;

  const sourceUrl = match[1];
  const sourceSpreadsheetId = sourceUrl.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if (!sourceSpreadsheetId) return null;

  const reference = match[2];
  const separator = reference.lastIndexOf('!');
  if (separator <= 0) return null;

  const sourceSheetTitle = reference.slice(0, separator).replace(/^'|'$/g, '').replaceAll("''", "'");
  const sourceCell = reference.slice(separator + 1).toUpperCase();
  if (!/^\$?[A-Z]+\$?\d+$/.test(sourceCell)) return null;

  return {
    sourceUrl,
    sourceSpreadsheetId,
    sourceSheetTitle,
    sourceCell,
  };
}

export function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
