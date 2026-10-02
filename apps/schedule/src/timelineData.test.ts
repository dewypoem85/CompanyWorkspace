import { describe, expect, it, vi } from 'vitest';
import { emptyTasks, loadWeeks, type WeekData } from './timelineData';
import { extendRange, timelineDays } from './timeline';
import type { Task } from './types';

const data = (): WeekData => ({ tasks: { ...emptyTasks, items: [{ id: 7, version: 1, startDate: '2026-09-07', endDate: '2026-09-21' } as Task], total: 1 }, milestones: [], absences: { items: [], available: true, updatedAt: null } });
describe('가로 일정 지연 로딩', () => {
  it('새 주만 불러오고 여러 주에 걸친 업무를 중복 표시하지 않는다', async () => {
    const fetcher = vi.fn(async () => data());
    const first = await loadWeeks('2026-09-07', 2, '', new Map(), false, fetcher);
    const next = await loadWeeks('2026-09-07', 3, '', first.cache, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3); expect(next.tasks.total).toBe(1); expect(next.tasks.items).toHaveLength(1);
    await loadWeeks('2026-09-07', 3, 'projectId=10', next.cache, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('새로고침은 기존 구간도 갱신하고 실패한 구간은 캐시에 부분 반영하지 않는다', async () => {
    const fetcher = vi.fn(async () => data());
    const first = await loadWeeks('2026-09-07', 2, '', new Map(), false, fetcher);
    await loadWeeks('2026-09-07', 2, '', first.cache, true, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const fails = vi.fn(async () => { throw new Error('연결 실패'); });
    await expect(loadWeeks('2026-09-07', 3, '', first.cache, false, fails)).rejects.toThrow('연결 실패');
    expect(first.cache.size).toBe(2);
  });
  it('양방향 이동과 연도 경계에서 최대 8주만 유지하며 계속 이동한다', async () => {
    let range = { start: '2026-12-28', count: 2 };
    for (let i = 0; i < 80; i++) range = extendRange(range, 1);
    expect(range.count).toBe(8); expect(range.start > '2027-01-01').toBe(true);
    const before = range.start; range = extendRange(range, -1);
    expect(range.start < before).toBe(true);
    expect(timelineDays(range.start, range.count, false)).toHaveLength(40);
    const result = await loadWeeks(range.start, range.count, '', new Map([['old', data()]]), false, async () => data());
    expect(result.cache.size).toBe(8); expect(result.cache.has('old')).toBe(false);
  });
});
