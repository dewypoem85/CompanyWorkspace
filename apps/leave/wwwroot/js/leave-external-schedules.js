/* External calendar domain adapter. Native transport, feedback and confirmations are shared. */
(() => {
  'use strict';
  const screen=document.querySelector('[data-leave-external-screen]');if(!screen)return;
  const session=window.LeaveFormSession ||= window.CompanyForm.createSession(),sessionOwner='external';
  const state=screen.querySelector('[data-leave-external-state]'),recheck=screen.querySelector('[data-leave-external-recheck]');
  const forms=new Map(),routeFields=['Year','Month','CalendarView','SelfOnly','ShowOthers','ViewEmployeeId','RequestLimit','RequestPage'];
  const inputFields={employeeId:'EmployeeId',startDate:'StartDate',endDate:'EndDate',category:'Category',memo:'Memo'};
  const idPattern=/^[1-9][0-9]*$/,hashPattern=/^[a-f0-9]{64}$/;
  let busy=false,locked=false,invalid=false,disposed=false,committed=false,confirmation=null,baseline='',editor=null,savedBaseline=null;
  const saveForm=()=>document.getElementById('externalScheduleForm');
  const value=(form,key)=>form.elements.namedItem(key)?.value??'';
  const input=form=>Object.fromEntries(Object.entries(inputFields).map(([key,field])=>[key,value(form,'ExternalInput.'+field)]));
  const snapshot=form=>JSON.stringify([value(form,'expectedEmployeeId'),value(form,'expectedSnapshot'),value(form,'ExternalInput.Id'),value(form,'id'),value(form,'displayInput'),input(form),routeFields.map(key=>value(form,key))]);
  const hasDraft=()=>!!editor?.isConnected&&snapshot(editor)!==baseline;
  session.track(sessionOwner,hasDraft);
  const resources=(id,version)=>id?['external-schedule:'+id+':'+version]:[];
  const formResources=form=>resources(value(form,form.getAttribute('id')==='externalScheduleDeleteForm'?'id':'ExternalInput.Id'),value(form,'expectedSnapshot'));
  const otherBusy=()=>session.blocked(sessionOwner);
  const blocked=()=>busy||locked||invalid||disposed||otherBusy();
  const otherEditors=[...document.forms].filter(form=>form.method==='post'&&!['applyForm','externalScheduleForm','externalScheduleDeleteForm','adminForceAddForm','adminForceDeleteForm'].includes(form.getAttribute('id'))&&!form.matches('[data-leave-self-action]'));
  const editorValue=form=>JSON.stringify([...form.elements].filter(el=>el.name&&el.type!=='hidden'&&!['submit','button'].includes(el.type)).map(el=>[el.name,el.value,el.checked??null]));
  const otherBaselines=new Map(otherEditors.map(form=>[form,editorValue(form)]));
  const otherDraft=()=>session.hasDraftExcept(sessionOwner)||window.LeaveAdminCalendar?.hasDraft()||otherEditors.some(form=>form.isConnected&&editorValue(form)!==otherBaselines.get(form));
  const show=(kind,title,message)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message});};
  function sync(){
    document.documentElement.dataset.leaveExternalBusy=String(busy||locked||invalid||disposed);
    const calendar=document.getElementById('calendarArea');if(calendar)calendar.inert=session.pending;
    for(const form of forms.keys())for(const button of form.querySelectorAll('button'))button.disabled=blocked()||(button.type==='submit'&&(session.blocked(sessionOwner,formResources(form))||(form===editor&&savedBaseline!==null&&snapshot(form)===savedBaseline)));
    for(const button of document.querySelectorAll('.external-schedule-edit-button,.external-schedule-delete-button'))button.disabled=blocked()||session.blocked(sessionOwner,resources(button.dataset.scheduleId,button.dataset.snapshot));
  }
function hideDetail(){window.LeaveDayDetail?.close();}
  function setEditor(data){
    const form=saveForm();if(!form)return;
    form.elements.namedItem('ExternalInput.Id').value=data.id||'';form.elements.expectedSnapshot.value=data.snapshot||'';
    for(const [key,field] of Object.entries(inputFields))form.elements.namedItem('ExternalInput.'+field).value=data[key]||'';
    document.getElementById('externalScheduleFormTitle').textContent=data.id?'외부 일정 수정':'외부 일정 추가';
    document.getElementById('externalScheduleSubmit').textContent=data.id?'수정 저장':'외부 일정 추가';
    // Notify the shared searchable picker; do not implement a second employee control.
    editor=form;baseline=snapshot(form);savedBaseline=null;
    form.elements.namedItem('ExternalInput.EmployeeId').dispatchEvent(new Event('change',{bubbles:true}));
  }
  function defaults(date,employeeId){const form=saveForm();const select=form?.elements.namedItem('ExternalInput.EmployeeId');return {employeeId:select&&[...select.options].some(option=>option.value===employeeId)?employeeId:select?.options[0]?.value||'',startDate:date,endDate:date,category:'외근',memo:''};}
  async function discardThen(action){
    if(blocked())return;
    const form=saveForm(),before=form?snapshot(form):'',focus=document.activeElement;
    if(!hasDraft()){action();return;}
    const lease=session.begin(sessionOwner);if(!lease)return;committed=false;
    busy=true;confirmation=new AbortController();sync();
    try {
      const yes=await window.CompanyDialog.confirm({title:'작성 중인 외부 일정 내용을 버릴까요?',message:'아직 저장하지 않은 외부 일정 입력만 초기화합니다. 다른 연차 입력은 유지합니다.',confirmLabel:'초안 버리기',signal:confirmation.signal,returnFocus:focus});
      if(yes&&!invalid&&!disposed&&form?.isConnected&&snapshot(form)===before)action();
    } catch {if(!invalid&&!disposed)show('error','초안을 유지했습니다.','확인창을 열지 못했습니다.');}
    finally {lease.finish('cancelled');busy=false;confirmation=null;sync();if(focus?.isConnected&&!focus.disabled&&!invalid&&!disposed)focus.focus({preventScroll:true});}
  }
  function target(button){return {id:button.dataset.scheduleId,snapshot:button.dataset.snapshot,employeeId:button.dataset.employeeId,startDate:button.dataset.startDate,endDate:button.dataset.endDate,category:button.dataset.category,memo:button.dataset.memo,employeeName:button.dataset.employeeName};}
  function validTarget(data){return idPattern.test(data.id||'')&&hashPattern.test(data.snapshot||'')&&Object.keys(inputFields).every(key=>typeof data[key]==='string')&&idPattern.test(data.employeeId);}
  function attach(form){
    const deleting=form.getAttribute('id')==='externalScheduleDeleteForm',owner=value(form,'expectedEmployeeId');let accepted=false,captured='',intention=null,focus=null,lease=null;
    const submit=async event=>{
      if(accepted)return;event.preventDefault();event.stopImmediatePropagation();if(blocked()||!form.reportValidity())return;
      const id=value(form,deleting?'id':'ExternalInput.Id'),version=value(form,'expectedSnapshot');
      if((id&&!idPattern.test(id))||((id||deleting)?!hashPattern.test(version):version!==''))return;
      try {intention=deleting?JSON.parse(value(form,'displayInput')):input(form);}catch{return;}
      if(!intention||Object.keys(inputFields).some(key=>typeof intention[key]!=='string'))return;
      if(!deleting){intention.category=intention.category.trim();intention.memo=intention.memo.trim();}
      if(!deleting&&savedBaseline!==null&&snapshot(form)===savedBaseline)return;
      lease=session.begin(sessionOwner,formResources(form));if(!lease)return;committed=false;
      captured=snapshot(form);focus=document.activeElement;busy=true;confirmation=new AbortController();sync();
      try {
        const label=deleting?'삭제':id?'수정 저장':'추가';
        const yes=await window.CompanyDialog.confirm({title:deleting?'외부 일정을 삭제할까요?':id?'외부 일정을 수정할까요?':'외부 일정을 추가할까요?',message:'연차 차감 없이 관리자에게 표시되는 외부 일정입니다.',details:[{label:'직원',value:deleting?intention.employeeName||intention.employeeId:form.elements.namedItem('ExternalInput.EmployeeId').selectedOptions[0]?.textContent||intention.employeeId},{label:'기간',value:intention.startDate+' ~ '+intention.endDate},{label:'구분',value:intention.category},{label:'메모',value:intention.memo}],confirmLabel:label,signal:confirmation.signal,returnFocus:focus});
        if(!yes||invalid||disposed||!form.isConnected||snapshot(form)!==captured)return;
        hideDetail();accepted=true;form.requestSubmit();accepted=false;
      } catch {if(!invalid&&!disposed)show('error','일정 확인을 열지 못했습니다.','입력은 유지했습니다.');}
      finally {confirmation=null;if(!controller.busy){lease?.finish('cancelled');busy=false;sync();if(focus?.isConnected&&!focus.disabled&&!invalid&&!disposed)focus.focus({preventScroll:true});}}
    };
    form.addEventListener('submit',submit,true);
    const controller=window.CompanyForm.attach(form,{state,
      canSubmit:()=>accepted&&lease?.current&&!locked&&!invalid&&!disposed&&!otherBusy(),
      prepare:()=>{if(snapshot(form)!==captured||value(form,'expectedEmployeeId')!==owner)throw Error('Changed external schedule intent');},
      onSaved:(data,sent)=>{
        const id=sent.get(deleting?'id':'ExternalInput.Id')||'',mode=deleting?'delete':id?'update':'create';
        if(!data||data.operation!==(deleting?'ExternalScheduleDelete':'ExternalScheduleSave')||data.mode!==mode||data.actorEmployeeId!==owner||typeof data.id!=='string'||!idPattern.test(data.id)||BigInt(data.id)>9223372036854775807n||(id&&data.id!==id)||data.previousSnapshot!==sent.get('expectedSnapshot')||snapshot(form)!==captured)throw Error('Unconfirmed external schedule receipt');
        if(deleting?data.snapshot!=='':typeof data.snapshot!=='string'||!hashPattern.test(data.snapshot))throw Error('Invalid saved baseline');
        if(!data.input||Object.keys(inputFields).some(key=>data.input[key]!==intention[key]))throw Error('Changed external schedule fields');
        if(typeof data.navigateTo!=='string'||!data.navigateTo.startsWith('/')||data.navigateTo.startsWith('//'))throw Error('Missing calendar route');
        const url=new URL(data.navigateTo,location.origin);
        if(url.origin!==location.origin||!['/Leave','/Leave/Index'].includes(url.pathname)||url.hash||[...url.searchParams.keys()].some(key=>!routeFields.includes(key)||url.searchParams.getAll(key).length!==1))throw Error('Invalid calendar route');
        for(const key of routeFields){const actual=url.searchParams.get(key)||'',expected=key==='Year'?String(Number(intention.startDate.slice(0,4))):key==='Month'?String(Number(intention.startDate.slice(5,7))):key==='CalendarView'?'month':sent.get(key)||'';if(['SelfOnly','ShowOthers'].includes(key)?actual.toLowerCase()!==expected:actual!==expected)throw Error('Changed calendar view');}
        const keep=otherDraft()||(deleting&&hasDraft());committed=true;
        if(!deleting){setEditor({...data.input,id:data.id,snapshot:data.snapshot});savedBaseline=snapshot(form);}
        recheck.querySelector('a').href=url.href;recheck.hidden=false;
        if(!keep)location.assign(url.href);
      },
      onSettled:(saved,outcome)=>{lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown');busy=false;if(disposed||invalid)return;if(!saved&&outcome!=='invalid')locked=true;sync();recheck.hidden=false;if(saved)show('success','외부 일정 처리 결과를 확인했습니다.','다른 입력은 이어서 저장할 수 있습니다. 최신 일정은 새 탭에서 확인하세요.');}
    });
    forms.set(form,{controller,submit});
  }
  function reconcile(){
    if(disposed)return;
    for(const [form,entry] of forms)if(!form.isConnected){
      if(entry.controller.busy||(form===editor&&snapshot(form)!==baseline)){session.invalidate();locked=true;busy=false;recheck.hidden=false;show('error','일정 화면이 교체되었습니다.','이전 응답은 적용하지 않습니다. 최신 일정을 확인해 주세요.');}
      entry.controller.dispose();form.removeEventListener('submit',entry.submit,true);forms.delete(form);
    }
    for(const id of ['externalScheduleForm','externalScheduleDeleteForm']){const form=document.getElementById(id);if(form&&!forms.has(form)){attach(form);if(id==='externalScheduleForm'){editor=form;baseline=snapshot(form);}}}
    sync();
  }
  window.LeaveExternalSchedule={get pending(){return busy;},hasDraft,
    blocksNavigation(){const stop=busy||locked||invalid||disposed||hasDraft();if(stop&&!busy&&!locked&&!invalid&&!disposed)show('error','작성 중인 외부 일정이 있습니다.','내용을 유지했습니다. 저장하거나 상세창의 초안 초기화를 사용한 뒤 달력을 이동해 주세요.');return stop;},
    selectDate(date,employeeId){if(!blocked()&&!hasDraft()&&savedBaseline===null)setEditor(defaults(date,employeeId));},
    reset(date,employeeId){return discardThen(()=>setEditor(defaults(date,employeeId)));},
    edit(button){const data=target(button);if(!validTarget(data)||session.blocked(sessionOwner,resources(data.id,data.snapshot)))return;return discardThen(()=>{setEditor(data);saveForm()?.scrollIntoView({block:'nearest'});document.getElementById('externalScheduleMemo')?.focus();});},
    remove(button){if(blocked())return;const data=target(button),form=document.getElementById('externalScheduleDeleteForm');if(!form||!validTarget(data)||session.blocked(sessionOwner,resources(data.id,data.snapshot)))return;form.elements.namedItem('id').value=data.id;form.elements.expectedSnapshot.value=data.snapshot;form.elements.displayInput.value=JSON.stringify(data);form.requestSubmit();}
  };
  const invalidate=()=>{invalid=true;confirmation?.abort();for(const entry of forms.values())entry.controller.dispose();busy=false;sync();recheck.hidden=false;show('denied','로그인 상태 또는 권한이 바뀌었습니다.','이전 계정의 외부 일정 변경은 다시 보내지 않습니다. 현재 계정과 일정을 확인해 주세요.');};
  const unload=event=>{if((busy&&!committed)||hasDraft()){event.preventDefault();event.returnValue='';}};
  const guard=event=>{const form=event.target;if(form?.method==='post'&&!forms.has(form)&&(busy||locked||invalid||disposed||session.invalid)){event.preventDefault();event.stopImmediatePropagation();}};
  const unsubscribe=session.subscribe(sync);
  document.addEventListener('input',sync);document.addEventListener('change',sync);
  const observer=new MutationObserver(reconcile);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-application-locked']});reconcile();
  const dispose=event=>{if(event?.persisted||disposed)return;disposed=true;confirmation?.abort();observer.disconnect();unsubscribe();document.removeEventListener('input',sync);document.removeEventListener('change',sync);for(const [form,entry] of forms){entry.controller.dispose();form.removeEventListener('submit',entry.submit,true);}busy=false;sync();document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);document.removeEventListener('submit',guard,true);window.removeEventListener('beforeunload',unload);window.removeEventListener('pagehide',dispose);};
  document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);document.addEventListener('submit',guard,true);window.addEventListener('beforeunload',unload);window.addEventListener('pagehide',dispose);
})();
