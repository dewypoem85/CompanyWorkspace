import {describe, expect, it} from 'vitest';
import {captureTodoWrite, confirmTodoReceipt, todoEditingResponse, todoWriteBody, todoWriteResource} from './personalTodoWrites';
import type {Bootstrap, PersonalTodo} from './types';

const tokenA='a'.repeat(64),tokenB='b'.repeat(64);
const me={id:2,name:'직원',department:'개발',departmentId:1,projectIds:[],role:'employee' as const,active:true,access:true,shared:false,isAdmin:false};
const boot={me,employees:[me],departments:[{id:1,name:'개발',archived:false}],projects:[],leads:[],csrfToken:'csrf',demo:false} as Bootstrap;
const item=(id:number,sortOrder=id):PersonalTodo=>({id,ownerId:2,title:`TODO ${id}`,sortOrder,version:1,completedAt:null,createdAt:'2026-09-10T00:00:00Z',updatedAt:'2026-09-10T00:00:00Z'});

describe('TODO 공통 저장 계약',()=>{
  it('편집 기준은 현재 actor, 토큰과 정확한 대상 또는 목록을 요구한다',()=>{
    const list={actorId:'2',stateToken:tokenA,todos:[item(1),item(2)]};
    expect(todoEditingResponse(list,2)).toEqual(list);
    expect(todoEditingResponse({...list,todos:[item(2)]},2,2).todos[0].id).toBe(2);
    for(const value of [{...list,actorId:'3'},{...list,stateToken:'bad'},{...list,todos:[{...item(1),ownerId:3}]}])expect(()=>todoEditingResponse(value,2)).toThrow();
    expect(()=>todoEditingResponse(list,2,1)).toThrow();
  });

  it('캡처는 화면과 서버 기준을 대조하고 전송 원문을 고정한다',()=>{
    const rows=[item(1),item(2)],editing={actorId:'2',stateToken:tokenA,todos:rows};
    const add=captureTodoWrite({kind:'add',title:'새 TODO'},boot,rows,editing);
    expect(add.body).toEqual({title:'새 TODO'});expect(add.actorScope).toContain('employee');
    const order=captureTodoWrite({kind:'order',ids:[2,1],archived:false},boot,rows,editing);
    expect(order.body).toEqual({ids:[2,1],archived:false});
    const target={...editing,todos:[rows[0]]};
    expect(captureTodoWrite({kind:'save',item:rows[0],title:'수정'},boot,rows,target).body).toEqual({title:'수정',version:1});
    expect(()=>captureTodoWrite({kind:'save',item:rows[0],title:'수정'},boot,[{...rows[0],version:2},rows[1]],target)).toThrow();
    expect(()=>captureTodoWrite({kind:'order',ids:[1,1],archived:false},boot,rows,editing)).toThrow();
    expect(()=>captureTodoWrite({kind:'add',title:' 앞 공백'},boot,rows,editing)).toThrow();
    expect(todoWriteResource({kind:'save',item:rows[0],title:'수정'},rows,2,false)).not.toBe(todoWriteResource({kind:'save',item:{...rows[0],version:2},title:'수정'},rows,2,false));
    expect(todoWriteResource({kind:'order',ids:[2,1],archived:false},rows,2,false)).not.toBe(todoWriteResource({kind:'order',ids:[2,1],archived:false},[rows[1],rows[0]],2,false));
  });

  it('전체 ACK는 operation, actor, 기준, 본문과 작업별 저장 결과를 모두 확인한다',()=>{
    const rows=[item(1),item(2)],listEditing={actorId:'2',stateToken:tokenA,todos:rows};
    const add=captureTodoWrite({kind:'add',title:'새 TODO'},boot,rows,listEditing);
    const created={...item(3,3),title:'새 TODO'};
    expect(confirmTodoReceipt({operation:'add',actorId:'2',previousStateToken:tokenA,stateToken:tokenB,todo:created,todos:null,deleted:false},add,todoWriteBody(add.command)).todo).toEqual(created);
    const order=captureTodoWrite({kind:'order',ids:[2,1],archived:false},boot,rows,listEditing),ordered=[item(2,1),item(1,2)];
    expect(confirmTodoReceipt({operation:'order',actorId:'2',previousStateToken:tokenA,stateToken:tokenB,todo:null,todos:ordered,deleted:false},order,order.body).todos?.map(x=>x.id)).toEqual([2,1]);
    const deleting=captureTodoWrite({kind:'delete',item:rows[0]},boot,rows,{...listEditing,todos:[rows[0]]});
    expect(confirmTodoReceipt({operation:'delete',actorId:'2',previousStateToken:tokenA,stateToken:tokenB,todo:rows[0],todos:[rows[1]],deleted:true},deleting,deleting.body).deleted).toBe(true);
    for(const patch of [{actorId:'3'},{previousStateToken:tokenB},{stateToken:tokenA},{operation:'save'},{deleted:false}]){
      expect(()=>confirmTodoReceipt({operation:'delete',actorId:'2',previousStateToken:tokenA,stateToken:tokenB,todo:rows[0],todos:[rows[1]],deleted:true,...patch},deleting,deleting.body)).toThrow();
    }
  });
});
