import {ApiError,dayAdd,monday} from './api';
import {loadWeeks,emptyTasks,type WeekData} from './timelineData';
import type {Absences,Bootstrap,Employee,Milestone,MilestoneAuditSnapshot,MilestonePage,MilestoneRevision,Task,TaskList,Status,Detail,Comment,Attachment,Change,WorkGoal,TaskScheduleItem,SharedTaskTodo,CalendarHoliday} from './types';

export type TaskReference={id:number;title:string;projectId:number|null;archived:boolean};

const id=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown)=>typeof v==='string';
const bool=(v:unknown)=>typeof v==='boolean';
const nullableId=(v:unknown)=>v===null||id(v);
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function requireValue(ok:unknown){if(!ok)throw Error('일정 조회 응답이 올바르지 않습니다. 최신 내용을 다시 조회해 주세요.');}
function unique<T>(value:unknown,validate:(row:T)=>void,key:(row:T)=>unknown):T[]{
  requireValue(Array.isArray(value));const rows=value as T[];
  rows.forEach(row=>{requireValue(row&&typeof row==='object');validate(row);});requireValue(new Set(rows.map(key)).size===rows.length);return rows;
}
function employee(e:Employee){requireValue(id(e.id)&&text(e.name)&&text(e.department)&&nullableId(e.departmentId)&&Array.isArray(e.projectIds)&&e.projectIds.every(id)&&new Set(e.projectIds).size===e.projectIds.length&&['employee','admin','master'].includes(e.role)&&bool(e.active)&&bool(e.shared)&&bool(e.access)&&bool(e.isAdmin)&&(e.isPrivate===undefined||bool(e.isPrivate)));}
export const scheduleActorScope=(me:Employee)=>JSON.stringify([me.id,me.role,me.active,me.shared,me.access,me.isAdmin]);
export function bootstrapResponse(value:unknown):Bootstrap{
  const b=value as Bootstrap;requireValue(b&&b.me);employee(b.me);
  b.goals ??= [];
  requireValue(bool(b.demo)&&text(b.csrfToken)&&b.csrfToken.length>0);
  unique<Employee>(b.employees,employee,e=>e.id);
  unique<Bootstrap['projects'][number]>(b.projects,p=>requireValue(id(p.id)&&text(p.name)&&/^#[0-9a-f]{6}$/i.test(p.color)&&bool(p.archived)&&id(p.version)&&(p.isPrivate===undefined||bool(p.isPrivate))),p=>p.id);
  unique<Bootstrap['departments'][number]>(b.departments,d=>requireValue(id(d.id)&&text(d.name)&&bool(d.archived)),d=>d.id);
  unique<Bootstrap['leads'][number]>(b.leads,l=>requireValue(id(l.id)&&id(l.employeeId)&&text(l.department)&&nullableId(l.departmentId)),l=>l.id);
  unique<WorkGoal>(b.goals,g=>requireValue(id(g.id)&&text(g.title)&&text(g.description)&&nullableId(g.projectId)&&id(g.createdBy)&&id(g.version)&&(g.closedAt===null||stamp(g.closedAt))&&(g.closedBy===null||id(g.closedBy))&&stamp(g.createdAt)&&stamp(g.updatedAt)),g=>g.id);
  if(!b.me.active||!b.me.access||b.me.shared)throw new ApiError(403,'현재 계정으로 일정에 접근할 수 없습니다.');
  return b;
}
function task(t:Task){
  t.goalId ??= null;
  requireValue(id(t.id)&&text(t.title)&&text(t.body)&&id(t.assigneeId)&&id(t.createdBy)&&nullableId(t.projectId)&&nullableId(t.goalId)&&id(t.version)&&bool(t.archived)&&['planned','progress','done'].includes(t.status)&&stamp(t.createdAt)&&stamp(t.updatedAt));
  requireValue((t.startDate===null&&t.endDate===null)||(date(t.startDate)&&date(t.endDate)&&t.startDate!<=t.endDate!));
}
export function taskListResponse(value:unknown):TaskList{
  const list=value as TaskList;requireValue(list&&count(list.total));list.scheduleItems??=[];list.sharedTodos??=[];const rows=unique<Task>(list.items,task,t=>t.id),ids=new Set(rows.map(t=>t.id));
  requireValue(list.total>=rows.length&&Array.isArray(list.editableIds)&&list.editableIds.every(v=>id(v)&&ids.has(v))&&new Set(list.editableIds).size===list.editableIds.length);
  for(const values of [list.commentCounts,list.attachmentCounts])unique<TaskList['commentCounts'][number]>(values,c=>requireValue(ids.has(c.taskId)&&count(c.count)),c=>c.taskId);
  unique<TaskScheduleItem>(list.scheduleItems,i=>{i.endDate??=i.date;requireValue(id(i.id)&&ids.has(i.taskId)&&text(i.title)&&date(i.date)&&date(i.endDate)&&i.date<=i.endDate&&id(i.createdBy)&&id(i.version)&&stamp(i.createdAt)&&stamp(i.updatedAt));},i=>i.id);
  unique<SharedTaskTodo>(list.sharedTodos,i=>requireValue(id(i.id)&&ids.has(i.taskId)&&text(i.title)&&id(i.createdBy)&&(i.completedBy===null||id(i.completedBy))&&(i.completedAt===null||stamp(i.completedAt))&&id(i.version)&&stamp(i.createdAt)&&stamp(i.updatedAt)),i=>i.id);
  const scheduleItems=list.scheduleItems||[],sharedTodos=list.sharedTodos||[];
  list.items=rows.map(item=>({...item,scheduleItems:scheduleItems.filter(value=>value.taskId===item.id),sharedTodos:sharedTodos.filter(value=>value.taskId===item.id)}));
  return list;
}
export function archivedTaskPageResponse(value:unknown):TaskList{
  const page=taskListResponse(value);requireValue(page.items.every(item=>item.archived));return page;
}
export function mergeTaskListPages(previous:TaskList,next:TaskList):TaskList{
  requireValue(next.total===previous.total&&previous.items.length<previous.total&&next.items.length>0);
  requireValue(!next.items.some(item=>previous.items.some(old=>old.id===item.id)));
  const merged={...next,items:[...previous.items,...next.items],editableIds:[...previous.editableIds,...next.editableIds],commentCounts:[...previous.commentCounts,...next.commentCounts],attachmentCounts:[...previous.attachmentCounts,...next.attachmentCounts],scheduleItems:[...(previous.scheduleItems||[]),...(next.scheduleItems||[])],sharedTodos:[...(previous.sharedTodos||[]),...(next.sharedTodos||[])]};
  requireValue(merged.items.length<=merged.total);return taskListResponse(merged);
}
export function taskDetailResponse(value:unknown,expectedId:number):Detail{
  const d=value as Detail;requireValue(d&&d.task&&id(expectedId));d.scheduleItems??=[];d.sharedTodos??=[];task(d.task);
  requireValue(d.task.id===expectedId&&bool(d.canEdit)&&(!d.task.archived||!d.canEdit));
  const comments=unique<Comment>(d.comments,c=>requireValue(id(c.id)&&c.taskId===expectedId&&id(c.authorId)&&nullableId(c.parentId)&&c.parentId!==c.id&&text(c.body)&&bool(c.deleted)&&id(c.version)&&stamp(c.createdAt)&&(c.editedAt===null||stamp(c.editedAt))),c=>c.id);
  const byId=new Map(comments.map(c=>[c.id,c]));
  // Replies survive deleted parents, but must belong to an existing top-level comment.
  comments.forEach(c=>requireValue(c.parentId===null||byId.has(c.parentId)&&byId.get(c.parentId)!.parentId===null));
  unique<Attachment>(d.attachments,a=>requireValue(text(a.id)&&a.id.length>0&&a.taskId===expectedId&&(a.commentId===null||id(a.commentId)&&byId.has(a.commentId)&&!byId.get(a.commentId)!.deleted)&&text(a.name)&&text(a.contentType)&&count(a.size)),a=>a.id);
  unique<Change>(d.history,h=>requireValue(id(h.id)&&id(h.actorId)&&text(h.action)&&text(h.details)&&stamp(h.createdAt)),h=>h.id);
  unique<TaskScheduleItem>(d.scheduleItems,i=>{i.endDate??=i.date;requireValue(id(i.id)&&i.taskId===expectedId&&text(i.title)&&date(i.date)&&date(i.endDate)&&i.date<=i.endDate&&id(i.createdBy)&&id(i.version)&&stamp(i.createdAt)&&stamp(i.updatedAt));},i=>i.id);
  unique<SharedTaskTodo>(d.sharedTodos,i=>requireValue(id(i.id)&&i.taskId===expectedId&&text(i.title)&&id(i.createdBy)&&(i.completedBy===null||id(i.completedBy))&&(i.completedAt===null||stamp(i.completedAt))&&id(i.version)&&stamp(i.createdAt)&&stamp(i.updatedAt)),i=>i.id);
  if(d.commentEditing!==undefined){
    const token=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    requireValue(text(d.commentEditing.actorId)&&token(d.commentEditing.createStateToken));
    const states=unique<NonNullable<Detail['commentEditing']>['comments'][number]>(d.commentEditing.comments,row=>requireValue(id(row.id)&&byId.has(row.id)&&token(row.stateToken)),row=>row.id);
    requireValue(states.length===comments.length);
  }
  return d;
}
export function taskReferenceResponse(value:unknown,expectedId:number):TaskReference{
  const reference=value as TaskReference;requireValue(reference&&id(expectedId)&&reference.id===expectedId&&text(reference.title)&&nullableId(reference.projectId)&&bool(reference.archived));return reference;
}
export function assertCurrentTaskDetail(previous:Detail|undefined,next:Detail){
  if(!previous||previous.task.id!==next.task.id)return;
  const comments=new Map(next.comments.map(c=>[c.id,c]));
  requireValue(next.task.version>=previous.task.version&&previous.comments.every(c=>comments.has(c.id)&&comments.get(c.id)!.version>=c.version));
}
export function milestoneResponse(value:unknown):Milestone[]{return unique<Milestone>(value,m=>requireValue(id(m.id)&&text(m.title)&&text(m.description)&&(m.deadlineMemo===undefined||typeof m.deadlineMemo==='string'&&m.deadlineMemo.length<=200)&&date(m.date)&&(!m.endDate||date(m.endDate))&&(!m.endDate||m.endDate>=m.date)&&nullableId(m.projectId)&&id(m.version)&&(m.type===undefined||['general','review','update','prototype'].includes(m.type))&&(m.additionalSchedules===undefined||Array.isArray(m.additionalSchedules)&&m.additionalSchedules.length<=20&&m.additionalSchedules.every(s=>s&&['general','review','update','prototype'].includes(s.type)&&date(s.date)&&(!s.endDate||date(s.endDate)&&s.endDate>=s.date)&&(s.memo===undefined||typeof s.memo==='string'&&s.memo.length<=200)))&&(m.createdBy===undefined||nullableId(m.createdBy))&&(m.updatedBy===undefined||nullableId(m.updatedBy))&&(m.createdAt===undefined||m.createdAt===null||stamp(m.createdAt))&&(m.updatedAt===undefined||m.updatedAt===null||stamp(m.updatedAt))),m=>m.id);}
function milestoneAuditSnapshot(value:unknown):MilestoneAuditSnapshot{
  const snapshot=structuredClone(value) as MilestoneAuditSnapshot;
  requireValue(snapshot&&text(snapshot.title)&&text(snapshot.description)&&(snapshot.deadlineMemo===undefined||typeof snapshot.deadlineMemo==='string'&&snapshot.deadlineMemo.length<=200)&&date(snapshot.date)&&(!snapshot.endDate||date(snapshot.endDate))&&nullableId(snapshot.projectId)&&['general','review','update','prototype'].includes(snapshot.type)&&Array.isArray(snapshot.additionalSchedules)&&snapshot.additionalSchedules.length<=20&&snapshot.additionalSchedules.every(s=>s&&['general','review','update','prototype'].includes(s.type)&&date(s.date)&&(s.memo===undefined||typeof s.memo==='string'&&s.memo.length<=200)));
  return snapshot;
}
export function milestoneRevisionResponse(value:unknown,expectedId:number):MilestoneRevision[]{return unique<MilestoneRevision>(value,r=>{
  requireValue(id(r.id)&&r.milestoneId===expectedId&&id(r.actorId)&&['create','update','delete'].includes(r.action)&&text(r.beforeSnapshot)&&text(r.afterSnapshot)&&stamp(r.createdAt));
  for(const snapshot of [r.beforeSnapshot,r.afterSnapshot])if(snapshot)milestoneAuditSnapshot(JSON.parse(snapshot));
},r=>r.id);}
export function milestonePageResponse(value:unknown):MilestonePage{
  const page=value as MilestonePage,items=milestoneResponse(page?.items),tokens=page?.editing;
  const token=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  requireValue(tokens&&text(tokens.actorId)&&token(tokens.createStateToken));
  const rows=unique<MilestonePage['editing']['milestones'][number]>(tokens.milestones,row=>requireValue(id(row.id)&&token(row.stateToken)),row=>row.id);
  // The editing set can cover rows outside the selected date range, but every
  // visible item must have exactly one write baseline.
  requireValue(items.every(item=>rows.some(row=>row.id===item.id)));
  return page;
}
export function absencesResponse(value:unknown):Absences{
  const a=value as Absences;requireValue(a&&bool(a.available)&&(a.updatedAt===null||stamp(a.updatedAt))&&(a.holidaysAvailable===undefined||bool(a.holidaysAvailable))&&Array.isArray(a.items));
  a.items.forEach(i=>requireValue(i&&id(i.employeeId)&&date(i.date)&&text(i.portion)));
  requireValue(a.holidays===undefined||Array.isArray(a.holidays));a.holidays?.forEach(h=>requireValue(h&&date(h.date)&&text(h.name)));return a;
}
type HolidayResponse={holidays:CalendarHoliday[];available:boolean;updatedAt:string|null};
function holidayResponse(value:unknown):HolidayResponse{
  const response=value as HolidayResponse;requireValue(response&&bool(response.available)&&(response.updatedAt===null||stamp(response.updatedAt))&&Array.isArray(response.holidays));
  response.holidays.forEach(item=>requireValue(item&&date(item.date)&&text(item.name)));
  requireValue(response.available||response.holidays.length===0);return response;
}
// This transport never navigates or mutates a shared login state from a late body.
export async function scheduleGet<T>(path:string,signal:AbortSignal,parse:(value:unknown)=>T):Promise<T>{
  signal.throwIfAborted();
  const response=await fetch(path,{signal,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  signal.throwIfAborted();
  if(!response.ok)throw new ApiError(response.status,[401,403].includes(response.status)?'로그인·권한을 다시 확인해 주세요.':'일정 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  if(response.redirected||!response.headers.get('content-type')?.includes('application/json'))throw Error('일정 조회 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  const value=await response.json();signal.throwIfAborted();return parse(value);
}
export type BoardQuery={view:'week'|'month'|'kanban';unscheduled:boolean;onlyWeek:boolean;week:string;loadedWeeks:number;limit:number;department:string;project:string;person:string;goal:string;includePlanning?:boolean;allOpen?:boolean;includeUnscheduledOpen?:boolean};
export const emptyBoard=():WeekData=>({tasks:{...emptyTasks},milestones:[],absences:{items:[],available:true,updatedAt:null}});
export function milestonesForProject(milestones:Milestone[],project:string,mineProjectIds:readonly number[]){
  if(!project)return milestones;
  if(project==='mine'){const mine=new Set(mineProjectIds);return milestones.filter(milestone=>milestone.projectId!==null&&mine.has(milestone.projectId));}
  const projectId=Number(project);return Number.isSafeInteger(projectId)&&projectId>0?milestones.filter(milestone=>milestone.projectId===projectId):[];
}
export async function readScheduleBoard(o:BoardQuery,cache:Map<string,WeekData>,force:boolean,signal:AbortSignal):Promise<WeekData&{cache:Map<string,WeekData>}>{
  const q=new URLSearchParams();if(o.department)q.set('departmentId',o.department);if(o.project)q.set('projectId',o.project);if(o.person)q.set('assigneeId',o.person);if(o.goal)q.set('goalId',o.goal);if(o.includePlanning)q.set('includePlanning','true');
  const milestoneProject=o.project?`&projectId=${encodeURIComponent(o.project)}`:'';
  const get=<T,>(path:string,parse:(v:unknown)=>T)=>scheduleGet(path,signal,parse);
  async function taskPages(query:string,max=Infinity):Promise<TaskList>{
    const first=await get(`/api/tasks?${query}&take=${Math.min(max,200)}`,taskListResponse);let merged=first;
    for(let skip=200;skip<Math.min(max,first.total);skip+=200){
      const next=await get(`/api/tasks?${query}&take=${Math.min(max-skip,200)}&skip=${skip}`,taskListResponse);
      requireValue(next.total===first.total&&next.items.length>0&&!next.items.some(row=>merged.items.some(old=>old.id===row.id)));
      merged={...first,items:[...merged.items,...next.items],editableIds:[...merged.editableIds,...next.editableIds],commentCounts:[...merged.commentCounts,...next.commentCounts],attachmentCounts:[...merged.attachmentCounts,...next.attachmentCounts],scheduleItems:[...(merged.scheduleItems||[]),...(next.scheduleItems||[])],sharedTodos:[...(merged.sharedTodos||[]),...(next.sharedTodos||[])]};
    }
    requireValue(merged.items.length===Math.min(max,first.total));return merged;
  }
  if(o.allOpen){
    if(!o.includeUnscheduledOpen)q.set('scheduled','true');
    const openLists=await Promise.all((['planned','progress'] as Status[]).map(status=>taskPages(`${q}&status=${status}`)));
    const openTasks=openLists.reduce((a,b)=>({items:[...a.items,...b.items],total:a.total+b.total,editableIds:[...a.editableIds,...b.editableIds],commentCounts:[...a.commentCounts,...b.commentCounts],attachmentCounts:[...a.attachmentCounts,...b.attachmentCounts],scheduleItems:[...(a.scheduleItems||[]),...(b.scheduleItems||[])],sharedTodos:[...(a.sharedTodos||[]),...(b.sharedTodos||[])]}),{...emptyTasks});
    const dates=openTasks.items.flatMap(task=>[task.startDate,task.endDate]).filter((value):value is string=>!!value).sort();
    const from=monday([o.week,...dates].sort()[0]),to=dayAdd(monday([o.week,...dates].sort().at(-1)!),6);
    const done=await taskPages(`${q}&status=done&from=${from}&to=${to}`);
    const tasks=[openTasks,done].reduce((a,b)=>({items:[...a.items,...b.items],total:a.total+b.total,editableIds:[...a.editableIds,...b.editableIds],commentCounts:[...a.commentCounts,...b.commentCounts],attachmentCounts:[...a.attachmentCounts,...b.attachmentCounts],scheduleItems:[...(a.scheduleItems||[]),...(b.scheduleItems||[])],sharedTodos:[...(a.sharedTodos||[]),...(b.sharedTodos||[])]}),{...emptyTasks});
    taskListResponse(tasks);
    const [milestones,holidays]=await Promise.all([get(`/api/milestones?from=${from}&to=${to}${milestoneProject}`,milestoneResponse),get(`/api/holidays?from=${from}&to=${to}`,holidayResponse)]);
    return {tasks,milestones,absences:{items:[],holidays:holidays.holidays,holidaysAvailable:holidays.available,available:true,updatedAt:holidays.updatedAt},cache:new Map<string,WeekData>()};
  }
  if((o.view==='week'||o.view==='month')&&!o.unscheduled){
    const loaded=await loadWeeks(o.week,o.loadedWeeks,q.toString(),cache,force,async(start,filters)=>{
      const dates=`from=${start}&to=${dayAdd(start,6)}`;
      const [tasks,milestones,absences]=await Promise.all([taskPages(`${filters}&${dates}`),get(`/api/milestones?${dates}${milestoneProject}`,milestoneResponse),get(`/api/absences?${dates}`,absencesResponse)]);
      return {tasks,milestones,absences};
    });
    return loaded;
  }
  const end=dayAdd(o.week,(o.view==='week'?o.loadedWeeks:1)*7-1);
  if(o.unscheduled)q.set('unscheduled','true');else if(o.onlyWeek){q.set('from',o.week);q.set('to',end);}
  const lists=o.unscheduled?[await taskPages(q.toString())]:await Promise.all((['planned','progress','done'] as Status[]).map(status=>taskPages(`${q}&status=${status}`,o.limit)));
  const tasks=lists.reduce((a,b)=>({items:[...a.items,...b.items],total:a.total+b.total,editableIds:[...a.editableIds,...b.editableIds],commentCounts:[...a.commentCounts,...b.commentCounts],attachmentCounts:[...a.attachmentCounts,...b.attachmentCounts],scheduleItems:[...(a.scheduleItems||[]),...(b.scheduleItems||[])],sharedTodos:[...(a.sharedTodos||[]),...(b.sharedTodos||[])]}),{...emptyTasks});
  // Status tabs must not contain duplicate IDs. Original totals remain the server totals.
  taskListResponse(tasks);
  const [milestones,absences]=await Promise.all([get(`/api/milestones?from=${o.week}&to=${end}${milestoneProject}`,milestoneResponse),get(`/api/absences?from=${o.week}&to=${end}`,absencesResponse)]);
  return {tasks,milestones,absences,cache:new Map<string,WeekData>()};
}
