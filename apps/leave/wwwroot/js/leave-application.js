/* Application-specific acknowledgement and navigation; native transport belongs to CompanyForm. */
(() => {
  'use strict';
  const form=document.getElementById('applyForm');if(!form)return;
  const session=window.LeaveFormSession ||= window.CompanyForm.createSession(),sessionOwner='application';let lease=null;
  const state=document.querySelector('[data-application-state]'),owner=form.elements.expectedEmployeeId.value,submit=form.querySelector('[type=submit]');
  const keys=['Input.StartDate','Input.EndDate','Input.Portion','Input.Reason','Input.WorkPlan','expectedEmployeeId','ViewEmployeeId','SelfOnly','ShowOthers','RequestLimit'];
  const snapshot=()=>JSON.stringify(keys.map(key=>form.elements.namedItem(key)?.value??''));
  const initial=snapshot();let captured='',confirming=false,accepted=false,locked=state.dataset.applicationLocked==='true',invalid=false,disposed=false,committed=false,confirmation=null;
  session.track(sessionOwner,()=>!disposed&&!committed&&form.isConnected&&snapshot()!==initial);
  if(locked)session.invalidate();
  // GET filters have defaults (year, page size), not unsaved business data.
  // Keep other POST editors intact, including a changed select/date or checkbox.
  const otherForms=[...document.querySelectorAll('form')].filter(other=>other!==form&&other.method.toLowerCase()==='post'&&!['externalScheduleForm','externalScheduleDeleteForm','adminForceAddForm','adminForceDeleteForm'].includes(other.getAttribute('id')));
  const editorSnapshot=other=>JSON.stringify([...other.elements].filter(input=>input.name&&input.type!=='hidden'&&!['submit','button'].includes(input.type)).map(input=>[input.name,input.value,input.checked??null]));
  const otherBaselines=new Map(otherForms.map(other=>[other,editorSnapshot(other)]));
  const otherDraft=()=>session.hasDraftExcept(sessionOwner)||window.LeaveAdminCalendar?.hasDraft()||window.LeaveExternalSchedule?.hasDraft()||otherForms.some(other=>other.isConnected&&editorSnapshot(other)!==otherBaselines.get(other));
  const show=(kind,title,message)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message});};
  function lock(){const busy=confirming||controller.busy||locked||invalid||disposed||session.blocked(sessionOwner);form.dataset.applicationLocked=String(busy);form.dataset.applicationSaved=String(committed);form.dataset.applicationDirty=String(!committed&&snapshot()!==initial);[...form.elements].forEach(input=>{input.disabled=input.id==='cancelApplyPanel'?false:busy;});}
  const confirm=async event=>{
    if(accepted)return;event.preventDefault();event.stopImmediatePropagation();
    if(locked||invalid||disposed||confirming||controller.busy||session.blocked(sessionOwner)||!form.reportValidity())return;
    lease=session.begin(sessionOwner);if(!lease)return;
    captured=snapshot();confirming=true;confirmation=new AbortController();lock();
    try{
      const ok=await window.CompanyDialog.confirm({title:'연차를 신청할까요?',message:'신청을 등록하고 관리자에게 승인 알림을 보냅니다. 근무일과 잔여량·가불은 서버에서 확인합니다.',details:[{label:'기간',value:form.elements.namedItem('Input.StartDate').value+' ~ '+form.elements.namedItem('Input.EndDate').value},{label:'유형',value:form.elements.namedItem('Input.Portion').selectedOptions[0]?.textContent||''},{label:'업무 기록',value:form.elements.namedItem('Input.WorkPlan').value}],confirmLabel:'신청하기',returnFocus:submit,signal:confirmation.signal});
      if(!ok||invalid||disposed||snapshot()!==captured)return;
      confirming=false;lock();accepted=true;form.requestSubmit(submit);accepted=false;
    }catch{if(!invalid&&!disposed)show('error','신청 확인을 열지 못했습니다.','입력은 유지했습니다. 다시 확인해 주세요.');}
    finally{confirmation=null;confirming=false;if(!controller.busy)lease?.finish('cancelled');if(!disposed){lock();if(!controller.busy&&!locked&&!invalid)submit.focus({preventScroll:true});}}
  };
  form.addEventListener('submit',confirm,true);
  const controller=window.CompanyForm.attach(form,{state,
    canSubmit:()=>accepted&&lease?.current&&!locked&&!invalid&&!disposed&&!confirming,
    prepare:()=>{if(snapshot()!==captured||form.elements.expectedEmployeeId.value!==owner)throw Error('Changed application');},
    onSaved:(data,sent)=>{
      const start=sent.get('Input.StartDate'),end=sent.get('Input.EndDate')<start?start:sent.get('Input.EndDate'),portion=sent.get('Input.Portion');
      if(!data||data.operation!=='Apply'||data.employeeId!==owner||typeof data.id!=='string'||!/^[1-9][0-9]*$/.test(data.id)||data.id.length>19||BigInt(data.id)>9223372036854775807n||data.status!=='Pending'||snapshot()!==captured)throw Error('Unconfirmed application');
      if(!['FullDay','Morning','Afternoon','기타','Birthday'].includes(portion)||!data.input||data.input.startDate!==start||data.input.endDate!==end||data.input.portion!==portion||data.input.reason!==((sent.get('Input.Reason')||'').trim()||null)||data.input.workPlan!==sent.get('Input.WorkPlan').trim())throw Error('Changed saved application fields');
      if(!Array.isArray(data.dates)||!data.dates.length)throw Error('Missing application dates');let previous='';
      for(const day of data.dates){if(!day||typeof day.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||new Date(day.date).toISOString().slice(0,10)!==day.date||day.date<start||day.date>end||day.date<=previous||day.portion!==portion)throw Error('Invalid application dates');previous=day.date;}
      const single=portion==='Morning'||portion==='Afternoon'||portion==='Birthday';
      if(single&&(start!==end||data.dates.length!==1))throw Error('Invalid single-day interval');
      const days=portion==='FullDay'?String(data.dates.length):portion==='기타'||portion==='Birthday'?'0':'0.5';if(data.calculatedDays!==days)throw Error('Invalid application duration');
      if(typeof data.navigateTo!=='string'||!data.navigateTo.startsWith('/')||data.navigateTo.startsWith('//'))throw Error('Missing local application route');const url=new URL(data.navigateTo,location.origin);
      if(url.origin!==location.origin||!['/Leave','/Leave/Index'].includes(url.pathname)||url.searchParams.has('handler')||url.hash||url.searchParams.get('Year')!==String(Number(start.slice(0,4)))||url.searchParams.get('Month')!==String(Number(start.slice(5,7)))||url.searchParams.get('CalendarView')!=='month'||url.searchParams.get('RequestPage')!=='1')throw Error('Invalid application destination');
      const routeKeys=['Year','Month','CalendarView','SelfOnly','ShowOthers','ViewEmployeeId','RequestLimit','RequestPage'];
      if([...url.searchParams.keys()].some(key=>!routeKeys.includes(key)||url.searchParams.getAll(key).length!==1))throw Error('Unexpected application route fields');
      for(const key of ['SelfOnly','ShowOthers'])if(url.searchParams.get(key)?.toLowerCase()!==sent.get(key))throw Error('Changed calendar preference');
      for(const key of ['ViewEmployeeId','RequestLimit'])if((url.searchParams.get(key)||'')!==sent.get(key))throw Error('Changed application view');
      committed=true;locked=true;document.querySelector('[data-application-recheck]').href=url.href;
      // Other calendar forms may hold their own unsent work. Only navigate automatically when none would be lost.
      if(!otherDraft())location.assign(url.href);
    },
    onSettled:(saved,outcome)=>{lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown');if(disposed||invalid)return;if(!saved&&outcome!=='invalid')locked=true;lock();if(saved)show('success','연차 신청을 등록했습니다.','승인 대기 상태입니다. 다른 입력은 이어서 저장할 수 있습니다. 최신 내역은 새 탭에서 확인하세요.');}
  });
  const changed=()=>{form.dataset.applicationDirty=String(!committed&&snapshot()!==initial);};
  const invalidate=()=>{if(invalid||disposed)return;invalid=true;confirmation?.abort();controller.dispose();lock();show('denied','로그인 상태 또는 권한이 바뀌었습니다.','이전 계정의 신청은 다시 전송하지 않습니다. 새 탭에서 현재 계정과 신청 내역을 확인해 주세요.');};
  const unload=event=>{if(!committed&&(confirming||controller.busy||snapshot()!==initial)){event.preventDefault();event.returnValue='';}};
  const unsubscribe=session.subscribe(lock);
  const dispose=event=>{if(event?.persisted||disposed)return;disposed=true;confirmation?.abort();controller.dispose();unsubscribe();lock();form.removeEventListener('submit',confirm,true);form.removeEventListener('input',changed);form.removeEventListener('change',changed);document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);window.removeEventListener('beforeunload',unload);window.removeEventListener('pagehide',dispose);};
  form.addEventListener('input',changed);form.addEventListener('change',changed);document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);window.addEventListener('beforeunload',unload);window.addEventListener('pagehide',dispose);lock();
})();
