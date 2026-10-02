import {useEffect,useState} from 'react';
import {today} from './api';
import {milestoneSchedules} from './milestoneSchedules';
import {scheduleGet} from './scheduleReads';
import {createWorkspaceReadSession} from './generated/workspace-read';
import type {Milestone} from './types';
import type {MilestoneHolidays} from './MilestoneCountdown';
import {unavailableMilestoneHolidays} from './MilestoneCountdown';

type HolidayResponse={holidays:{date:string;name:string}[];available:boolean;updatedAt:string|null};

function holidayResponse(value:unknown):HolidayResponse{
  const row=value as HolidayResponse;
  if(!row||typeof row.available!=='boolean'||!Array.isArray(row.holidays)||
    row.holidays.some(item=>!item||!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||typeof item.name!=='string')||
    (!row.available&&row.holidays.length))throw Error('회사 공휴일 응답을 확인할 수 없습니다.');
  return row;
}

export function useMilestoneHolidays(milestones:Partial<Milestone>[],ownerId:number):MilestoneHolidays{
  const [clock,setClock]=useState(today);
  const [snapshot,setSnapshot]=useState<{key:string;value:MilestoneHolidays}|null>(null);
  useEffect(()=>{const timer=window.setInterval(()=>setClock(today()),60_000);return()=>window.clearInterval(timer);},[]);
  const dates=milestones.flatMap(m=>m.date?milestoneSchedules(m as Milestone).map(s=>s.date):[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d));
  const from=[clock,...dates].sort()[0],to=[clock,...dates].sort().at(-1)!;
  const key=dates.length?`${ownerId}:${from}:${to}`:'';
  useEffect(()=>{
    if(!key)return;
    let active=true;
    let session;
    try{session=createWorkspaceReadSession();}catch{return;}
    const scopeChanged=()=>{session.cancel('milestone-holidays');setSnapshot(null);};
    document.addEventListener('workspace-entity-scope-change',scopeChanged);
    const load=()=>void session.run('milestone-holidays',signal=>scheduleGet(`/api/holidays?from=${from}&to=${to}`,signal,holidayResponse)).then(result=>{
      if(!active||result.status==='cancelled'||!result.isCurrent())return;
      if(result.status==='error'||!result.value.available){setSnapshot({key,value:unavailableMilestoneHolidays});return;}
      setSnapshot({key,value:{dates:new Set(result.value.holidays.map(h=>h.date)),available:true}});
    });
    load();
    const timer=window.setInterval(load,60_000);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('workspace-entity-scope-change',scopeChanged);session.dispose();};
  },[key,from,to]);
  return snapshot?.key===key?snapshot.value:unavailableMilestoneHolidays;
}
