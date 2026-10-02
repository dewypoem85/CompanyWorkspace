import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { taskGroups } from './taskGroups';
import { WeekBoard } from './WeekBoard';
import type { Employee, Project, Task, WorkGoal } from './types';
const employees = [{id:1,name:'직원 A',department:'개발',departmentId:10,projectIds:[2],active:false},{id:2,name:'직원 B',department:'아트',departmentId:20,projectIds:[1],active:true}] as Employee[];
const projects = [{id:1,name:'프로젝트 A',color:'#123456'},{id:2,name:'프로젝트 B',color:'#654321'},{id:3,name:'빈 프로젝트',color:'#777777'}] as Project[];
const departments = [{id:10,name:'개발'},{id:20,name:'아트'}];
const tasks = [{id:1,title:'개발 업무',assigneeId:1,projectId:1,startDate:'2026-09-07',endDate:'2026-09-11'}, {id:2,title:'아트 업무',assigneeId:2,projectId:2,startDate:'2026-09-07',endDate:'2026-09-11'}, {id:3,title:'프로젝트 미지정',assigneeId:1,projectId:null,startDate:'2026-09-07',endDate:'2026-09-11'}] as Task[];
const goals = [{id:7,title:'슬라임 출시',description:'',projectId:1,createdBy:1,closedAt:null,closedBy:null,version:1,createdAt:'',updatedAt:''}] as WorkGoal[];
describe('업무 기준 일정 분류', () => {
  it('참여 프로젝트를 추정하지 않고 업무에 지정된 프로젝트만 포함한다', () => {
    const groups = taskGroups(tasks, employees, projects, departments, 'project');
    expect(groups.map(g=>[g.id,g.tasks.map(t=>t.id)])).toEqual([[1,[1]],[2,[2]]]);
    expect(taskGroups(tasks.filter(t=>t.projectId===1), employees, projects, departments, 'project')).toHaveLength(1);
  });
  it('담당자 부서로 묶으며 업무가 있는 비활성 직원도 보존한다', () => {
    const groups = taskGroups(tasks, employees, projects, departments, 'department');
    expect(groups.find(g=>g.id===10)?.tasks.map(t=>t.id)).toEqual([1,3]);
    expect(groups.find(g=>g.id===20)?.tasks.map(t=>t.id)).toEqual([2]);
  });
  it('목표별 보기는 목표가 연결된 업무만 해당 목표 아래에 묶는다', () => {
    const linked = [{...tasks[0],goalId:7},{...tasks[1],goalId:null}];
    const groups = taskGroups(linked, employees, projects, departments, 'goal', undefined, goals);
    expect(groups.map(group=>[group.name,group.tasks.map(task=>task.id)])).toEqual([['슬라임 출시',[1]]]);
  });
  it('조회 날짜에 포함되지 않는 업무를 제외한다', () => {
    const ranged = {...tasks[0],endDate:'2026-09-08'};
    expect(taskGroups([ranged],employees,projects,departments,'project',['2026-09-10'])).toHaveLength(0);
    expect(taskGroups([ranged],employees,projects,departments,'project',['2026-09-08'])[0].tasks).toHaveLength(1);
  });
  it('프로젝트 보기는 직원 행 없이 업무 행과 전체 펼치기·접기 버튼을 제공한다', () => {
    const html = renderToStaticMarkup(<WeekBoard grouping="project" days={['2026-09-07']} people={employees} employees={employees} projects={projects} departments={departments} tasks={tasks} milestones={[]} absences={{items:[],available:true,updatedAt:null}} project="" density="compact" card={t=><button>{t.title} · 담당자 {t.assigneeId}</button>} create={()=>{}} canAssign={()=>false} editMilestone={()=>{}} />);
    expect(html).toContain('data-task-id="1"'); expect(html).toContain('data-task-id="2"');
    expect(html).not.toContain('data-employee-id='); expect(html).not.toContain('프로젝트 미지정');
    expect(html).toContain('업무 모두 펼치기'); expect(html).toContain('업무 모두 접기');
    expect(html).not.toContain('class="milestone-row"');
  });
  it('1,000개 업무를 중복 없이 모두 분류한다', () => {
    const many = Array.from({length:1000},(_,i)=>({...tasks[i%2],id:i+1}));
    const result = taskGroups(many,employees,projects,departments,'project',['2026-09-07']);
    expect(result.reduce((n,g)=>n+g.tasks.length,0)).toBe(1000);
    expect(new Set(result.flatMap(g=>g.tasks.map(t=>t.id))).size).toBe(1000);
  });
});
