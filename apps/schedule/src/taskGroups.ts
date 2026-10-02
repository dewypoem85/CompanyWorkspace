import type { Employee, Project, Task, WorkGoal } from './types';
import { dateSpan, departmentColor } from './timeline';

export type Grouping = 'employee' | 'project' | 'department' | 'goal' | 'mine';
export type TaskGroup = { id: number; name: string; color: string; tasks: Task[] };
export function taskGroups(tasks: Task[], employees: Employee[], projects: Project[], departments: { id: number; name: string }[], mode: Exclude<Grouping, 'employee'|'mine'>, days?: string[], goals: WorkGoal[] = []): TaskGroup[] {
  const people = new Map(employees.map(p => [p.id, p]));
  const groups = new Map<number, TaskGroup>();
  const directory = mode === 'project' ? projects : mode === 'goal' ? goals.map(goal => ({ id:goal.id, name:goal.title, color:departmentColor(`goal-${goal.id}`) })) : departments.map(d => ({ ...d, color: departmentColor(d.name) }));
  for (const group of directory) groups.set(group.id, { id:group.id, name:group.name, color:group.color, tasks:[] });
  for (const task of tasks) {
    if (days && !dateSpan(task, days)) continue;
    const id = mode === 'project' ? task.projectId : mode === 'goal' ? task.goalId : people.get(task.assigneeId)?.departmentId;
    if (id != null) groups.get(id)?.tasks.push(task);
  }
  return [...groups.values()].filter(g => g.tasks.length).sort((a,b) => a.name.localeCompare(b.name, 'ko')).map(g => ({ ...g, tasks:g.tasks.sort((a,b) => (a.startDate || '').localeCompare(b.startDate || '') || a.id - b.id) }));
}
