import { describe, expect, it } from 'vitest';
import { placeTasks } from './WeekBoard';
import { dayAdd, monday } from './api';
import type { Task } from './types';
import { timelineDays, visibleLanes, weekDay } from './timeline';
const item = (id: number, startDate: string | null, endDate: string | null) => ({ id, startDate, endDate } as Task);
describe('주간 기간 배치', () => {
  it('주 경계에서 막대를 잘라 표시하고 업무 하나는 한 번만 배치한다', () => {
    const days = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'];
    const placements = placeTasks([item(1, '2026-12-20', '2026-12-29'), item(2, '2026-12-29', '2027-01-04'), item(3, null, null), item(4, '2027-01-02', '2027-01-03')], days);
    expect(placements).toHaveLength(2); expect(placements[0]).toMatchObject({ start: 0, end: 1, lane: 0 }); expect(placements[1]).toMatchObject({ start: 1, end: 4, lane: 1 });
  });
  it('겹치지 않는 업무는 같은 줄을 재사용한다', () => {
    const days = ['2026-09-07', '2026-09-08', '2026-09-09'];
    const p = placeTasks([item(1, days[0], days[0]), item(2, days[1], days[2])], days); expect(p.map(x => x.lane)).toEqual([0, 0]);
  });
  it('한국 달력 날짜 연산은 연도·윤년·일요일 경계를 유지한다', () => { expect(dayAdd('2026-12-31', 1)).toBe('2027-01-01'); expect(dayAdd('2028-02-28', 1)).toBe('2028-02-29'); expect(monday('2026-09-13')).toBe('2026-09-07'); });
  it('4주 조회는 연도를 넘어도 20개 평일과 올바른 요일을 표시한다', () => {
    const days = timelineDays('2026-12-28', 4, false);
    expect(days).toHaveLength(20);
    expect(days[5]).toBe('2027-01-04'); expect(weekDay(days[5])).toBe('월');
    expect(days.at(-1)).toBe('2027-01-22');
    expect(timelineDays('2026-12-28', 4, true)).toHaveLength(28);
  });
  it('숨긴 주말에만 있는 업무는 잘못된 열에 배치하지 않고 주말 표시 시 복원한다', () => {
    const tasks = [item(1, '2026-09-12', '2026-09-13'), item(2, '2026-09-11', '2026-09-14')];
    const weekdays = placeTasks(tasks, timelineDays('2026-09-07', 2, false));
    expect(weekdays).toHaveLength(1);
    expect(weekdays[0]).toMatchObject({ start: 4, end: 5, lane: 0 });
    const allDays = placeTasks(tasks, timelineDays('2026-09-07', 2, true));
    expect(allDays.find(p => p.task.id === 1)).toMatchObject({ start: 5, end: 6, lane: 1 });
  });
  it('요약은 겹치는 업무만 숨기고 직원 펼치기로 전체 업무에 접근한다', () => {
    const days = timelineDays('2026-09-07', 2, false);
    const tasks = [item(1, days[0], days[2]), item(2, days[0], days[1]), item(3, days[0], days[0]), item(4, days[5], days[6])];
    const placed = placeTasks(tasks, days);
    const compact = visibleLanes(placed, 'compact', false);
    expect(compact.lanes).toBe(1); expect(compact.hidden).toBe(2);
    expect(compact.visible.map(p => p.task.id)).toEqual([1, 4]);
    expect(visibleLanes(placed, 'detail', false).hidden).toBe(1);
    expect(visibleLanes(placed, 'compact', true).visible).toHaveLength(4);
    expect(visibleLanes(placed, 'compact', true).hidden).toBe(0);
  });
  it('조회 범위 밖 업무와 날짜 미정 업무는 제외하고 경계 막대를 자른다', () => {
    const days = timelineDays('2026-09-07', 4, false);
    const tasks = [item(1, '2026-09-01', '2026-10-10'), item(2, '2026-10-05', '2026-10-06'), item(3, null, null)];
    expect(placeTasks(tasks, days)).toMatchObject([{ task: { id: 1 }, start: 0, end: 19, lane: 0 }]);
  });
});
