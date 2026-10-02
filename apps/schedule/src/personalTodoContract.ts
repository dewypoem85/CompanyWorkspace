import type {Employee, PersonalTodo} from './types';

export type TodoCommand = {kind:'add'; title:string} | {kind:'save'; item:PersonalTodo; title:string}
  | {kind:'complete'; item:PersonalTodo; completed:boolean} | {kind:'delete'; item:PersonalTodo}
  | {kind:'order'; ids:number[]; archived:boolean};
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export const todoActorScope=(me:Employee)=>JSON.stringify([me.id,me.role,me.active,me.access,me.shared]);
export function requireTodoActor(me:Employee) {
  if(!positive(me.id)||!me.active||!me.access||me.shared)throw Error('현재 계정으로 개인 TODO를 사용할 수 없습니다.');
}
export function validateTodo(value:unknown,ownerId:number):PersonalTodo {
  const item=value as PersonalTodo;
  if(!item||!positive(item.id)||item.ownerId!==ownerId||typeof item.title!=='string'||!item.title.trim()||item.title.length>500
    ||!positive(item.version)||!Number.isSafeInteger(item.sortOrder)||item.sortOrder<0
    ||!date(item.createdAt)||!date(item.updatedAt)||(item.completedAt!==null&&!date(item.completedAt)))
    throw Error('개인 TODO 확인 응답이 올바르지 않습니다.');
  return {...item};
}
export function validateTodoList(value:unknown,ownerId:number):PersonalTodo[] {
  if(!Array.isArray(value))throw Error('개인 TODO 목록 응답이 올바르지 않습니다.');
  const items=value.map(item=>validateTodo(item,ownerId));
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('중복된 개인 TODO 응답입니다.');
  return items;
}
export const todoSignature=(item:PersonalTodo)=>JSON.stringify([item.id,item.ownerId,item.title,item.version,item.completedAt,item.createdAt]);
export function confirmTodoResult(result:unknown,command:TodoCommand,ownerId:number):PersonalTodo|undefined {
  if(command.kind==='delete'||command.kind==='order') {
    if(result!==undefined)throw Error('TODO 완료 응답이 올바르지 않습니다.');
    return;
  }
  const saved=validateTodo(result,ownerId);
  if(command.kind==='add') {
    if(saved.title!==command.title||saved.completedAt!==null||saved.version!==1)throw Error('추가한 TODO의 확인 응답이 일치하지 않습니다.');
  }else {
    const before=command.item;
    if(saved.id!==before.id||saved.createdAt!==before.createdAt||saved.version!==before.version+1
      ||saved.title!==(command.kind==='save'?command.title:before.title)
      ||(command.kind==='save'&&saved.completedAt!==before.completedAt)
      ||(command.kind==='complete'&&(command.completed ? saved.completedAt===null||(before.completedAt!==null&&saved.completedAt!==before.completedAt) : saved.completedAt!==null)))
      throw Error('변경한 TODO의 대상·내용·버전 확인이 일치하지 않습니다.');
  }
  return saved;
}
