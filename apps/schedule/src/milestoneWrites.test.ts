import {describe,expect,it} from 'vitest';
import {captureMilestoneWrite,confirmMilestoneReceipt,milestoneBody,milestoneSnapshot,milestoneWriteBaseline} from './milestoneWrites';
import type {Bootstrap,MilestonePage} from './types';

const token=(c:string)=>c.repeat(64);
const me={id:1,name:'관리자',department:'개발',departmentId:1,projectIds:[10],role:'admin',active:true,shared:false,access:true,isAdmin:true};
const boot={me,employees:[me],projects:[{id:10,name:'게임',color:'#123456',archived:false,version:1}],departments:[],leads:[],demo:false,csrfToken:'test'} as Bootstrap;
const row={id:7,type:'review' as const,title:'검수',description:'준비',date:'2026-09-18',projectId:10,version:2};
const page={items:[row],editing:{actorId:'1',createStateToken:token('a'),milestones:[{id:7,stateToken:token('b')}]}} as MilestonePage;

describe('주요 일정 공통 저장 계약',()=>{
  it('생성·수정·삭제가 정확한 계정과 서버 기준을 캡처한다',()=>{
    const create=captureMilestoneWrite('create',{...row,id:undefined,version:0,title:' 새 일정 ',description:' 내용 '},undefined,boot,page);expect(create.body).toMatchObject({title:'새 일정',description:'내용',version:0});expect(create.stateToken).toBe(token('a'));
    const update=captureMilestoneWrite('update',{...row,title:'수정'},row,boot,page);expect(update.targetId).toBe(7);expect(update.stateToken).toBe(token('b'));
    const remove=captureMilestoneWrite('delete',row,row,boot,page);expect(remove.body).toEqual({version:2});
  });
  it('전체 저장 ACK만 확정하고 축약·변조 응답은 거부한다',()=>{
    const write=captureMilestoneWrite('update',{...row,title:'수정'},row,boot,page),saved={...row,title:'수정',version:3};
    const receipt={operation:'update',actorId:'1',previousStateToken:token('b'),stateToken:token('c'),milestone:saved,deleted:false};expect(confirmMilestoneReceipt(receipt,write,write.body).milestone).toEqual(saved);
    for(const changed of [{...receipt,actorId:'2'},{...receipt,stateToken:token('b')},{...receipt,deleted:true},{...receipt,milestone:{...saved,title:'변조'}}])expect(()=>confirmMilestoneReceipt(changed,write,write.body)).toThrow();
    expect(()=>confirmMilestoneReceipt(receipt,write,{...write.body,title:'다른 전송'})).toThrow();
  });
  it('형식과 권한·기준 누락을 fail closed 한다',()=>{
    expect(milestoneSnapshot(row)).toEqual(row);expect(milestoneBody({...row,title:'  검수  '})).toMatchObject({title:'검수'});expect(milestoneWriteBaseline(page,'1',7)).toBe(token('b'));
    for(const value of [{...row,date:'2026-02-30'},{...row,version:0},{...row,type:'bad'}])expect(()=>milestoneSnapshot(value)).toThrow();
    expect(captureMilestoneWrite('create',{...row,id:undefined,version:0},undefined,{...boot,me:{...me,isAdmin:false,role:'employee'}},page).actorId).toBe('1');
    expect(()=>captureMilestoneWrite('delete',row,row,{...boot,me:{...me,isAdmin:false,role:'employee'}},page)).toThrow();
    expect(()=>captureMilestoneWrite('create',{...row,id:undefined,version:0},undefined,{...boot,me:{...me,shared:true}},page)).toThrow();
    expect(()=>milestoneWriteBaseline(page,'2')).toThrow();
  });
  it('기존 기간을 타입별 단일 마감일로 변환하고 전체 저장 결과와 대조한다',()=>{
    const additionalSchedules=[{type:'prototype' as const,date:'2026-10-10',endDate:null,memo:' 신캐릭터 마감 '},{type:'review' as const,date:'2026-10-20',endDate:'2026-10-22',memo:'신스킨 마감'}];
    const draft={...row,date:'2026-10-30',type:'update' as const,deadlineMemo:' 업데이트 마감 ',additionalSchedules};
    const write=captureMilestoneWrite('update',draft,row,boot,page);
    const deadlines=[{type:'prototype' as const,date:'2026-10-10',endDate:null,memo:'신캐릭터 마감'},{type:'review' as const,date:'2026-10-22',endDate:null,memo:'신스킨 마감'}];
    expect(write.body).toMatchObject({date:'2026-10-30',endDate:null,deadlineMemo:'업데이트 마감',additionalSchedules:deadlines});
    const saved={...draft,deadlineMemo:'업데이트 마감',additionalSchedules:deadlines,endDate:null,version:3};
    const receipt={operation:'update' as const,actorId:'1',previousStateToken:token('b'),stateToken:token('c'),milestone:saved,deleted:false};
    expect(confirmMilestoneReceipt(receipt,write,write.body).milestone.additionalSchedules).toEqual(deadlines);
    expect(()=>confirmMilestoneReceipt({...receipt,milestone:{...saved,additionalSchedules:additionalSchedules.slice(0,1)}},write,write.body)).toThrow();
    for(const invalid of [[{type:'review',date:'2026-10-22',endDate:'2026-10-20'}],[{type:'bad',date:'2026-10-10'}],[{type:'review',date:'2026-10-22',memo:'x'.repeat(201)}]])
      expect(()=>milestoneBody({...draft,additionalSchedules:invalid as typeof additionalSchedules})).toThrow();
  });
});
