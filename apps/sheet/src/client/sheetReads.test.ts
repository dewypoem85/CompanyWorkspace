import {expect, test} from 'vitest';
import {readAnalysis,readConfig,readPreview,readSnapshots} from './sheetReads';
import {analysis,config,preview,snapshots} from '../test/sheetFixtures';

test('valid complete responses preserve string cells, zero sheet IDs and truncated rule lists',()=>{
  expect(readConfig(config)).toBe(config); expect(readAnalysis(analysis)).toBe(analysis);
  expect(readPreview(preview)).toBe(preview); expect(readSnapshots(snapshots)).toBe(snapshots);
  const truncated=structuredClone(analysis);truncated.totals.formulas=160;truncated.totals.ready=160;
  expect(readAnalysis(truncated).rules[0].plainValue).toBe('9007199254740993');
  const blocked=structuredClone(analysis);blocked.rules[0].source={spreadsheetId:'',sheetTitle:'',cell:'',url:''};
  blocked.rules[0].status='blocked';blocked.rules[0].plainValue=null;blocked.totals.blocked=1;blocked.totals.ready=0;
  expect(readAnalysis(blocked)).toBe(blocked);
});
test('malformed configuration and snapshot records never become ready or empty lists',()=>{
  for(const v of [null,{}, {...config,writesEnabled:'false'}, {...config,actorId:''}, {...config,defaultSpreadsheetUrl:'javascript:alert(1)'}])expect(()=>readConfig(v)).toThrow();
  for(const v of [{},[null],[...snapshots,...snapshots],[{...snapshots[0],createdAt:'invalid'}],[{...snapshots[0],entryCount:-1}],[{...snapshots[0],kind:'restore'}]])expect(()=>readSnapshots(v)).toThrow();
  expect(readSnapshots([])).toEqual([]);
});
test('analysis validates fields, exact row targets, duplicates and counts before rendering',()=>{
  const mutations=[(v:any)=>v.totals.ready++, (v:any)=>v.rules[0].target.spreadsheetId='other', (v:any)=>v.rules.push(v.rules[0]),
    (v:any)=>v.sheets.push(v.sheets[0]), (v:any)=>v.rules[0].plainValue={}, (v:any)=>delete v.rules[0].target.key,
    (v:any)=>v.spreadsheet.url='https://user:password@example.test', (v:any)=>v.rules[0].status='unknown'];
  for(const mutate of mutations){const v=structuredClone(analysis);mutate(v);expect(()=>readAnalysis(v)).toThrow();}
});
test('preview validates language, complete rows, target, count and source link',()=>{
  const mutations=[(v:any)=>v.language='English', (v:any)=>v.items=[], (v:any)=>v.items[0].target.spreadsheetId='other',
    (v:any)=>v.items[0].source.url='data:text/html,x', (v:any)=>v.items[0].status='unchanged', (v:any)=>v.items[0].source.value=Infinity];
  for(const mutate of mutations){const v=structuredClone(preview);mutate(v);expect(()=>readPreview(v)).toThrow();}
});
