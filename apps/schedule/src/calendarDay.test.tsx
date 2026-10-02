import { describe, expect, it } from 'vitest';
import { vi, afterEach } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
import { renderToStaticMarkup } from 'react-dom/server';
import { calendarDay } from './calendarDay';
import { WeekBoard } from './WeekBoard';
import { OpenScheduleBoard,openScheduleColumnWidth,openScheduleDays,openScheduleSortTasks,openScheduleTasksForGrouping,openScheduleTasksForWindow,openScheduleTodayScrollLeft,openScheduleVisibleRange,openScheduleVisibility } from './OpenScheduleBoard';

describe('주말·공휴일 표시', () => {
  const holidays = [{ date:'2026-09-25', name:'등록 공휴일' }, { date:'2026-09-26', name:'주말 공휴일' }];
  it('토요일은 파랑, 일요일은 빨강, 평일은 기본값으로 분류한다', () => {
    expect(calendarDay('2026-09-19', []).kind).toBe('saturday');
    expect(calendarDay('2026-09-20', []).kind).toBe('sunday');
    expect(calendarDay('2026-09-21', []).kind).toBe('weekday');
  });
  it('등록 공휴일은 토요일 색상보다 우선하며 이름과 요일을 제공한다', () => {
    expect(calendarDay('2026-09-26', holidays)).toMatchObject({ kind:'holiday', holiday:'주말 공휴일', label:'2026-09-26 토요일 · 주말 공휴일' });
    expect(calendarDay('2026-09-25', holidays).kind).toBe('holiday');
  });
  it('연도 경계에서도 등록한 휴일만 표시한다', () => {
    expect(calendarDay('2027-01-01', [{date:'2027-01-01',name:'회사 등록 휴일'}]).holiday).toBe('회사 등록 휴일');
    expect(calendarDay('2027-01-01', []).holiday).toBe('');
  });
  it('데스크톱 헤더·주요 일정·직원 칸과 모바일에 같은 휴일을 표시한다', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const html = renderToStaticMarkup(<WeekBoard days={['2026-09-25','2026-09-26','2026-09-27']} people={[{id:1,name:'직원',department:'개발',departmentId:null,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false}]} tasks={[]} milestones={[{id:1,title:"검수",description:"",date:"2026-09-25",projectId:null,version:1}]} absences={{items:[],available:true,updatedAt:null,holidays}} project="" density="compact" card={()=>null} create={()=>{}} canAssign={()=>false} editMilestone={()=>{}} />);
    expect(html).toContain('day-header calendar-holiday');
    expect(html).toContain('milestone-cell calendar-holiday');
    expect(html).toContain('timeline-background calendar-holiday');
    expect(html).toContain('mobile-day calendar-holiday');
    expect(html).toContain('calendar-sunday');
    expect(html).toContain('holiday-name');
    expect(html).toContain('등록 공휴일');
  });
  it('전체 일정은 미완료 업무를 프로젝트별 한 줄 일정으로 표시한다',()=>{
    vi.stubGlobal('matchMedia',()=>({matches:false}));
    const person={id:1,name:'직원',department:'개발',departmentId:null,projectIds:[],role:'employee' as const,active:true,shared:false,access:true,isAdmin:false};
    const task={id:1,title:'업무',body:'',assigneeId:1,createdBy:1,projectId:null,goalId:null,startDate:'2026-09-28',endDate:'2026-09-30',status:'planned' as const,archived:false,version:1,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'};
    const props={days:['2026-09-28','2026-09-29','2026-09-30'],people:[person],employees:[person],tasks:[task],milestones:[],absences:{items:[],available:true,updatedAt:null},project:'',density:'compact' as const,card:()=>null,create:()=>{},canAssign:()=>false,editMilestone:()=>{}};
    const unscheduled={...task,id:2,title:'날짜 없는 업무',projectId:1,startDate:null,endDate:null,status:'progress' as const};
    const progress={...task,id:3,title:'진행 업무',projectId:1,status:'progress' as const},planned={...task,id:4,title:'예정 업무',projectId:1},done={...task,id:5,title:'완료 업무',projectId:1,status:'done' as const};
    const milestone={id:7,title:'출시',description:'',deadlineMemo:'업데이트 마감',date:'2026-09-30',type:'update' as const,projectId:1,version:1};
    const standard=renderToStaticMarkup(<WeekBoard {...props}/>),overview=renderToStaticMarkup(<OpenScheduleBoard loading tasks={[done,planned,progress,unscheduled]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'게임 프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[milestone]} holidays={[{date:'2026-09-30',name:'등록 공휴일'}]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} open={()=>{}}/>);
    expect(standard).toContain('>담당자<');expect(overview).toContain('프로젝트별');expect(overview).toContain('부서별');expect(overview).toContain('목표별');expect(overview).not.toContain('>직원별<');expect(overview).toContain('aria-label="날짜 칸 너비"');expect(overview).toContain('aria-label="날짜 칸 너비 직접 입력"');expect(overview).toContain('max="300"');expect(overview).toContain('오늘로 이동');expect(overview).not.toContain('크게 보기');expect(overview).toContain('◆ 주요 일정');expect(overview).toContain('업데이트 마감');expect(overview).toContain('업무 · 담당자');expect(overview).toContain('class="cw-button open-schedule-task-cell" style=');expect(overview).not.toContain('open-schedule-task-cell" data-variant="quiet"');expect(overview).toContain('진행 업무 - 직원 · 2026-09-28 ~ 2026-09-30');expect(overview).toContain('직원 · 개발');expect(overview).toContain('data-status="progress"');expect(overview).toContain('--bar-start:');expect(overview).toContain('--bar-width:');expect(overview).toContain('--project-color:#3874c9');expect(overview).toContain('open-schedule-day calendar-holiday');expect(overview).not.toContain('<small>등록 공휴일</small>');expect(overview).toContain('open-schedule-refresh active');expect(overview).not.toContain('board-loading');expect(overview).not.toContain('margin-left:');expect(overview).not.toContain('날짜 없는 업무');expect(overview.indexOf('진행 업무')).toBeLessThan(overview.indexOf('예정 업무'));expect(overview.indexOf('예정 업무')).toBeLessThan(overview.indexOf('완료 업무'));expect(overview).not.toContain('월요일 계획');expect(overview).not.toContain('변경 강조');
    expect(openScheduleColumnWidth(301)).toBe(300);expect(openScheduleColumnWidth(31)).toBe(32);expect(openScheduleColumnWidth(157.6)).toBe(158);
    const days=openScheduleDays([{...task,startDate:'2026-08-03',endDate:'2026-11-20'}],false,4,4);expect(days[0]).toBe('2026-08-31');expect(days.at(-1)).toBe('2026-12-18');
  });
  it('1주 고정은 해당 주의 날짜와 업무만 표시하고 고정 칸·상태 색 설정을 적용한다',()=>{
    const person={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[1],role:'employee' as const,active:true,shared:false,access:true,isAdmin:false};
    const task={id:1,title:'이번 주 업무',body:'',assigneeId:1,createdBy:1,projectId:1,goalId:null,startDate:'2026-09-28',endDate:'2026-09-30',status:'progress' as const,archived:false,version:1,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'};
    const html=renderToStaticMarkup(<OpenScheduleBoard fixedWeek projectColumnWidth={180} taskColumnWidth={360} onProjectColumnWidthChange={()=>{}} onTaskColumnWidthChange={()=>{}} statusColors={{planned:'#111111',progress:'#222222',done:'#333333'}} statusTextColors={{planned:'#aaaaaa',progress:'#eeeeee',done:'#bbbbbb'}} tasks={[task,{...task,id:2,title:'다음 주 업무',startDate:'2026-10-12',endDate:'2026-10-13'}]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} open={()=>{}}/>);
    expect(html).toContain('1주 고정');expect(html).toContain('이번 주 업무');expect(html).toContain('다음 주 업무');expect(html).toContain('10.12–10.13 · 이후 →');expect(html).toContain('--open-project-width:180px');expect(html).toContain('--open-task-width:360px');expect(html).toContain('--schedule-progress-color:#222222');expect(html).toContain('--schedule-progress-text:#eeeeee');expect(html).toContain('open-schedule-project-content');expect(html).toContain('aria-label="프로젝트 칸 너비 조절"');expect(html).toContain('aria-label="업무 담당자 칸 너비 조절"');
  });
  it('실제 스크롤 위치의 날짜 칸만 보이는 범위로 계산하고 업무 방향을 분류한다',()=>{
    expect(openScheduleVisibleRange(96,1018,412,48,60)).toEqual({first:2,last:14});
    expect(openScheduleVisibleRange(0,320,412,300,5)).toEqual({first:0,last:0});
    expect(openScheduleVisibility('2026-09-21','2026-09-25','2026-09-28','2026-10-02')).toBe('before');
    expect(openScheduleVisibility('2026-10-12','2026-10-16','2026-09-28','2026-10-02')).toBe('after');
    expect(openScheduleVisibility('2026-09-21','2026-10-16','2026-09-28','2026-10-02')).toBe('clipped-both');
    expect(openScheduleVisibility('2026-09-29','2026-10-01','2026-09-28','2026-10-02')).toBe('inside');
  });
  it('직원별 묶기는 기본 분류를 유지하고 같은 직원의 업무를 연속해 표시한다',()=>{
    const first={id:1,name:'가직원',department:'개발',departmentId:1,projectIds:[1],role:'employee' as const,active:true,shared:false,access:true,isAdmin:false};
    const second={...first,id:2,name:'나직원'};
    const base={id:1,title:'나직원 먼저 날짜',body:'',assigneeId:2,createdBy:1,projectId:1,goalId:null,startDate:'2026-09-28',endDate:'2026-09-28',status:'planned' as const,archived:false,version:1,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'};
    const html=renderToStaticMarkup(<OpenScheduleBoard tasks={[base,{...base,id:2,title:'가직원 나중 날짜',assigneeId:1,startDate:'2026-09-30',endDate:'2026-09-30'}]} employees={[first,second]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} groupByEmployee open={()=>{}}/>);
    expect(html).toContain('2개 업무 · 직원별 묶음');
    expect(html.indexOf('가직원 나중 날짜')).toBeLessThan(html.indexOf('나직원 먼저 날짜'));
    expect(html).toContain('employee-group-start');
    const history={...base,id:3,title:'가직원 과거 완료',assigneeId:1,startDate:'2026-09-14',endDate:'2026-09-18',status:'done' as const};
    const secondHistory={...history,id:4,title:'나직원 과거 완료',assigneeId:2};
    const ordered=openScheduleSortTasks([base,history,secondHistory,{...base,id:5,title:'가직원 현재',assigneeId:1}], [first,second],true,'2026-09-28');
    expect(ordered.map(task=>task.title)).toEqual(['가직원 현재','가직원 과거 완료','나직원 먼저 날짜','나직원 과거 완료']);
  });
  it('내 일정은 분류 선택 없이 한 목록으로 합치고 기한 미지정 미완료 업무도 표시한다',()=>{
    const person={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[1,2],role:'employee' as const,active:true,shared:false,access:true,isAdmin:false};
    const base={id:1,title:'날짜 있는 업무',body:'',assigneeId:1,createdBy:1,projectId:1,goalId:null,startDate:'2026-09-28',endDate:'2026-09-30',status:'planned' as const,archived:false,version:1,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'};
    const unscheduled={...base,id:2,title:'날짜 없는 진행 업무',projectId:2,startDate:null,endDate:null,status:'progress' as const};
    const completedUnscheduled={...base,id:3,title:'완료된 날짜 없는 업무',startDate:null,endDate:null,status:'done' as const};
    const projects=[{id:1,name:'첫 프로젝트',color:'#3874c9',archived:false,version:1},{id:2,name:'둘째 프로젝트',color:'#8068bd',archived:false,version:1}];
    const html=renderToStaticMarkup(<OpenScheduleBoard unified tasks={[base,unscheduled,completedUnscheduled]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={projects} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} open={()=>{}}/>);
    expect(html).toContain('내 일정');expect(html).toContain('<strong>2</strong>개 일정');expect(html).toContain('날짜 있는 업무');expect(html).toContain('날짜 없는 진행 업무');expect(html).toContain('기한 미지정');expect(html).toContain('둘째 프로젝트');
    expect(html).not.toContain('프로젝트별');expect(html).not.toContain('부서별');expect(html).not.toContain('목표별');expect(html).not.toContain('완료된 날짜 없는 업무');
    expect(openScheduleTasksForGrouping([base,unscheduled,completedUnscheduled],[],'project',true).map(task=>task.id)).toEqual([1,2]);
  });
  it('목표별 보기에서는 진행 중 목표에 연결된 일정만 표시한다',()=>{
    const task={id:1,title:'진행 목표 업무',body:'',assigneeId:1,createdBy:1,projectId:1,goalId:10,startDate:'2026-09-28',endDate:'2026-09-30',status:'planned' as const,archived:false,version:1,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'};
    const goals=[{id:10,title:'진행 목표',description:'',projectId:1,createdBy:1,closedAt:null,closedBy:null,version:1,createdAt:task.createdAt,updatedAt:task.updatedAt},{id:11,title:'완료 목표',description:'',projectId:1,createdBy:1,closedAt:'2026-09-27T00:00:00Z',closedBy:1,version:2,createdAt:task.createdAt,updatedAt:task.updatedAt}];
    const visible=openScheduleTasksForGrouping([task,{...task,id:2,title:'완료 목표 업무',goalId:11},{...task,id:3,title:'목표 미지정 업무',goalId:null},{...task,id:4,title:'날짜 미지정 업무',startDate:null,endDate:null}],goals,'goal');
    expect(visible.map(item=>item.title)).toEqual(['진행 목표 업무']);
    expect(openScheduleTasksForGrouping([task],goals,'project')).toHaveLength(1);
  });
  it('오늘 이동은 이번 주 월요일을 일정 영역 왼쪽에 맞춘다',()=>{
    expect(openScheduleTodayScrollLeft(30,48)).toBe(1440);
    expect(openScheduleTodayScrollLeft(0,44)).toBe(0);
  });
  it('이번 주 이전 완료 업무는 숨기고 과거 주차를 불러오면 표시한다',()=>{
    const done={id:1,title:'지난 완료',body:'',assigneeId:1,createdBy:1,projectId:1,goalId:null,startDate:'2026-09-14',endDate:'2026-09-18',status:'done' as const,archived:false,version:1,createdAt:'2026-09-18T00:00:00Z',updatedAt:'2026-09-18T00:00:00Z'};
    const progress={...done,id:2,title:'지난 진행',status:'progress' as const};
    expect(openScheduleTasksForWindow([done,progress],'2026-09-28').map(task=>task.title)).toEqual(['지난 진행']);
    expect(openScheduleTasksForWindow([done,progress],'2026-09-14').map(task=>task.title)).toEqual(['지난 완료','지난 진행']);
  });
  it('주간 일정은 마감 메모를 카드 제목으로 쓰고 메모가 없으면 게시글 제목을 쓴다',()=>{
    vi.stubGlobal('matchMedia',()=>({matches:false}));
    const person={id:1,name:'직원',department:'개발',departmentId:null,projectIds:[],role:'employee' as const,active:true,shared:false,access:true,isAdmin:false};
    const milestone={id:1,title:'신캐릭터&신스킨',description:'',deadlineMemo:'신스킨 마감',date:'2026-10-02',type:'update' as const,additionalSchedules:[{type:'review' as const,date:'2026-10-15',memo:'신캐릭터 마감'}],projectId:null,version:1};
    const html=renderToStaticMarkup(<WeekBoard days={['2026-10-02','2026-10-15']} people={[person]} tasks={[]} milestones={[milestone]} absences={{items:[],available:true,updatedAt:null}} project="" density="compact" card={()=>null} create={()=>{}} canAssign={()=>false} editMilestone={()=>{}}/>);
    expect(html).toContain('>신스킨 마감<');expect(html).toContain('>신캐릭터 마감<');expect(html).toContain('주요 일정: 신캐릭터&amp;신스킨');
  });
});
