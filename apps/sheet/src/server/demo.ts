import type { AnalysisResult, ImportRangeRule } from '../shared/types.js';
import { stableId } from './parser.js';
import { spreadsheetUrl } from './config.js';

const spreadsheetId = '10ryam8K5qbNZ7EFjW1YjvOEzGbEf9uh5dR36daNQuog';

function rule(
  targetSheet: string,
  targetSheetId: number,
  targetCell: string,
  key: string,
  language: string,
  sourceSpreadsheetId: string,
  sourceSheet: string,
  sourceCell: string,
  value: string,
): ImportRangeRule {
  const sourceUrl = `https://docs.google.com/spreadsheets/d/${sourceSpreadsheetId}/edit`;
  const formula = `=IMPORTRANGE("${sourceUrl}", "${sourceSheet}!${sourceCell}")`;
  return {
    id: stableId(spreadsheetId, targetSheet, targetCell, formula),
    target: {
      spreadsheetId,
      sheetId: targetSheetId,
      sheetTitle: targetSheet,
      cell: targetCell,
      key,
      language,
    },
    source: {
      spreadsheetId: sourceSpreadsheetId,
      sheetTitle: sourceSheet,
      cell: sourceCell,
      url: sourceUrl,
    },
    formula,
    plainValue: value,
    formattedValue: value,
    status: 'ready',
  };
}

const playerInfo = '1vhzAf7kUFxG2q_IOqkrY_16CUkjSi7wB_tCJRZ5aTp0';
const traitInfo = '1irwTpBpzJmF_yZ_Z7zRu_LtPMXOedRZYuP3D71X1hsE';

export const demoAnalysis: AnalysisResult = {
  id: 'demo-3710-rules',
  createdAt: new Date().toISOString(),
  mode: 'demo',
  spreadsheet: {
    id: spreadsheetId,
    title: 'I2Loc 던전슬래셔 번역의 사본',
    url: spreadsheetUrl(spreadsheetId),
    locale: 'en_US',
    timeZone: 'America/Los_Angeles',
  },
  totals: {
    formulas: 3710,
    ready: 3710,
    blocked: 0,
    sourceSpreadsheets: 4,
    sourceSheets: 19,
  },
  sheets: [
    { sheetId: 44412869, title: 'Common', rowCount: 15, columnCount: 7, formulaCount: 0, blockerCount: 0 },
    { sheetId: 0, title: 'Default', rowCount: 2876, columnCount: 7, formulaCount: 3142, blockerCount: 0 },
    { sheetId: 1956151388, title: '인앱결제', rowCount: 998, columnCount: 7, formulaCount: 0, blockerCount: 0 },
    { sheetId: 1886771645, title: 'Mission', rowCount: 1040, columnCount: 7, formulaCount: 0, blockerCount: 0 },
    { sheetId: 151567196, title: 'Tutorial', rowCount: 1034, columnCount: 7, formulaCount: 0, blockerCount: 0 },
    { sheetId: 518098319, title: 'Cartoon', rowCount: 36, columnCount: 7, formulaCount: 0, blockerCount: 0 },
    { sheetId: 1281119602, title: 'SinStat', rowCount: 41, columnCount: 7, formulaCount: 33, blockerCount: 0 },
    { sheetId: 1759027638, title: 'Trait', rowCount: 109, columnCount: 7, formulaCount: 535, blockerCount: 0 },
    { sheetId: 674310663, title: 'Pass', rowCount: 19, columnCount: 7, formulaCount: 0, blockerCount: 0 },
  ],
  rules: [
    rule('Default', 0, 'B1576', 'SummonerSkinName0', 'Korean', playerInfo, '#소환술사', 'D31', '소환술사'),
    rule('Default', 0, 'B1577', 'SummonerSkinName1', 'Korean', playerInfo, '#소환술사', 'D32', '괴도 코발트'),
    rule('Default', 0, 'B1578', 'SummonerSkinName2', 'Korean', playerInfo, '#소환술사', 'D33', '이상한 던전의 소환술사'),
    rule('Default', 0, 'B1579', 'SummonerSkinName3', 'Korean', playerInfo, '#소환술사', 'D34', '휴양지 소환술사'),
    rule('Default', 0, 'B1580', 'SummonerSkinName4', 'Korean', playerInfo, '#소환술사', 'D35', '탐욕'),
    rule('SinStat', 1281119602, 'B6', 'SinStat0', 'Korean', playerInfo, 'SinStat', 'B3', '죄악 수치'),
    rule('Trait', 1759027638, 'B3', 'TraitBerserker1', 'Korean', traitInfo, '#Trait 번역', 'C3', '광전사 특성'),
    rule('Trait', 1759027638, 'C3', 'TraitBerserker1', 'English', traitInfo, '#Trait 번역', 'D3', 'Berserker Trait'),
  ],
};
