import type {AnalysisResult, KoreanSyncPreview, RuntimeConfig, SnapshotRecord} from '../shared/types';

const object = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const text = (v: unknown): v is string => typeof v === 'string';
const id = (v: unknown): v is string => text(v) && v.length > 0;
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const date = (v: unknown) => id(v) && Number.isFinite(Date.parse(v));
const cell = (v: unknown) => v === null || text(v) || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const url = (v: unknown) => { try { const u = new URL(String(v)); return text(v) && ['http:','https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
const mode = (v: unknown) => v === 'google' || v === 'demo';
const unique = (items: any[], key: string) => new Set(items.map(item => item[key])).size === items.length;
const document = (v: unknown) => object(v) && id(v.id) && text(v.title) && url(v.url);
const counts = (v: unknown, keys: string[]) => object(v) && keys.every(key => count(v[key]));
const failure = () => Error('시트 조회 응답이 올바르지 않습니다. 현재 표시값을 유지하고 다시 확인해 주세요.');

export function readConfig(v: unknown): RuntimeConfig {
  if (!object(v) || !mode(v.mode) || typeof v.writesEnabled !== 'boolean' || !id(v.actorId) || !id(v.defaultSpreadsheetId) || !url(v.defaultSpreadsheetUrl)) throw failure();
  return v as unknown as RuntimeConfig;
}
export function readAnalysis(v: unknown): AnalysisResult {
  if (!object(v) || !id(v.id) || !date(v.createdAt) || !mode(v.mode) || !document(v.spreadsheet)
    || !counts(v.totals,['formulas','ready','blocked','sourceSpreadsheets','sourceSheets'])
    || v.totals.ready + v.totals.blocked !== v.totals.formulas || !Array.isArray(v.sheets) || !Array.isArray(v.rules)) throw failure();
  if (!v.sheets.every(s => object(s) && count(s.sheetId) && text(s.title) && counts(s,['rowCount','columnCount','formulaCount','blockerCount'])) || !unique(v.sheets,'sheetId')) throw failure();
  if (!v.rules.every(r => object(r) && id(r.id) && object(r.target) && r.target.spreadsheetId === v.spreadsheet.id
    && count(r.target.sheetId) && ['sheetTitle','cell','key','language'].every(k => text(r.target[k]))
    && object(r.source) && ['spreadsheetId','sheetTitle','cell','url'].every(k => text(r.source[k]))
    && (r.source.url === '' || url(r.source.url)) && text(r.formula) && cell(r.plainValue) && text(r.formattedValue)
    && ['ready','blocked'].includes(r.status) && (r.error === undefined || text(r.error))) || !unique(v.rules,'id') || v.rules.length > v.totals.formulas) throw failure();
  // The public endpoint intentionally returns only the first 150 rules. Do not
  // require its row count to equal the complete document's totals.
  return v as unknown as AnalysisResult;
}
export function readPreview(v: unknown): KoreanSyncPreview {
  if (!object(v) || !id(v.id) || !date(v.createdAt) || !document(v.target) || v.language !== 'Korean'
    || !counts(v.totals,['tracked','changed','unchanged','sourceSpreadsheets','sourceSheets'])
    || v.totals.changed + v.totals.unchanged !== v.totals.tracked || !Array.isArray(v.items)) throw failure();
  if (!v.items.every(r => object(r) && id(r.ruleId) && text(r.key) && ['changed','unchanged'].includes(r.status)
    && object(r.source) && ['spreadsheetId','sheetTitle','cell'].every(k => text(r.source[k])) && url(r.source.url) && cell(r.source.value)
    && object(r.target) && r.target.spreadsheetId === v.target.id && text(r.target.sheetTitle) && text(r.target.cell) && cell(r.target.currentValue))
    || !unique(v.items,'ruleId') || v.items.length !== v.totals.tracked
    || v.items.filter(r => r.status === 'changed').length !== v.totals.changed) throw failure();
  return v as unknown as KoreanSyncPreview;
}
export function readSnapshots(v: unknown): Array<Omit<SnapshotRecord,'entries'>> {
  if (!Array.isArray(v) || !v.every(r => object(r) && id(r.id) && date(r.createdAt) && id(r.spreadsheetId)
    && text(r.spreadsheetTitle) && text(r.analysisId) && count(r.entryCount)
    && (r.kind === undefined || ['migration','korean-sync'].includes(r.kind))) || !unique(v,'id')) throw failure();
  return v;
}
