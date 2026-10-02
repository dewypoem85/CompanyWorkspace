import {describe,it,expect} from 'vitest';
import {confirmTodoResult,validateTodoList,requireTodoActor,todoSignature} from './personalTodoContract';
import type {Employee,PersonalTodo} from './types';
const item:PersonalTodo={id:7,ownerId:2,title:'개인 할 일 9007199254740993',sortOrder:1,version:3,completedAt:null,createdAt:'2026-09-10T00:00:00',updatedAt:'2026-09-10T00:00:00Z'};
describe('TODO 응답 계약',()=>{
  it('소유자·식별자·버전·문자열·날짜와 중복 목록을 검사한다',()=>{
    expect(validateTodoList([item],2)).toEqual([item]);
    for(const patch of [{ownerId:3},{id:Number.MAX_SAFE_INTEGER+1},{version:0},{title:''},{completedAt:'bad'},{updatedAt:null},{sortOrder:NaN}])expect(()=>validateTodoList([{...item,...patch}],2)).toThrow();
    expect(()=>validateTodoList([item,item],2)).toThrow();expect(()=>validateTodoList({},2)).toThrow();
  });
  it('추가·수정 응답은 검토한 원문 및 증가한 버전을 보존한다',()=>{
    const saved={...item,title:'수정 원문 9223372036854775807',version:4};
    expect(confirmTodoResult(saved,{kind:'save',item,title:saved.title},2)).toEqual(saved);
    for(const patch of [{id:8},{title:'rounded'},{version:3},{createdAt:'2026-09-11T00:00:00Z'},{completedAt:'2026-09-10T02:00:00Z'}])expect(()=>confirmTodoResult({...saved,...patch},{kind:'save',item,title:saved.title},2)).toThrow();
    expect(confirmTodoResult({...item,version:1},{kind:'add',title:item.title},2)).toMatchObject({version:1});
    expect(()=>confirmTodoResult(item,{kind:'add',title:item.title},2)).toThrow();
  });
  it('완료·되돌리기 응답은 제목과 완료 상태를 검증한다',()=>{
    const completed={...item,completedAt:'2026-09-10T01:00:00Z',version:4};
    expect(confirmTodoResult(completed,{kind:'complete',item,completed:true},2)).toEqual(completed);
    expect(()=>confirmTodoResult({...completed,title:'다른 제목'},{kind:'complete',item,completed:true},2)).toThrow();
    expect(confirmTodoResult({...completed,completedAt:null,version:5},{kind:'complete',item:completed,completed:false},2)).toMatchObject({completedAt:null});
  });
  it('삭제·정렬은 기존 204 계약만 완료로 인정한다',()=>{
    for(const command of [{kind:'delete' as const,item},{kind:'order' as const,ids:[7],archived:false}]){
      expect(confirmTodoResult(undefined,command,2)).toBeUndefined();
      for(const value of [null,{},[],{success:true}])expect(()=>confirmTodoResult(value,command,2)).toThrow();
    }
  });
  it('정렬 변경은 편집 기준을 바꾸지 않지만 내용·완료·버전 변경은 구분한다',()=>{
    expect(todoSignature({...item,sortOrder:99})).toBe(todoSignature(item));
    expect(todoSignature({...item,version:4})).not.toBe(todoSignature(item));
  });
  it('공용·비활성·접근 권한 없음은 클라이언트에서도 실행을 막는다',()=>{
    const me={id:2,active:true,access:true,shared:false} as Employee;
    expect(()=>requireTodoActor(me)).not.toThrow();
    for(const patch of [{shared:true},{active:false},{access:false}])expect(()=>requireTodoActor({...me,...patch})).toThrow();
  });
});
