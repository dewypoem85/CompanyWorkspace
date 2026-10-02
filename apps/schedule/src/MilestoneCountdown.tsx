import type {MilestoneSchedule} from './types';
import {milestoneCountdown} from './milestoneSchedules';
import './milestoneCountdown.css';

export type MilestoneHolidays={dates:ReadonlySet<string>;available:boolean};
export const unavailableMilestoneHolidays:MilestoneHolidays={dates:new Set(),available:false};

export function MilestoneCountdown({schedule,compact=false,holidays=unavailableMilestoneHolidays}:{schedule:MilestoneSchedule;compact?:boolean;holidays?:MilestoneHolidays}){
  const {state,calendar,weekdays}=milestoneCountdown(schedule,undefined,holidays.dates);
  return <span className="milestone-countdown" title={holidays.available?`${state} ${calendar} · 평일 ${weekdays} (토·일 및 회사에 등록된 공휴일 제외)`:`${state} ${calendar} · 회사 공휴일 정보를 불러오지 못해 평일 남은 일수를 표시할 수 없습니다.`}>
    <span>{compact?calendar:`${state} ${calendar}`}</span><span>평일 {holidays.available?weekdays:'—'}</span>
  </span>;
}
