import {describe, it, expect} from 'vitest';
import {confirmMigrationReceipt, confirmMigrationResult, confirmSyncReceipt, confirmSyncResult} from './sheetWrites';
import type {AnalysisResult, KoreanSyncPreview} from '../shared/types';
const analysis = {spreadsheet:{id:'sheet'}, rules:[{}]} as AnalysisResult;
const preview = {id:'preview', target:{id:'sheet'}, totals:{changed:1, unchanged:3}} as KoreanSyncPreview;
const migration = {id:'result', spreadsheetId:'sheet', snapshotId:'snapshot', ruleFile:'sheet.json', startedAt:'2026-09-10T00:00:00Z', completedAt:'2026-09-10T00:00:01Z', converted:1, remaining:0};
const sync = {id:'result', spreadsheetId:'sheet', previewId:'preview', snapshotId:'snapshot', completedAt:'2026-09-10T00:00:01Z', updated:1, unchanged:3};
describe('explicit sheet write acknowledgements', () => {
  it('accepts the existing server results with the exact reviewed spreadsheet and counts', () => {
    expect(confirmMigrationResult(migration,analysis)).toBe(migration);
    expect(confirmSyncResult(sync,preview)).toBe(sync);
  });
  it('rejects wrong targets, malformed counts and incomplete migration confirmation', () => {
    for(const patch of [{spreadsheetId:'other'},{snapshotId:''},{converted:2},{remaining:-1},{converted:NaN},{completedAt:'bad'},{ruleFile:''}])
      expect(()=>confirmMigrationResult({...migration,...patch},analysis)).toThrow(/실행 확인/);
  });
  it('rejects the wrong preview or missing snapshot without claiming success', () => {
    for(const patch of [{previewId:'new-preview'},{spreadsheetId:'other'},{updated:2},{unchanged:4},{snapshotId:undefined},{id:''}])
      expect(()=>confirmSyncResult({...sync,...patch},preview)).toThrow(/실행 확인/);
  });
  it('preserves the server no-change response without requiring a nonexistent snapshot', () => {
    expect(confirmSyncResult({...sync,updated:0,snapshotId:undefined},{...preview,totals:{...preview.totals,changed:0}}).updated).toBe(0);
  });
  it('binds the common receipt to the exact transmitted migration command', () => {
    const value={operation:'migration',analysisId:'preview-analysis',spreadsheetId:'sheet',result:migration};
    const reviewed={...analysis,id:'preview-analysis'};
    expect(confirmMigrationReceipt(value,{analysisId:'preview-analysis',confirmation:'수식 제거'},reviewed)).toBe(migration);
    for(const mutate of [
      (x:any)=>x.value.operation='korean-sync',(x:any)=>x.value.analysisId='old',(x:any)=>x.value.extra=true,
      (x:any)=>x.sent.analysisId='old',(x:any)=>x.sent.confirmation='한국어 갱신',(x:any)=>x.sent.extra=true,
    ]){const sample={value:structuredClone(value),sent:{analysisId:'preview-analysis',confirmation:'수식 제거'}};mutate(sample);expect(()=>confirmMigrationReceipt(sample.value,sample.sent,reviewed)).toThrow(/실행 확인/);}
  });
  it('binds the common receipt to the exact transmitted Korean sync command', () => {
    const value={operation:'korean-sync',previewId:'preview',spreadsheetId:'sheet',result:sync};
    const sent={spreadsheetId:'sheet',previewId:'preview',confirmation:'한국어 갱신'};
    expect(confirmSyncReceipt(value,sent,preview)).toBe(sync);
    for(const mutate of [
      (x:any)=>x.value.operation='migration',(x:any)=>x.value.previewId='old',(x:any)=>x.value.spreadsheetId='other',
      (x:any)=>x.sent.previewId='old',(x:any)=>x.sent.confirmation='수식 제거',(x:any)=>x.sent.extra=true,
    ]){const sample={value:structuredClone(value),sent:structuredClone(sent)};mutate(sample);expect(()=>confirmSyncReceipt(sample.value,sample.sent,preview)).toThrow(/실행 확인/);}
  });
});
