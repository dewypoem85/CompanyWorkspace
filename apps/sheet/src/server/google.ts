import { google, sheets_v4 } from 'googleapis';
import process from 'node:process';
import type { AnalysisResult, ImportRangeRule, SheetSummary, SnapshotRecord } from '../shared/types.js';
import { columnName, quoteSheetTitle } from './a1.js';
import { contentHash, parseImportRange, stableId } from './parser.js';
import { saveAnalysis } from './store.js';
import { spreadsheetUrl } from './config.js';

const scopes = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

function credentialsFromEnvironment(): Record<string, unknown> | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return undefined;
  return JSON.parse(raw) as Record<string, unknown>;
}

export function createGoogleClients() {
  const credentials = credentialsFromEnvironment();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes,
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
}

function cellValue(value?: sheets_v4.Schema$ExtendedValue | null): string | number | boolean | null {
  if (!value) return null;
  if (value.stringValue !== undefined && value.stringValue !== null) return value.stringValue;
  if (value.numberValue !== undefined && value.numberValue !== null) return value.numberValue;
  if (value.boolValue !== undefined && value.boolValue !== null) return value.boolValue;
  return null;
}

function displayedValue(cell?: sheets_v4.Schema$CellData): string {
  if (!cell) return '';
  return cell.formattedValue ?? String(cellValue(cell.effectiveValue) ?? '');
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;

  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await task(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export async function analyzeGoogleSheet(spreadsheetId: string): Promise<AnalysisResult> {
  const { sheets } = createGoogleClients();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
    fields:
      'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))',
  });

  const spreadsheet = metadata.data;
  const tabs = (spreadsheet.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((properties): properties is sheets_v4.Schema$SheetProperties => Boolean(properties?.title));

  const scanned = await mapWithConcurrency(tabs, 3, async (properties) => {
    const rowCount = properties.gridProperties?.rowCount ?? 1;
    const columnCount = properties.gridProperties?.columnCount ?? 1;
    const range = `${quoteSheetTitle(properties.title!)}!A1:${columnName(columnCount - 1)}${rowCount}`;
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: true,
      ranges: [range],
      fields:
        'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue))))',
    });

    const sheet = response.data.sheets?.[0];
    const rows = sheet?.data?.[0]?.rowData ?? [];
    const headers = (rows[0]?.values ?? []).map((cell) => displayedValue(cell));
    const rules: ImportRangeRule[] = [];
    let blockerCount = 0;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const cells = rows[rowIndex]?.values ?? [];
      const key = displayedValue(cells[0]);

      for (let columnIndex = 0; columnIndex < cells.length; columnIndex += 1) {
        const cell = cells[columnIndex];
        const formula = cell.userEnteredValue?.formulaValue;
        if (!formula || !/IMPORTRANGE\s*\(/i.test(formula)) continue;

        const parsed = parseImportRange(formula);
        const error = cell.effectiveValue?.errorValue;
        const targetCell = `${columnName(columnIndex)}${rowIndex + 1}`;
        const ruleId = stableId(spreadsheetId, properties.title!, targetCell, formula);

        if (!parsed || error) blockerCount += 1;

        rules.push({
          id: ruleId,
          target: {
            spreadsheetId,
            sheetId: properties.sheetId ?? 0,
            sheetTitle: properties.title!,
            cell: targetCell,
            key,
            language: headers[columnIndex] || columnName(columnIndex),
          },
          source: parsed
            ? {
                spreadsheetId: parsed.sourceSpreadsheetId,
                sheetTitle: parsed.sourceSheetTitle,
                cell: parsed.sourceCell,
                url: parsed.sourceUrl,
              }
            : { spreadsheetId: '', sheetTitle: '', cell: '', url: '' },
          formula,
          plainValue: cellValue(cell.effectiveValue),
          formattedValue: displayedValue(cell),
          status: parsed && !error ? 'ready' : 'blocked',
          error: error?.message ?? (!parsed ? '지원하지 않는 IMPORTRANGE 형식입니다.' : undefined),
        });
      }
    }

    const summary: SheetSummary = {
      sheetId: properties.sheetId ?? 0,
      title: properties.title!,
      rowCount,
      columnCount,
      formulaCount: rules.length,
      blockerCount,
    };

    return { summary, rules };
  });

  const rules = scanned.flatMap((entry) => entry.rules);
  const sourceSpreadsheets = new Set(rules.map((rule) => rule.source.spreadsheetId).filter(Boolean));
  const sourceSheets = new Set(
    rules
      .filter((rule) => rule.source.spreadsheetId)
      .map((rule) => `${rule.source.spreadsheetId}:${rule.source.sheetTitle}`),
  );

  const id = contentHash(
    rules.map((rule) => [rule.id, rule.formula, rule.plainValue, rule.formattedValue]),
  ).slice(0, 24);

  const analysis: AnalysisResult = {
    id,
    createdAt: new Date().toISOString(),
    mode: 'google',
    spreadsheet: {
      id: spreadsheetId,
      title: spreadsheet.properties?.title ?? spreadsheetId,
      url: spreadsheetUrl(spreadsheetId),
      locale: spreadsheet.properties?.locale ?? undefined,
      timeZone: spreadsheet.properties?.timeZone ?? undefined,
    },
    totals: {
      formulas: rules.length,
      ready: rules.filter((rule) => rule.status === 'ready').length,
      blocked: rules.filter((rule) => rule.status === 'blocked').length,
      sourceSpreadsheets: sourceSpreadsheets.size,
      sourceSheets: sourceSheets.size,
    },
    sheets: scanned.map((entry) => entry.summary),
    rules,
  };

  await saveAnalysis(analysis);
  return analysis;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function writePlainValues(rules: ImportRangeRule[]): Promise<void> {
  if (rules.length === 0) return;
  const { sheets } = createGoogleClients();
  const spreadsheetId = rules[0].target.spreadsheetId;

  for (const batch of chunks(rules, 400)) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: batch.map((rule) => ({
          range: `${quoteSheetTitle(rule.target.sheetTitle)}!${rule.target.cell}`,
          majorDimension: 'ROWS',
          values: [[rule.plainValue ?? '']],
        })),
      },
    });
  }
}

export async function restoreFormulas(snapshot: SnapshotRecord): Promise<void> {
  const { sheets } = createGoogleClients();

  for (const batch of chunks(snapshot.entries, 400)) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: snapshot.spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batch.map((entry) => ({
          range: entry.range,
          majorDimension: 'ROWS',
          values: [[entry.formula]],
        })),
      },
    });
  }
}

export async function restoreSnapshot(snapshot: SnapshotRecord): Promise<void> {
  const { sheets } = createGoogleClients();
  const restoresFormulas = snapshot.kind === undefined || snapshot.kind === 'migration';

  for (const batch of chunks(snapshot.entries, 400)) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: snapshot.spreadsheetId,
      requestBody: {
        valueInputOption: restoresFormulas ? 'USER_ENTERED' : 'RAW',
        data: batch.map((entry) => ({
          range: entry.range,
          majorDimension: 'ROWS',
          values: [[restoresFormulas ? (entry.formula ?? '') : (entry.plainValue ?? '')]],
        })),
      },
    });
  }
}
