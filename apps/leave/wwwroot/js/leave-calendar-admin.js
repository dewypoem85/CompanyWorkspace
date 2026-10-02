/* Calendar admin domain adapter; shared primitives own modal and native POST lifetimes. */
(() => {
  'use strict';
  const screen=document.querySelector('[data-leave-admin-screen]');if(!screen)return;
  const session=window.LeaveFormSession ||= window.CompanyForm.createSession(),sessionOwner='admin';
  const state=screen.querySelector('[data-leave-admin-state]'),recheck=screen.querySelector('[data-leave-admin-recheck]'),draft=screen.querySelector('[data-leave-admin-draft]');
  const forms=new Map(),routeFields=['Year','Month','CalendarView','SelfOnly','ShowOthers','ViewEmployeeId','RequestLimit','RequestPage'];
  const ids=['adminForceAddForm','adminForceDeleteForm'],portions={FullDay:'연차',Morning:'오전반차',Afternoon:'오후반차',특수휴가:'특수 휴가',기타:'기타',Birthday:'생일연차'},days={FullDay:'1',Morning:'0.5',Afternoon:'0.5',특수휴가:'0',기타:'0',Birthday:'0'};
  const value=(form,key)=>form?.elements.namedItem(key)?.value??'',add=()=>document.getElementById(ids[0]),removeForm=()=>document.getElementById(ids[1]);
  const snapshot=form=>JSON.stringify(['expectedEmployeeId','expectedSnapshot','ForceInput.EmployeeId','ForceInput.Date','ForceInput.Portion','ForceInput.Reason','ForceDeleteRequestId','ForceDeleteReason','displayTarget',...routeFields].map(key=>value(form,key)));
  const subject=form=>JSON.stringify(['expectedEmployeeId','expectedSnapshot','ForceDeleteRequestId','displayTarget',...routeFields].map(key=>value(form,key)));
  let editor=null,baseline='',busy=false,locked=false,invalid=false,disposed=false,committed=false,confirmation=null,deleteFocus=null,savedAdd=null;
  const addDirty=()=>!!editor?.isConnected&&snapshot(editor)!==baseline;
  const deleteDirty=()=>!!value(removeForm(),'ForceDeleteReason');
  const hasDraft=()=>addDirty()||deleteDirty();
  session.track(sessionOwner,hasDraft);
  const resources=(id,version)=>id?['leave-request:'+id+':'+version]:[];
  const otherBusy=()=>session.blocked(sessionOwner);
  const blocked=()=>busy||locked||invalid||disposed||otherBusy();
  const otherEditors=[...document.forms].filter(form=>form.method==='post'&&!ids.includes(form.getAttribute('id'))&&!form.matches('[data-leave-self-action]')&&!['applyForm','externalScheduleForm','externalScheduleDeleteForm'].includes(form.getAttribute('id')));
  const editorValue=form=>JSON.stringify([...form.elements].filter(el=>el.name&&el.type!=='hidden'&&!['submit','button'].includes(el.type)).map(el=>[el.name,el.value,el.checked??null]));
  const otherBaselines=new Map(otherEditors.map(form=>[form,editorValue(form)]));
  const otherDraft=()=>session.hasDraftExcept(sessionOwner)||window.LeaveExternalSchedule?.hasDraft()||otherEditors.some(form=>form.isConnected&&editorValue(form)!==otherBaselines.get(form));
  const show=(kind,title,message)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message});};
  const idOk=id=>typeof id==='string'&&/^[1-9][0-9]*$/.test(id)&&id.length<=19&&BigInt(id)<=9223372036854775807n;
  const hashOk=hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash);
  const dateOk=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date!=='0001-01-01'&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  function targetOk(target){return target&&idOk(target.id)&&idOk(target.employeeId)&&hashOk(target.snapshot)&&typeof target.employeeName==='string'&&['Pending','Approved','Rejected','CancelRequested','Cancelled'].includes(target.status)&&typeof target.calculatedDays==='string'&&/^\d+(?:\.\d+)?$/.test(target.calculatedDays)&&Array.isArray(target.dates)&&target.dates.length>0&&target.dates.every(day=>day&&dateOk(day.date)&&Object.hasOwn(portions,day.portion));}
  function sync(){
    document.documentElement.dataset.leaveAdminBusy=String(busy||locked||invalid||disposed);
    for(const id of ['calendarArea','leaveRequestsArea']){const area=document.getElementById(id);if(area)area.inert=session.pending;}
    for(const form of forms.keys())for(const button of form.querySelectorAll('button'))button.disabled=blocked()||(button.type==='submit'&&form===editor&&savedAdd!==null&&snapshot(form)===savedAdd);
    for(const button of document.querySelectorAll('.force-delete-button,[data-force-resume],[data-force-discard]')){let used=false;if(button.matches('.force-delete-button')){try{const target=JSON.parse(button.dataset.adminTarget);used=session.blocked(sessionOwner,resources(target.id,target.snapshot));}catch{used=true;}}button.disabled=blocked()||used;}
    draft.hidden=!deleteDirty();
  }
const hideDetail=()=>window.LeaveDayDetail?.close();
  function setDefaults(date,employeeId){
    const form=add();if(!form||!dateOk(date))return;
    const select=form.elements.namedItem('ForceInput.EmployeeId');select.value=[...select.options].some(option=>option.value===employeeId)?employeeId:select.options[0]?.value||'';
    form.elements.namedItem('ForceInput.Date').value=date;form.elements.namedItem('ForceInput.Portion').value='FullDay';form.elements.namedItem('ForceInput.Reason').value='';
    editor=form;baseline=snapshot(form);savedAdd=null;select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  async function discard(which,action){
    if(blocked())return false;
    const form=which==='add'?add():removeForm(),before=form?snapshot(form):'',dirty=which==='add'?addDirty():deleteDirty(),focus=document.activeElement;
    if(!dirty){action();return true;}
    const lease=session.begin(sessionOwner);if(!lease)return false;committed=false;
    busy=true;confirmation=new AbortController();sync();
    try {
      const yes=await window.CompanyDialog.confirm({title:which==='add'?'강제 추가 초안을 버릴까요?':'강제 삭제 사유를 버릴까요?',message:'선택한 작업의 입력만 초기화합니다. 다른 연차와 외부 일정 초안은 유지합니다.',confirmLabel:'초안 버리기',signal:confirmation.signal,returnFocus:focus});
      if(yes&&!invalid&&!disposed&&form?.isConnected&&snapshot(form)===before){action();return true;}
      return false;
    } catch {if(!invalid&&!disposed)show('error','초안을 유지했습니다.','확인창을 열지 못했습니다.');return false;}
    finally {lease.finish('cancelled');busy=false;confirmation=null;sync();if(focus?.isConnected&&!focus.disabled&&!invalid&&!disposed)focus.focus({preventScroll:true});}
  }
  function clearDelete(){const form=removeForm();if(!form)return;for(const key of ['ForceDeleteRequestId','ForceDeleteReason','expectedSnapshot','displayTarget'])form.elements.namedItem(key).value='';sync();}
  function reviewDelete(form,target,signal,focus){
    const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
    const dialog=make('dialog');dialog.className='cw-review cw-confirm';dialog.setAttribute('aria-labelledby','force-delete-title');
    const header=make('header'),title=make('h2','신청 전체를 강제 삭제할까요?');title.id='force-delete-title';title.tabIndex=-1;
    header.append(title,make('p','여러 날짜가 포함된 신청은 전체 날짜가 삭제됩니다. 삭제 사유를 확인하고 실행하세요.'));dialog.append(header);
    const review=make('form');review.className='cw-dialog-form';review.method='dialog';const body=make('div');body.className='cw-review-body';
    const details=make('dl');for(const [label,text] of [['직원',target.employeeName],['사용일',target.dates.map(day=>day.date+' · '+portions[day.portion]).join('\n')],['신청 사유',target.reason||'없음'],['신청 번호',target.id]]){const row=make('div');row.append(make('dt',label),make('dd',text));details.append(row);}body.append(details);
    const label=make('label'),input=make('input');label.append(make('span','강제 삭제 사유'),input);input.type='text';input.autocomplete='off';input.required=form.dataset.reasonRequired==='true';input.value=value(form,'ForceDeleteReason');body.append(label);
    const footer=make('footer'),cancel=make('button','닫기 · 초안 유지'),apply=make('button','신청 전체 삭제');cancel.type='button';apply.type='submit';apply.dataset.tone='danger';footer.append(cancel,apply);review.append(body,footer);dialog.append(review);
    const before=subject(form),lifetime=window.CompanyDialog.present(dialog,{signal,returnFocus:focus,initialFocus:title});
    input.addEventListener('input',()=>{form.elements.namedItem('ForceDeleteReason').value=input.value;draft.hidden=!deleteDirty();});
    cancel.addEventListener('click',()=>lifetime.finish(null));
    review.addEventListener('submit',event=>{event.preventDefault();if(!review.reportValidity()||invalid||disposed||!form.isConnected||subject(form)!==before){if(!invalid&&!disposed)show('error','삭제 대상을 다시 확인해 주세요.','확인 중 대상이 변경되어 실행하지 않았습니다.');return;}form.elements.namedItem('ForceDeleteReason').value=input.value;lifetime.finish(true);});
    return lifetime.closed;
  }
  function attach(form){
    const deleting=form.getAttribute('id')===ids[1],owner=value(form,'expectedEmployeeId');let accepted=false,captured='',intention=null,focus=null,lease=null;
    const submit=async event=>{
      if(accepted)return;event.preventDefault();event.stopImmediatePropagation();if(blocked()||!form.reportValidity())return;
      try {intention=deleting?JSON.parse(value(form,'displayTarget')):{employeeId:value(form,'ForceInput.EmployeeId'),date:value(form,'ForceInput.Date'),portion:value(form,'ForceInput.Portion')};}catch{return;}
      if(deleting?!targetOk(intention)||intention.id!==value(form,'ForceDeleteRequestId')||intention.snapshot!==value(form,'expectedSnapshot'):!idOk(intention.employeeId)||!dateOk(intention.date)||!Object.hasOwn(days,intention.portion)||value(form,'expectedSnapshot')!=='')return;
      if(!deleting&&savedAdd!==null&&snapshot(form)===savedAdd)return;
      lease=session.begin(sessionOwner,deleting?resources(intention.id,intention.snapshot):[]);if(!lease)return;committed=false;
      focus=deleting?deleteFocus||document.activeElement:document.activeElement;captured=snapshot(form);busy=true;confirmation=new AbortController();sync();
      try {
        const yes=deleting?await reviewDelete(form,intention,confirmation.signal,focus):await window.CompanyDialog.confirm({title:'연차를 강제로 추가할까요?',message:'과거 날짜도 승인 완료 상태로 기록됩니다. 날짜와 대상 직원을 확인하세요.',details:[{label:'직원',value:form.elements.namedItem('ForceInput.EmployeeId').selectedOptions[0]?.textContent||intention.employeeId},{label:'추가할 날짜',value:intention.date},{label:'유형',value:portions[intention.portion]+' · '+days[intention.portion]+'일 차감'},{label:'사유',value:value(form,'ForceInput.Reason').trim()||'사유 미입력'}],confirmLabel:'승인 상태로 추가',returnFocus:focus,signal:confirmation.signal});
        if(!yes||invalid||disposed||!form.isConnected||(!deleting&&snapshot(form)!==captured))return;
        captured=snapshot(form);hideDetail();accepted=true;form.requestSubmit();accepted=false;
      } catch {if(!invalid&&!disposed)show('error','처리 확인을 열지 못했습니다.','입력은 유지했습니다.');}
      finally {confirmation=null;if(!controller.busy){lease?.finish('cancelled');busy=false;sync();if(focus?.isConnected&&!focus.disabled&&!invalid&&!disposed)focus.focus({preventScroll:true});}}
    };
    form.addEventListener('submit',submit,true);
    const controller=window.CompanyForm.attach(form,{state,
      canSubmit:()=>accepted&&lease?.current&&!locked&&!invalid&&!disposed&&!otherBusy(),
      prepare:()=>{if(snapshot(form)!==captured||value(form,'expectedEmployeeId')!==owner)throw Error('Changed admin action intent');},
      onSaved:(data,sent)=>{
        const reason=(sent.get(deleting?'ForceDeleteReason':'ForceInput.Reason')||'').trim()||'사유 미입력';
        if(!data||data.operation!==(deleting?'AdminForceDelete':'AdminForceAdd')||data.actorEmployeeId!==owner||!idOk(data.id)||data.targetEmployeeId!==intention.employeeId||data.previousSnapshot!==sent.get('expectedSnapshot')||data.previousStatus!==(deleting?intention.status:null)||data.status!==(deleting?'deleted':'Approved')||data.reason!==reason||snapshot(form)!==captured)throw Error('Unconfirmed calendar admin receipt');
        if(deleting?(data.id!==intention.id||data.snapshot!==''):!hashOk(data.snapshot))throw Error('Wrong saved admin target');
        const expectedDates=deleting?intention.dates:[{date:intention.date,portion:intention.portion}];
        if(data.calculatedDays!==(deleting?intention.calculatedDays:days[intention.portion])||!Array.isArray(data.dates)||data.dates.length!==expectedDates.length||data.dates.some((day,index)=>!day||day.date!==expectedDates[index].date||day.portion!==expectedDates[index].portion))throw Error('Wrong saved admin dates');
        if(typeof data.navigateTo!=='string'||!data.navigateTo.startsWith('/')||data.navigateTo.startsWith('//'))throw Error('Missing local admin route');
        const url=new URL(data.navigateTo,location.origin);
        if(url.origin!==location.origin||!['/Leave','/Leave/Index'].includes(url.pathname)||url.hash||[...url.searchParams.keys()].some(key=>!routeFields.includes(key)||url.searchParams.getAll(key).length!==1))throw Error('Invalid admin route');
        for(const key of routeFields){const actual=url.searchParams.get(key)||'',expected=!deleting&&key==='Year'?String(Number(intention.date.slice(0,4))):!deleting&&key==='Month'?String(Number(intention.date.slice(5,7))):!deleting&&key==='CalendarView'?'month':sent.get(key)||'';if(['SelfOnly','ShowOthers'].includes(key)?actual.toLowerCase()!==expected:actual!==expected)throw Error('Changed admin calendar view');}
        const keep=otherDraft()||(deleting?addDirty():deleteDirty());committed=true;
        if(deleting)clearDelete();else {baseline=snapshot(form);savedAdd=baseline;}
        recheck.querySelector('a').href=url.href;recheck.hidden=false;if(!keep)location.assign(url.href);
      },
      onSettled:(saved,outcome)=>{lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown');busy=false;if(disposed||invalid)return;if(!saved&&outcome!=='invalid')locked=true;sync();recheck.hidden=false;if(saved)show('success','관리자 연차 처리 결과를 확인했습니다.','다른 입력은 이어서 저장할 수 있습니다. 최신 연차 내역은 새 탭에서 확인하세요.');}
    });
    forms.set(form,{controller,submit});
  }
  function reconcile(){
    if(disposed)return;
    for(const [form,entry] of forms)if(!form.isConnected){
      if(busy||entry.controller.busy||(form===editor&&snapshot(form)!==baseline)||value(form,'ForceDeleteReason')){session.invalidate();locked=true;busy=false;confirmation?.abort();recheck.hidden=false;show('error','관리자 연차 화면이 교체되었습니다.','이전 응답을 적용하지 않습니다. 최신 내역을 확인해 주세요.');}
      entry.controller.dispose();form.removeEventListener('submit',entry.submit,true);forms.delete(form);
    }
    for(const id of ids){const form=document.getElementById(id);if(form&&!forms.has(form)){attach(form);if(id===ids[0]){editor=form;baseline=snapshot(form);}}}sync();
  }
  async function remove(button){
    if(blocked())return;let target;try{target=JSON.parse(button.dataset.adminTarget);}catch{return;}
    if(!targetOk(target)||target.id!==button.dataset.requestId||session.blocked(sessionOwner,resources(target.id,target.snapshot)))return;
    const form=removeForm();if(!form)return;
    if(value(form,'displayTarget')!==JSON.stringify(target)&&!await discard('delete',clearDelete))return;
    if(blocked()||!form.isConnected)return;
    form.elements.namedItem('ForceDeleteRequestId').value=target.id;form.elements.expectedSnapshot.value=target.snapshot;form.elements.displayTarget.value=JSON.stringify(target);deleteFocus=button;form.requestSubmit();
  }
  window.LeaveAdminCalendar={get pending(){return busy;},hasDraft,
    blocksNavigation(){const stop=busy||locked||invalid||disposed||hasDraft();if(stop&&!busy&&!locked&&!invalid&&!disposed)show('error','작성 중인 관리자 연차 내용이 있습니다.','입력을 유지했습니다. 저장하거나 해당 초안을 초기화한 뒤 달력을 이동해 주세요.');return stop;},
    selectDate(date,employeeId){if(!blocked()&&!addDirty()&&savedAdd===null)setDefaults(date,employeeId);},remove
  };
  const click=event=>{
    if(event.target.closest('[data-force-reset]'))void discard('add',()=>setDefaults(document.getElementById('dayDetailModal')?.dataset.selectedDate,screen.dataset.employeeId||value(add(),'ForceInput.EmployeeId')));
    if(event.target.closest('[data-force-discard]'))void discard('delete',clearDelete);
    if(event.target.closest('[data-force-resume]')&&!blocked()){deleteFocus=event.target;removeForm()?.requestSubmit();}
  };
  const invalidate=()=>{invalid=true;confirmation?.abort();for(const entry of forms.values())entry.controller.dispose();busy=false;sync();recheck.hidden=false;show('denied','로그인 상태 또는 권한이 바뀌었습니다.','이전 관리자의 요청은 다시 보내지 않습니다. 현재 계정과 내역을 확인해 주세요.');};
  const unload=event=>{if((busy&&!committed)||hasDraft()){event.preventDefault();event.returnValue='';}};
  const guard=event=>{if(event.target?.method==='post'&&!forms.has(event.target)&&(busy||locked||invalid||disposed||session.invalid)){event.preventDefault();event.stopImmediatePropagation();}};
  const unsubscribe=session.subscribe(sync);
  document.addEventListener('input',sync);document.addEventListener('change',sync);
  const observer=new MutationObserver(reconcile);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-application-locked']});reconcile();
  const dispose=event=>{if(event?.persisted||disposed)return;disposed=true;confirmation?.abort();observer.disconnect();unsubscribe();document.removeEventListener('input',sync);document.removeEventListener('change',sync);for(const [form,entry] of forms){entry.controller.dispose();form.removeEventListener('submit',entry.submit,true);}busy=false;sync();document.removeEventListener('click',click);document.removeEventListener('submit',guard,true);document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);window.removeEventListener('beforeunload',unload);window.removeEventListener('pagehide',dispose);};
  document.addEventListener('click',click);document.addEventListener('submit',guard,true);document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);window.addEventListener('beforeunload',unload);window.addEventListener('pagehide',dispose);
})();
