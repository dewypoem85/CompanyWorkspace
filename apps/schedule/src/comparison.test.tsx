import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dateSpan, placeTasks, timelineDays } from './timeline';
import { ReleaseBadge } from './Releases';
import { releaseName, type Task } from './types';
const task = { id: 1, title: '업무', startDate: '2026-01-01', endDate: '2026-01-03' } as Task;
describe('업무 일정 배치', () => {
  it('시작일부터 종료일까지 하나의 막대로 배치한다', () => {
    const days = timelineDays('2025-12-29', 2, true);
    const placements = placeTasks([task], days);
    expect(placements).toHaveLength(1); expect(placements[0].task).toBe(task);
    expect(placements.map(x=>[x.start,x.end,x.lane])).toEqual([[3,5,0]]);
    expect(dateSpan(task, days)).toEqual({ start:3, end:5 });
    expect(placeTasks([task], ['2026-01-07'])).toHaveLength(0);
  });
  it('기본 버전과 마이너 표기 및 건너뜀 경고를 표시한다', () => {
    expect(releaseName({ baseVersion:770, minor:0 })).toBe('770');
    expect(releaseName({ baseVersion:770, minor:10 })).toBe('770.10');
    expect(renderToStaticMarkup(<ReleaseBadge status="stable" />)).toContain('data-tone="success"');
    expect(renderToStaticMarkup(<ReleaseBadge status="unrecorded" />)).toContain('data-tone="neutral"');
    const skipped = renderToStaticMarkup(<ReleaseBadge status="skipped" />);
    expect(skipped).toContain('class="release-status cw-state-pill"');
    expect(skipped).toContain('data-tone="danger"');
    expect(skipped).toContain('버전 건너뜀');
  });
});
