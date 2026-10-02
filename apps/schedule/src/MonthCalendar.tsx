import type {CSSProperties} from 'react';
import {calendarDay} from './calendarDay';
import {dayAdd,today} from './api';
import {Avatar} from './Avatar';
import {ProjectIcon} from './ProjectIcon';
import {milestoneOccurrences} from './milestoneSchedules';
import {MilestoneCountdown} from './MilestoneCountdown';
import {unavailableMilestoneHolidays,type MilestoneHolidays} from './MilestoneCountdown';
import {milestoneTypes} from './types';
import {statuses} from './types';
import type {Absences,Bootstrap,Milestone,Task,TaskList} from './types';

export function monthGridStart(month:string){const first=new Date(`${month.slice(0,7)}-01T12:00:00`),day=first.getDay();return dayAdd(first.toISOString().slice(0,10),-day);}
export function monthAdd(month:string,offset:number){const value=new Date(`${month.slice(0,7)}-01T12:00:00`);value.setMonth(value.getMonth()+offset);return value.toISOString().slice(0,10);}

export type MonthTaskSegment={task:Task;start:number;end:number;lane:number;continuesBefore:boolean;continuesAfter:boolean};
export type MonthTaskWeek={days:string[];segments:MonthTaskSegment[];laneCount:number};

function selectedRange(task:Task){
  return task.startDate&&task.endDate?{start:task.startDate,end:task.endDate}:null;
}

/** Places one clipped ribbon per task and week, preserving the lane across a week boundary. */
export function monthTaskWeeks(tasks:Task[],days:string[]):MonthTaskWeek[]{
  const ranges=tasks.map(task=>({task,range:selectedRange(task)})).filter((item):item is {task:Task;range:{start:string;end:string}}=>!!item.range&&item.range.end>=days[0]&&item.range.start<=days.at(-1)!);
  let previousLanes=new Map<number,number>();
  return Array.from({length:Math.ceil(days.length/7)},(_,weekIndex)=>{
    const weekDays=days.slice(weekIndex*7,weekIndex*7+7),weekStart=weekDays[0],weekEnd=weekDays.at(-1)!;
    const candidates=ranges.filter(item=>item.range.start<=weekEnd&&item.range.end>=weekStart).map(item=>({
      ...item,
      start:Math.max(0,weekDays.findIndex(day=>day>=item.range.start)),
      end:weekDays.length-1-[...weekDays].reverse().findIndex(day=>day<=item.range.end),
      continuesBefore:item.range.start<weekStart,
      continuesAfter:item.range.end>weekEnd,
      preferred:previousLanes.get(item.task.id)
    })).sort((a,b)=>Number(b.continuesBefore)-Number(a.continuesBefore)||(a.preferred??Number.MAX_SAFE_INTEGER)-(b.preferred??Number.MAX_SAFE_INTEGER)||a.start-b.start||b.end-a.end||a.task.id-b.task.id);
    const occupied:number[]=[],segments:MonthTaskSegment[]=[],nextLanes=new Map<number,number>();
    for(const item of candidates){
      let lane=item.preferred!==undefined&&item.preferred<=occupied.length&&(occupied[item.preferred]??-1)<item.start?item.preferred:occupied.findIndex(end=>end<item.start);
      if(lane<0)lane=occupied.length;
      occupied[lane]=item.end;
      segments.push({task:item.task,start:item.start,end:item.end,lane,continuesBefore:item.continuesBefore,continuesAfter:item.continuesAfter});
      if(item.continuesAfter)nextLanes.set(item.task.id,lane);
    }
    previousLanes=nextLanes;
    return{days:weekDays,segments,laneCount:occupied.length};
  });
}

export function MonthCalendar({month,boot,tasks,milestones,absences,milestoneHolidays=unavailableMilestoneHolidays,open,create,editMilestone,detailed}:{month:string;boot:Bootstrap;tasks:TaskList;milestones:Milestone[];absences:Absences;milestoneHolidays?:MilestoneHolidays;open:(task:Task)=>void;create:(employeeId:number,date:string)=>void;editMilestone?:(milestone:Milestone)=>void;detailed:boolean}){
  const start=monthGridStart(month),days=Array.from({length:42},(_,index)=>dayAdd(start,index)),monthKey=month.slice(0,7);
  const info=new Map(days.map(day=>[day,calendarDay(day,absences.holidays||[])])),weeks=monthTaskWeeks(tasks.items,days);
  return <section className="month-calendar" aria-label={`${monthKey} 월간 일정`}>
    <div className="month-weekdays">{['일','월','화','수','목','금','토'].map(day=><b key={day}>{day}</b>)}</div>
    <div className="month-grid">{weeks.map((week,weekIndex)=>{
      const milestoneRows=Math.max(0,...week.days.map(day=>milestoneOccurrences(milestones,day).length));
      const weekStyle={'--month-info-height':`${36+milestoneRows*40}px`,'--month-lanes':week.laneCount,'--month-lane-height':detailed?'60px':'46px'} as CSSProperties;
      return <section className="month-week" data-detailed={detailed||undefined} style={weekStyle} aria-label={`${week.days[0]}부터 ${week.days.at(-1)}까지`} key={week.days[0]}>
        <div className="month-week-days">{week.days.map(day=>{const dayMilestones=milestoneOccurrences(milestones,day),dayInfo=info.get(day)!;return <article key={day} className={`${dayInfo.className} ${day===today()?'today':''} ${!day.startsWith(monthKey)?'outside-month':''}`} aria-label={dayInfo.label}>
          <header><time dateTime={day}>{Number(day.slice(8))}</time>{dayInfo.holiday&&<span>{dayInfo.holiday}</span>}<button type="button" className="cw-button" data-layout="icon" data-size="compact" data-variant="quiet" aria-label={`${day} 내 업무 등록`} onClick={()=>create(boot.me.id,day)}>＋</button></header>
          <div className="month-milestones">{dayMilestones.map(({milestone,schedule,index})=>{const label=schedule.memo?.trim()||milestone.title;return <button type="button" key={`m-${milestone.id}-${index}`} className="cw-button month-milestone" data-size="compact" title={`${milestoneTypes[schedule.type]} · ${label}${label!==milestone.title?`\n주요 일정: ${milestone.title}`:''}`} onClick={()=>editMilestone?.(milestone)}><span className="month-milestone-title">◆ {milestoneTypes[schedule.type]} · {label}</span><MilestoneCountdown schedule={schedule} holidays={milestoneHolidays} compact/></button>;})}</div>
        </article>;})}</div>
        <div className="month-task-lanes" aria-label={`${weekIndex+1}주차 업무`}>{week.segments.map(segment=>{
          const task=segment.task,employee=boot.employees.find(value=>value.id===task.assigneeId),project=boot.projects.find(value=>value.id===task.projectId),assignee=employee?.name||'이전 직원';
          const range=selectedRange(task)!;
          const label=`${task.title} · 담당 ${assignee} · ${project?.name||'프로젝트 미지정'} · ${statuses[task.status]} · ${range.start} ~ ${range.end}`;
          const segmentStyle={gridColumn:`${segment.start+1} / ${segment.end+2}`,gridRow:segment.lane+1,'--record-accent':project?.color||'#7d899d'} as CSSProperties;
          return <button type="button" className={`cw-button month-task ${task.status}`} data-layout="content" data-variant="record" data-span-days={segment.end-segment.start+1} data-continues-before={segment.continuesBefore||undefined} data-continues-after={segment.continuesAfter||undefined} style={segmentStyle} key={`${task.id}-${weekIndex}`} aria-label={label} title={detailed&&task.body?`${label}\n${task.body}`:label} onClick={()=>open(task)}>
            <span className="month-task-heading"><ProjectIcon id={project?.id}/><strong>{task.title}</strong><span className={`month-task-status ${task.status}`}>{statuses[task.status]}</span></span>
            <span className="month-task-meta"><Avatar id={employee?.id} name={assignee}/><b>{assignee}</b><span aria-hidden="true">·</span><span>{project?.name||'프로젝트 미지정'}</span></span>
            {detailed&&<span className="month-task-description">{task.body||'업무 설명 없음'}</span>}
          </button>;
        })}</div>
      </section>;
    })}</div>
  </section>;
}
