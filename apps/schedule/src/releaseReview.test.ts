import {describe,it,expect} from 'vitest';
import {applyReleaseReview,canManageRelease,confirmReleaseSaved,currentRelease,releaseReviewItem,releaseSnapshot,releaseValues,validateReleaseDraft} from './releaseReview';
import type {Bootstrap,ReleaseRecord} from './types';
export const release:ReleaseRecord={id:70,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',releasedOnUnknown:false,sourceReference:'',notes:'원문 9223372036854775807',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:1,version:1,updatedAt:'2026-09-10T03:00:00Z'};
describe('release review and acknowledged save contract',()=>{
  it('retains exact text and requires a complete identity, status, date and version',()=>{
    expect(releaseSnapshot(release)).toEqual(release);
    for(const patch of [{id:0},{version:0},{createdBy:-1},{notes:null},{issue:undefined},{releasedOn:'2026-02-30'},{rollbackTargetId:undefined},{status:'invalid'},{updatedAt:''}])expect(()=>releaseSnapshot({...release,...patch})).toThrow();
  });
  it('refuses another project, number, creator, source or older snapshot',()=>{
    for(const patch of [{id:71},{projectId:11},{minor:1},{createdBy:2},{sourceReference:'changed'},{version:0}])expect(()=>currentRelease({...release,...patch},release)).toThrow();
  });
  it('applies only reviewed fields without saving or losing integer text',()=>{
    const draft={...release,notes:'내 변경 9223372036854775807'},current={...release,version:2,issue:'서버 메모'};
    const review=releaseReviewItem(release,draft,current,new Map());
    const selection={id:'70',fields:Object.fromEntries(review.fields.map(f=>[f.key,f.key==='notes'?f.draft:f.current]))};
    const result=applyReleaseReview(selection,release,draft,current,new Map());
    expect(result).toMatchObject({notes:draft.notes,issue:current.issue,version:2,id:70});
    expect(()=>applyReleaseReview({...selection,id:'71'},release,draft,current,new Map())).toThrow();
    expect(()=>applyReleaseReview({...selection,fields:{...selection.fields,notes:['unreviewed']}},release,draft,current,new Map())).toThrow();
  });
  it('keeps imported dates paired and cannot restore unknown after correction',()=>{
    const before={...release,releasedOnUnknown:true,sourceReference:'https://example.test/legacy'},current={...before,version:2,releasedOnUnknown:false};
    const chosen={id:'70',fields:releaseValues(before)};
    expect(()=>applyReleaseReview(chosen,before,before,current,new Map())).toThrow(/미기재/);
    expect(releaseReviewItem(before,before,current,new Map()).fields[0].format?.(['2026-09-10','unknown'])).toBe('출시일 미기재');
  });
  it('validates combined rollback, resolution and skipped status choices',()=>{
    const draft={...release,status:'rolled_back' as const,issue:'롤백 사유',rollbackTargetId:69};
    const lower={...release,id:69,baseVersion:769};validateReleaseDraft(draft,release,new Map([[69,lower]]));
    for(const target of [{...lower,baseVersion:771},{...lower,projectId:20}])expect(()=>validateReleaseDraft(draft,release,new Map([[69,target]]))).toThrow();
    expect(()=>validateReleaseDraft({...draft,status:'stable'},release)).toThrow();
    expect(()=>validateReleaseDraft({...release,status:'skipped',minor:1,issue:'이유'},release)).toThrow();
    expect(()=>validateReleaseDraft({...release,resolvedInId:72},release)).toThrow();
    const fixed={...release,id:72,minor:2};validateReleaseDraft({...release,issue:'해결',resolvedInId:72},release,new Map([[72,fixed]]));
    expect(()=>validateReleaseDraft({...release,issue:'해결',resolvedInId:72},release,new Map([[72,{...fixed,status:'unstable'}]]))).toThrow();
  });
  it('acknowledges exact normalized writes, never partial or unrelated responses',()=>{
    const draft={...release,notes:'  저장 원문 9223372036854775807  ',issue:' 메모 '},result={...draft,notes:draft.notes.trim(),issue:'메모',version:2};
    expect(confirmReleaseSaved(result,draft,release,2)).toEqual(result);
    for(const patch of [{id:71},{version:3},{notes:'changed'},{createdBy:2},{sourceReference:'changed'},{releasedOnUnknown:true}])expect(()=>confirmReleaseSaved({...result,...patch},draft,release,2)).toThrow();
    expect(()=>confirmReleaseSaved({success:true},draft,release,2)).toThrow();
    const {id,createdBy,updatedAt,...newDraft}=release;expect(confirmReleaseSaved({...release,id:80,createdBy:2},newDraft,undefined,2).id).toBe(80);
  });
  it('preserves manager and archived-project boundaries',()=>{
    const boot={me:{id:1,departmentId:2,isAdmin:false,active:true,access:true,shared:false},leads:[{employeeId:1,departmentId:2}],projects:[{id:10,archived:true}]} as Bootstrap;
    expect(canManageRelease(boot,10)).toBe(false);expect(canManageRelease(boot,10,true)).toBe(true);
    expect(canManageRelease({...boot,leads:[]},10,true)).toBe(false);expect(canManageRelease({...boot,projects:[]},10,true)).toBe(false);
  });
});
