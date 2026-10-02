import type {AnalysisResult, KoreanSyncPreview, KoreanSyncResult, MigrationResult} from '../shared/types';

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const timestamp = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const invalid = () => new Error('완전한 실행 확인 응답을 받지 못했습니다. 서버 반영 여부를 다시 확인해 주세요.');

export function confirmMigrationResult(result: MigrationResult, analysis: AnalysisResult): MigrationResult {
  if (!result || !text(result.id) || result.spreadsheetId !== analysis.spreadsheet.id || !text(result.snapshotId)
    || !timestamp(result.completedAt) || !timestamp(result.startedAt) || !text(result.ruleFile)
    || !count(result.converted) || result.remaining !== 0 || result.converted !== analysis.rules.length) throw invalid();
  return result;
}
export function confirmSyncResult(result: KoreanSyncResult, preview: KoreanSyncPreview): KoreanSyncResult {
  if (!result || !text(result.id) || result.spreadsheetId !== preview.target.id || result.previewId !== preview.id
    || !timestamp(result.completedAt) || !count(result.updated) || !count(result.unchanged)
    || result.updated !== preview.totals.changed || result.unchanged !== preview.totals.unchanged
    || (result.updated > 0 && !text(result.snapshotId))) throw invalid();
  return result;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: RecordValue, expected: string[]) =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

export function confirmMigrationReceipt(value: unknown, sent: unknown, analysis: AnalysisResult): MigrationResult {
  if (!record(sent) || !exactKeys(sent, ['analysisId', 'confirmation'])
    || sent.analysisId !== analysis.id || sent.confirmation !== '수식 제거'
    || !record(value) || !exactKeys(value, ['operation', 'analysisId', 'spreadsheetId', 'result'])
    || value.operation !== 'migration' || value.analysisId !== analysis.id
    || value.spreadsheetId !== analysis.spreadsheet.id) throw invalid();
  return confirmMigrationResult(value.result as MigrationResult, analysis);
}

export function confirmSyncReceipt(value: unknown, sent: unknown, preview: KoreanSyncPreview): KoreanSyncResult {
  if (!record(sent) || !exactKeys(sent, ['spreadsheetId', 'previewId', 'confirmation'])
    || sent.spreadsheetId !== preview.target.id || sent.previewId !== preview.id || sent.confirmation !== '한국어 갱신'
    || !record(value) || !exactKeys(value, ['operation', 'previewId', 'spreadsheetId', 'result'])
    || value.operation !== 'korean-sync' || value.previewId !== preview.id
    || value.spreadsheetId !== preview.target.id) throw invalid();
  return confirmSyncResult(value.result as KoreanSyncResult, preview);
}
