/* Employee cancellation/withdrawal domain adapter; CompanyForm owns native transport. */
(() => {
  'use strict';
  const screen=document.querySelector('[data-leave-self-screen]');if(!screen)return;
  const session=window.LeaveFormSession ||= window.CompanyForm.createSession(),sessionOwner='self';session.track(sessionOwner);
  const resources=form=>['leave-request:'+form.elements.namedItem('id').value+':'+form.elements.expectedSnapshot.value];
  const state=screen.querySelector('[data-leave-self-state]'),recheck=screen.querySelector('[data-leave-self-recheck]'),forms=new Map();
  let busy=false,locked=screen.dataset.selfLocked==='true',disposed=false,invalid=false,committed=false,confirmation=null;
  if(locked)session.invalidate();
  const routeFields=['Year','Month','CalendarView','SelfOnly','ShowOthers','ViewEmployeeId','RequestLimit','RequestPage'];
  const fields=['id','expectedEmployeeId','expectedSnapshot','expectedStatus',...routeFields,'displayDates','displayReason'];
  const snapshot=form=>JSON.stringify(fields.map(key=>form.elements.namedItem(key)?.value||''));
  const editors=[...document.forms].filter(form=>form.method==='post'&&!form.matches('[data-leave-self-action]')&&!['applyForm','externalScheduleForm','externalScheduleDeleteForm','adminForceAddForm','adminForceDeleteForm'].includes(form.getAttribute('id')));
  const editorValue=form=>JSON.stringify([...form.elements].filter(input=>input.name&&input.type!=='hidden'&&!['submit','button'].includes(input.type)).map(input=>[input.name,input.value,input.checked??null]));
  const baselines=new Map(editors.map(form=>[form,editorValue(form)]));
  const hasDraft=()=>session.hasDraftExcept(sessionOwner)||window.LeaveAdminCalendar?.hasDraft()||window.LeaveExternalSchedule?.hasDraft()||editors.some(form=>form.isConnected&&editorValue(form)!==baselines.get(form));
  const show=(kind,title,message)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message});state.scrollIntoView?.({block:'nearest'});};
  const isBlocked=()=>busy||locked||invalid||disposed||session.blocked(sessionOwner);
  function sync(){document.documentElement.dataset.leaveSelfBusy=String(busy||locked||invalid||disposed);for(const id of ['calendarArea','leaveRequestsArea']){const area=document.getElementById(id);if(area)area.inert=session.pending;}for(const form of forms.keys())for(const button of form.querySelectorAll('button'))button.disabled=isBlocked()||session.blocked(sessionOwner,resources(form));}
  function attach(form){
    let accepted=false,captured='',focus=null,lease=null;
    const operation=form.dataset.leaveSelfAction,owner=form.elements.expectedEmployeeId.value;
    const submit=async event=>{
      if(accepted)return;event.preventDefault();event.stopImmediatePropagation();if(isBlocked())return;
      const prior=form.elements.expectedStatus.value;
      if(!/^[1-9][0-9]*$/.test(form.elements.namedItem('id').value)||!/^[a-f0-9]{64}$/.test(form.elements.expectedSnapshot.value)||!(operation==='Cancel'?['Pending','Approved']:['CancelRequested']).includes(prior))return;
      lease=session.begin(sessionOwner,resources(form));if(!lease)return;committed=false;
      captured=snapshot(form);focus=document.activeElement;busy=true;confirmation=new AbortController();sync();
      const label=operation==='WithdrawCancel'?'취소 요청 철회':prior==='Pending'?'신청 취소':'취소 요청';
      try {
        const yes=await window.CompanyDialog.confirm({title:operation==='WithdrawCancel'?'취소 요청을 철회할까요?':prior==='Pending'?'신청을 취소할까요?':'취소 승인을 요청할까요?',message:operation==='WithdrawCancel'?'취소 요청을 철회하고 승인된 연차 상태로 되돌립니다.':prior==='Pending'?'승인 대기 중인 신청을 취소합니다.':'승인된 연차는 즉시 취소되지 않습니다. 관리자에게 취소 승인을 요청합니다.',details:[{label:'사용 기간',value:form.elements.displayDates.value},{label:'신청 사유',value:form.elements.displayReason.value||'없음'},{label:'신청 번호',value:form.elements.namedItem('id').value}],confirmLabel:label,returnFocus:focus,signal:confirmation.signal});
        if(!yes||invalid||disposed||snapshot(form)!==captured||!form.isConnected)return;
window.LeaveDayDetail?.close();
        accepted=true;form.requestSubmit();accepted=false;
      } catch {if(!invalid&&!disposed)show('error','처리 확인을 열지 못했습니다.','현재 신청 내역을 확인해 주세요.');}
      finally {confirmation=null;if(!controller.busy){lease?.finish('cancelled');busy=false;sync();if(focus?.isConnected&&!focus.disabled&&!invalid&&!disposed)focus.focus({preventScroll:true});}}
    };
    form.addEventListener('submit',submit,true);
    const controller=window.CompanyForm.attach(form,{state,
      canSubmit:()=>accepted&&lease?.current&&!locked&&!invalid&&!disposed,
      prepare:()=>{if(snapshot(form)!==captured||form.elements.expectedEmployeeId.value!==owner)throw Error('Changed cancellation intent');},
      onSaved:(data,sent)=>{
        const prior=sent.get('expectedStatus'),expected=operation==='WithdrawCancel'?'Approved':prior==='Pending'?'Cancelled':'CancelRequested';
        if(!data||data.operation!==operation||data.employeeId!==owner||data.id!==sent.get('id')||data.previousSnapshot!==sent.get('expectedSnapshot')||data.previousStatus!==prior||data.status!==expected||snapshot(form)!==captured)throw Error('Unconfirmed cancellation receipt');
        if(typeof data.navigateTo!=='string'||!data.navigateTo.startsWith('/')||data.navigateTo.startsWith('//'))throw Error('Missing local receipt route');
        const url=new URL(data.navigateTo,location.origin),allowed=routeFields;
        if(url.origin!==location.origin||!['/Leave','/Leave/Index'].includes(url.pathname)||url.hash||[...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1))throw Error('Invalid cancellation route');
        for(const key of allowed){const value=url.searchParams.get(key)||'',submitted=sent.get(key)||'';if(['SelfOnly','ShowOthers'].includes(key)?value.toLowerCase()!==submitted:value!==submitted)throw Error('Changed return view');}
        committed=true;recheck.querySelector('a').href=url.href;recheck.hidden=false;
        if(!hasDraft())location.assign(url.href);
      },
      onSettled:(saved,outcome)=>{lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown');busy=false;if(disposed||invalid)return;if(!saved&&outcome!=='invalid')locked=true;sync();recheck.hidden=false;if(saved)show('success','신청 처리 결과를 확인했습니다.','다른 입력은 이어서 저장할 수 있습니다. 최신 신청 상태와 잔여량은 새 탭에서 확인하세요.');}
    });
    forms.set(form,{controller,submit});
  }
  function reconcile(){if(disposed)return;for(const [form,entry] of forms)if(!form.isConnected){if(entry.controller.busy){session.invalidate();busy=false;locked=true;recheck.hidden=false;show('error','처리 결과를 확인하지 못했습니다.','화면이 교체되어 이전 응답을 반영하지 않습니다. 최신 신청 내역을 확인해 주세요.');}entry.controller.dispose();form.removeEventListener('submit',entry.submit,true);forms.delete(form);}document.querySelectorAll('[data-leave-self-action]').forEach(form=>{if(!forms.has(form))attach(form);});sync();}
  const observer=new MutationObserver(reconcile);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-application-locked']});reconcile();
  const invalidate=()=>{invalid=true;confirmation?.abort();for(const entry of forms.values())entry.controller.dispose();busy=false;sync();recheck.hidden=false;show('denied','로그인 상태 또는 권한이 바뀌었습니다.','이전 계정의 요청은 다시 보내지 않습니다. 현재 계정과 신청 내역을 확인해 주세요.');};
  const unload=event=>{if(busy&&!committed){event.preventDefault();event.returnValue='';}};
  const unsubscribe=session.subscribe(sync);
  const dispose=event=>{if(event?.persisted||disposed)return;disposed=true;confirmation?.abort();observer.disconnect();unsubscribe();for(const [form,entry] of forms){entry.controller.dispose();form.removeEventListener('submit',entry.submit,true);}busy=false;sync();document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);window.removeEventListener('pagehide',dispose);window.removeEventListener('beforeunload',unload);};
  document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);window.addEventListener('pagehide',dispose);window.addEventListener('beforeunload',unload);
})();
