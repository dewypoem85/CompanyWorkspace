import { describe, expect, it } from 'vitest';
import { applyTaskReview, taskReviewItem, taskSnapshot, taskValues, type TaskSnapshot } from './taskReview';
import type { Bootstrap, Detail } from './types';
const boot: Bootstrap = {me:{id:1,name:'관리자',department:'개발',departmentId:1,projectIds:[10],role:'admin',active:true,shared:false,access:true,isAdmin:true},employees:[],projects:[{id:10,name:'프로젝트',color:'',archived:false,version:1}],departments:[],leads:[],demo:false,csrfToken:''};
boot.employees=[boot.me,{...boot.me,id:2,name:'같은 이름',isAdmin:false,role:'employee'}];
const detail: Detail = {task:{id:101,title:'원본',body:'@[같은 이름](2) 9007199254740993',assigneeId:1,createdBy:1,projectId:10,startDate:'2026-09-01',endDate:'2026-09-09',status:'planned',version:1,archived:false,createdAt:'',updatedAt:''},attachments:[],comments:[],history:[],canEdit:true};
const base=()=>taskSnapshot(structuredClone(detail));
describe('업무 초안의 공통 비교 연결',()=>{
  it('필드별 선택과 서버 버전, 멘션 ID 및 본문의 큰 정수를 보존한다',()=>{
    const before=base(),draft=base(),current=base();draft.form.title='내 제목';current.form.body+=' 서버';current.form.version=2;
    const item=taskReviewItem(101,before,draft,current,boot);
    expect(item.fields.find(f=>f.key==='assigneeId')?.entityKind).toBe('employee');
    const selected={id:'101',fields:{...taskValues(current),title:['내 제목']}};
    const result=applyTaskReview(selected,101,before,draft,current,boot);
    expect(result.form.title).toBe('내 제목');expect(result.form.body).toBe(detail.task.body+' 서버');expect(result.form.version).toBe(2);
    expect(before.form.version).toBe(1);expect(draft.form.body).toBe(detail.task.body);
  });
  it('날짜의 독립 병합으로 생긴 잘못된 조합을 거부한다',()=>{
    const before=base(),draft=base(),current=base();draft.form.startDate='2026-09-08';current.form.endDate='2026-09-05';
    const selected={id:'101',fields:{...taskValues(current),startDate:['2026-09-08']}};
    expect(()=>applyTaskReview(selected,101,before,draft,current,boot)).toThrow(/날짜 순서/);
    selected.fields.startDate=['2026-09-01'];expect(applyTaskReview(selected,101,before,draft,current,boot).form.endDate).toBe('2026-09-05');
  });
  it('서버 첨부와 새 업로드만 적용하며 서버에서 제거된 기존 첨부를 되살리지 않는다',()=>{
    const before=base(),draft=base(),current=base();
    before.images=[{id:'old',taskId:101,commentId:null,name:'원본.png',contentType:'image/png',size:1}];draft.images=[...before.images];
    current.images=[{...before.images[0],id:'remote',name:'서버.png'}];
    const selected={id:'101',fields:taskValues(draft)};
    expect(()=>applyTaskReview(selected,101,before,draft,current,boot)).toThrow(/제거된 첨부/);
    selected.fields.attachmentIds=['remote'];expect(applyTaskReview(selected,101,before,draft,current,boot).images[0].name).toBe('서버.png');
    draft.images=[{...before.images[0],id:'upload',taskId:null}];selected.fields.attachmentIds=['upload'];expect(applyTaskReview(selected,101,before,draft,current,boot).images[0].id).toBe('upload');
  });
  it('담당자/비공개 프로젝트/불완전 응답과 확인하지 않은 값을 거부한다',()=>{
    const before=base(),draft=base(),current=base(),selected={id:'101',fields:taskValues(current)};
    const denied=structuredClone(boot);denied.employees[0].role='master';expect(()=>applyTaskReview(selected,101,before,draft,current,denied)).toThrow(/담당자/);
    denied.employees[0].role='employee';denied.me.isAdmin=false;denied.projects[0].isPrivate=true;expect(()=>applyTaskReview(selected,101,before,draft,current,denied)).toThrow(/프로젝트/);
    selected.fields.title=['확인 안 함'];expect(()=>applyTaskReview(selected,101,before,draft,current,boot)).toThrow(/확인하지 않은/);
    expect(()=>taskSnapshot({...detail,task:{...detail.task,assigneeId:Number.MAX_SAFE_INTEGER+1}})).toThrow(/식별자/);
    expect(()=>taskValues({form:{...before.form,body:undefined},images:[]} as unknown as TaskSnapshot)).toThrow(/누락/);
  });
});
