import { dayAdd } from './api';
import type { Task } from './types';

export type WeekSpan = 1 | 2 | 4;
export type Density = 'compact' | 'detail';
export const weekDay = (date: string) => ['일', '월', '화', '수', '목', '금', '토'][new Date(date + 'T12:00:00').getDay()];
export function timelineDays(start: string, weeks: number, weekends: boolean) {
  return Array.from({ length: weeks * 7 }, (_, i) => dayAdd(start, i))
    .filter(date => weekends || !['토', '일'].includes(weekDay(date)));
}

export function placeTasks(tasks: Task[], days: string[]) {
  const occupied: number[] = [];
  return tasks.filter(t => t.startDate && t.endDate && days.some(d => d >= t.startDate! && d <= t.endDate!))
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!) || b.endDate!.localeCompare(a.endDate!) || a.id - b.id)
    .map(task => {
      const start = days.findIndex(d => d >= task.startDate!);
      const end = days.length - 1 - [...days].reverse().findIndex(d => d <= task.endDate!);
      let lane = occupied.findIndex(last => last < start);
      if (lane < 0) lane = occupied.length;
      occupied[lane] = end;
      return { task, start, end, lane };
    });
}

export function visibleLanes(placements: ReturnType<typeof placeTasks>, density: Density, expanded: boolean) {
  const total = Math.max(1, ...placements.map(p => p.lane + 1));
  const lanes = expanded ? total : Math.min(density === 'compact' ? 1 : 2, total);
  return { lanes, total, visible: placements.filter(p => p.lane < lanes), hidden: placements.filter(p => p.lane >= lanes).length };
}

export type TimelineRange = { start: string; count: number };
export function extendRange(range: TimelineRange, direction: -1 | 1): TimelineRange {
  const count = Math.min(8, range.count + 1);
  return { start: dayAdd(range.start, direction === -1 ? -7 : range.count === 8 ? 7 : 0), count };
}
export function departmentColor(name: string) {
  if (name.includes('기획')) return '#b77916';
  if (name.includes('개발')) return '#3874c9';
  if (name.includes('아트') || name.includes('디자인')) return '#9663c4';
  return '#64867d';
}

export function dateSpan(task: Task, days: string[]) {
  const included = days.map((d, i) => task.startDate && task.endDate && d >= task.startDate && d <= task.endDate ? i : -1).filter(i => i >= 0);
  return included.length ? { start: included[0], end: included[included.length - 1] } : null;
}
