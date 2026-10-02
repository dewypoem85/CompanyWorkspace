import {milestoneTypes,type Milestone,type MilestoneSchedule} from './types';
import {today} from './api';

const utcDay=(date:string)=>Date.parse(`${date}T00:00:00Z`)/86400000;

/** Count working dates after `from` through `to`, excluding registered company holidays. */
function weekdaysBetween(from:string,to:string,holidays:ReadonlySet<string>){
  const first=utcDay(from)+1,last=utcDay(to);
  if(first>last)return 0;
  const total=last-first+1,fullWeeks=Math.floor(total/7);
  let count=fullWeeks*5;
  for(let day=first+fullWeeks*7;day<=last;day++){
    const weekday=new Date(day*86400000).getUTCDay();
    if(weekday!==0&&weekday!==6)count++;
  }
  for(const holiday of holidays){
    const day=utcDay(holiday);
    if(day<first||day>last)continue;
    const weekday=new Date(day*86400000).getUTCDay();
    if(weekday!==0&&weekday!==6)count--;
  }
  return count;
}

export function milestoneCountdown(schedule:MilestoneSchedule,reference=today(),holidays:ReadonlySet<string>=new Set()){
  const target=schedule.endDate&&schedule.endDate>=schedule.date?schedule.endDate:schedule.date;
  const state=reference<target?'마감까지':reference>target?'마감 후':'오늘 마감';
  const difference=utcDay(target)-utcDay(reference);
  const weekdays=difference>=0?weekdaysBetween(reference,target,holidays):-weekdaysBetween(target,reference,holidays);
  const label=(days:number)=>days<0?`D+${-days}`:`D-${days}`;
  return {state,calendar:label(difference),weekdays:label(weekdays)};
}

export function milestoneSchedules(milestone:Pick<Milestone,'type'|'date'|'endDate'|'deadlineMemo'|'additionalSchedules'>):MilestoneSchedule[]{
  return [{type:milestone.type||'general',date:milestone.endDate||milestone.date,memo:milestone.deadlineMemo||''},...(milestone.additionalSchedules||[]).map(item=>({type:item.type,date:item.endDate||item.date,memo:item.memo||''}))];
}

export function milestoneDateSummary(milestone:Pick<Milestone,'type'|'date'|'endDate'|'deadlineMemo'|'additionalSchedules'>){
  return milestoneSchedules(milestone).sort((a,b)=>a.date.localeCompare(b.date)).map(schedule=>`${milestoneTypes[schedule.type]} ${schedule.date}${schedule.memo?` · ${schedule.memo}`:''}`).join(' · ');
}

export function milestoneOccurrences(milestones:Milestone[],day:string){
  return milestones.flatMap(milestone=>milestoneSchedules(milestone).flatMap((schedule,index)=>
    schedule.date===day?[{milestone,schedule,index}]:[]));
}
