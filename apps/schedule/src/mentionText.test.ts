import { describe,it,expect } from 'vitest';
import { editMentionText,insertMentionText,parseMentionText } from './mentionText';
describe('멘션은 이름이 아닌 위치와 ID로 보존',()=>{
  it('같은 표시 이름의 기존 직원 두 명을 서로 바꾸지 않는다',()=>{
    const value='@[동료](11) / @[동료](22)';
    expect(editMentionText(value,'@동료 / @동료!')).toBe(value+'!');
    expect(editMentionText(value,'메모 @동료 / @동료')).toBe('메모 '+value);
  });
  it('수동 입력한 동명이인 문자열을 기존 멘션으로 변환하지 않는다',()=>{
    expect(editMentionText('@[동료](11)','@동료 @동료')).toBe('@[동료](11) @동료');
    expect(editMentionText('@[동료](11)','@동료2')).toBe('@[동료](11)2');
  });
  it('동일한 글자의 앞쪽 멘션 삭제는 실제 선택 범위를 따른다',()=>{
    const value='@[동료](11)@[동료](22)';
    expect(editMentionText(value,'@동료',{start:0,end:3,type:'deleteContentBackward'})).toBe('@[동료](22)');
    expect(editMentionText(value,'@동료',{start:3,end:6,type:'deleteContentBackward'})).toBe('@[동료](11)');
  });
  it('멘션 내부 편집 시 해당 ID만 해제하고 다른 멘션은 보존한다',()=>{
    expect(editMentionText('@[동료](11) @[동료](22)','@동X료 @동료',{start:2,end:2,type:'insertText'})).toBe('@동X료 @[동료](22)');
    expect(editMentionText('@[동료](11) @[동료](22)','@동 @동료',{start:3,end:3,type:'deleteContentBackward'})).toBe('@동 @[동료](22)');
  });
  it('명시적으로 고른 직원만 토큰을 추가하고 커서를 복원한다',()=>{
    const result=insertMentionText('@[동료](11) @ㄱ',4,6,'김직원',22);
    expect(result.value).toBe('@[동료](11) @[김직원](22) ');expect(result.caret).toBe(9);
    expect(parseMentionText(result.value).text).toBe('@동료 @김직원 ');
  });
  it('멘션 삭제·일반 텍스트·줄바꿈·이모지를 보존한다',()=>{
    expect(editMentionText('😀 @[동료](11)\n메모','😀 \n메모')).toBe('😀 \n메모');
    expect(parseMentionText('일반 @동료\n@[다른 이름](2)').text).toBe('일반 @동료\n@다른 이름');
  });
  it('잘못된 새 ID와 토큰 경계 문자를 안전하게 처리한다',()=>{
    expect(()=>insertMentionText('',0,0,'동료',0)).toThrow();
    const result=insertMentionText('',0,0,'잘못]된\n이름',12);
    expect(result.value).toBe('@[잘못 된 이름](12) ');
  });
});
