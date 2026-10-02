import {expect,test} from 'vitest';
import {milestoneCountdown,milestoneDateSummary,milestoneOccurrences} from './milestoneSchedules';
import type {Milestone} from './types';

test('각 날짜에 같은 주요 일정 게시글의 해당 타입만 표시한다',()=>{
  const milestone:Milestone={id:7,title:'신캐릭터&신스킨',description:'공유 내용',deadlineMemo:'업데이트 마감',projectId:10,version:1,type:'update',date:'2026-10-30',additionalSchedules:[{type:'prototype',date:'2026-10-10',memo:'신캐릭터 마감'},{type:'review',date:'2026-10-20',endDate:'2026-10-22',memo:'신스킨 마감'}]};
  expect(milestoneOccurrences([milestone],'2026-10-10').map(x=>x.schedule)).toEqual([{type:'prototype',date:'2026-10-10',memo:'신캐릭터 마감'}]);
  expect(milestoneOccurrences([milestone],'2026-10-20')).toEqual([]);
  expect(milestoneOccurrences([milestone],'2026-10-21')).toEqual([]);
  expect(milestoneOccurrences([milestone],'2026-10-22').map(x=>x.schedule.type)).toEqual(['review']);
  expect(milestoneOccurrences([milestone],'2026-10-30').map(x=>x.milestone.id)).toEqual([7]);
  expect(milestoneOccurrences([milestone],'2026-10-22')[0].schedule.memo).toBe('신스킨 마감');
  expect(milestoneDateSummary(milestone)).toBe('프로토타입 2026-10-10 · 신캐릭터 마감 · 검수 2026-10-22 · 신스킨 마감 · 업데이트 2026-10-30 · 업데이트 마감');
});

test('남은 실제 날짜와 평일을 각각 계산하고 주말은 평일에서 제외한다',()=>{
  expect(milestoneCountdown({type:'update',date:'2026-10-05'},'2026-10-02')).toEqual({state:'마감까지',calendar:'D-3',weekdays:'D-1'});
  expect(milestoneCountdown({type:'update',date:'2026-10-04'},'2026-10-02')).toEqual({state:'마감까지',calendar:'D-2',weekdays:'D-0'});
  expect(milestoneCountdown({type:'update',date:'2027-01-04'},'2026-12-31')).toEqual({state:'마감까지',calendar:'D-4',weekdays:'D-2'});
});

test('회사에 등록된 평일 공휴일만 근무일에서 빼고 과거 마감도 같은 기준으로 계산한다',()=>{
  const holidays=new Set(['2026-10-05','2026-10-04','2026-10-05']);
  expect(milestoneCountdown({type:'update',date:'2026-10-06'},'2026-10-02',holidays)).toEqual({state:'마감까지',calendar:'D-4',weekdays:'D-1'});
  expect(milestoneCountdown({type:'update',date:'2026-10-02'},'2026-10-06',holidays)).toEqual({state:'마감 후',calendar:'D+4',weekdays:'D+1'});
});

test('기존 기간 데이터는 마지막 날만 마감일로 표시한다',()=>{
  const schedule={type:'review' as const,date:'2026-10-02',endDate:'2026-10-07'};
  expect(milestoneCountdown(schedule,'2026-10-05')).toEqual({state:'마감까지',calendar:'D-2',weekdays:'D-2'});
  expect(milestoneCountdown(schedule,'2026-10-07')).toEqual({state:'오늘 마감',calendar:'D-0',weekdays:'D-0'});
  expect(milestoneCountdown(schedule,'2026-10-09')).toEqual({state:'마감 후',calendar:'D+2',weekdays:'D+2'});
});
