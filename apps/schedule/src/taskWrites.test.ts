import {describe,it,expect} from 'vitest';
import {captureTaskWrite,confirmTaskReceipt,taskWriteBaseline,statusDraft,type TaskWrite} from './taskWrites';
import {taskSnapshot} from './taskReview';
import type {Bootstrap,Detail} from './types';
const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[10],role:'admin',active:true,shared:false,access:true,isAdmin:true};
const boot={me,csrfToken:'synthetic',demo:false,employees:[me],projects:[],departments:[],leads:[]} as Bootstrap;
const detail:Detail={task:{id:5,title:'업무',body:'9223372036854775807',assigneeId:1,createdBy:2,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:2,createdAt:'2026-01-01T00:00:00',updatedAt:'2026-01-02T00:00:00'},canEdit:true,comments:[],history:[],attachments:[{id:'a',name:'사진',size:68,contentType:'image/png',taskId:5,commentId:null,ownerId:1,createdAt:'2026-01-01T00:00:00'}],editing:{actorId:'1',stateToken:'a'.repeat(64)}};
function receipt(write:TaskWrite){return {operation:write.kind,actorId:'1',previousStateToken:write.stateToken,stateToken:'b'.repeat(64),task:{...detail.task,...write.draft.form,title:write.draft.form.title.trim(),body:write.draft.form.body.trim(),version:write.draft.form.version+1,createdBy:write.kind==='create'?1:2,updatedAt:'2026-01-03T00:00:00'},attachments:write.draft.images.map(a=>({...a,taskId:5,commentId:null,ownerId:a.ownerId??1,createdAt:a.createdAt??'2026-01-01T00:00:00'})),navigateTo:'/tasks/5'};}
describe('task write domain contract',()=>{
  it('validates full update receipt, exact request and retained original strings',()=>{
    const draft=taskSnapshot(detail);draft.form.title=' 수정 ';const write=captureTaskWrite('update',draft,boot,detail);
    const ack=receipt(write);expect(confirmTaskReceipt(ack,write,write.body)).toBe(ack);expect(write.body.body).toBe('9223372036854775807');
    draft.form.title='later';expect(write.draft.form.title).toBe(' 수정 ');
  });
  it('validates creation and status without treating untouched fields as optional',()=>{
    const draft=taskSnapshot(detail);draft.form.version=0;draft.images=[];
    const creation=captureTaskWrite('create',draft,boot);expect(confirmTaskReceipt(receipt(creation),creation,creation.body).task.createdBy).toBe(1);
    const write=captureTaskWrite('status',statusDraft(detail,'done'),boot,detail);
    expect(write.body).toEqual({status:'done',version:2});expect(confirmTaskReceipt(receipt(write),write,write.body).task.status).toBe('done');
  });
  it('requires editing owner/token and refuses stale, archived or unauthorized baselines',()=>{
    for(const value of [{...detail,editing:undefined},{...detail,editing:{actorId:'2',stateToken:'a'.repeat(64)}},{...detail,editing:{actorId:'1',stateToken:'bad'}}])expect(()=>taskWriteBaseline(value,'1')).toThrow();
    for(const value of [{...detail,canEdit:false},{...detail,task:{...detail.task,archived:true}},{...detail,task:{...detail.task,version:3}}])expect(()=>captureTaskWrite('update',taskSnapshot(detail),boot,value)).toThrow();
  });
  it('rejects missing or wrong identity, intent, original metadata and any edited field',()=>{
    const write=captureTaskWrite('update',taskSnapshot(detail),boot,detail),base=receipt(write);
    for(const mutate of [
      (x:any)=>x.actorId='2',(x:any)=>x.operation='create',(x:any)=>x.previousStateToken='c'.repeat(64),(x:any)=>x.stateToken=write.stateToken,(x:any)=>x.navigateTo='/tasks/9',
      (x:any)=>x.task.id=9,(x:any)=>x.task.version=2,(x:any)=>x.task.createdBy=1,(x:any)=>x.task.createdAt='2026-01-02T00:00:00',
      (x:any)=>x.task.updatedAt='2025-01-01T00:00:00',(x:any)=>x.task.archived=true,
      (x:any)=>x.task.title='wrong',(x:any)=>x.task.body='rounded',(x:any)=>x.task.assigneeId=2,(x:any)=>x.task.projectId=10,
      (x:any)=>x.task.startDate='2026-01-01',(x:any)=>delete x.task.endDate,
      (x:any)=>x.task.status='done',(x:any)=>x.attachments=[],(x:any)=>x.attachments.push({...x.attachments[0]}),
      (x:any)=>x.attachments[0].taskId=99,(x:any)=>x.attachments[0].commentId=7,(x:any)=>x.attachments[0].ownerId=2,
      (x:any)=>x.attachments[0].name='wrong',(x:any)=>x.attachments[0].size=0,(x:any)=>x.attachments[0].contentType='text/plain',
      (x:any)=>x.attachments[0].createdAt='2026-01-05T00:00:00'
    ]){const changed=structuredClone(base);mutate(changed);expect(()=>confirmTaskReceipt(changed,write,write.body)).toThrow();}
    expect(()=>confirmTaskReceipt(base,write,{...write.body,title:'different'})).toThrow();
  });
  it('allows SQLite UTC suffix differences but not different original timestamps',()=>{
    const write=captureTaskWrite('update',taskSnapshot(detail),boot,detail),ack=receipt(write);
    ack.task.createdAt+='Z';ack.attachments[0].createdAt+='Z';expect(()=>confirmTaskReceipt(ack,write,write.body)).not.toThrow();
    ack.task.updatedAt=write.before!.task.updatedAt+'Z';expect(()=>confirmTaskReceipt(ack,write,write.body)).not.toThrow();
    ack.task.updatedAt='2026-01-01T23:59:59Z';expect(()=>confirmTaskReceipt(ack,write,write.body)).toThrow();
  });
});
