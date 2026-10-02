import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { vi, afterEach } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
import { WeekBoard } from './WeekBoard';
import { MilestoneDetails } from './Settings';
import type { Milestone } from './types';

it('주간·모바일·상세에서 프로젝트와 프로토타입을 표시하고 미지정도 구분한다', () => {
  const projects = [{ id: 10, name: '던전 슬래셔', color: '#123456', archived: false, version: 1 }];
  const milestone: Milestone = { id: 1, title: '조작감 시연', date: '2026-09-08', description: '준비 사항', type: 'prototype', projectId: 10, version: 1 };
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const html = renderToStaticMarkup(<WeekBoard days={[milestone.date]} people={[]} tasks={[]}
    milestones={[milestone, { ...milestone, id: 2, projectId: null, title: '공통 시연' }]}
    projects={projects} absences={{ items: [], available: true, updatedAt: null }} project="" density="compact"
    card={() => null} create={() => {}} canAssign={() => false} editMilestone={() => {}} />);
  expect(html.match(/class="milestone-project-name">던전 슬래셔/g)).toHaveLength(2);
  expect(html.match(/class="milestone-project-name">프로젝트 미지정/g)).toHaveLength(2);
  expect(html.match(/class="cw-entity-avatar"/g)).toHaveLength(2);
  expect(html).toContain('던전 슬래셔 · 프로토타입 · 조작감 시연');
  const details = renderToStaticMarkup(<MilestoneDetails milestone={milestone} projects={projects} />);
  expect(details).toContain('던전 슬래셔'); expect(details).toContain('프로토타입');
});
