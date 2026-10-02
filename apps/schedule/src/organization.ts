import type { Employee, Project, Task } from './types';

export function visiblePeople(employees: Employee[], tasks: Task[], project: string, department: string, person: string, currentUserId?: number) {
  const mine=project==='mine',projectId = Number(project),mineIds=new Set(employees.find(employee=>employee.id===currentUserId)?.projectIds||[]);
  const projectMatch=(id:number|null)=>mine?(id!==null&&mineIds.has(id)):id===projectId;
  const historical = new Set(tasks.filter(t => projectMatch(t.projectId)).map(t => t.assigneeId));
  return employees.filter(p => p.role !== 'master' && ((p.active && !p.shared && p.access) || (!!project && historical.has(p.id)))
    && (!project || (mine?p.projectIds.some(id=>mineIds.has(id)):p.projectIds.includes(projectId)) || historical.has(p.id))
    && (!department || String(p.departmentId) === department) && (!person || String(p.id) === person))
    .sort((a, b) => Number(b.id === currentUserId) - Number(a.id === currentUserId));
}
export function recommendedProjects(projects: Project[], employee: Employee | undefined, selected: number | null) {
  const joined = new Set(employee?.projectIds || []);
  return projects.filter(p => !p.archived || p.id === selected).sort((a,b) => Number(joined.has(b.id)) - Number(joined.has(a.id)) || a.name.localeCompare(b.name));
}

export function defaultProjectId(projects: Project[], employee: Employee | undefined) {
  const joined = new Set(employee?.projectIds || []);
  return projects.reduce<number | null>((first, project) => {
    if (project.archived || !joined.has(project.id)) return first;
    return first === null || project.id < first ? project.id : first;
  }, null);
}
