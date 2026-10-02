import {useState,type FormEvent} from 'react';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {ScheduleToastNotice} from './ScheduleToasts';
import {DatePicker} from './DatePicker';
import {Avatar} from './Avatar';
import {stamp} from './api';
import {usePlanningWrites} from './usePlanningWrites';
import type {Bootstrap,Detail,SharedTaskTodo,TaskScheduleItem} from './types';

type ScheduleDraft={id:number;title:string;date:string;endDate:string};
type TodoDraft={id:number;title:string};

export function TaskPlanning({boot,detail,reload,disabled}:{boot:Bootstrap;detail:Detail;reload:()=>Promise<void>;disabled:boolean}) {
  const writer=usePlanningWrites(boot,reload);
  const [scheduleTitle,setScheduleTitle]=useState('');
  const [scheduleDate,setScheduleDate]=useState(detail.task.startDate||'');
  const [scheduleEndDate,setScheduleEndDate]=useState(detail.task.endDate||detail.task.startDate||'');
  const [todoTitle,setTodoTitle]=useState('');
  const [editingSchedule,setEditingSchedule]=useState<ScheduleDraft|null>(null);
  const [editingTodo,setEditingTodo]=useState<TodoDraft|null>(null);
  const name=(id:number|null)=>id?boot.employees.find(employee=>employee.id===id)?.name||'이전 직원':'—';
  const scheduleRange=(item:TaskScheduleItem)=>item.date===(item.endDate||item.date)?item.date:`${item.date} ~ ${item.endDate}`;
  const canEditTodo=(item:SharedTaskTodo)=>item.createdBy===boot.me.id||boot.me.isAdmin;

  async function removeSchedule(item:TaskScheduleItem){
    const intent=await confirmWorkspaceAction({title:'상세 일정을 삭제할까요?',message:'업무 상세의 일정 항목에서 제거됩니다.',confirmLabel:'삭제',tone:'danger',details:[{label:'기간',value:scheduleRange(item)},{label:'내용',value:item.title}]});
    if(intent)await writer.run('schedule-delete',`/api/tasks/${detail.task.id}/schedule-items/${item.id}?version=${item.version}`,'DELETE',{version:item.version});
  }
  async function removeTodo(item:SharedTaskTodo){
    const intent=await confirmWorkspaceAction({title:'공용 TODO를 삭제할까요?',message:'모든 직원의 업무 상세에서 제거됩니다.',confirmLabel:'삭제',tone:'danger',details:[{label:'TODO',value:item.title}]});
    if(intent)await writer.run('todo-delete',`/api/tasks/${detail.task.id}/shared-todos/${item.id}?version=${item.version}`,'DELETE',{version:item.version});
  }
  function beginSchedule(item:TaskScheduleItem){
    writer.clear();setEditingTodo(null);setEditingSchedule({id:item.id,title:item.title,date:item.date,endDate:item.endDate||item.date});
  }
  async function saveSchedule(event:FormEvent,item:TaskScheduleItem){
    event.preventDefault();if(!editingSchedule||editingSchedule.id!==item.id)return;
    if(await writer.run('schedule-update',`/api/tasks/${detail.task.id}/schedule-items/${item.id}`,'PUT',{title:editingSchedule.title,date:editingSchedule.date,endDate:editingSchedule.endDate,version:item.version}))setEditingSchedule(null);
  }
  function beginTodo(item:SharedTaskTodo){writer.clear();setEditingSchedule(null);setEditingTodo({id:item.id,title:item.title});}
  async function saveTodo(event:FormEvent,item:SharedTaskTodo){
    event.preventDefault();if(!editingTodo||editingTodo.id!==item.id)return;
    if(await writer.run('todo-update',`/api/tasks/${detail.task.id}/shared-todos/${item.id}`,'PUT',{title:editingTodo.title,version:item.version}))setEditingTodo(null);
  }

  return <section className="task-planning">
    <header><div><span className="eyebrow">DETAILED PLAN</span><h2>상세 일정</h2></div><small>하루 또는 여러 날의 기간으로 설정할 수 있습니다.</small></header>
    {(detail.scheduleItems||[]).length?<ol className="task-schedule-list">{(detail.scheduleItems||[]).map(item=><li key={item.id} className={editingSchedule?.id===item.id?'is-editing':undefined}>
      {editingSchedule?.id===item.id?<form className="planning-edit" onSubmit={event=>void saveSchedule(event,item)}>
        <div className="planning-date-fields"><label className="cw-form-field">시작일<DatePicker label="상세 일정 수정 시작일" value={editingSchedule.date} onChange={date=>setEditingSchedule({...editingSchedule,date,endDate:editingSchedule.endDate<date?date:editingSchedule.endDate})}/></label><label className="cw-form-field">종료일<DatePicker label="상세 일정 수정 종료일" value={editingSchedule.endDate} onChange={endDate=>setEditingSchedule({...editingSchedule,endDate})}/></label></div>
        <label className="cw-form-field planning-title">일정 내용<input className="cw-form-control" required maxLength={300} value={editingSchedule.title} onChange={event=>setEditingSchedule({...editingSchedule,title:event.target.value})}/></label>
        <div className="planning-edit-actions"><button type="button" className="cw-button" data-size="compact" disabled={disabled||writer.busy} onClick={()=>setEditingSchedule(null)}>취소</button><button className="cw-button" data-size="compact" data-variant="primary" disabled={disabled||writer.busy||!editingSchedule.date||!editingSchedule.endDate||editingSchedule.endDate<editingSchedule.date}>저장</button></div>
      </form>:<><time>{scheduleRange(item)}</time><strong>{item.title}</strong><span><Avatar id={item.createdBy} name={name(item.createdBy)}/>{name(item.createdBy)} 등록</span>{detail.canEdit&&<div className="planning-row-actions"><button type="button" className="cw-button" data-size="compact" data-variant="quiet" disabled={disabled||writer.busy} onClick={()=>beginSchedule(item)}>수정</button><button type="button" className="cw-button" data-size="compact" data-variant="quiet" disabled={disabled||writer.busy} onClick={()=>void removeSchedule(item)}>삭제</button></div>}</>}
    </li>)}</ol>:<p className="empty-note">등록된 상세 일정이 없습니다.</p>}
    {detail.canEdit&&<form className="planning-add" onSubmit={async event=>{event.preventDefault();if(await writer.run('schedule-create',`/api/tasks/${detail.task.id}/schedule-items`,'POST',{title:scheduleTitle,date:scheduleDate,endDate:scheduleEndDate,version:0})){setScheduleTitle('');}}}>
      <div className="planning-date-fields"><label className="cw-form-field">시작일<DatePicker label="상세 일정 시작일" value={scheduleDate} onChange={date=>{setScheduleDate(date);if(!scheduleEndDate||scheduleEndDate<date)setScheduleEndDate(date);}}/></label><label className="cw-form-field">종료일<DatePicker label="상세 일정 종료일" value={scheduleEndDate} onChange={setScheduleEndDate}/></label></div>
      <label className="cw-form-field planning-title">일정 내용<input className="cw-form-control" required maxLength={300} value={scheduleTitle} onChange={event=>setScheduleTitle(event.target.value)} placeholder="예: 애니메이션 적용 및 프리팹 설정"/></label><button className="cw-button" data-variant="primary" disabled={disabled||writer.busy||!scheduleDate||!scheduleEndDate||scheduleEndDate<scheduleDate}>추가</button>
    </form>}
    <header><div><span className="eyebrow">SHARED CHECKLIST</span><h2>공용 TODO</h2></div><small>등록자는 내용을 수정할 수 있고, 완료 처리 기록은 모두에게 표시됩니다.</small></header>
    {(detail.sharedTodos||[]).length?<ul className="shared-todo-list">{(detail.sharedTodos||[]).map(item=><li key={item.id} className={`${item.completedAt?'completed ':''}${editingTodo?.id===item.id?'is-editing':''}`.trim()}>
      {editingTodo?.id===item.id?<form className="planning-edit todo-edit" onSubmit={event=>void saveTodo(event,item)}><label className="cw-form-field planning-title">TODO 내용<input className="cw-form-control" required maxLength={500} value={editingTodo.title} onChange={event=>setEditingTodo({...editingTodo,title:event.target.value})}/></label><div className="planning-edit-actions"><button type="button" className="cw-button" data-size="compact" disabled={disabled||writer.busy} onClick={()=>setEditingTodo(null)}>취소</button><button className="cw-button" data-size="compact" data-variant="primary" disabled={disabled||writer.busy}>저장</button></div></form>:<><label className="cw-check-control"><input className="cw-checkbox" type="checkbox" checked={!!item.completedAt} disabled={disabled||writer.busy} onChange={event=>void writer.run('todo-complete',`/api/tasks/${detail.task.id}/shared-todos/${item.id}/completion`,'PATCH',{completed:event.target.checked,version:item.version})}/><strong>{item.title}</strong></label><span><Avatar id={item.createdBy} name={name(item.createdBy)}/>{name(item.createdBy)} 등록</span>{item.completedAt&&<span><Avatar id={item.completedBy||undefined} name={name(item.completedBy)}/>{name(item.completedBy)} 완료 · {stamp(item.completedAt)}</span>}{canEditTodo(item)&&<div className="planning-row-actions"><button type="button" className="cw-button" data-size="compact" data-variant="quiet" disabled={disabled||writer.busy} onClick={()=>beginTodo(item)}>수정</button><button type="button" className="cw-button" data-size="compact" data-variant="quiet" disabled={disabled||writer.busy} onClick={()=>void removeTodo(item)}>삭제</button></div>}</>}
    </li>)}</ul>:<p className="empty-note">등록된 공용 TODO가 없습니다.</p>}
    <form className="planning-add" onSubmit={async event=>{event.preventDefault();if(await writer.run('todo-create',`/api/tasks/${detail.task.id}/shared-todos`,'POST',{title:todoTitle,version:0}))setTodoTitle('');}}><label className="cw-form-field planning-title">새 TODO<input className="cw-form-control" required maxLength={500} value={todoTitle} onChange={event=>setTodoTitle(event.target.value)} placeholder="모두가 확인할 체크 항목"/></label><button className="cw-button" data-variant="primary" disabled={disabled||writer.busy}>추가</button></form>
    <ScheduleToastNotice id={`task-planning-${detail.task.id}`} state={writer.outcome}/>
  </section>;
}
