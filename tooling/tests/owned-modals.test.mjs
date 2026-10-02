import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkOwnedModals,checkLeaveDayDetail} from '../check-owned-modals.mjs';
const sources=['TaskPanel','Editor','DatePicker','Releases','DateNavigation','Settings'].map(name=>readFileSync(resolve(root,`apps/schedule/src/${name}.tsx`),'utf8')).concat(readFileSync(resolve(root,'apps/schedule/src/useMilestoneWrites.ts'),'utf8'));
test('leave native detail ownership cannot regress to a private overlay or bypass domain close',()=>{
  const read=path=>readFileSync(resolve(root,path),'utf8'),page=read('apps/leave/Pages/Leave/Index.cshtml'),clients=['leave-self-actions','leave-external-schedules','leave-calendar-admin'].map(name=>read(`apps/leave/wwwroot/js/${name}.js`)),css=['site','mobile'].map(name=>read(`apps/leave/wwwroot/css/${name}.css`));
  assert.deepEqual(checkLeaveDayDetail(page,clients,css),[]);
  for(const marker of ['window.CompanyDialog.attach(detailModal,',"scope:'dismiss'",'detailLifetime?.dispose()','!detailNode.isConnected','data-day-detail-trigger aria-label=','if (detailDisposed || window.LeaveFormSession?.pending || window.LeaveFormSession?.invalid) return;'])assert.ok(checkLeaveDayDetail(page.replace(marker,''),clients,css).length,marker);
  for(let i=0;i<clients.length;i++){const changed=[...clients];changed[i]=changed[i].replace('window.LeaveDayDetail?.close()','privateHide()');assert.ok(checkLeaveDayDetail(page,changed,css).length);}
  assert.ok(checkLeaveDayDetail(page,clients,[...css,'.day-detail-backdrop{background:white}']).length);
});
test('actual schedule modal ownership and mutations are checked',()=>{
  assert.deepEqual(checkOwnedModals(...sources),[]);
  for(const marker of ['canClose:edit.canCloseNow','beforeCloseRequest:edit.requestDiscard']){const changed=[...sources];changed[3]=changed[3].replace(marker,'bypass');assert.ok(checkOwnedModals(...changed).length);}
  for(const marker of ['canClose:canCloseNow','beforeCloseRequest:requestDiscard','useWorkspaceNavigationRequest(requestDiscard)','async function requestDiscard','confirmWorkspaceAction({ title: \'주요 일정 초안을 버릴까요?\'','discard.current.epoch === snapshot.epoch','=== snapshot.actor','JSON.stringify(current.current.milestone) === snapshot.milestone','validate: () => stable()','function choose(next: Partial<Milestone>) { void transitionDraft(','function switchTab(next: string)','onClose:finishClose','current.current.dirty = false']){const changed=[...sources];changed[5]=changed[5].replace(marker,'bypass');assert.ok(checkOwnedModals(...changed).length,marker);}
  {const changed=[...sources];changed[5]=changed[5].replace('import { confirmWorkspaceAction }','bypass');assert.ok(checkOwnedModals(...changed).length,'confirmation import');}
  for(const marker of ["useMilestoneWrites({", "writes.run('delete')", "writes.run(milestone.id?'update':'create')", 'page:milestonePage', 'draft:milestone,baseline,page:milestonePage']){const changed=[...sources];changed[5]=changed[5].replace(marker,'bypass');assert.ok(checkOwnedModals(...changed).length,marker);}
  for(const marker of ["confirmWorkspaceAction({title:kind", "kind==='delete'?'주요 일정을 삭제할까요?'", 'validate,', "entity:{kind:'project'", "workspaceDocumentFormSession('schedule-milestone-writes')", "transport.current=createWorkspaceWriteTransport", "X-Workspace-Milestone-State"]){const changed=[...sources];changed[6]=changed[6].replace(marker,'bypass');assert.ok(checkOwnedModals(...changed).length,marker);}
  for(const index of [3,4,5]){const changed=[...sources];changed[index]=changed[index].replace('useWorkspaceModal(dialog,','privateModal(dialog,');assert.ok(checkOwnedModals(...changed).length);}
  for(const [index,before,after] of [[0,"scope:'retain'","scope:'dismiss'"],[1,'useWorkspaceModal(dialog,','privateModal(dialog,'],[2,'returnFocus:input','returnFocus:undefined'],[0,'canClose:()=>!actions.busy&&!saving&&','canClose:()=>'],[1,'modal.close()','dialog.current?.close()'],[2,'className="cw-modal ','className="private '],[0,'onClose:()=>void close()','onClose:()=>{}']]){
    const changed=[...sources];assert.ok(changed[index].includes(before));changed[index]=changed[index].replace(before,after);
    assert.ok(checkOwnedModals(...changed).length,`${index} ${before}`);
  }
});
