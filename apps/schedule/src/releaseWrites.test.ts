import {describe,expect,it} from 'vitest';
import {captureReleaseDelete,captureReleaseWrite,confirmReleaseReceipt,releaseEditingResponse} from './releaseWrites';
import type {Bootstrap,ReleaseRecord} from './types';

const hash='a'.repeat(64),next='b'.repeat(64);
const boot={me:{id:2,name:'관리자',department:'개발',departmentId:1,projectIds:[10],role:'admin',active:true,shared:false,access:true,isAdmin:true},employees:[],projects:[{id:10,name:'게임',color:'#000',archived:false,version:1}],departments:[],leads:[],demo:false,csrfToken:'token'} as Bootstrap;
const record={id:70,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',releasedOnUnknown:false,notes:'패치',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:2,version:1,updatedAt:'2026-09-10T00:00:00Z'} as ReleaseRecord;

describe('release writes',()=>{
  it('validates create and update editing baselines',()=>{
    expect(releaseEditingResponse({actorId:'2',stateToken:hash,record:null},10)).toEqual({actorId:'2',stateToken:hash,record:null});
    expect(releaseEditingResponse({actorId:'2',stateToken:hash,record},10,70).record?.id).toBe(70);
    expect(()=>releaseEditingResponse({actorId:'2',stateToken:'bad',record:null},10)).toThrow();
    expect(()=>releaseEditingResponse({actorId:'2',stateToken:hash,record},10)).toThrow();
    expect(()=>releaseEditingResponse({actorId:'2',stateToken:hash,record:{...record,id:71}},10,70)).toThrow();
  });
  it('captures exact bodies and verifies complete receipts',()=>{
    const write=captureReleaseWrite({...record,notes:'수정'},record,boot,{actorId:'2',stateToken:hash,record});
    const saved={...record,notes:'수정',version:2,updatedAt:'2026-09-12T00:00:00Z'};
    const receipt={operation:'update',actorId:'2',previousStateToken:hash,stateToken:next,release:saved,deleted:false};
    expect(confirmReleaseReceipt(receipt,write,write.body).release).toEqual(saved);
    for(const bad of [{...receipt,actorId:'3'},{...receipt,stateToken:hash},{...receipt,release:{...saved,notes:'다름'}}])expect(()=>confirmReleaseReceipt(bad,write,write.body)).toThrow();
    expect(()=>confirmReleaseReceipt(receipt,write,{...write.body,notes:'다름'})).toThrow();
  });
  it('captures a new record without inventing an id',()=>{
    const {id,createdBy,updatedAt,...draft}=record;const write=captureReleaseWrite(draft,draft,boot,{actorId:'2',stateToken:hash,record:null});
    expect(write.kind).toBe('create');expect(write.body).toEqual(draft);expect(write.before).toBeUndefined();
  });
  it('captures an exact delete version and verifies the deleted record receipt',()=>{
    const write=captureReleaseDelete(record,boot,{actorId:'2',stateToken:hash,record});
    expect(write.kind).toBe('delete');expect(write.body).toEqual({version:1});expect(write.before).toEqual(record);
    const receipt={operation:'delete',actorId:'2',previousStateToken:hash,stateToken:next,release:record,deleted:true};
    expect(confirmReleaseReceipt(receipt,write,{version:1}).release).toEqual(record);
    for(const bad of [{...receipt,deleted:false},{...receipt,release:{...record,minor:1}},{...receipt,stateToken:hash}])expect(()=>confirmReleaseReceipt(bad,write,write.body)).toThrow();
    expect(()=>captureReleaseDelete(record,boot,{actorId:'2',stateToken:hash,record:{...record,version:2}})).toThrow(/수정/);
  });
});
