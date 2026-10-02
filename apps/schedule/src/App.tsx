import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { WorkspaceNavigation, useWorkspacePage } from './generated/workspace-navigation';
import { PAGES, additionalPages, type View } from './generated/workspace-pages';
import { dayAdd, monday, today } from './api';
import { statuses } from './types';
import type { Milestone, Task, Status } from './types';
import { TaskPanel, type NewTask } from './TaskPanel';
import { visiblePeople } from './organization';
import { WeekBoard } from './WeekBoard';
import { defaultOpenScheduleStatusColors,defaultOpenScheduleStatusTextColors,OpenScheduleBoard,type ScheduleGrouping } from './OpenScheduleBoard';
import { ScheduleFilterOverlay } from './ScheduleFilterOverlay';
import type { Grouping } from './taskGroups';
import { DateNavigation } from './DateNavigation';
import { dateSpan, extendRange, timelineDays, type Density, type WeekSpan } from './timeline';

import { useScheduleData } from './useScheduleData';
import { WorkspaceState } from './generated/workspace-state';
import { Avatar } from './Avatar';
import { ProjectIcon } from './ProjectIcon';
import { Releases } from './Releases';
import { PersonalTodos } from './PersonalTodos';
import { FeedbackBoard } from './FeedbackBoard';
import { Settings } from './Settings';
import { registerScheduleTools } from './webmcp';
import { useTaskQuickStatus } from './useTaskQuickStatus';
import { createWorkspaceReadSession, type WorkspaceReadSession } from './generated/workspace-read';
import { milestonesForProject, scheduleGet, taskDetailResponse } from './scheduleReads';
import { MonthCalendar, monthAdd, monthGridStart } from './MonthCalendar';
import { GoalsPanel } from './GoalsPanel';
import { ScheduleToastNotice,ScheduleToastProvider,type ScheduleNotice } from './ScheduleToasts';
import { useMilestoneHolidays } from './useMilestoneHolidays';
import './boardControls.css';

function feedbackBadgeResponse(value:unknown){const result=value as {count:number};if(!result||!Number.isSafeInteger(result.count)||result.count<0)throw Error('제보 배지 응답을 확인하지 못했습니다.');return result;}
function storedNumber(key:string,min:number,max:number,fallback:number){try{const value=Number(localStorage.getItem(key));return Number.isFinite(value)&&value>=min&&value<=max?Math.round(value):fallback;}catch{return fallback;}}
function storedColor(key:string,fallback:string){try{const value=localStorage.getItem(key)||'';return /^#[0-9a-f]{6}$/i.test(value)?value:fallback;}catch{return fallback;}}

export function App(){return <ScheduleToastProvider><ScheduleApp/></ScheduleToastProvider>;}

function ScheduleApp() {
  const { view: routeView, path: routePath, navigate: changePage } = useWorkspacePage(PAGES);
  const [grouping, setGrouping] = useState<Grouping>(() => { try { const saved = localStorage.getItem('schedule.grouping'); return saved === 'project' || saved === 'department' || saved === 'goal' || saved === 'mine' ? saved : 'employee'; } catch { return 'employee'; } });
  const [focusBoard, setFocusBoard] = useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  function changeGrouping(value: Grouping) { setGrouping(value); if(value==='mine')setPerson(String(boot?.me.id||''));else if(person===String(boot?.me.id))setPerson(''); try { localStorage.setItem('schedule.grouping', value); } catch {} }
  const [error, setError] = useState('');
  const releasesOpen = routeView === 'releases';
  const todoOpen = routeView === 'todos';
  const feedbackOpen = routeView === 'feedback' || routeView === 'feedbackDetail';
  const [view, setView] = useState<'week' | 'month' | 'kanban'>(location.pathname === '/kanban' ? 'kanban' : 'week'); const [week, setWeek] = useState(monday());
  const [overview,setOverview]=useState<'all'|'mine'|null>(location.pathname==='/mine'?'mine':'all');
  const overviewActive=routeView==='week'||routeView==='mine'||((routeView==='task'||routeView==='settings')&&overview!==null);
  const mineScheduleActive=routeView==='mine'||((routeView==='task'||routeView==='settings')&&overview==='mine');
  const [month,setMonth]=useState(today().slice(0,7)+'-01');
  const [weeks, setWeeks] = useState<WeekSpan>(() => { try { const v = Number(localStorage.getItem('schedule.visibleWeeks')); return v === 2 || v === 4 ? v : 1; } catch { return 1; } });
  const [loadedWeeks, setLoadedWeeks] = useState(weeks + 1); const [rowHeight, setRowHeight] = useState(() => { try { return Math.max(36, Math.min(100, Number(localStorage.getItem('schedule.rowHeight')) || 44)); } catch { return 44; } });
  const [navigation, setNavigation] = useState(0); const [density, setDensity] = useState<Density>('compact');
  const rangeWeeks = view === 'week' ? loadedWeeks : 1;
  const [weekend, setWeekend] = useState(false); const [department, setDepartment] = useState(''); const [project, setProject] = useState('mine'); const [person, setPerson] = useState(''); const [goal,setGoal]=useState('');
  const [groupTimelineByEmployee,setGroupTimelineByEmployeeState]=useState(()=>{try{return localStorage.getItem('schedule.groupTimelineByEmployee')==='true';}catch{return false;}});
  const setGroupTimelineByEmployee=(value:boolean)=>{setGroupTimelineByEmployeeState(value);try{localStorage.setItem('schedule.groupTimelineByEmployee',String(value));}catch{/**/}};
  const [openScheduleFixedWeek,setOpenScheduleFixedWeekState]=useState(()=>{try{return localStorage.getItem('schedule.openFixedWeek')==='true';}catch{return false;}});
  const [openProjectWidth,setOpenProjectWidthState]=useState(()=>storedNumber('schedule.openProjectWidth',100,260,132));
  const [openTaskWidth,setOpenTaskWidthState]=useState(()=>storedNumber('schedule.openTaskWidth',200,520,280));
  const [openStatusColors,setOpenStatusColorsState]=useState<Record<Status,string>>(()=>({planned:storedColor('schedule.openColor.planned',defaultOpenScheduleStatusColors.planned),progress:storedColor('schedule.openColor.progress',defaultOpenScheduleStatusColors.progress),done:storedColor('schedule.openColor.done',defaultOpenScheduleStatusColors.done)}));
  const [openStatusTextColors,setOpenStatusTextColorsState]=useState<Record<Status,string>>(()=>({planned:storedColor('schedule.openTextColor.planned',defaultOpenScheduleStatusTextColors.planned),progress:storedColor('schedule.openTextColor.progress',defaultOpenScheduleStatusTextColors.progress),done:storedColor('schedule.openTextColor.done',defaultOpenScheduleStatusTextColors.done)}));
  const [openScheduleGrouping,setOpenScheduleGrouping]=useState<ScheduleGrouping>('project');
  const setOpenScheduleFixedWeek=(value:boolean)=>{setOpenScheduleFixedWeekState(value);try{localStorage.setItem('schedule.openFixedWeek',String(value));}catch{/**/}};
  const setOpenProjectWidth=(value:number)=>{const next=Math.max(100,Math.min(260,Math.round(value)));setOpenProjectWidthState(next);try{localStorage.setItem('schedule.openProjectWidth',String(next));}catch{/**/}};
  const setOpenTaskWidth=(value:number)=>{const next=Math.max(200,Math.min(520,Math.round(value)));setOpenTaskWidthState(next);try{localStorage.setItem('schedule.openTaskWidth',String(next));}catch{/**/}};
  const setOpenStatusColor=(status:Status,value:string)=>{if(!/^#[0-9a-f]{6}$/i.test(value))return;setOpenStatusColorsState(colors=>({...colors,[status]:value}));try{localStorage.setItem(`schedule.openColor.${status}`,value);}catch{/**/}};
  const setOpenStatusTextColor=(status:Status,value:string)=>{if(!/^#[0-9a-f]{6}$/i.test(value))return;setOpenStatusTextColorsState(colors=>({...colors,[status]:value}));try{localStorage.setItem(`schedule.openTextColor.${status}`,value);}catch{/**/}};
  const [onlyWeek, setOnlyWeek] = useState(false); const [unscheduled, setUnscheduled] = useState(false); const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<number>(() => Number(/^\/tasks\/(\d+)/.exec(location.pathname)?.[1]) || 0);
  const [creating, setCreating] = useState<NewTask>(); const [settings, setSettings] = useState(false); const [selectedMilestone, setSelectedMilestone] = useState<Milestone>(); const [goalsOpen,setGoalsOpen]=useState(false);
  const returnToMonth = useRef(false);
  const queryWeek=view==='month'?monthGridStart(month):week,queryWeeks=view==='month'?6:loadedWeeks;
  const reads=useScheduleData({view,unscheduled,onlyWeek,week:queryWeek,loadedWeeks:queryWeeks,limit,department,project,person:mineScheduleActive?'me':person,goal,includePlanning:!overviewActive&&grouping==='mine',allOpen:overviewActive&&view==='week'&&!unscheduled,includeUnscheduledOpen:mineScheduleActive},!releasesOpen&&!todoOpen&&!feedbackOpen);
  const {boot,bootstrap,refresh,loading,data:{tasks,milestones,absences}}=reads;
  const visibleMilestones=milestonesForProject(milestones,project,boot?.me.projectIds||[]);
  const milestoneHolidays=useMilestoneHolidays(visibleMilestones,boot?.me.id||0);
  const quickStatus=useTaskQuickStatus({boot,disabled:reads.invalid||!reads.ready,currentTask:id=>tasks.items.find(task=>task.id===id),refreshIdentity:bootstrap,refreshBoard:()=>refresh(true,true),invalidate:reads.invalidate});
  // Preserve existing drafts, but never mount a new editor from invalidated identity data.
  const invalidRoute=useRef<string|null>(null);
  if(reads.invalid){if(invalidRoute.current===null)invalidRoute.current=routePath;else if(invalidRoute.current!==routePath)invalidRoute.current='';}
  const retainEditor=!reads.invalid||invalidRoute.current===routePath;
  useEffect(() => {
    setSelected(routeView === 'task' ? Number(/^\/tasks\/(\d+)/.exec(routePath)?.[1]) || 0 : 0);
    setCreating(undefined); setSettings(false); setSelectedMilestone(undefined);
    setFiltersOpen(false);
    if (routeView === 'week' || routeView === 'mine' || routeView === 'kanban') {
      setOverview(routeView==='week'?'all':routeView==='mine'?'mine':null);
      if (routeView !== 'week' || !returnToMonth.current) setView(routeView==='week'||routeView==='mine'?'week':routeView);
      returnToMonth.current = false;
      setUnscheduled(false);
    }
  }, [routeView, routePath]);
  useEffect(() => {
    if (!boot||reads.invalid) return;
    let session:WorkspaceReadSession;
    try { session=createWorkspaceReadSession(); } catch { return registerScheduleTools(async()=>{throw Error('공통 조회 도구를 불러오지 못했습니다. 페이지를 다시 열어 주세요.');}); }
    const scopeChanged=()=>session.cancel('webmcp-task-open');
    document.addEventListener('workspace-entity-scope-change',scopeChanged);
    const unregister=registerScheduleTools(async id => {
      const result=await session.run('webmcp-task-open',signal=>scheduleGet(`/api/tasks/${id}`,signal,value=>taskDetailResponse(value,id)));
      if(result.status==='cancelled'||!result.isCurrent())throw Error('회사 계정이 변경되어 업무를 열지 않았습니다.');
      if(result.status==='error')throw result.error;
      if(!await openId(id))throw Error('일정 이동을 취소했습니다.');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    return()=>{document.removeEventListener('workspace-entity-scope-change',scopeChanged);unregister();session.dispose();};
  }, [boot?.me.id,reads.invalid]);
  useEffect(()=>{
    if(!boot||reads.invalid)return;
    const session=createWorkspaceReadSession();
    const update=async()=>{const result=await session.run('feedback-badge',signal=>scheduleGet('/api/feedback/badge',signal,feedbackBadgeResponse));if(result.status==='success'&&result.isCurrent())(window as unknown as {CompanyNavigation?:{setBadge:(service:string,id:string,count:number)=>void}}).CompanyNavigation?.setBadge('schedule','schedule.feedback',result.value.count);};
    void update();const timer=setInterval(()=>void update(),30000);const refreshBadge=()=>void update();window.addEventListener('focus',refreshBadge);document.addEventListener('feedback-badge-refresh',refreshBadge);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refreshBadge);document.removeEventListener('feedback-badge-refresh',refreshBadge);session.dispose();};
  },[boot?.me.id,reads.invalid]);
  const people = visiblePeople(boot?.employees || [], tasks.items, project, department, person, boot?.me.id);
  const days = timelineDays(queryWeek, queryWeeks, view==='month'||weekend);
  function navigate(date: string) { setWeek(date); setLoadedWeeks(weeks + 1); setNavigation(n => n + 1); }
  function extend(direction: -1 | 1) { if (loading || error || reads.outcome || reads.invalid) return; const next = extendRange({ start: week, count: loadedWeeks }, direction); setWeek(next.start); setLoadedWeeks(next.count); }
  function zoom(value: WeekSpan) { setWeeks(value); setLoadedWeeks(n => Math.max(n, value + 1)); try { localStorage.setItem("schedule.visibleWeeks", String(value)); } catch {} }
  const hiddenWeekendTasks = !weekend && view === 'week' && !unscheduled ? tasks.items.filter(t => !dateSpan(t, days)).length : 0;
  async function openId(id: number, commentId?: number | null) { if(!await changePage('task', id, commentId ? `#comment-${commentId}` : ''))return false;setCreating(undefined);setSettings(false);return true; }
  function openTask(t: Task) { openId(t.id); }
  function canAssign(id: number) { const p = boot?.employees.find(e => e.id === id); return !!p?.active && !p.shared && p.access && p.role !== 'master'; }
  async function changed(requireSuccess = false) { await refresh(true,requireSuccess); }
  async function closeTask() {
    if(view==='month'&&routeView==='task'){
      returnToMonth.current=true;
      if(!await changePage('week')){returnToMonth.current=false;return false;}
    }else if(view!=='month'&&!await changePage(overview==='mine'?'mine':overview==='all'?'week':view))return false;
    setSelected(0);setCreating(undefined);return true;
  }
  async function closeSettings() { if(routeView==='settings'&&!await changePage(overview==='mine'?'mine':overview==='all'?'week':view==='month'?'week':view))return;setSettings(false); }
  function card(t: Task) { const p = boot?.projects.find(x => x.id === t.projectId); const assignee = boot?.employees.find(x => x.id === t.assigneeId); return <button key={t.id} className={`cw-button task-card ${t.status}`} data-variant="record" data-layout="content" data-size={view === 'week' ? 'compact' : undefined} style={{ '--record-accent': p?.color || '#7d899d' } as CSSProperties} title={`${t.title} · ${p?.name || '프로젝트 미지정'} · ${statuses[t.status]} · 일정 ${t.startDate ? `${t.startDate} ~ ${t.endDate}` : '미지정'}`} draggable={view === 'kanban' && tasks.editableIds.includes(t.id) && quickStatus.busyTaskId===null && !quickStatus.locked} onDragStart={e => e.dataTransfer.setData('text/task-id', String(t.id))} onClick={() => openTask(t)}><span className="task-project"><ProjectIcon id={p?.id} />{p?.name || '프로젝트 미지정'}</span><strong>{t.title}</strong>{view === 'week' && grouping !== 'employee' && <span className="task-assignee"><Avatar id={t.assigneeId} name={assignee?.name} />{assignee?.name || '이전 직원'}</span>}<span className="card-meta"><span className={`dot ${t.status}`} />{statuses[t.status]}<span className="grow" />{tasks.attachmentCounts.find(c => c.taskId === t.id)?.count ? '이미지 ' : ''}{tasks.commentCounts.find(c => c.taskId === t.id)?.count ? `댓글 ${tasks.commentCounts.find(c => c.taskId === t.id)?.count}` : ''}</span></button>; }
  if (!boot) return <main className="cw-main"><h1>팀 일정</h1><WorkspaceState {...(reads.identityError||{kind:'loading',title:'회사 정보를 불러오는 중입니다…'})} actionLabel={reads.identityError?(reads.invalid?'페이지 다시 열기':'회사 정보 다시 조회'):undefined} onAction={()=>reads.invalid?location.reload():void bootstrap().catch(()=>{})} /></main>;
  const scheduleModeNavigation = <header className="schedule-mode-navigation">
    <h1 className="schedule-view-title">{mineScheduleActive?'내 일정':overviewActive&&view==='week'?'주간 일정':view==='month'?(grouping==='mine'?'내 월간 일정':'월간 일정'):view==='kanban'?'칸반':'팀 일정'}</h1>
    <div className="schedule-mode-rail" tabIndex={0} aria-label="일정 보기 메뉴">
      {!overviewActive&&<div className="schedule-view-switch" role="group" aria-label="일정 보기 방식">
        {([['week','주간 일정'],['month','월간 달력'],['kanban','칸반']] as const).map(([value,label])=><button type="button" className="cw-button" data-size="compact" key={value} aria-pressed={view===value&&!unscheduled} onClick={()=>{setView(value);setUnscheduled(false);if(value==='month'){if(overviewActive){returnToMonth.current=true;setOverview(null);void changePage('week');}}else{setOverview(null);void changePage(value);}}}>{label}</button>)}
      </div>}
      {!overviewActive&&view!=='kanban'&&!unscheduled&&<div className="grouping-switch" role="group" aria-label="일정 분류">
        {([['employee','직원별'],['project','프로젝트별'],['department','부서별'],['goal','목표별'],['mine','내 일정']] as const).map(([value,label])=><button type="button" className="cw-button" data-size="compact" key={value} aria-pressed={grouping===value} onClick={()=>changeGrouping(value)}>{label}</button>)}
      </div>}
      {overviewActive&&!mineScheduleActive&&<div className="open-schedule-grouping schedule-navigation-grouping" role="group" aria-label="전체 일정 분류">{([['project','프로젝트별'],['department','부서별'],['goal','목표별']] as const).map(([value,label])=><button type="button" className="cw-button" data-size="compact" key={value} aria-pressed={openScheduleGrouping===value} onClick={()=>setOpenScheduleGrouping(value)}>{label}</button>)}</div>}
    </div>
    <div className="schedule-primary-actions">
      <button type="button" className="cw-button schedule-filter-button" data-size="compact" aria-expanded={filtersOpen} aria-controls="schedule-filter-overlay" onClick={()=>setFiltersOpen(value=>!value)}>⚙ 설정</button>
      <button type="button" className="cw-button" data-size="compact" onClick={()=>setGoalsOpen(true)}>목표 관리</button>
      <button type="button" className="cw-button schedule-create-button" data-variant="primary" onClick={()=>setCreating({assigneeId:view==='month'?boot.me.id:canAssign(boot.me.id)?boot.me.id:boot.employees.find(p=>canAssign(p.id))?.id||0,date:view==='month'?month:null})}>＋ 업무 등록</button>
    </div>
  </header>;
  const monthContent = <>
    <div className="month-navigation"><button type="button" className="cw-button" data-size="compact" data-layout="icon" aria-label="이전 달" onClick={()=>setMonth(monthAdd(month,-1))}>‹</button><strong>{month.slice(0,4)}년 {Number(month.slice(5,7))}월</strong><button type="button" className="cw-button" data-size="compact" data-layout="icon" aria-label="다음 달" onClick={()=>setMonth(monthAdd(month,1))}>›</button><button type="button" className="cw-button" data-size="compact" onClick={()=>setMonth(today().slice(0,7)+'-01')}>이번 달</button></div>
    {reads.ready&&tasks.total===0&&<WorkspaceState kind="empty" title="이 달에 표시할 업무가 없습니다."/>}
    <MonthCalendar month={month} boot={boot} tasks={tasks} milestones={visibleMilestones} absences={absences} milestoneHolidays={milestoneHolidays} open={openTask} create={(assigneeId,date)=>setCreating({assigneeId,date})} editMilestone={m=>{setSelectedMilestone(m);setSettings(true);}} detailed={grouping==='mine'}/>
  </>;
  const boardContent = <>{!overviewActive&&<div className="toolbar"><div className="week-nav"><button type="button" className="cw-button" data-size="compact" data-layout="icon" aria-label={`이전 ${weeks}주`} onClick={() => navigate(dayAdd(week, -weeks * 7))}>‹</button><DateNavigation start={week} end={dayAdd(week, rangeWeeks * 7 - (weekend ? 1 : 3))} jump={date => { navigate(monday(date)); setUnscheduled(false); if (view === 'kanban') setOnlyWeek(true); if ([0, 6].includes(new Date(date + 'T12:00:00').getDay())) setWeekend(true); }} /><button type="button" className="cw-button" data-size="compact" data-layout="icon" aria-label={`다음 ${weeks}주`} onClick={() => navigate(dayAdd(week, weeks * 7))}>›</button><button type="button" className="cw-button" data-size="compact" onClick={() => navigate(monday())}>오늘</button></div></div>}
    {reads.ready && tasks.total===0 && <WorkspaceState kind="empty" title={overviewActive?'조회 조건에 맞는 일정이 없습니다.':'조회 조건에 맞는 업무가 없습니다.'} message={overviewActive?'날짜가 지정된 진행·예정·완료 업무가 여기에 표시됩니다.':'기간과 필터를 바꾸거나 새 업무를 등록할 수 있습니다.'} />}
    {(view !== 'week' || unscheduled) && <div className="view-caption"><span>{unscheduled ? '날짜가 정해지지 않은 업무' : view === 'week' ? `${people.length}명 · 화면 ${weeks}주 · 좌우 스크롤로 계속 조회 · ${density === 'compact' ? '요약 보기' : '자세히 보기'}` : '업무 진행 현황'}</span><span>{loading ? '갱신 중…' : `${tasks.total}개 업무`}</span></div>}
    {view === 'week' && !unscheduled ? overviewActive ? <OpenScheduleBoard tasks={tasks.items} employees={boot.employees} departments={boot.departments} projects={boot.projects} goals={boot.goals||[]} milestones={visibleMilestones} holidays={absences.holidays||[]} milestoneHolidays={milestoneHolidays} includeWeekends={weekend} fixedWeek={openScheduleFixedWeek} projectColumnWidth={openProjectWidth} taskColumnWidth={openTaskWidth} onProjectColumnWidthChange={setOpenProjectWidth} onTaskColumnWidthChange={setOpenTaskWidth} statusColors={openStatusColors} statusTextColors={openStatusTextColors} scheduleGrouping={openScheduleGrouping} setScheduleGrouping={setOpenScheduleGrouping} showGroupingControls={false} unified={mineScheduleActive} groupByEmployee={groupTimelineByEmployee&&!mineScheduleActive} loading={loading} ready={reads.ready} open={openTask} create={date=>setCreating({assigneeId:canAssign(boot.me.id)?boot.me.id:boot.employees.find(employee=>canAssign(employee.id))?.id||0,date})} editableIds={tasks.editableIds} changeStatus={(task,status)=>void quickStatus.run(task,status)} statusBusy={quickStatus.busyTaskId!==null||quickStatus.locked} editMilestone={m=>{setSelectedMilestone(m);setSettings(true);}}/> : <WeekBoard focused={focusBoard} toggleFocus={() => setFocusBoard(!focusBoard)} key={grouping} grouping={grouping} employees={boot.employees} departments={boot.departments} visibleWeeks={weeks} rowHeight={rowHeight} navigation={navigation} loading={loading} extend={extend} density={density} days={days} people={people} tasks={tasks.items} milestones={visibleMilestones} projects={boot.projects} goals={boot.goals||[]} absences={absences} milestoneHolidays={milestoneHolidays} project={project} card={card} create={(assigneeId, date) => setCreating({ assigneeId, date })} canAssign={canAssign} editMilestone={m => { setSelectedMilestone(m); setSettings(true); }} /> : <div className={unscheduled ? 'unscheduled-list' : 'kanban'}>{(unscheduled ? ['all'] : Object.keys(statuses)).map(status => <section className="kanban-column" key={status} onDragOver={e => { if (status !== 'all' && quickStatus.busyTaskId===null && !quickStatus.locked) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const t = tasks.items.find(x => x.id === Number(e.dataTransfer.getData('text/task-id'))); if (t && status !== 'all') void quickStatus.run(t, status as Status); }}><h2>{status === 'all' ? '날짜 미정' : statuses[status as Status]} <span>{tasks.items.filter(t => status === 'all' || t.status === status).length}</span></h2>{tasks.items.filter(t => status === 'all' || t.status === status).map(t => <div key={t.id}>{card(t)}<div className="kanban-person"><Avatar id={t.assigneeId} name={boot.employees.find(p=>p.id===t.assigneeId)?.name}/>{boot.employees.find(p=>p.id===t.assigneeId)?.name} · {t.startDate?`${t.startDate.slice(5)} ~ ${t.endDate!.slice(5)}`:'날짜 미지정'}{tasks.editableIds.includes(t.id)&&<label className="cw-form-field"><span>상태 변경</span><select className="cw-form-control" aria-label={`${t.title} 상태 변경`} disabled={quickStatus.busyTaskId!==null||quickStatus.locked} value={t.status} onChange={e=>void quickStatus.run(t,e.target.value as Status)}>{Object.entries(statuses).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}</div></div>)}</section>)}</div>}
    {view === 'kanban' && tasks.items.length < tasks.total && <button type="button" className="cw-button load-more" onClick={() => setLimit(limit + 50)}>업무 더 보기</button>}
    {!overviewActive&&hiddenWeekendTasks > 0 && <div className="weekend-note">주말에만 있는 업무 {hiddenWeekendTasks}개가 있습니다.<button type="button" className="cw-button" onClick={() => setWeekend(true)}>주말 표시</button></div>}
    <footer className="schedule-help">{overviewActive?`${mineScheduleActive?'내':'모든'} 업무를 전체 기간으로 표시합니다. 업무명이나 일정 막대를 누르면 상세 내용과 논의를 확인할 수 있습니다.`:<>{view === 'week' && density === 'compact' && '겹치는 업무는 직원 이름 옆 +N개를 눌러 펼쳐 보세요. '}행 배경은 부서, 업무 카드 테두리와 배경은 프로젝트 색상입니다. 카드를 열어 상세 내용과 논의를 확인하세요.</>}</footer></>;
  const visibleBoard = <>{scheduleModeNavigation}<ScheduleFilterOverlay open={filtersOpen} close={()=>setFiltersOpen(false)} boot={boot} mineSchedule={mineScheduleActive} fullTimeline={overviewActive} view={view} department={department} setDepartment={setDepartment} project={project} setProject={setProject} person={person} setPerson={setPerson} goal={goal} setGoal={setGoal} weekend={weekend} setWeekend={setWeekend} groupByEmployee={groupTimelineByEmployee} setGroupByEmployee={setGroupTimelineByEmployee} onlyWeek={onlyWeek} setOnlyWeek={setOnlyWeek} weeks={weeks} setWeeks={zoom} density={density} setDensity={setDensity} rowHeight={rowHeight} setRowHeight={value=>{setRowHeight(value);try{localStorage.setItem('schedule.rowHeight',String(value));}catch{}}} timelineFixedWeek={openScheduleFixedWeek} setTimelineFixedWeek={setOpenScheduleFixedWeek} projectColumnWidth={openProjectWidth} setProjectColumnWidth={setOpenProjectWidth} taskColumnWidth={openTaskWidth} setTaskColumnWidth={setOpenTaskWidth} statusColors={openStatusColors} setStatusColor={setOpenStatusColor} statusTextColors={openStatusTextColors} setStatusTextColor={setOpenStatusTextColor}/>{view==='month'?monthContent:boardContent}</>;
  const isBoard = ['week','mine','kanban','task','settings'].includes(routeView);
  const notices:ScheduleNotice[]=[];
  if(isBoard&&loading&&!reads.ready)notices.push({id:'board-loading',state:{kind:'loading',title:view==='month'?'월간 일정을 불러오는 중입니다…':'일정을 불러오는 중입니다…',message:'잠시 기다려 주세요.'}});
  if(error)notices.push({id:'task-error',state:{kind:'error',title:'업무 처리 결과를 확인해 주세요.',message:error,actionLabel:'목록 다시 조회',onAction:()=>{setError('');void refresh();}}});
  if(quickStatus.outcome)notices.push({id:'quick-status',state:quickStatus.outcome});
  if(reads.outcome)notices.push({id:'board-read',state:{...reads.outcome,actionLabel:'일정 다시 조회',onAction:()=>void refresh()}});
  if(reads.ready&&!absences.available)notices.push({id:'absences',state:{kind:'error',title:'부재 정보를 갱신하지 못했습니다.',message:'업무 일정은 계속 사용할 수 있습니다.',actionLabel:'부재 정보 다시 조회',onAction:()=>void refresh()}});
  if(reads.ready&&view==='week'&&!unscheduled&&absences.holidaysAvailable===false)notices.push({id:'holidays',state:{kind:'error',title:'공휴일 정보를 불러오지 못했습니다.',message:'주말만 표시하고 있습니다. 공휴일은 연차관리의 등록 정보를 사용합니다.',actionLabel:'공휴일 다시 조회',onAction:()=>void refresh()}});
  if(isBoard&&reads.identityError)notices.push({id:'identity',state:{...reads.identityError,actionLabel:reads.invalid?'페이지 다시 열기':'회사 정보 다시 조회',onAction:()=>reads.invalid?location.reload():void bootstrap().catch(()=>{})}});
  const pageContent: Record<View, ReactNode> = {
    week: visibleBoard,
    mine: visibleBoard,
    kanban: visibleBoard,
    task: visibleBoard,
    settings: visibleBoard,
    todos: <PersonalTodos key={boot.me.id} boot={boot} refreshIdentity={bootstrap} />,
    releases: <Releases key={boot.me.id} boot={boot} refreshIdentity={bootstrap} />,
    feedback: <FeedbackBoard key={`feedback-${boot.me.id}`} boot={boot} open={id=>void changePage('feedbackDetail',id)} close={()=>void changePage('feedback')} openTask={id=>void openId(id)} refreshIdentity={bootstrap}/>,
    feedbackDetail: <FeedbackBoard key={`feedback-${boot.me.id}`} boot={boot} selectedId={Number(/^\/feedback\/(\d+)/.exec(routePath)?.[1])||undefined} open={id=>void changePage('feedbackDetail',id)} close={()=>void changePage('feedback')} openTask={id=>void openId(id)} refreshIdentity={bootstrap}/>,
    ...additionalPages,
  };
  return <div className="app">
    <WorkspaceNavigation service="schedule" capabilities={['schedule.manage']} />
    <main data-workspace-view={routeView} className={`workspace cw-main ${isBoard ? "schedule-workspace" : ""} ${isBoard && view === "week" && !unscheduled ? `timeline-workspace ${focusBoard ? "focus-board" : ""}` : ""}`}>
      {boot.demo && <span className="demo-badge cw-state-pill" data-tone="warning">예시 데이터</span>}
      {reads.identityError && !isBoard && <WorkspaceState {...reads.identityError} actionLabel={reads.invalid?'페이지 다시 열기':'회사 정보 다시 조회'} onAction={()=>reads.invalid?location.reload():void bootstrap().catch(()=>{})} />}
      {reads.invalid && (isBoard||!retainEditor) ? null : pageContent[routeView]}
    </main>
    {notices.map(notice=><ScheduleToastNotice key={notice.id} {...notice}/>)}
    {retainEditor && (!!selected || creating) && <TaskPanel key={selected || 'new'} id={selected || undefined} initial={creating} boot={boot} close={closeTask} changed={changed} opened={openId} refreshIdentity={bootstrap} />}
    {retainEditor && (settings || routeView === 'settings') && <Settings boot={boot} close={closeSettings} changed={async () => { await bootstrap(); await refresh(); }} refreshIdentity={bootstrap} selectedMilestone={selectedMilestone} openTask={openId} />}
    {goalsOpen && <GoalsPanel boot={boot} close={()=>setGoalsOpen(false)} changed={async()=>{await bootstrap();}} />}
  </div>;
}
