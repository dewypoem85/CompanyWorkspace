import type { Attachment, Bootstrap, Detail, Task } from './types';
import { statuses } from './types';
import type { ReviewItem, ReviewSelection } from './generated/workspace-review';

export const taskFields = [
  ['title','제목'], ['body','본문'], ['assigneeId','담당자'], ['projectId','프로젝트'],
  ['goalId','업무 목표'],
  ['startDate','시작일'], ['endDate','종료일'], ['status','진행 상태']
] as const;
export type TaskDraft = Pick<Task, typeof taskFields[number][0] | 'version'>;
export type TaskSnapshot = {form: TaskDraft; images: Attachment[]};
const safeId = (value: number) => { if (!Number.isSafeInteger(value) || value < 1) throw Error('업무 식별자 또는 버전이 올바르지 않습니다.'); return String(value); };
export function taskSnapshot(detail: Detail): TaskSnapshot {
  safeId(detail.task.id); safeId(detail.task.version);
  const form = Object.fromEntries(taskFields.map(([key]) => [key, detail.task[key] ?? null])) as TaskDraft;
  form.version = detail.task.version;
  const snapshot = {form, images: detail.attachments.filter(a => a.commentId === null)};
  taskValues(snapshot); // Reject incomplete snapshots before changing a draft.
  return snapshot;
}
export function taskValues(snapshot: TaskSnapshot): Record<string,string[]> {
  const fields: Record<string,string[]> = {};
  for (const [key] of taskFields) {
    const value = snapshot.form[key];
    if (key === 'assigneeId' || key === 'projectId' || key === 'goalId') fields[key] = [value == null && key !== 'assigneeId' ? '' : safeId(value as number)];
    else {
      if (value != null && typeof value !== 'string' || value == null && !key.endsWith('Date')) throw Error('업무 비교 필드가 누락되었습니다.');
      fields[key] = [value == null ? '' : String(value)];
    }
  }
  if (snapshot.images.some(a => typeof a.id !== 'string' || !a.id || typeof a.name !== 'string') || new Set(snapshot.images.map(a=>a.id)).size !== snapshot.images.length) throw Error('첨부 확인 정보가 올바르지 않습니다.');
  fields.attachmentIds = snapshot.images.map(a => a.id);
  return fields;
}
export function taskReviewItem(id: number, before: TaskSnapshot, draft: TaskSnapshot, current: TaskSnapshot, boot: Bootstrap): ReviewItem {
  const versions = [before,draft,current].map(taskValues);
  const images = new Map([...before.images,...draft.images,...current.images].map(a => [a.id,a]));
  return {id:safeId(id), label:`업무 #${id}`, fields:[...taskFields, ['attachmentIds','첨부 이미지']].map(([key,label]) => ({
    key,label,before:versions[0][key],draft:versions[1][key],current:versions[2][key],set:key==='attachmentIds',
    entityKind:key==='assigneeId'?'employee':key==='projectId'?'project':undefined,
    format:values=>values.map(value=>key==='assigneeId' ? `${boot.employees.find(e=>String(e.id)===value)?.name || '이전 직원'} (#${value})`
      : key==='projectId' ? value ? `${boot.projects.find(p=>String(p.id)===value)?.name || '이전 프로젝트'} (#${value})` : '미지정'
      : key==='goalId' ? value ? `${(boot.goals||[]).find(goal=>String(goal.id)===value)?.title || '이전 목표'} (#${value})` : '미지정'
      : key==='attachmentIds' ? `${images.get(value)?.name || '첨부'} (#${value})` : key==='status' ? statuses[value as keyof typeof statuses] || value : value || '—').join('\n') || '—'
  }))};
}

export function applyTaskReview(selection: ReviewSelection, id: number, before: TaskSnapshot, draft: TaskSnapshot, current: TaskSnapshot, boot: Bootstrap): TaskSnapshot {
  if (selection.id !== safeId(id)) throw Error('다른 업무의 비교 결과입니다.');
  const fields = selection.fields, allowed = [before,draft,current].map(taskValues);
  for (const [key] of [...taskFields, ['attachmentIds','첨부']]) {
    const values = fields[key];
    if (!Array.isArray(values) || !allowed.some(a => JSON.stringify(a[key]) === JSON.stringify(values))) throw Error('확인하지 않은 비교 값입니다.');
  }
  const value = (key: string) => fields[key][0];
  const form: TaskDraft = { title:value('title'), body:value('body'), assigneeId:Number(value('assigneeId')), projectId:value('projectId') ? Number(value('projectId')) : null, goalId:value('goalId') ? Number(value('goalId')) : null,
    startDate:value('startDate')||null, endDate:value('endDate')||null,
    status:value('status') as Task['status'], version:current.form.version };
  if (!form.title.trim() || form.title.trim().length>200 || form.body.trim().length>20000 || !Object.hasOwn(statuses,form.status)) throw Error('제목·본문 길이와 업무 상태를 확인해 주세요.');
  for (const date of [form.startDate,form.endDate]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) throw Error('날짜 형식이 올바르지 않습니다.');
  if (!!form.startDate !== !!form.endDate || form.startDate && form.endDate && form.startDate>form.endDate) throw Error('시작일·종료일을 함께 지정하고 날짜 순서를 확인해 주세요.');
  const assignee = boot.employees.find(e=>e.id===form.assigneeId);
  if (!assignee || !assignee.active || !assignee.access || assignee.shared || assignee.role==='master' || !boot.me.isAdmin && (assignee.isPrivate || assignee.id!==boot.me.id && !(assignee.departmentId && assignee.departmentId===boot.me.departmentId && boot.leads.some(l=>l.employeeId===boot.me.id&&l.departmentId===assignee.departmentId)))) throw Error('현재 수정할 수 있는 담당자를 선택해 주세요.');
  if (form.projectId !== null && !boot.projects.some(p=>p.id===form.projectId && (boot.me.isAdmin || !p.isPrivate))) throw Error('현재 접근할 수 있는 프로젝트를 선택해 주세요.');
  if (form.goalId !== null && !(boot.goals||[]).some(goal=>goal.id===form.goalId && (!goal.closedAt || before.form.goalId===goal.id) && (goal.projectId===null || goal.projectId===form.projectId))) throw Error('현재 업무에 연결할 수 있는 목표를 선택해 주세요.');
  const available = new Map([...draft.images.filter(a=>!before.images.some(b=>b.id===a.id)),...current.images].map(a=>[a.id,a]));
  if (fields.attachmentIds.length>10 || fields.attachmentIds.some(id=>!available.has(id))) throw Error('서버에서 제거된 첨부는 다시 업로드해야 합니다. 현재 서버 첨부를 선택하거나 취소 후 초안을 수정해 주세요.');
  return {form,images:fields.attachmentIds.map(id=>available.get(id)!)};
}
