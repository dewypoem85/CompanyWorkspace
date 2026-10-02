import {describe,it,expect} from 'vitest';
import {captureTaskAction,confirmTaskActionReceipt,confirmTaskActionResult,taskActionBaseline,taskActionSignature,taskActionTarget,verifyTaskActionRead} from './taskActions';
import type {Bootstrap,Detail,Employee} from './types';
const actor:Employee={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};
const taskState='a'.repeat(64),commentState='b'.repeat(64),nextState='c'.repeat(64);
const source:Detail={task:{id:101,title:'원본 업무',body:'9007199254740993',assigneeId:1,createdBy:1,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:'2026-09-10T00:00:00Z',updatedAt:'2026-09-10T00:00:00Z'},comments:[{id:7,taskId:101,authorId:1,parentId:null,body:'원본 댓글',deleted:false,version:2,createdAt:'2026-09-10T00:00:00Z',editedAt:null}],canEdit:true,attachments:[],history:[],editing:{actorId:'1',stateToken:taskState},commentEditing:{actorId:'1',createStateToken:'d'.repeat(64),comments:[{id:7,stateToken:commentState}]}};
const boot:Bootstrap={me:actor,employees:[actor],projects:[],departments:[],leads:[],demo:false,csrfToken:'test'};
describe('일정 보관/복원/댓글 삭제의 검토 계약',()=>{
  it('역할·업무 편집·작성자·보관 상태를 각 작업에 맞게 검증한다',()=>{
    expect(taskActionTarget('archive',101,source,actor).task.version).toBe(1);
    expect(()=>taskActionTarget('restore',101,{...source,task:{...source.task,archived:true}},actor)).toThrow(/관리자/);
    expect(taskActionTarget('restore',101,{...source,task:{...source.task,archived:true},canEdit:false},{...actor,isAdmin:true}).kind).toBe('restore');
    expect(()=>taskActionTarget('archive',101,{...source,canEdit:false},actor)).toThrow(/권한/);
    expect(taskActionTarget('delete-comment',101,{...source,canEdit:false},actor,7).comment?.id).toBe(7);
    expect(()=>taskActionTarget('delete-comment',101,source,{...actor,id:2},7)).toThrow(/작성자/);
    expect(taskActionTarget('delete-comment',101,source,{...actor,id:2,isAdmin:true},7).comment?.id).toBe(7);
    for(const patch of [{active:false},{access:false},{shared:true}])expect(()=>taskActionTarget('archive',101,source,{...actor,...patch})).toThrow(/계정/);
  });
  it('현재 계정과 업무·댓글별 opaque 기준을 정확히 캡처한다',()=>{
    expect(taskActionBaseline(source,'1','archive')).toBe(taskState);
    expect(taskActionBaseline(source,'1','delete-comment',7)).toBe(commentState);
    expect(captureTaskAction('archive',101,source,boot).body).toEqual({version:1});
    expect(captureTaskAction('delete-comment',101,source,boot,7).body).toEqual({version:2});
    expect(()=>taskActionBaseline({...source,editing:undefined},'1','archive')).toThrow(/기준/);
    expect(()=>taskActionBaseline({...source,commentEditing:{...source.commentEditing!,actorId:'2'}},'1','delete-comment',7)).toThrow(/계정/);
  });
  it('전체 보관·복원·댓글 삭제 ACK와 정확한 전송 본문만 승인한다',()=>{
    const archive=captureTaskAction('archive',101,source,boot);
    const task={...source.task,archived:true,version:2,updatedAt:'2026-09-10T01:00:00Z'};
    const receipt={operation:'archive' as const,actorId:'1',previousStateToken:taskState,stateToken:nextState,task,attachments:[],navigateTo:'/tasks/101'};
    expect(confirmTaskActionReceipt(receipt,archive,{version:1}).task).toEqual(task);
    expect(()=>confirmTaskActionReceipt({...receipt,previousStateToken:commentState},archive,{version:1})).toThrow(/응답/);
    expect(()=>confirmTaskActionReceipt(receipt,archive,{version:2})).toThrow(/응답/);
    const deletion=captureTaskAction('delete-comment',101,source,boot,7),comment={...source.comments[0],body:'',deleted:true,version:3,editedAt:'2026-09-10T01:00:00Z'};
    expect(confirmTaskActionReceipt({operation:'delete-comment',actorId:'1',previousStateToken:commentState,stateToken:nextState,comment,attachments:[]},deletion,{version:2}).comment).toEqual(comment);
    expect(()=>confirmTaskActionReceipt({operation:'delete-comment',actorId:'1',previousStateToken:commentState,stateToken:nextState,comment:{...comment,body:'남음'},attachments:[]},deletion,{version:2})).toThrow(/응답/);
  });
  it('검토한 값은 복사본이며 ID·버전·중복 댓글·삭제 상태를 검증한다',()=>{
    const detail=structuredClone(source),action=taskActionTarget('delete-comment',101,detail,actor,7),signature=taskActionSignature(action);
    detail.comments[0].body='새 댓글';expect(taskActionSignature(action)).toBe(signature);
    expect(taskActionSignature(taskActionTarget('delete-comment',101,detail,actor,7))).not.toBe(signature);
    for(const invalid of [{...source,task:{...source.task,id:102}},{...source,task:{...source.task,version:NaN}},{...source,comments:[...source.comments,...source.comments]},{...source,comments:[{...source.comments[0],deleted:true}]}])expect(()=>taskActionTarget('delete-comment',101,invalid,actor,7)).toThrow();
  });
  it('보관/복원 응답은 대상·새 버전·상태·원본 값이 일치해야 한다',()=>{
    const action=taskActionTarget('archive',101,source,actor),saved={...source.task,archived:true,version:2};
    expect(confirmTaskActionResult(saved,action)).toBe(saved);
    for(const patch of [{id:102},{version:1},{archived:false},{body:'변경된 본문'},{title:undefined},{updatedAt:'bad'}])expect(()=>confirmTaskActionResult({...saved,...patch},action)).toThrow(/완료 응답/);
    expect(()=>confirmTaskActionResult(null,action)).toThrow();
  });
  it('댓글 삭제의 기존 204만 확인하고 후속 조회는 이전 버전을 거부한다',()=>{
    const action=taskActionTarget('delete-comment',101,source,actor,7);
    expect(confirmTaskActionResult(undefined,action)).toBeUndefined();
    for(const value of [null,{}, {success:true}])expect(()=>confirmTaskActionResult(value,action)).toThrow(/완료 응답/);
    expect(()=>verifyTaskActionRead(source,action)).toThrow(/최신 댓글/);
    expect(()=>verifyTaskActionRead({...source,comments:[{...source.comments[0],deleted:true,version:3}]},action)).not.toThrow();
    for(const version of [NaN,Infinity,2])expect(()=>verifyTaskActionRead({...source,comments:[{...source.comments[0],deleted:true,version}]},action)).toThrow();
    const archived=taskActionTarget('archive',101,source,actor);
    expect(()=>verifyTaskActionRead({...source,task:{...source.task,version:2}},archived)).toThrow();
    expect(()=>verifyTaskActionRead({...source,task:{...source.task,version:2,archived:true}},archived)).not.toThrow();
    // A different explicit change after acknowledgement may already have restored it.
    expect(()=>verifyTaskActionRead({...source,task:{...source.task,version:3,archived:false}},archived)).not.toThrow();
  });
});
