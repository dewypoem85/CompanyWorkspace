import {describe,expect,it} from 'vitest';
import {PAGES} from './generated/workspace-pages';

describe('일정 페이지 구성',()=>{
  it('전체 기간 일정을 기본 주간 일정으로 제공하고 이전 주소도 호환한다',()=>{
    const week=PAGES.find(page=>page.id==='schedule.week');
    expect(week).toMatchObject({path:'/',title:'주간 일정',view:'week'});
    expect(week?.aliases).toContain('/comparison');
    expect(PAGES.map(page=>String(page.id))).not.toContain('schedule.comparison');
  });
});
