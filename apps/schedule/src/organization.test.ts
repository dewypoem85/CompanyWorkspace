import { describe, expect, it } from 'vitest';
import { defaultProjectId, recommendedProjects, visiblePeople } from './organization';
import type { Employee, Project, Task } from './types';

const person = (id: number, projectIds: number[], active = true): Employee => ({ id, projectIds, active, name:`직원 ${id}`, department:'개발', departmentId:1, role:'employee', access:true, shared:false, isAdmin:false });
describe('조직 정보와 일정 표시', () => {
  it('본인 행만 맨 위로 올리고 나머지 순서와 원본 배열을 유지한다', () => {
    const people = [person(3,[]), person(1,[]), person(2,[])];
    expect(visiblePeople(people, [], '', '', '', 2).map(p=>p.id)).toEqual([2,3,1]);
    expect(people.map(p=>p.id)).toEqual([3,1,2]);
    expect(visiblePeople(people, [], '', '', '', 99).map(p=>p.id)).toEqual([3,1,2]);
    expect(visiblePeople(people, [], '', '', '1', 2).map(p=>p.id)).toEqual([1]);
    expect(visiblePeople(people, [], '', '99', '', 2)).toEqual([]);
  });
  it('업무 없는 참여자와 탈퇴·비활성 직원의 기존 업무를 함께 보여준다', () => {
    const people=[person(1,[10]),person(2,[]),person(3,[],false),person(4,[20]),person(5,[10],false)];
    const tasks=[{assigneeId:2,projectId:10},{assigneeId:3,projectId:10},{assigneeId:4,projectId:20}] as Task[];
    expect(visiblePeople(people,tasks,'10','','').map(p=>p.id)).toEqual([1,2,3]);
    expect(visiblePeople(people,tasks,'10','1','2').map(p=>p.id)).toEqual([2]);
    expect(visiblePeople(people,tasks,'10','2','')).toEqual([]);
    expect(visiblePeople(people,tasks,'','','').map(p=>p.id)).toEqual([1,2,4]);
  });
  it('내 프로젝트 필터는 본인이 참여한 프로젝트의 참여자와 기존 담당자를 함께 보여준다', () => {
    const people=[person(1,[10]),person(2,[20]),person(3,[10,20]),person(4,[],false)];
    const tasks=[{assigneeId:4,projectId:10},{assigneeId:2,projectId:20}] as Task[];
    expect(visiblePeople(people,tasks,'mine','','',1).map(p=>p.id)).toEqual([1,3,4]);
  });
  it('참여 프로젝트를 먼저 제안하고 기존 선택을 변경하지 않는다', () => {
    const projects=[{id:10,name:'A',archived:false},{id:20,name:'B',archived:false},{id:30,name:'C',archived:true}] as Project[];
    expect(recommendedProjects(projects,person(1,[20]),30).map(p=>p.id)).toEqual([20,10,30]);
    expect(recommendedProjects(projects,person(2,[]),null).map(p=>p.id)).toEqual([10,20]);
    expect(projects.map(p=>p.id)).toEqual([10,20,30]);
  });
  it('새 업무는 참여 중인 활성 프로젝트 가운데 번호가 가장 빠른 항목을 선택한다', () => {
    const projects=[{id:30,name:'먼저 표시된 프로젝트',archived:false},{id:10,name:'번호가 빠른 프로젝트',archived:false},{id:5,name:'보관 프로젝트',archived:true},{id:20,name:'미참여 프로젝트',archived:false}] as Project[];
    expect(defaultProjectId(projects,person(1,[30,10,5]))).toBe(10);
    expect(defaultProjectId(projects,person(2,[5]))).toBeNull();
    expect(defaultProjectId(projects,person(3,[]))).toBeNull();
    expect(projects.map(p=>p.id)).toEqual([30,10,5,20]);
  });
});
