/* Same-service page changes retain the shell; writes and drafts remain page-owned. */
(() => {
  let root=null,modified=false,revision=0;
  const changed=event=>{
    if(event.isTrusted&&!event.target.closest?.('.view-as-form, #calendarMoveForm')){modified=true;revision++;}
  };
  function start(view) {
    root=view;
    modified=false;revision=0;
    root?.addEventListener('input',changed);
    root?.addEventListener('change',changed);
  }
  function dispose() {
    root?.removeEventListener('input',changed);
    root?.removeEventListener('change',changed);
    root=null;modified=false;
  }
  const adapter={
    start,
    dispose,
    async beforeLeave() {
      if(!root)return true;
      if(root.querySelector('form[aria-busy="true"]')||window.LeaveFormSession?.pending||window.LeaveAdminCalendar?.pending||window.LeaveExternalSchedule?.pending)return false;
      const hasDraft=modified||root.querySelector('[data-application-dirty="true"]')||window.LeaveAdminCalendar?.hasDraft?.()||window.LeaveExternalSchedule?.hasDraft?.();
      if(!hasDraft)return true;
      const captured=revision;
      const approved=await window.CompanyDialog.confirm({title:'작성 중인 연차 정보',message:'저장하지 않은 입력이 있습니다. 변경사항을 버리고 이동하시겠습니까?',confirmLabel:'버리고 이동',returnFocus:document.activeElement});
      return approved&&captured===revision&&!root.querySelector('form[aria-busy="true"]')&&!window.LeaveFormSession?.pending;
    }
  };
  for(const id of ['leave.dashboard','leave.usage','leave.discord','leave.approvals','leave.employees','leave.employee.usage','leave.adjustments','leave.holidays','leave.settlements','leave.audit','leave.notifications.settings','leave.security','leave.master.employees'])window.CompanyPageRouter?.register(id,adapter);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>start(document.querySelector('[data-workspace-view]')));
  else start(document.querySelector('[data-workspace-view]'));
})();
