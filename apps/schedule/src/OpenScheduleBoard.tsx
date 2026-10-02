import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type MouseEvent as ReactMouseEvent,type PointerEvent as ReactPointerEvent} from 'react';
import {dayAdd,today} from './api';
import {Avatar} from './Avatar';
import {calendarDay} from './calendarDay';
import {MilestoneCountdown,type MilestoneHolidays} from './MilestoneCountdown';
import {ProjectIcon} from './ProjectIcon';
import {milestoneSchedules} from './milestoneSchedules';
import {milestoneTypes,statuses,type CalendarHoliday,type Employee,type Milestone,type Project,type Status,type Task,type WorkGoal} from './types';
import {weekDay} from './timeline';

type Props={
  tasks:Task[];
  employees:Employee[];
  departments:{id:number;name:string}[];
  projects:Project[];
  goals:WorkGoal[];
  milestones:Milestone[];
  holidays:CalendarHoliday[];
  milestoneHolidays:MilestoneHolidays;
  includeWeekends:boolean;
  fixedWeek?:boolean;
  projectColumnWidth?:number;
  taskColumnWidth?:number;
  onProjectColumnWidthChange?:(value:number)=>void;
  onTaskColumnWidthChange?:(value:number)=>void;
  statusColors?:Record<Status,string>;
  statusTextColors?:Record<Status,string>;
  scheduleGrouping?:ScheduleGrouping;
  setScheduleGrouping?:(value:ScheduleGrouping)=>void;
  showGroupingControls?:boolean;
  unified?:boolean;
  groupByEmployee?:boolean;
  loading?:boolean;
  ready?:boolean;
  open:(task:Task)=>void;
  create?:(date:string)=>void;
  editableIds?:number[];
  changeStatus?:(task:Task,status:Status)=>void;
  statusBusy?:boolean;
  editMilestone?:(milestone:Milestone)=>void;
};

type Segment={key:string;label:string;start:number;end:number};
export type ScheduleGrouping='project'|'department'|'goal';
type ScheduleGroup={key:string;name:string;color:string;projectId:number|null;tasks:Task[];milestones:Milestone[]};
type ScheduleContextMenu={x:number;y:number;date:string;task?:Task};
export type OpenScheduleVisibleRange={first:number;last:number};
export type OpenScheduleVisibility='before'|'after'|'inside'|'clipped-before'|'clipped-after'|'clipped-both';

const statusOrder:Record<Status,number>={progress:0,planned:1,done:2};

function mondayKey(date:string){const value=new Date(`${date}T12:00:00`);return dayAdd(date,-((value.getDay()+6)%7));}
function segments(days:string[],key:(date:string)=>string,label:(date:string)=>string){
  const result:Segment[]=[];
  days.forEach((date,index)=>{const value=key(date),last=result.at(-1);if(last?.key===value)last.end=index;else result.push({key:value,label:label(date),start:index,end:index});});
  return result;
}
function sunday(date:string){return dayAdd(mondayKey(date),6);}
export function openScheduleTasksForGrouping(tasks:Task[],goals:WorkGoal[],grouping:ScheduleGrouping,includeUnscheduled=false){
  const scheduled=tasks.filter(task=>task.startDate&&task.endDate||includeUnscheduled&&task.status!=='done'&&!task.startDate&&!task.endDate);
  if(includeUnscheduled)return scheduled;
  if(grouping!=='goal')return scheduled;
  const openGoalIds=new Set(goals.filter(goal=>!goal.closedAt).map(goal=>goal.id));
  return scheduled.filter(task=>task.goalId!=null&&openGoalIds.has(task.goalId));
}
export function openScheduleTodayScrollLeft(index:number,columnWidth:number){
  return Math.max(0,index*columnWidth);
}
export function openScheduleVisibleRange(scrollLeft:number,clientWidth:number,fixedColumnsWidth:number,columnWidth:number,dayCount:number):OpenScheduleVisibleRange{
  if(dayCount<=0)return {first:0,last:0};
  const first=Math.max(0,Math.min(dayCount-1,Math.floor(Math.max(0,scrollLeft)/columnWidth)));
  const dateViewportWidth=Math.max(columnWidth,clientWidth-fixedColumnsWidth);
  const last=Math.max(first,Math.min(dayCount-1,Math.ceil((Math.max(0,scrollLeft)+dateViewportWidth)/columnWidth)-1));
  return {first,last};
}
export function openScheduleVisibility(start:string|null,end:string|null,visibleStart:string,visibleEnd:string):OpenScheduleVisibility|null{
  if(!start||!end)return null;
  if(end<visibleStart)return 'before';
  if(start>visibleEnd)return 'after';
  const before=start<visibleStart,after=end>visibleEnd;
  return before&&after?'clipped-both':before?'clipped-before':after?'clipped-after':'inside';
}
export function openScheduleColumnWidth(value:number,fallback=44){
  return Number.isFinite(value)?Math.max(32,Math.min(300,Math.round(value))):fallback;
}
export const defaultOpenScheduleStatusColors:Record<Status,string>={planned:'#b98552',progress:'#4d7ed0',done:'#4f8b70'};
export const defaultOpenScheduleStatusTextColors:Record<Status,string>={planned:'#ffffff',progress:'#ffffff',done:'#ffffff'};
export function openScheduleDays(tasks:Task[],includeWeekends:boolean,beforeWeeks=0,afterWeeks=0,additionalDates:string[]=[]){
  const dates=[...tasks.flatMap(task=>[task.startDate,task.endDate]).filter((date):date is string=>!!date),...additionalDates];
  const start=dayAdd(mondayKey(today()),-beforeWeeks*7);
  const end=dayAdd(sunday([today(),...dates].sort().at(-1)!),afterWeeks*7);
  const days:string[]=[];
  for(let date=start;date<=end;date=dayAdd(date,1))if(includeWeekends||![0,6].includes(new Date(`${date}T12:00:00`).getDay()))days.push(date);
  return days;
}
export function openScheduleTasksForWindow(tasks:Task[],start:string,includeUnscheduled=false){
  return tasks.filter(task=>task.startDate&&task.endDate&&(task.status!=='done'||task.endDate>=start)||includeUnscheduled&&task.status!=='done'&&!task.startDate&&!task.endDate);
}
export function openScheduleSortTasks(tasks:Task[],employees:Employee[],groupByEmployee:boolean,currentMonday=mondayKey(today())){
  const people=new Map(employees.map(employee=>[employee.id,employee]));
  return [...tasks].sort((a,b)=>{
    const aHistory=a.status==='done'&&!!a.endDate&&a.endDate<currentMonday,bHistory=b.status==='done'&&!!b.endDate&&b.endDate<currentMonday;
    const employeeOrder=groupByEmployee?(people.get(a.assigneeId)?.name||'이전 직원').localeCompare(people.get(b.assigneeId)?.name||'이전 직원','ko')||a.assigneeId-b.assigneeId:0;
    const historyOrder=Number(aHistory)-Number(bHistory)||(aHistory&&bHistory?b.endDate!.localeCompare(a.endDate!):0);
    return (groupByEmployee?employeeOrder||historyOrder:historyOrder)||(a.startDate||'9999-12-31').localeCompare(b.startDate||'9999-12-31')||statusOrder[a.status]-statusOrder[b.status]||a.id-b.id;
  });
}
function span(start:string|null,end:string|null,days:string[]){
  if(!start||!end)return null;
  const included=days.map((date,index)=>date>=start&&date<=end?index:-1).filter(index=>index>=0);
  return included.length?{start:included[0],end:included.at(-1)!}:null;
}
function compactPeriod(start:string,end:string){return `${start.slice(5).replace('-','.')}–${end.slice(5).replace('-','.')}`;}
function dateDistanceInWeeks(from:string,to:string){return Math.max(0,Math.round((new Date(`${to}T12:00:00`).getTime()-new Date(`${from}T12:00:00`).getTime())/604800000));}

export function OpenScheduleBoard({tasks,employees,departments,projects,goals,milestones,holidays,milestoneHolidays,includeWeekends,fixedWeek=false,projectColumnWidth=132,taskColumnWidth=280,onProjectColumnWidthChange,onTaskColumnWidthChange,statusColors=defaultOpenScheduleStatusColors,statusTextColors=defaultOpenScheduleStatusTextColors,scheduleGrouping,setScheduleGrouping,showGroupingControls=true,unified=false,groupByEmployee=false,loading=false,ready=true,open,create,editableIds=[],changeStatus,statusBusy=false,editMilestone}:Props){
  const scroll=useRef<HTMLDivElement>(null);
  const contextMenuElement=useRef<HTMLDivElement>(null);
  const [localGrouping,setLocalGrouping]=useState<ScheduleGrouping>('project');
  const grouping=scheduleGrouping??localGrouping,changeGrouping=setScheduleGrouping??setLocalGrouping;
  const [contextMenu,setContextMenu]=useState<ScheduleContextMenu|null>(null);
  const [columnWidth,setColumnWidthState]=useState(()=>{try{return openScheduleColumnWidth(Number(localStorage.getItem('schedule.openColumnWidth'))||44);}catch{return 44;}});
  const [columnWidthDraft,setColumnWidthDraft]=useState(()=>String(columnWidth));
  const [fixedWeekStart,setFixedWeekStart]=useState(()=>mondayKey(today()));
  const [edgeWeeks,setEdgeWeeks]=useState({before:0,after:2});
  const [visibleRange,setVisibleRange]=useState<OpenScheduleVisibleRange>({first:0,last:Number.MAX_SAFE_INTEGER});
  const [dragging,setDragging]=useState(false);
  const [resizingColumn,setResizingColumn]=useState<'project'|'task'|null>(null);
  const drag=useRef<{pointerId:number;x:number;left:number}|null>(null),columnResize=useRef<{pointerId:number;column:'project'|'task';x:number;width:number}|null>(null),pendingPrepend=useRef(0),pendingToday=useRef<boolean|null>(null),pendingJump=useRef<{date:string;smooth:boolean}|null>(null),edgeLock=useRef({left:true,right:false}),labelFrame=useRef<number|null>(null);
  const scheduledTasks=useMemo(()=>tasks.filter(task=>task.startDate&&task.endDate),[tasks]);
  const milestoneDates=useMemo(()=>milestones.flatMap(milestone=>milestoneSchedules(milestone).map(schedule=>schedule.date)),[milestones]);
  const days=useMemo(()=>{
    if(!fixedWeek)return openScheduleDays(scheduledTasks,includeWeekends,edgeWeeks.before,edgeWeeks.after,milestoneDates);
    const result:string[]=[];for(let offset=0;offset<7;offset++){const date=dayAdd(fixedWeekStart,offset);if(includeWeekends||offset<5)result.push(date);}return result;
  },[scheduledTasks,includeWeekends,edgeWeeks,milestoneDates,fixedWeek,fixedWeekStart]);
  const groupedTasks=useMemo(()=>{
    return openScheduleTasksForWindow(openScheduleTasksForGrouping(tasks,goals,grouping,unified),days[0],unified);
  },[tasks,goals,grouping,days,unified]);
  const people=useMemo(()=>new Map(employees.map(employee=>[employee.id,employee])),[employees]);
  const projectMap=useMemo(()=>new Map(projects.map(project=>[project.id,project])),[projects]);
  const goalMap=useMemo(()=>new Map(goals.map(goal=>[goal.id,goal])),[goals]);
  const groups=useMemo(()=>{
    const grouped=new Map<string,ScheduleGroup>();
    for(const task of groupedTasks){
      const person=people.get(task.assigneeId),project=task.projectId==null?undefined:projectMap.get(task.projectId),goal=task.goalId==null?undefined:goalMap.get(task.goalId);
      const department=person?.departmentId==null?undefined:departments.find(item=>item.id===person.departmentId);
      const identity:Omit<ScheduleGroup,'tasks'|'milestones'>=unified
        ?{key:'mine',name:'내 일정',color:'#7d899d',projectId:null}
        :grouping==='project'
        ?{key:`project-${task.projectId??'none'}`,name:project?.name||'프로젝트 미지정',color:project?.color||'#7d899d',projectId:project?.id??null}
        :grouping==='department'
          ?{key:`department-${person?.departmentId??'none'}`,name:department?.name||person?.department||'부서 미지정',color:'#4f83c2',projectId:null}
          :{key:`goal-${task.goalId??'none'}`,name:goal?.title||'목표 미지정',color:goal?.projectId?projectMap.get(goal.projectId)?.color||'#8068bd':'#8068bd',projectId:null};
      const group=grouped.get(identity.key)||{...identity,tasks:[],milestones:[]};group.tasks.push(task);grouped.set(identity.key,group);
    }
    if(!unified&&grouping==='project')for(const milestone of milestones){
      if(fixedWeek&&!milestoneSchedules(milestone).some(schedule=>days.includes(schedule.date)))continue;
      const project=milestone.projectId==null?undefined:projectMap.get(milestone.projectId),key=`project-${milestone.projectId??'none'}`;
      const group=grouped.get(key)||{key,name:project?.name||'프로젝트 미지정',color:project?.color||'#7d899d',projectId:project?.id??null,tasks:[],milestones:[]};
      group.milestones.push(milestone);grouped.set(key,group);
    }
    return [...grouped.values()]
      .map(group=>({...group,tasks:openScheduleSortTasks(group.tasks,employees,groupByEmployee)}))
      .sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  },[groupedTasks,people,projectMap,goalMap,departments,grouping,milestones,groupByEmployee,employees,unified,fixedWeek,days]);
  const monthSegments=useMemo(()=>segments(days,date=>date.slice(0,7),date=>`${date.slice(0,4)}년 ${Number(date.slice(5,7))}월`),[days]);
  const weekSegments=useMemo(()=>segments(days,mondayKey,date=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))} 주`),[days]);
  const dayInfo=useMemo(()=>new Map(days.map(date=>[date,calendarDay(date,holidays)])),[days,holidays]);
  const fixedColumnsWidth=projectColumnWidth+taskColumnWidth;
  const template=`${projectColumnWidth}px ${taskColumnWidth}px repeat(${days.length},${columnWidth}px)`;
  const gridStyle={gridTemplateColumns:template,'--open-project-width':`${projectColumnWidth}px`,'--open-task-width':`${taskColumnWidth}px`,'--open-fixed-width':`${fixedColumnsWidth}px`,'--open-schedule-width':`${fixedColumnsWidth+days.length*columnWidth}px`} as CSSProperties;
  const boardStyle={'--schedule-planned-color':statusColors.planned,'--schedule-progress-color':statusColors.progress,'--schedule-done-color':statusColors.done,'--schedule-planned-text':statusTextColors.planned,'--schedule-progress-text':statusTextColors.progress,'--schedule-done-text':statusTextColors.done} as CSSProperties;

  const syncLabelPosition=useCallback(()=>{const element=scroll.current;if(!element)return;element.style.setProperty('--open-schedule-scroll-left',`${element.scrollLeft}px`);const next=openScheduleVisibleRange(element.scrollLeft,element.clientWidth,fixedColumnsWidth,columnWidth,days.length);setVisibleRange(current=>current.first===next.first&&current.last===next.last?current:next);},[columnWidth,days.length,fixedColumnsWidth]);
  const scheduleLabelPosition=useCallback(()=>{if(labelFrame.current!==null)return;labelFrame.current=requestAnimationFrame(()=>{labelFrame.current=null;syncLabelPosition();});},[syncLabelPosition]);
  const moveToday=useCallback((smooth=true)=>{
    const element=scroll.current;if(!element)return;
    if(fixedWeek){const current=mondayKey(today());if(fixedWeekStart!==current){pendingToday.current=smooth;setFixedWeekStart(current);return;}element.scrollTo({left:0,behavior:smooth?'smooth':'auto'});scheduleLabelPosition();return;}
    edgeLock.current.left=true;
    if(edgeWeeks.before){pendingToday.current=smooth;setEdgeWeeks(value=>({...value,before:0}));return;}
    const mondayIndex=days.indexOf(mondayKey(today()));element.scrollTo({left:openScheduleTodayScrollLeft(Math.max(0,mondayIndex),columnWidth),behavior:smooth?'smooth':'auto'});scheduleLabelPosition();
  },[days,columnWidth,edgeWeeks.before,scheduleLabelPosition,fixedWeek,fixedWeekStart]);
  const setColumnWidth=(value:number)=>{const next=openScheduleColumnWidth(value,columnWidth);setColumnWidthState(next);setColumnWidthDraft(String(next));try{localStorage.setItem('schedule.openColumnWidth',String(next));}catch{/**/}};
  const commitColumnWidth=()=>{const value=columnWidthDraft.trim()===''?columnWidth:Number(columnWidthDraft);setColumnWidth(value);};
  const scrollToDate=useCallback((date:string,smooth:boolean)=>{
    const element=scroll.current;if(!element||!days.length)return false;
    let index=days.indexOf(date);
    if(index<0)index=days.findIndex(item=>item>=date);
    if(index<0)index=days.length-1;
    element.scrollTo({left:openScheduleTodayScrollLeft(index,columnWidth),behavior:smooth?'smooth':'auto'});edgeLock.current.left=index===0;scheduleLabelPosition();return true;
  },[columnWidth,days,scheduleLabelPosition]);
  const moveToTask=useCallback((task:Task,direction:'before'|'after')=>{
    const date=direction==='before'?task.endDate:task.startDate;if(!date)return;
    if(fixedWeek){const targetWeek=mondayKey(date);if(targetWeek===fixedWeekStart){scrollToDate(date,true);return;}pendingJump.current={date,smooth:true};setFixedWeekStart(targetWeek);return;}
    if(date<days[0]){pendingJump.current={date,smooth:true};const missing=Math.max(1,dateDistanceInWeeks(mondayKey(date),mondayKey(days[0])));setEdgeWeeks(value=>({...value,before:value.before+missing}));return;}
    if(date>days.at(-1)!){pendingJump.current={date,smooth:true};const missing=Math.max(1,dateDistanceInWeeks(mondayKey(days.at(-1)!),mondayKey(date)));setEdgeWeeks(value=>({...value,after:value.after+missing}));return;}
    scrollToDate(date,true);
  },[days,fixedWeek,fixedWeekStart,scrollToDate]);
  const initialized=useRef(false);
  useLayoutEffect(()=>{
    const element=scroll.current;if(!element)return;
    if(pendingJump.current){const pending=pendingJump.current;pendingJump.current=null;if(fixedWeek){element.scrollTo({left:0,behavior:pending.smooth?'smooth':'auto'});syncLabelPosition();}else scrollToDate(pending.date,pending.smooth);return;}
    if(pendingToday.current!==null){const smooth=pendingToday.current;pendingToday.current=null;element.scrollTo({left:0,behavior:smooth?'smooth':'auto'});syncLabelPosition();return;}
    if(pendingPrepend.current){element.scrollLeft+=pendingPrepend.current;pendingPrepend.current=0;syncLabelPosition();return;}
    if(ready&&!initialized.current){initialized.current=true;moveToday(false);}
    else syncLabelPosition();
  },[days,fixedWeek,moveToday,ready,scrollToDate,syncLabelPosition]);
  useLayoutEffect(()=>()=>{if(labelFrame.current!==null)cancelAnimationFrame(labelFrame.current);},[]);
  useLayoutEffect(()=>{const element=scroll.current;if(!element)return;syncLabelPosition();if(typeof ResizeObserver==='undefined'){window.addEventListener('resize',syncLabelPosition);return()=>window.removeEventListener('resize',syncLabelPosition);}const observer=new ResizeObserver(syncLabelPosition);observer.observe(element);return()=>observer.disconnect();},[syncLabelPosition]);
  useEffect(()=>{
    if(!contextMenu)return;
    const close=(event:Event)=>{if(!contextMenuElement.current?.contains(event.target as Node))setContextMenu(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setContextMenu(null);};
    document.addEventListener('pointerdown',close);document.addEventListener('scroll',close,true);window.addEventListener('resize',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);document.removeEventListener('keydown',escape);};
  },[contextMenu]);
  useLayoutEffect(()=>{contextMenuElement.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();},[contextMenu]);
  const extend=(side:'left'|'right')=>{
    if(side==='left'){pendingPrepend.current+=(includeWeekends?28:20)*columnWidth;setEdgeWeeks(value=>({...value,before:value.before+4}));}
    else setEdgeWeeks(value=>({...value,after:value.after+4}));
  };
  const handleScroll=()=>{
    const element=scroll.current;if(!element)return;
    scheduleLabelPosition();
    if(fixedWeek)return;
    if(element.scrollLeft<48){if(!edgeLock.current.left){edgeLock.current.left=true;extend('left');}}else if(element.scrollLeft>96)edgeLock.current.left=false;
    if(element.scrollLeft+element.clientWidth>element.scrollWidth-48){if(!edgeLock.current.right){edgeLock.current.right=true;extend('right');}}else if(element.scrollLeft+element.clientWidth<element.scrollWidth-96)edgeLock.current.right=false;
  };
  const beginDrag=(event:ReactPointerEvent<HTMLDivElement>)=>{if(event.button!==0||(event.target as HTMLElement).closest('button,a,input,select'))return;drag.current={pointerId:event.pointerId,x:event.clientX,left:event.currentTarget.scrollLeft};edgeLock.current.left=event.currentTarget.scrollLeft<=1;event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);};
  const moveDrag=(event:ReactPointerEvent<HTMLDivElement>)=>{if(!drag.current||drag.current.pointerId!==event.pointerId)return;const next=drag.current.left-(event.clientX-drag.current.x);if(next<0&&edgeLock.current.left){const prepended=(includeWeekends?28:20)*columnWidth;edgeLock.current.left=false;drag.current={pointerId:event.pointerId,x:event.clientX,left:prepended};extend('left');return;}event.currentTarget.scrollLeft=Math.max(0,next);};
  const endDrag=(event:ReactPointerEvent<HTMLDivElement>)=>{if(drag.current?.pointerId===event.pointerId){drag.current=null;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}};
  const columnLimits=(column:'project'|'task')=>column==='project'?{min:100,max:260}:{min:200,max:520};
  const changeColumnWidth=(column:'project'|'task',value:number)=>{const {min,max}=columnLimits(column),next=Math.max(min,Math.min(max,Math.round(value)));if(column==='project')onProjectColumnWidthChange?.(next);else onTaskColumnWidthChange?.(next);};
  const beginColumnResize=(event:ReactPointerEvent<HTMLDivElement>,column:'project'|'task')=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();columnResize.current={pointerId:event.pointerId,column,x:event.clientX,width:column==='project'?projectColumnWidth:taskColumnWidth};event.currentTarget.setPointerCapture(event.pointerId);setResizingColumn(column);};
  const moveColumnResize=(event:ReactPointerEvent<HTMLDivElement>)=>{const current=columnResize.current;if(!current||current.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();changeColumnWidth(current.column,current.width+event.clientX-current.x);};
  const endColumnResize=(event:ReactPointerEvent<HTMLDivElement>)=>{if(columnResize.current?.pointerId!==event.pointerId)return;columnResize.current=null;setResizingColumn(null);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
  const columnResizeHandle=(column:'project'|'task',label:string,value:number)=>{const limits=columnLimits(column),enabled=column==='project'?!!onProjectColumnWidthChange:!!onTaskColumnWidthChange;if(!enabled)return null;return <div className={`open-schedule-resize-handle${resizingColumn===column?' active':''}`} role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={value} tabIndex={0} onPointerDown={event=>beginColumnResize(event,column)} onPointerMove={moveColumnResize} onPointerUp={endColumnResize} onPointerCancel={endColumnResize} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?limits.min:event.key==='End'?limits.max:value+(event.key==='ArrowLeft'?-4:4);changeColumnWidth(column,next);}}/>;};
  const showContextMenu=(event:ReactMouseEvent,date:string,task?:Task)=>{event.preventDefault();event.stopPropagation();setContextMenu({x:Math.max(8,Math.min(event.clientX,window.innerWidth-224)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-(task?226:72))),date,task});};
  const groupingLabel=unified?'내 일정':grouping==='project'?'프로젝트':grouping==='department'?'부서':'목표';
  const visibleFirst=Math.min(days.length-1,visibleRange.first),visibleLast=Math.min(days.length-1,visibleRange.last),visibleStart=days[visibleFirst],visibleEnd=days[visibleLast];

  return <section className="open-schedule" aria-label="전체 기간 업무 일정" style={boardStyle}>
    <div className="open-schedule-actions">
      <span>{unified?<><strong>{groupedTasks.length}</strong>개 일정</>:<><strong>{groups.length}</strong>개 {groupingLabel} · <strong>{groupedTasks.length}</strong>개 일정</>}</span>
      {!unified&&showGroupingControls&&<div className="open-schedule-grouping" role="group" aria-label="전체 일정 분류">{([['project','프로젝트별'],['department','부서별'],['goal','목표별']] as const).map(([value,label])=><button type="button" className="cw-button" data-size="compact" key={value} aria-pressed={grouping===value} onClick={()=>changeGrouping(value)}>{label}</button>)}</div>}
      <span className="open-schedule-range">{days[0]} — {days.at(-1)} · {fixedWeek?'1주 고정':'끝에서 계속 불러오기'}</span>
      <span className="grow"/>
      <div className="open-schedule-column-width"><span>칸 너비</span><span className="cw-range-control"><input className="cw-range" type="range" min="32" max="300" step="4" value={columnWidth} aria-label="날짜 칸 너비" onChange={event=>setColumnWidth(Number(event.target.value))}/></span><input className="cw-form-control open-schedule-column-input" type="number" min="32" max="300" step="1" inputMode="numeric" value={columnWidthDraft} aria-label="날짜 칸 너비 직접 입력" onChange={event=>setColumnWidthDraft(event.target.value)} onBlur={commitColumnWidth} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/><span className="open-schedule-column-unit">px</span></div>
      {fixedWeek&&<><button type="button" className="cw-button" data-size="compact" aria-label="이전 주" onClick={()=>setFixedWeekStart(value=>dayAdd(value,-7))}>← 이전</button><button type="button" className="cw-button" data-size="compact" aria-label="다음 주" onClick={()=>setFixedWeekStart(value=>dayAdd(value,7))}>다음 →</button></>}
      <button type="button" className="cw-button" data-size="compact" onClick={()=>moveToday()}>오늘로 이동</button>
    </div>
    <div ref={scroll} className={`open-schedule-scroll ${dragging?'dragging':''} ${resizingColumn?'resizing-column':''}`} tabIndex={0} aria-busy={loading} onScroll={handleScroll} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="open-schedule-grid open-schedule-header" style={gridStyle}>
        <div className="open-schedule-corner project">{groupingLabel}{columnResizeHandle('project','프로젝트 칸 너비 조절',projectColumnWidth)}</div><div className="open-schedule-corner task">업무 · 담당자{columnResizeHandle('task','업무 담당자 칸 너비 조절',taskColumnWidth)}</div>
        {monthSegments.map(item=><div key={`month-${item.key}`} className="open-schedule-scale month" style={{gridColumn:`${item.start+3} / ${item.end+4}`,gridRow:1}}>{item.label}</div>)}
        {weekSegments.map(item=><div key={`week-${item.key}`} className="open-schedule-scale week" style={{gridColumn:`${item.start+3} / ${item.end+4}`,gridRow:2}}>{item.label}</div>)}
        {days.map((date,index)=>{const info=dayInfo.get(date)!,isToday=date===today();return <div key={date} className={`open-schedule-day ${info.className} ${isToday?'today':''}`} title={`${info.label}\n우클릭하여 이 날에 업무 등록`} style={{gridColumn:index+3,gridRow:3}} onContextMenu={event=>showContextMenu(event,date)}><span>{isToday?'오늘':weekDay(date)}</span><b>{Number(date.slice(8,10))}</b></div>;})}
      </div>
      {(unified||grouping!=='project')&&<MilestoneTimelineRow label="◆ 주요 일정" groupLabel={`${groupingLabel} 공통`} milestones={milestones} days={days} dayInfo={dayInfo} gridStyle={gridStyle} milestoneHolidays={milestoneHolidays} projects={projects} editMilestone={editMilestone}/>}
      {groups.map(group=>{const milestoneRows=!unified&&grouping==='project'?1:0,projectRows=`1 / ${group.tasks.length+milestoneRows+1}`;return <div key={group.key} className="open-schedule-grid open-schedule-project" style={{...gridStyle,gridTemplateRows:`${milestoneRows?'46px ':''}repeat(${group.tasks.length},54px)`,'--project-color':group.color} as CSSProperties}>
        <div className="open-schedule-project-cell" style={{gridColumn:1,gridRow:projectRows,'--project-color':group.color} as CSSProperties}/><div className="open-schedule-project-content" style={{gridColumn:1,gridRow:projectRows,'--project-color':group.color} as CSSProperties}>{!unified&&grouping==='project'?<ProjectIcon id={group.projectId??undefined}/>:<span className="open-schedule-group-mark">{group.name.slice(0,1)}</span>}<strong>{group.name}</strong><small>{group.tasks.length}개 업무{groupByEmployee?' · 직원별 묶음':''}</small></div>
        {!!milestoneRows&&<MilestoneTimelineCells label="◆ 주요 일정" milestones={group.milestones} days={days} dayInfo={dayInfo} milestoneHolidays={milestoneHolidays} editMilestone={editMilestone}/>}
        {group.tasks.map((task,rowIndex)=>{
          const person=people.get(task.assigneeId),project=task.projectId==null?undefined:projectMap.get(task.projectId),current=span(task.startDate,task.endDate,days),visibility=openScheduleVisibility(task.startDate,task.endDate,visibleStart,visibleEnd),row=rowIndex+milestoneRows+1,period=task.startDate&&task.endDate?`${task.startDate} ~ ${task.endDate}`:'기한 미지정',tooltip=`${task.title} - ${person?.name||'이전 직원'} · ${period}`,employeeGroupStart=groupByEmployee&&(rowIndex===0||group.tasks[rowIndex-1].assigneeId!==task.assigneeId),employeeClass=employeeGroupStart?' employee-group-start':'';
          const before=visibility==='before',after=visibility==='after',clippedBefore=visibility==='clipped-before'||visibility==='clipped-both',clippedAfter=visibility==='clipped-after'||visibility==='clipped-both',compact=task.startDate&&task.endDate?compactPeriod(task.startDate,task.endDate):'';
          return <div key={task.id} className="open-schedule-task-row" style={{display:'contents'}}>
            <button type="button" className={`cw-button open-schedule-task-cell${employeeClass}`} style={{gridColumn:2,gridRow:row}} onClick={()=>open(task)} onContextMenu={event=>showContextMenu(event,task.startDate&&task.startDate>=days[0]?task.startDate:days[0],task)} title={`${tooltip}\n우클릭하여 상태 변경`}><span className="open-schedule-task-title"><strong>{task.title}</strong><b className={`open-schedule-status ${task.status}`}>{task.status==='progress'?'진행중':statuses[task.status]}</b></span><span><Avatar id={person?.id} name={person?.name}/>{person?.name||'이전 직원'} · {unified?(project?.name||'프로젝트 미지정'):(person?.department||'부서 미지정')}{!task.startDate&&<> · 기한 미지정</>}</span></button>
            {days.map((date,index)=>{const info=dayInfo.get(date)!;return <div key={`${task.id}-${date}`} className={`open-schedule-cell${employeeClass} ${info.className} ${date===today()?'today':''}`} style={{gridColumn:index+3,gridRow:row}} onContextMenu={event=>showContextMenu(event,date,task)}/>;})}
            {current&&(()=>{const barWidth=(current.end-current.start+1)*columnWidth-4,barStart=fixedColumnsWidth+current.start*columnWidth,visibleBarWidth=Math.max(1,Math.min(current.end,visibleLast)-Math.max(current.start,visibleFirst)+1)*columnWidth-4,continuationLabel=`${clippedBefore?'이전 날짜부터 이어짐 · ':''}${clippedAfter?'이후 날짜까지 이어짐 · ':''}${tooltip}`;return <button type="button" className={`cw-button open-schedule-bar${clippedBefore?' continues-before':''}${clippedAfter?' continues-after':''}${employeeClass}`} data-status={task.status} onClick={()=>open(task)} onContextMenu={event=>{const rect=event.currentTarget.getBoundingClientRect(),offset=rect.width?Math.floor((event.clientX-rect.left)/Math.max(1,rect.width/(current.end-current.start+1))):0;showContextMenu(event,days[Math.min(current.end,Math.max(current.start,current.start+offset))],task);}} style={{gridColumn:`${current.start+3} / ${current.end+4}`,gridRow:row,'--project-color':unified?project?.color||group.color:group.color,'--bar-start':`${barStart}px`,'--bar-width':`${barWidth}px`,'--bar-visible-width':`${visibleBarWidth}px`} as CSSProperties} title={`${tooltip}\n우클릭하여 상태 변경`} aria-label={clippedBefore||clippedAfter?continuationLabel:undefined}><span className="open-schedule-bar-label"><span className="open-schedule-bar-title">{task.title}</span></span></button>;})()}
            {(before||after)&&<button type="button" className={`cw-button open-schedule-offscreen ${before?'before':'after'}${employeeClass}`} data-status={task.status} style={{gridColumn:(before?visibleFirst:visibleLast)+3,gridRow:row} as CSSProperties} title={`${tooltip}\n눌러서 해당 일정으로 이동`} aria-label={`${tooltip} · ${before?'이전':'이후'} 일정으로 이동`} onClick={()=>moveToTask(task,before?'before':'after')}>{before?`← 이전 · ${compact}`:`${compact} · 이후 →`}</button>}
          </div>;
        })}
      </div>})}
      {!groups.length&&<div className="open-schedule-empty" style={{minWidth:`${fixedColumnsWidth+days.length*columnWidth}px`}}>{unified?'등록된 미완료 업무가 없습니다.':grouping==='goal'?'진행 중인 목표에 연결된 일정이 없습니다.':'날짜가 지정된 업무가 없습니다.'}</div>}
    </div>
    <span className={`open-schedule-refresh${loading?' active':''}`} role="status" aria-live="polite">{loading?'갱신 중…':''}</span>
    {contextMenu&&<div ref={contextMenuElement} className="open-schedule-context-menu" role="menu" aria-label={`${contextMenu.date} 일정 메뉴`} style={{left:contextMenu.x,top:contextMenu.y}} onContextMenu={event=>event.preventDefault()}>
      <div className="open-schedule-context-date">{contextMenu.date}</div>
      <button type="button" className="cw-button" data-variant="quiet" role="menuitem" disabled={!create} onClick={()=>{const date=contextMenu.date;setContextMenu(null);create?.(date);}}>＋ 이 날에 업무 등록</button>
      {contextMenu.task&&<><div className="open-schedule-context-divider"/><div className="open-schedule-context-task" title={contextMenu.task.title}>{contextMenu.task.title}</div><div className="open-schedule-context-label">해당 업무 변경</div>{(['planned','progress','done'] as Status[]).map(status=><button type="button" className="cw-button open-schedule-context-status" data-variant="quiet" data-status={status} role="menuitem" key={status} disabled={statusBusy||!changeStatus||!editableIds.includes(contextMenu.task!.id)||contextMenu.task!.status===status} onClick={()=>{const task=contextMenu.task!;setContextMenu(null);changeStatus?.(task,status);}}><span className={`dot ${status}`}/>{status==='progress'?'진행중':statuses[status]}{contextMenu.task!.status===status&&<small>현재</small>}</button>)}</>}
    </div>}
  </section>;
}

type MilestoneTimelineProps={label:string;milestones:Milestone[];days:string[];dayInfo:Map<string,ReturnType<typeof calendarDay>>;milestoneHolidays:MilestoneHolidays;projects?:Project[];editMilestone?:Props['editMilestone']};
function MilestoneTimelineCells({label,milestones,days,dayInfo,milestoneHolidays,projects,editMilestone}:MilestoneTimelineProps){
  const occurrences=milestones.flatMap(milestone=>milestoneSchedules(milestone).map((schedule,index)=>({milestone,schedule,index}))).filter(item=>days.includes(item.schedule.date));
  return <><div className="open-schedule-milestone-label" style={{gridColumn:2,gridRow:1}}>{label}</div>{days.map((date,index)=><div key={`milestone-${date}`} className={`open-schedule-milestone-cell ${dayInfo.get(date)!.className} ${date===today()?'today':''}`} style={{gridColumn:index+3,gridRow:1}}>{occurrences.filter(item=>item.schedule.date===date).map(({milestone,schedule,index:milestoneIndex})=>{const title=schedule.memo?.trim()||milestone.title,project=projects?.find(item=>item.id===milestone.projectId);return <button type="button" className={`cw-button open-schedule-milestone milestone-${schedule.type}`} key={`${milestone.id}-${milestoneIndex}`} title={`${project?`${project.name} · `:''}${milestoneTypes[schedule.type]} · ${title}${title!==milestone.title?`\n주요 일정: ${milestone.title}`:''}`} onClick={()=>editMilestone?.(milestone)}>{projects&&<span className="open-schedule-milestone-project"><ProjectIcon id={project?.id}/><em>{project?.name||'프로젝트 미지정'}</em></span>}<span>{milestoneTypes[schedule.type]}</span><strong>{title}</strong><MilestoneCountdown schedule={schedule} holidays={milestoneHolidays} compact/></button>;})}</div>)}</>;
}
function MilestoneTimelineRow({groupLabel,...props}:MilestoneTimelineProps&{gridStyle:CSSProperties;groupLabel:string}){
  return <div className="open-schedule-grid open-schedule-global-milestones" style={{...props.gridStyle,gridTemplateRows:'46px'}}><div className="open-schedule-global-milestone-label" style={{gridColumn:1,gridRow:1}}>{groupLabel}</div><MilestoneTimelineCells {...props}/></div>;
}
