import {describe,it,expect} from 'vitest';
import {spreadsheetIdFromInput} from '../src/shared/sheet-reference';
describe('시트 주소 입력',()=>{
  it('전체 Google 시트 주소에서 문서 ID만 추출하고 탭 번호를 버린다',()=>{
    expect(spreadsheetIdFromInput(' https://docs.google.com/spreadsheets/d/abc_123-xyz/edit?gid=123#gid=123 ')).toBe('abc_123-xyz');
    expect(spreadsheetIdFromInput('https://docs.google.com/spreadsheets/u/0/d/abc_123-xyz/edit')).toBe('abc_123-xyz');
  });
  it('기존 ID 입력과 선택적 빈값은 유지한다',()=>{
    expect(spreadsheetIdFromInput(' abc_123-xyz ')).toBe('abc_123-xyz');expect(spreadsheetIdFromInput('  ')).toBeUndefined();
  });
  it.each(['https://example.com/spreadsheets/d/abc/edit','https://docs.google.com.evil.test/spreadsheets/d/abc/edit','https://user:password@docs.google.com/spreadsheets/d/abc/edit','http://docs.google.com/spreadsheets/d/abc/edit','https://docs.google.com/spreadsheets/d/e/abc/pubhtml','gid=0','문서 이름','https://docs.google.com/document/d/abc/edit'])('잘못된 문서 참조를 요청 전에 거부: %s',value=>{
    expect(()=>spreadsheetIdFromInput(value)).toThrow('Google 시트 주소 전체 또는 문서 ID');
  });
});
