import { randomUUID } from 'node:crypto';
import type { sheets_v4 } from 'googleapis';
import type {
  CellValue,
  ImportRangeRule,
  KoreanSyncItem,
  KoreanSyncPreview,
  KoreanSyncResult,
  SnapshotRecord,
} from '../shared/types.js';
import { quoteSheetTitle } from './a1.js';
import { spreadsheetUrl } from './config.js';
import { createGoogleClients, restoreSnapshot } from './google.js';
import { contentHash } from './parser.js';
import { loadRules, saveSnapshot } from './store.js';

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function rangeFor(sheetTitle: string, cell: string): string {
  return `${quoteSheetTitle(sheetTitle)}!${cell}`;
}

function valueFromRange(range?: sheets_v4.Schema$ValueRange): CellValue {
  const value = range?.values?.[0]?.[0];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function sameValue(left: CellValue, right: CellValue): boolean {
  return left === right;
}

async function readValues(
  spreadsheetId: string,
  ranges: string[],
): Promise<CellValue[]> {
  const { sheets } = createGoogleClients();
  const values: CellValue[] = [];

  for (const batch of chunks(ranges, 400)) {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: batch,
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    const returned = response.data.valueRanges ?? [];
    for (let index = 0; index < batch.length; index += 1) {
      values.push(valueFromRange(returned[index]));
    }
  }

  return values;
}

async function readSourceValues(rules: ImportRangeRule[]): Promise<Map<string, CellValue>> {
  const groups = new Map<string, ImportRangeRule[]>();
  for (const rule of rules) {
    const group = groups.get(rule.source.spreadsheetId) ?? [];
    group.push(rule);
    groups.set(rule.source.spreadsheetId, group);
  }

  const entries = await Promise.all([...groups.entries()].map(async ([spreadsheetId, sourceRules]) => {
    const values = await readValues(
      spreadsheetId,
      sourceRules.map((rule) => rangeFor(rule.source.sheetTitle, rule.source.cell)),
    );
    return sourceRules.map((rule, index) => [rule.id, values[index]] as const);
  }));

  return new Map(entries.flat());
}

export async function createKoreanSyncPreview(spreadsheetId: string): Promise<KoreanSyncPreview> {
  const document = await loadRules(spreadsheetId);
  const koreanRules = document.rules.filter((rule) => rule.target.language.trim() === 'Korean');
  if (koreanRules.length === 0) {
    throw new Error('저장된 Korean 연결 규칙이 없습니다. 먼저 수식 마이그레이션을 완료해 주세요.');
  }

  const blocked = koreanRules.filter((rule) => rule.status !== 'ready' || !rule.source.spreadsheetId);
  if (blocked.length > 0) {
    throw new Error(`Korean 연결 규칙 ${blocked.length}개가 원본 위치를 확인할 수 없는 상태입니다.`);
  }

  const { sheets } = createGoogleClients();
  const [metadata, sourceValues, targetValues] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId, includeGridData: false, fields: 'properties(title)' }),
    readSourceValues(koreanRules),
    readValues(
      spreadsheetId,
      koreanRules.map((rule) => rangeFor(rule.target.sheetTitle, rule.target.cell)),
    ),
  ]);

  const items: KoreanSyncItem[] = koreanRules.map((rule, index) => {
    const sourceValue = sourceValues.get(rule.id) ?? null;
    const currentValue = targetValues[index] ?? null;
    return {
      ruleId: rule.id,
      key: rule.target.key,
      status: sameValue(sourceValue, currentValue) ? 'unchanged' : 'changed',
      source: { ...rule.source, value: sourceValue },
      target: {
        spreadsheetId: rule.target.spreadsheetId,
        sheetTitle: rule.target.sheetTitle,
        cell: rule.target.cell,
        currentValue,
      },
    };
  });

  const sourceSheets = new Set(items.map((item) => `${item.source.spreadsheetId}:${item.source.sheetTitle}`));
  const changed = items.filter((item) => item.status === 'changed').length;
  const id = contentHash(items.map((item) => [
    item.ruleId,
    item.source.value,
    item.target.currentValue,
  ])).slice(0, 24);

  return {
    id,
    createdAt: new Date().toISOString(),
    target: {
      id: spreadsheetId,
      title: metadata.data.properties?.title ?? spreadsheetId,
      url: spreadsheetUrl(spreadsheetId),
    },
    language: 'Korean',
    totals: {
      tracked: items.length,
      changed,
      unchanged: items.length - changed,
      sourceSpreadsheets: new Set(items.map((item) => item.source.spreadsheetId)).size,
      sourceSheets: sourceSheets.size,
    },
    items,
  };
}

async function writeSyncItems(spreadsheetId: string, items: KoreanSyncItem[]): Promise<void> {
  const { sheets } = createGoogleClients();
  for (const batch of chunks(items, 400)) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: batch.map((item) => ({
          range: rangeFor(item.target.sheetTitle, item.target.cell),
          majorDimension: 'ROWS',
          values: [[item.source.value ?? '']],
        })),
      },
    });
  }
}

export async function applyKoreanSync(
  spreadsheetId: string,
  expectedPreviewId: string,
): Promise<KoreanSyncResult> {
  const preview = await createKoreanSyncPreview(spreadsheetId);
  if (preview.id !== expectedPreviewId) {
    const error = new Error('미리보기 이후 원본 또는 번역 시트가 변경되었습니다. 다시 미리보기해 주세요.');
    Object.assign(error, { code: 'STALE_SYNC_PREVIEW', status: 409 });
    throw error;
  }

  const changes = preview.items.filter((item) => item.status === 'changed');
  if (changes.length === 0) {
    return {
      id: randomUUID(),
      completedAt: new Date().toISOString(),
      spreadsheetId,
      previewId: preview.id,
      updated: 0,
      unchanged: preview.totals.unchanged,
    };
  }

  const snapshot: SnapshotRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    kind: 'korean-sync',
    spreadsheetId,
    spreadsheetTitle: preview.target.title,
    analysisId: preview.id,
    entryCount: changes.length,
    entries: changes.map((item) => ({
      range: rangeFor(item.target.sheetTitle, item.target.cell),
      plainValue: item.target.currentValue,
      formattedValue: String(item.target.currentValue ?? ''),
    })),
  };
  await saveSnapshot(snapshot);

  try {
    await writeSyncItems(spreadsheetId, changes);
    const verified = await readValues(
      spreadsheetId,
      changes.map((item) => rangeFor(item.target.sheetTitle, item.target.cell)),
    );
    const failed = changes.filter((item, index) => !sameValue(item.source.value, verified[index] ?? null));
    if (failed.length > 0) {
      throw new Error(`갱신 검증에 실패한 Korean 셀이 ${failed.length}개 있습니다.`);
    }

    return {
      id: randomUUID(),
      completedAt: new Date().toISOString(),
      spreadsheetId,
      previewId: preview.id,
      snapshotId: snapshot.id,
      updated: changes.length,
      unchanged: preview.totals.unchanged,
    };
  } catch (error) {
    await restoreSnapshot(snapshot);
    throw error;
  }
}
