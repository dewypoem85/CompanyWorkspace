import type {AnalysisResult, KoreanSyncPreview, RuntimeConfig} from '../shared/types';
export const config: RuntimeConfig = {mode:'demo', writesEnabled:false, actorId:'employee-1', defaultSpreadsheetId:'sheet', defaultSpreadsheetUrl:'https://example.test/sheet'};
export const analysis: AnalysisResult = {
  id:'analysis', createdAt:'2026-09-10T00:00:00Z', mode:'demo', spreadsheet:{id:'sheet', title:'Sheet', url:config.defaultSpreadsheetUrl},
  totals:{formulas:1, ready:1, blocked:0, sourceSpreadsheets:1, sourceSheets:1},
  sheets:[{sheetId:0,title:'Target',rowCount:3,columnCount:2,formulaCount:1,blockerCount:0}],
  rules:[{id:'rule', target:{spreadsheetId:'sheet',sheetId:0,sheetTitle:'Target',cell:'B2',key:'Key',language:'Korean'},
    source:{spreadsheetId:'source',sheetTitle:'Source',cell:'A1',url:'https://example.test/source'},
    formula:'=IMPORTRANGE("source","Source!A1")',plainValue:'9007199254740993',formattedValue:'9007199254740993',status:'ready'}],
};
export const preview: KoreanSyncPreview = {id:'preview',createdAt:analysis.createdAt,target:analysis.spreadsheet,language:'Korean',
  totals:{tracked:1,changed:1,unchanged:0,sourceSpreadsheets:1,sourceSheets:1},items:[{ruleId:'rule',key:'Key',status:'changed',
    source:{...analysis.rules[0].source,value:'new'},target:{spreadsheetId:'sheet',sheetTitle:'Target',cell:'B2',currentValue:'old'}}]};
export const snapshots = [{id:'snapshot',kind:'migration' as const,createdAt:analysis.createdAt,spreadsheetId:'sheet',spreadsheetTitle:'Sheet',analysisId:'analysis',entryCount:1}];
