import { dayAdd } from './api';
import type { Absences, Milestone, TaskList } from './types';

export type WeekData = { tasks: TaskList; milestones: Milestone[]; absences: Absences };
export const emptyTasks: TaskList = { items: [], total: 0, editableIds: [], commentCounts: [], attachmentCounts: [], scheduleItems: [], sharedTodos: [] };
export function mergeTaskLists(lists: TaskList[]): TaskList {
  const items = new Map<number, TaskList['items'][number]>();
  for (const list of lists) for (const task of list.items) if (!items.has(task.id) || items.get(task.id)!.version <= task.version) items.set(task.id, task);
  return { items: [...items.values()], total: items.size,
    editableIds: [...new Set(lists.flatMap(l => l.editableIds))],
    commentCounts: [...new Map(lists.flatMap(l => l.commentCounts).map(c => [c.taskId, c])).values()],
    attachmentCounts: [...new Map(lists.flatMap(l => l.attachmentCounts).map(c => [c.taskId, c])).values()],
    scheduleItems: [...new Map(lists.flatMap(l => l.scheduleItems||[]).map(item => [item.id, item])).values()],
    sharedTodos: [...new Map(lists.flatMap(l => l.sharedTodos||[]).map(item => [item.id, item])).values()] };
}
export async function loadWeeks(start: string, count: number, filters: string, cache: Map<string, WeekData>, force: boolean, fetcher: (start: string, filters: string) => Promise<WeekData>) {
  const entries: [string, WeekData][] = [];
  // Keep requests bounded even when zooming out to several weeks.
  for (let i = 0; i < count; i++) {
    const date = dayAdd(start, i * 7); const key = `${filters}|${date}`;
    entries.push([key, !force && cache.has(key) ? cache.get(key)! : await fetcher(date, filters)]);
  }
  const rows = entries.map(([, data]) => data);
  return { cache: new Map(entries), tasks: mergeTaskLists(rows.map(r => r.tasks)),
    milestones: [...new Map(rows.flatMap(r => r.milestones).map(m => [m.id, m])).values()],
    absences: { items: rows.flatMap(r => r.absences.items), holidays: rows.flatMap(r => r.absences.holidays || []),
      available: rows.every(r => r.absences.available), holidaysAvailable: rows.every(r => r.absences.holidaysAvailable !== false),
      updatedAt: rows.map(r => r.absences.updatedAt).filter(Boolean).sort()[0] || null } as Absences };
}
