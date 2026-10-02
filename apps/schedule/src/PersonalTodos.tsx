import {useState} from 'react';
import {stamp} from './api';
import type {Bootstrap} from './types';
import {WorkspaceState} from './generated/workspace-state';
import {usePersonalTodos} from './usePersonalTodos';
import {todoSignature} from './personalTodoContract';
import {ScheduleToastNotice} from './ScheduleToasts';

export function archiveTime(completedAt:string) {
  const utc=completedAt.endsWith('Z')?completedAt:`${completedAt}Z`;
  return new Date(Date.parse(utc)+72*60*60*1000).toISOString();
}
export function PersonalTodos({boot,refreshIdentity}:{boot:Bootstrap;refreshIdentity:()=>Promise<Bootstrap>}) {
  const todos=usePersonalTodos(boot,refreshIdentity);
  const {items,archived,title,editor,busy,ready,needsRefresh,outcome}=todos;
  const [dragging,setDragging]=useState<number>();
  const disabled=busy||needsRefresh||!ready;
  const current=editor&&items.find(item=>item.id===editor.item.id);
  const conflict=Boolean(editor&&(!current||todoSignature(current)!==todoSignature(editor.item)));
  // Keep the draft mounted even when a fresh list no longer contains its row.
  const visible=editor&&!current?[editor.item,...items]:items;
  function reorder(fromId:number,toId:number) {
    if(disabled||editor||fromId===toId)return;
    const next=[...items],from=next.findIndex(item=>item.id===fromId),to=next.findIndex(item=>item.id===toId);
    if(from<0||to<0)return;
    const [moved]=next.splice(from,1);next.splice(to,0,moved);setDragging(undefined);
    void todos.run({kind:'order',ids:next.map(item=>item.id),archived});
  }
  return <section className="personal-todos">
    <header className="todo-heading"><div><span className="eyebrow">PRIVATE</span><h1>나의 TODO</h1><p>이 목록은 내 계정에만 귀속되며 다른 직원과 관리자 화면에는 표시되지 않습니다.</p></div></header>
    <div className="todo-tabs" role="tablist" aria-label="TODO 목록"><button className="cw-button" data-variant="quiet" role="tab" aria-selected={!archived} disabled={busy} onClick={()=>void todos.switchTab(false)}>할 일</button><button className="cw-button" role="tab" aria-selected={archived} disabled={busy} onClick={()=>void todos.switchTab(true)}>보관함</button></div>
    <ScheduleToastNotice id="personal-todo" state={outcome?{...outcome,actionLabel:needsRefresh&&!busy?'목록 다시 확인':undefined,onAction:()=>void todos.refresh()}:!ready?{kind:'loading',title:'개인 TODO를 불러옵니다.'}:null}/>
    <fieldset className="todo-fields" disabled={busy} aria-label="개인 TODO 작업">
      {!archived&&<form className="todo-add" onSubmit={event=>{event.preventDefault();if(!disabled&&!editor&&title.trim())void todos.run({kind:'add',title:title.trim()});}}><label className="cw-form-field">새 TODO<input className="cw-form-control" aria-label="새 TODO" maxLength={500} value={title} onChange={event=>todos.setTitle(event.target.value)} placeholder="할 일을 입력하세요" /></label><button className="cw-button" data-variant="primary" disabled={disabled||!!editor||!title.trim()}>추가</button></form>}
      <div className="todo-list" aria-busy={busy}>
        {visible.map((item,index)=><article key={item.id} data-todo-id={item.id} className={`todo-item ${item.completedAt?'completed':''} ${dragging===item.id?'dragging':''}`} draggable={!disabled&&!editor} onDragStart={()=>setDragging(item.id)} onDragEnd={()=>setDragging(undefined)} onDragOver={event=>event.preventDefault()} onDrop={()=>dragging&&reorder(dragging,item.id)}>
          <span className="todo-grip" title="끌어서 순서 변경" aria-hidden="true">⠿</span>
          <label className="todo-check-control cw-check-control" title={`${item.title} 완료`}><input className="todo-check cw-checkbox" type="checkbox" aria-label={`${item.title} 완료`} checked={!!item.completedAt} disabled={disabled||!!editor} onChange={event=>void todos.run({kind:'complete',item:{...item},completed:event.target.checked})} /></label>
          <div className="todo-content">{editor?.item.id===item.id?<>
            <form className="todo-edit" onSubmit={event=>{event.preventDefault();if(!disabled&&!conflict&&editor.draft.trim())void todos.run({kind:'save',item:editor.item,title:editor.draft.trim()});}}>
              <label className="cw-form-field">TODO 내용 수정<input className="cw-form-control" autoFocus aria-label="TODO 내용 수정" maxLength={500} value={editor.draft} onChange={event=>todos.setEditor({...editor,draft:event.target.value})} /></label>
              <button className="cw-button" disabled={disabled||conflict||!editor.draft.trim()}>저장</button><button className="cw-button" type="button" onClick={todos.cancelEdit}>취소</button>
            </form>
            {conflict&&<WorkspaceState kind="error" title="편집 기준이 변경되었습니다." message={current?`현재 내용: ${current.title}. 초안은 유지했습니다. 수정 취소 후 최신 항목을 다시 열어 주세요.`:'현재 목록에서 사라진 TODO입니다. 초안은 유지했으며 저장하지 않습니다.'} />}
          </>:<><strong>{item.title}</strong>{item.completedAt&&<small>{archived?`완료 ${stamp(item.completedAt,true)}`:`완료 ${stamp(item.completedAt,true)} · 보관 예정 ${stamp(archiveTime(item.completedAt),true)}`}</small>}</>}</div>
          <div className="todo-actions"><button className="cw-button" data-size="compact" aria-label={`${item.title} 위로 이동`} disabled={disabled||!!editor||index===0} onClick={()=>reorder(item.id,items[index-1].id)}>↑</button><button className="cw-button" data-size="compact" aria-label={`${item.title} 아래로 이동`} disabled={disabled||!!editor||index===items.length-1} onClick={()=>reorder(item.id,items[index+1].id)}>↓</button><button className="cw-button" data-size="compact" disabled={disabled||editor?.item.id===item.id} onClick={()=>void todos.edit(item)}>수정</button><button className="cw-button todo-delete" data-size="compact" data-variant="danger" disabled={disabled||!!editor} onClick={()=>void todos.run({kind:'delete',item:{...item}})}>삭제</button></div>
        </article>)}
        {ready&&!visible.length&&<WorkspaceState kind="empty" title={archived?'보관된 TODO가 없습니다.':'아직 등록한 TODO가 없습니다.'} message={archived?'완료한 할 일은 72시간 뒤 이곳으로 이동합니다.':'위 입력란에서 나만의 할 일을 추가하세요.'} />}
      </div>
    </fieldset>
    {!archived&&<p className="todo-note">완료한 TODO는 체크한 시각부터 72시간 뒤 보관함으로 이동합니다.</p>}
  </section>;
}
