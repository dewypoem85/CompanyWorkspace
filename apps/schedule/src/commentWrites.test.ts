import {describe,expect,test} from 'vitest';
import {captureCommentWrite,commentWriteBaseline,confirmCommentReceipt} from './commentWrites';
import type {Attachment,Bootstrap,Comment,Detail} from './types';

const stamp='2026-09-12T00:00:00Z',root='a'.repeat(64),commentState='b'.repeat(64),savedState='c'.repeat(64);
const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};
const boot:Bootstrap={me,employees:[me],projects:[],departments:[],leads:[],demo:false,csrfToken:'token'};
const comment:Comment={id:7,taskId:101,authorId:1,parentId:null,body:'원본',deleted:false,version:1,createdAt:stamp,editedAt:null};
const image:Attachment={id:'image',ownerId:1,taskId:101,commentId:7,name:'첨부.png',contentType:'image/png',size:3,createdAt:stamp};
const detail:Detail={task:{id:101,title:'업무',body:'',assigneeId:1,createdBy:1,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:stamp,updatedAt:stamp},canEdit:true,comments:[comment],attachments:[image],history:[],commentEditing:{actorId:'1',createStateToken:root,comments:[{id:7,stateToken:commentState}]}};

describe('comment write contract',()=>{
  test('captures root, reply and update writes without parsing large integer text',()=>{
    const create=captureCommentWrite({body:'새 댓글 9223372036854775807',images:[],version:0},detail,boot);expect(create.kind).toBe('create');expect(create.stateToken).toBe(root);expect(create.body.body).toContain('9223372036854775807');
    const reply=captureCommentWrite({body:'답글',images:[],version:0},detail,boot,undefined,7);expect(reply.kind).toBe('reply');expect(reply.targetId).toBe(7);expect(reply.stateToken).toBe(commentState);expect(reply.body.parentId).toBe(7);
    const update=captureCommentWrite({body:'수정',images:[image],version:1},detail,boot,comment);expect(update.kind).toBe('update');expect(update.before?.body).toBe('원본');expect(update.body.attachmentIds).toEqual(['image']);
  });

  test('requires server-issued actor and every comment baseline',()=>{
    expect(commentWriteBaseline(detail,'1')).toBe(root);expect(commentWriteBaseline(detail,'1',7)).toBe(commentState);
    expect(()=>commentWriteBaseline({...detail,commentEditing:undefined},'1')).toThrow(/저장 기준/);
    expect(()=>commentWriteBaseline({...detail,commentEditing:{...detail.commentEditing!,actorId:'2'}},'1',7)).toThrow(/저장 기준/);
    expect(()=>captureCommentWrite({body:'답글',images:[],version:0},detail,boot,undefined,999)).toThrow(/답글 대상/);
  });

  test('accepts only a full update acknowledgement and attachment set',()=>{
    const draft={body:'  수정  ',images:[image],version:1},write=captureCommentWrite(draft,detail,boot,comment);
    const savedComment={...comment,body:'수정',version:2,editedAt:'2026-09-12T00:01:00Z'},savedImage={...image};
    const receipt={operation:'update',actorId:'1',previousStateToken:commentState,stateToken:savedState,comment:savedComment,attachments:[savedImage]};
    expect(confirmCommentReceipt(receipt,write,write.body).comment.version).toBe(2);
    expect(()=>confirmCommentReceipt({...receipt,attachments:[]},write,write.body)).toThrow();
    expect(()=>confirmCommentReceipt(receipt,write,{...write.body,body:'다른 전송'})).toThrow();
    expect(()=>confirmCommentReceipt({...receipt,comment:{...savedComment,body:'다른 저장'}},write,write.body)).toThrow();
  });

  test('rejects unavailable actors, empty drafts and stale edits',()=>{
    expect(()=>captureCommentWrite({body:'댓글',images:[],version:0},detail,{...boot,me:{...me,shared:true}})).toThrow(/현재 계정/);
    expect(()=>captureCommentWrite({body:' ',images:[],version:0},detail,boot)).toThrow(/댓글 또는 이미지/);
    expect(()=>captureCommentWrite({body:'수정',images:[image],version:0},detail,boot,comment)).toThrow(/버전/);
  });
});
