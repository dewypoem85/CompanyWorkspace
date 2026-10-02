import { describe, expect, it } from 'vitest';
import { parseImportRange, stableId } from './parser.js';

describe('parseImportRange', () => {
  it('parses the real Summoner example', () => {
    const result = parseImportRange(
      '=IMPORTRANGE("https://docs.google.com/spreadsheets/d/1vhzAf7kUFxG2q_IOqkrY_16CUkjSi7wB_tCJRZ5aTp0/edit#gid=1956537927", "#소환술사!D33")',
    );

    expect(result).toEqual({
      sourceUrl:
        'https://docs.google.com/spreadsheets/d/1vhzAf7kUFxG2q_IOqkrY_16CUkjSi7wB_tCJRZ5aTp0/edit#gid=1956537927',
      sourceSpreadsheetId: '1vhzAf7kUFxG2q_IOqkrY_16CUkjSi7wB_tCJRZ5aTp0',
      sourceSheetTitle: '#소환술사',
      sourceCell: 'D33',
    });
  });

  it('rejects ranges and wrapped formulas', () => {
    expect(parseImportRange('=IMPORTRANGE("https://docs.google.com/spreadsheets/d/abc12345678901234567/edit", "Tab!A1:A2")')).toBeNull();
    expect(parseImportRange('=IFERROR(IMPORTRANGE("x", "Tab!A1"), "")')).toBeNull();
  });

  it('creates stable ids', () => {
    expect(stableId('a', 'b')).toBe(stableId('a', 'b'));
    expect(stableId('a', 'b')).not.toBe(stableId('a', 'c'));
  });
});
