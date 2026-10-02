import {useEffect} from 'react';
import type {Bootstrap,Status} from './types';
import {defaultOpenScheduleStatusColors,defaultOpenScheduleStatusTextColors} from './OpenScheduleBoard';
import type {Density,WeekSpan} from './timeline';

type Props={
  open:boolean;close:()=>void;boot:Bootstrap;mineSchedule:boolean;fullTimeline:boolean;view:'week'|'month'|'kanban';
  department:string;setDepartment:(value:string)=>void;
  project:string;setProject:(value:string)=>void;
  person:string;setPerson:(value:string)=>void;
  goal:string;setGoal:(value:string)=>void;
  weekend:boolean;setWeekend:(value:boolean)=>void;
  groupByEmployee:boolean;setGroupByEmployee:(value:boolean)=>void;
  onlyWeek:boolean;setOnlyWeek:(value:boolean)=>void;
  weeks:WeekSpan;setWeeks:(value:WeekSpan)=>void;
  density:Density;setDensity:(value:Density)=>void;
  rowHeight:number;setRowHeight:(value:number)=>void;
  timelineFixedWeek:boolean;setTimelineFixedWeek:(value:boolean)=>void;
  projectColumnWidth:number;setProjectColumnWidth:(value:number)=>void;
  taskColumnWidth:number;setTaskColumnWidth:(value:number)=>void;
  statusColors:Record<Status,string>;setStatusColor:(status:Status,value:string)=>void;
  statusTextColors:Record<Status,string>;setStatusTextColor:(status:Status,value:string)=>void;
};

export function ScheduleFilterOverlay({open,close,boot,mineSchedule,fullTimeline,view,department,setDepartment,project,setProject,person,setPerson,goal,setGoal,weekend,setWeekend,groupByEmployee,setGroupByEmployee,onlyWeek,setOnlyWeek,weeks,setWeeks,density,setDensity,rowHeight,setRowHeight,timelineFixedWeek,setTimelineFixedWeek,projectColumnWidth,setProjectColumnWidth,taskColumnWidth,setTaskColumnWidth,statusColors,setStatusColor,statusTextColors,setStatusTextColor}:Props){
  useEffect(()=>{
    if(!open)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[open,close]);
  if(!open)return null;
  const reset=()=>{setDepartment('');setProject('mine');setPerson('');setGoal('');setWeekend(false);setGroupByEmployee(false);setOnlyWeek(false);setTimelineFixedWeek(false);setProjectColumnWidth(132);setTaskColumnWidth(280);for(const status of ['planned','progress','done'] as Status[]){setStatusColor(status,defaultOpenScheduleStatusColors[status]);setStatusTextColor(status,defaultOpenScheduleStatusTextColors[status]);}};
  return <div className="schedule-filter-backdrop" onMouseDown={close}>
    <section id="schedule-filter-overlay" className="schedule-filter-overlay" role="dialog" aria-modal="true" aria-labelledby="schedule-filter-title" onMouseDown={event=>event.stopPropagation()}>
      <header><div><h2 id="schedule-filter-title">일정 설정</h2><p>조건을 바꾸면 일정표만 바로 갱신됩니다.</p></div><button type="button" className="cw-button" data-layout="icon" aria-label="설정 닫기" onClick={close}>×</button></header>
      <div className="schedule-filter-fields">
        <label className="cw-form-field"><span>프로젝트</span><select className="cw-form-control" data-company-picker="project" aria-label="프로젝트 필터" value={project} onChange={event=>setProject(event.target.value)}><option value="mine">내 프로젝트</option><option value="">전체 프로젝트</option>{boot.projects.map(item=><option key={item.id} value={item.id}>{item.name}{item.isPrivate?' · 비공개':''}</option>)}</select></label>
        <label className="cw-form-field"><span>부서</span><select className="cw-form-control" aria-label="부서 필터" value={department} onChange={event=>setDepartment(event.target.value)}><option value="">전체 부서</option>{boot.departments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {!mineSchedule&&<label className="cw-form-field"><span>담당자</span><select className="cw-form-control" data-company-picker="employee" aria-label="담당자 필터" value={person} onChange={event=>setPerson(event.target.value)}><option value="">전체 담당자</option>{boot.employees.filter(item=>item.active&&!item.shared).map(item=><option key={item.id} value={item.id}>{item.name}{item.isPrivate?' · 비공개':''}</option>)}</select></label>}
        <label className="cw-form-field"><span>목표</span><select className="cw-form-control" aria-label="목표 필터" value={goal} onChange={event=>setGoal(event.target.value)}><option value="">전체 목표</option>{(boot.goals||[]).map(item=><option key={item.id} value={item.id}>{item.title}{item.closedAt?' · 종료':''}</option>)}</select></label>
      </div>
      <div className="schedule-filter-toggles">
        {view==='week'?<label className="cw-check-control"><input className="cw-checkbox" type="checkbox" checked={weekend} onChange={event=>setWeekend(event.target.checked)}/> 주말 표시</label>:<label className="cw-check-control"><input className="cw-checkbox" type="checkbox" checked={onlyWeek} onChange={event=>setOnlyWeek(event.target.checked)}/> 선택한 주만</label>}
        {fullTimeline&&!mineSchedule&&<label className="cw-check-control"><input className="cw-checkbox" type="checkbox" role="switch" checked={groupByEmployee} onChange={event=>setGroupByEmployee(event.target.checked)}/> 직원별로 묶기</label>}
        {view==='week'&&fullTimeline&&<label className="cw-check-control"><input className="cw-checkbox" type="checkbox" role="switch" checked={timelineFixedWeek} onChange={event=>setTimelineFixedWeek(event.target.checked)}/> 1주만 보기 고정</label>}
      </div>
      {view==='week'&&!fullTimeline&&<section className="schedule-display-settings" aria-label="표시 설정">
        <label className="cw-form-field"><span>표시 기간</span><select className="cw-form-control" aria-label="표시 기간" value={weeks} onChange={event=>setWeeks(Number(event.target.value) as WeekSpan)}><option value={1}>1주</option><option value={2}>2주</option><option value={4}>4주</option></select></label>
        <label className="view-toggle cw-check-control"><input className="cw-checkbox" type="checkbox" role="switch" aria-label="상세 보기" checked={density==='detail'} onChange={event=>setDensity(event.target.checked?'detail':'compact')}/> 상세 보기</label>
        <label className="cw-form-field cw-range-field"><span>행 높이</span><span className="cw-range-control"><input id="schedule-row-height" className="cw-range" aria-label="직원 행 높이" type="range" min="36" max="100" step="4" value={rowHeight} onChange={event=>setRowHeight(Number(event.target.value))}/><output htmlFor="schedule-row-height">{rowHeight}px</output></span></label>
      </section>}
      {view==='week'&&fullTimeline&&<section className="schedule-display-settings open-schedule-display-settings" aria-label="전체 일정 표시 설정">
        <label className="cw-form-field cw-range-field"><span>프로젝트 칸 너비</span><span className="cw-range-control"><input className="cw-range" aria-label="프로젝트 칸 너비" type="range" min="100" max="260" step="4" value={projectColumnWidth} onChange={event=>setProjectColumnWidth(Number(event.target.value))}/><output>{projectColumnWidth}px</output></span></label>
        <label className="cw-form-field cw-range-field"><span>업무·담당자 칸 너비</span><span className="cw-range-control"><input className="cw-range" aria-label="업무 담당자 칸 너비" type="range" min="200" max="520" step="4" value={taskColumnWidth} onChange={event=>setTaskColumnWidth(Number(event.target.value))}/><output>{taskColumnWidth}px</output></span></label>
        <fieldset className="open-schedule-color-settings"><legend>상태별 일정 바 색상</legend>{([['planned','예정'],['progress','진행중'],['done','완료']] as const).map(([status,label])=><div className="open-schedule-color-card" key={status}><strong>{label}</strong><label><span>배경</span><input className="cw-form-control" type="color" aria-label={`${label} 일정 바 배경색`} value={statusColors[status]} onChange={event=>setStatusColor(status,event.target.value)}/><code>{statusColors[status]}</code></label><label><span>글자</span><input className="cw-form-control" type="color" aria-label={`${label} 일정 바 글자색`} value={statusTextColors[status]} onChange={event=>setStatusTextColor(status,event.target.value)}/><code>{statusTextColors[status]}</code></label></div>)}</fieldset>
      </section>}
      <footer><button type="button" className="cw-button" data-variant="quiet" onClick={reset}>기본값으로 초기화</button><button type="button" className="cw-button" data-variant="primary" onClick={close}>닫기</button></footer>
    </section>
  </div>;
}
