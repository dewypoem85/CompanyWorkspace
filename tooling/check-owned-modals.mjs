// Binding checks complement primitive tags, runtime tests and real browser focus.
// This is not an arbitrary JSX/DOM data-flow proof.
export function checkOwnedModals(task, editor, date, releases, navigation, settings, milestoneWrites='') {
  const errors=[];
  for(const [name,source,policy] of [['TaskPanel',task,'retain'],['Editor',editor,'dismiss'],['DatePicker',date,'dismiss'],['Releases',releases,'retain'],['DateNavigation',navigation,'dismiss'],['Settings',settings,'retain']]) {
    for(const marker of ["from './generated/workspace-modal'",'useWorkspaceModal(dialog,',`scope:'${policy}'`,'className="cw-modal ']) {
      if(!source.includes(marker))errors.push(`${name}: owned modal common binding missing ${marker}`);
    }
    if(/\.showModal\s*\(|dialog\.current\?*\.close\s*\(|onCancel=/.test(source))errors.push(`${name}: private modal lifecycle restored`);
  }
  if(!task.includes('canClose:()=>!actions.busy&&!saving&&'))errors.push('TaskPanel: busy/draft close guard missing');
  if(!task.includes('onClose:()=>void close()')||!task.includes('modal.close()'))errors.push('TaskPanel: modal close owner disconnected');
  if(!date.includes('returnFocus:input')||!date.includes('onClose:()=>setOpen(false)'))errors.push('DatePicker: close/focus owner disconnected');
  if(!editor.includes('onClose:()=>setFull(undefined)')||!editor.includes('modal.close()'))errors.push('Editor: lightbox close owner disconnected');
  for(const marker of ['canClose:edit.canCloseNow','beforeCloseRequest:edit.requestDiscard','onClose:close'])if(!releases.includes(marker))errors.push('Releases: asynchronous draft close owner disconnected '+marker);
  if(!navigation.includes('onClose:()=>setOpen(false)')||!navigation.includes('modal.close()'))errors.push('DateNavigation: close owner disconnected');
  for(const marker of ['canClose:canCloseNow','beforeCloseRequest:requestDiscard','useWorkspaceNavigationRequest(requestDiscard)','async function requestDiscard','confirmWorkspaceAction({ title: \'주요 일정 초안을 버릴까요?\'','discard.current.epoch === snapshot.epoch','=== snapshot.actor','JSON.stringify(current.current.milestone) === snapshot.milestone','validate: () => stable()','function choose(next: Partial<Milestone>) { void transitionDraft(','function switchTab(next: string)','onClose:finishClose','current.current.dirty = false']) {
    if(!settings.includes(marker))errors.push('Settings: asynchronous milestone draft owner disconnected '+marker);
  }
  if(!settings.includes('import { confirmWorkspaceAction }'))errors.push('Settings: milestone confirmation import disconnected');
  for(const marker of ["useMilestoneWrites({", "writes.run('delete')", "writes.run(milestone.id?'update':'create')", 'page:milestonePage', 'draft:milestone,baseline,page:milestonePage'])if(!settings.includes(marker))errors.push('Settings: milestone write owner disconnected '+marker);
  for(const marker of ["confirmWorkspaceAction({title:kind", "kind==='delete'?'주요 일정을 삭제할까요?'", 'validate,', "entity:{kind:'project'", "workspaceDocumentFormSession('schedule-milestone-writes')", "transport.current=createWorkspaceWriteTransport", "X-Workspace-Milestone-State"])if(!milestoneWrites.includes(marker))errors.push('Milestone writes: common confirmation disconnected '+marker);
  return errors;
}

export function checkLeaveDayDetail(page, clients, css) {
  const errors=[];
  for(const marker of ['<dialog class="cw-modal day-detail-modal"','aria-labelledby="dayDetailTitle"','data-day-detail-trigger aria-label=','window.CompanyDialog.attach(detailModal,',"scope:'dismiss'",'detailLifetime?.requestClose()','detailLifetime?.dispose()','!detailNode.isConnected','detailObserver.disconnect()','canClose:()=>!window.LeaveFormSession?.pending','if (detailDisposed || window.LeaveFormSession?.pending || window.LeaveFormSession?.invalid) return;','window.LeaveDayDetail = { close: hideDayDetail }']) {
    if(!page.includes(marker))errors.push('Leave day detail: common owner missing '+marker);
  }
  if(/day-detail-backdrop|role="dialog"|detailModal\.classList|detailModal\??\.setAttribute\('aria-hidden'/.test(page))errors.push('Leave day detail: private overlay lifecycle restored');
  for(const source of clients)if(!source.includes('window.LeaveDayDetail?.close()')||source.includes("getElementById('dayDetailModal')?.classList")||source.includes("modal?.classList.add('is-hidden')"))errors.push('Leave day detail: domain close bypasses common owner');
  if(css.some(source=>/\.day-detail-(?:modal|backdrop|card)\b/.test(source)))errors.push('Leave day detail: retired overlay frame CSS restored');
  return errors;
}
