/* Three grant operations share one form session. Reads never replace another form's draft. */
(() => {
  'use strict';
  const screen=document.querySelector('[data-grant-screen]');
  if(!screen||!screen.querySelector('[data-grant-form]'))return;
  const C=window.LeaveGrantContract,session=window.CompanyForm.createSession(),readSession=window.CompanyReadSession.create(),entries=new Map(),catalogs=new Map(),reads=new Map(),tables=new Map();
  const context={actor:screen.dataset.actor,actorName:screen.dataset.actorName,today:screen.dataset.today,required:screen.dataset.reasonRequired==='true',canDelete:screen.dataset.canDelete==='true'};
  const filter=screen.querySelector('[data-grant-filter]'),listState=screen.querySelector('[data-grant-list-state]'),empty=screen.querySelector('[data-grant-empty]'),recheck=screen.querySelector('[data-grant-recheck]');
  const names={Adjust:['EmployeeId','Days','EffectiveDate','Note'],AddGrant:['AddEmployeeId','AddGrantType','AddGrantedDate','AddExpiresDate','AddDays','AddNote'],DeleteGrant:['grantId','DeleteGrantReason']};
  let disposed=false,listSequence=0,activeList=filter.elements.employeeId.value;
  const show=(node,kind,title,message,action)=>{if(!node)return;node.hidden=false;window.CompanyState.render(node,{kind,title,message,actionLabel:action?'다시 확인':'',onAction:action});};
  const value=(entry,name)=>entry.form.elements.namedItem(name)?.value||'';
  const draft=entry=>JSON.stringify(names[entry.operation].map(name=>value(entry,name)));
  const capture=entry=>draft(entry)+JSON.stringify(['expectedEmployeeId','expectedEmployeeSnapshot','expectedSnapshot'].map(name=>value(entry,name)));
  const employee=entry=>entry.operation==='DeleteGrant'?entry.form.dataset.employee:value(entry,entry.operation==='Adjust'?'EmployeeId':'AddEmployeeId');
  function intent(entry) {
    const employeeId=employee(entry),catalog=catalogs.get(employeeId);if(!catalog)return null;
    let type,grantedDate,expiresDate,days,previous;
    if(entry.operation==='DeleteGrant') {
      previous=catalog.grants.find(row=>row.grant.id===value(entry,'grantId'));if(!previous)return null;
      ({type,grantedDate,expiresDate,days}=previous.grant);
    } else {
      const adjust=entry.operation==='Adjust';type=adjust?'Manual':value(entry,'AddGrantType');
      grantedDate=value(entry,adjust?'EffectiveDate':'AddGrantedDate')||(adjust?catalog.defaultDate:'');
      expiresDate=adjust?C.expiry(grantedDate):value(entry,'AddExpiresDate')||C.expiry(grantedDate);
      days=C.decimal(value(entry,adjust?'Days':'AddDays'));
      previous=catalog.grants.find(row=>row.grant.type===type&&row.grant.grantedDate===grantedDate);
    }
    const reason=value(entry,entry.operation==='Adjust'?'Note':entry.operation==='AddGrant'?'AddNote':'DeleteGrantReason').trim()||'사유 미입력';
    return {operation:entry.operation,employeeId,employeeSnapshot:catalog.employeeSnapshot,previousSnapshot:previous?.snapshot||'',previous,catalog,type,grantedDate,expiresDate,days,reason};
  }
  function sync() {
    if(disposed)return;
    for(const entry of entries.values()) {
      const plan=intent(entry),spent=plan&&session.blocked(entry.owner,[C.resource(plan)])&&!session.pending&&!session.invalid;
      entry.fields.disabled=session.pending||session.invalid||(entry.operation==='DeleteGrant'&&!!spent);
      entry.form.querySelector('[type=submit]').disabled=session.pending||session.invalid||reads.size>0||!plan||!!spent;
      const hint=entry.form.querySelector('[data-grant-spent]');if(hint)hint.hidden=!spent;
    }
    for(const control of filter.elements)control.disabled=session.pending||session.invalid;
    if(session.invalid)recheck.hidden=false;
  }
  function getCatalog(employeeId) {
    if(disposed||session.invalid||session.pending||!C.id(employeeId))return Promise.reject(Error('Inactive read scope'));
    if(catalogs.has(employeeId))return Promise.resolve(catalogs.get(employeeId));
    if(reads.has(employeeId))return reads.get(employeeId).promise;
    const revision=session.revision,channel='leave-grant:'+employeeId,record={channel,promise:null};reads.set(employeeId,record);sync();
    const current=()=>!disposed&&!session.invalid&&!session.pending&&session.revision===revision&&reads.get(employeeId)===record;
    const request=async signal=>{
      const url=new URL('/Admin/Adjustments',location.origin);url.searchParams.set('handler','Baseline');url.searchParams.set('employeeId',employeeId);
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
      if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('Grant catalog unavailable');
      const data=await response.json();signal.throwIfAborted();if(!current())throw Error('Expired grant read');
      return C.catalog(data,employeeId,context);
    };
    record.promise=readSession.run(channel,request,15000)
      .then(result=>{if(result.status==='cancelled'||!current()||!result.isCurrent?.())throw Error('Expired grant read');if(result.status==='error')throw result.error;catalogs.set(employeeId,result.value);return result.value;})
      .finally(()=>{if(reads.get(employeeId)===record)reads.delete(employeeId);sync();});
    return record.promise;
  }
  async function warm(entry) {
    const target=employee(entry),revision=session.revision;if(!target||disposed||session.invalid||session.pending)return;
    const state=entry.form.querySelector('[data-grant-read-state]');
    if(!catalogs.has(target))show(state,'loading','발생분 기준값을 확인하고 있습니다.','입력한 내용은 유지됩니다.');
    try {await getCatalog(target);if(!disposed&&!session.invalid&&session.revision===revision&&employee(entry)===target&&state)state.hidden=true;}
    catch {if(!disposed&&!session.invalid&&session.revision===revision&&employee(entry)===target)show(state,'error','발생분을 불러오지 못했습니다.','입력을 유지했습니다. 현재 계정과 연결을 확인한 후 조회만 다시 시도하세요.',()=>warm(entry));}
    sync();
  }
  function validate(plan,entry) {
    if(!plan||!C.date(plan.grantedDate)||!C.date(plan.expiresDate)||plan.expiresDate<plan.grantedDate||!Object.hasOwn(C.types,plan.type))return '직원·발생 유형·날짜를 확인해 주세요.';
    if(context.required&&!value(entry,entry.operation==='Adjust'?'Note':entry.operation==='AddGrant'?'AddNote':'DeleteGrantReason').trim())return '작업 사유를 입력해 주세요.';
    if(entry.operation!=='DeleteGrant'&&!C.half(plan.days))return '0이 아닌 0.5일 단위 일수를 입력해 주세요. 음수도 사용할 수 있습니다.';
    if(entry.operation==='AddGrant'&&plan.previous)return '같은 직원·발생 유형·발생일의 발생분이 이미 있습니다.';
    if(entry.operation==='DeleteGrant'&&(!context.canDelete||plan.previous.allocated!=='0'||plan.previous.settled!=='0'))return '배정·정산 이력이 있거나 삭제 권한이 없는 발생분입니다.';
    return null;
  }
  function attach(form) {
    if(form.hidden)return;
    const operation=form.dataset.grantForm,owner=operation==='DeleteGrant'?'grant-delete:'+form.elements.grantId.value:'grant-'+operation;
    if(entries.has(owner))return;
    const entry={form,owner,operation,fields:form.querySelector('fieldset'),state:form.querySelector('[data-grant-state]'),accepted:false,busy:false,lease:null,confirmation:null,dates:{},savedDraft:null};
    for(const [name,val] of [['expectedEmployeeId',context.actor],['expectedEmployeeSnapshot',''],['expectedSnapshot','']]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=val;form.append(input);}
    entry.original=draft(entry);entries.set(owner,entry);session.track(owner,()=>form.isConnected&&draft(entry)!==(entry.savedDraft??entry.original));
    entry.submit=async event=>{
      if(entry.accepted)return;event.preventDefault();event.stopImmediatePropagation();
      if(disposed||session.invalid||session.pending||reads.size||!form.reportValidity())return;
      const plan=intent(entry),problem=validate(plan,entry);if(problem){show(entry.state,'error','요청을 보내지 않았습니다.',problem);return;}
      const lease=session.begin(owner,[C.resource(plan)]);if(!lease){sync();return;}entry.lease=lease;
      form.elements.expectedEmployeeId.value=context.actor;form.elements.expectedEmployeeSnapshot.value=plan.employeeSnapshot;form.elements.expectedSnapshot.value=plan.previousSnapshot;
      entry.captured=capture(entry);entry.intent=plan;entry.busy=true;entry.confirmation=new AbortController();const focus=document.activeElement;sync();
      try {
        const yes=await window.CompanyDialog.confirm({title:operation==='Adjust'?'연차를 보정할까요?':operation==='AddGrant'?'발생분을 추가할까요?':'발생분을 삭제할까요?',tone:operation==='DeleteGrant'?'danger':undefined,
          message:operation==='Adjust'?'같은 기준일의 수동 발생분에 일수를 더하거나 차감하고 감사 기록을 남깁니다.':operation==='AddGrant'?'입력한 유형과 기간으로 발생분을 만들고 감사 기록을 남깁니다.':'이 발생분을 삭제하고 감사 기록을 남깁니다. 삭제 후에는 되돌릴 수 없습니다.',
          details:[{label:'직원',value:plan.catalog.employeeName,entity:{kind:'employee',id:window.CompanyEntityDisplay.localEmployeeId(plan.employeeId),name:plan.catalog.employeeName}},{label:'발생분',value:`${C.types[plan.type]} · ${plan.grantedDate} ~ ${plan.expiresDate}`},{label:operation==='Adjust'?'보정 일수':'일수',value:plan.days+'일'},{label:'사유',value:plan.reason}],confirmLabel:operation==='DeleteGrant'?'발생분 삭제':'적용',returnFocus:focus,signal:entry.confirmation.signal});
        if(!yes||disposed||!lease.current||entry.captured!==capture(entry)||!form.isConnected)return;
        entry.fields.disabled=false;entry.accepted=true;form.requestSubmit();entry.accepted=false;
      } catch {if(!disposed&&!session.invalid)show(entry.state,'error','확인창을 열지 못했습니다.','입력한 내용을 유지했습니다.');}
      finally {entry.confirmation=null;if(!entry.controller.busy){lease.finish('cancelled');entry.busy=false;sync();if(focus?.isConnected&&!focus.disabled&&!disposed)focus.focus({preventScroll:true});}}
    };
    form.addEventListener('submit',entry.submit,true);
    entry.controller=window.CompanyForm.attach(form,{state:entry.state,
      canSubmit:()=>entry.accepted&&entry.lease?.current&&!disposed&&!session.invalid,
      prepare:()=>{if(capture(entry)!==entry.captured||form.elements.expectedEmployeeId.value!==context.actor)throw Error('Changed grant intention');},
      onSaved:(data,sent)=>{
        if(!entry.lease?.current||capture(entry)!==entry.captured||data?.previousSnapshot!==sent.get('expectedSnapshot')||data?.employeeSnapshot!==sent.get('expectedEmployeeSnapshot'))throw Error('Changed grant response scope');
        C.saved(data,entry.intent,context);entry.savedDraft=draft(entry);
        recheck.querySelector('a').href=data.navigateTo;recheck.hidden=false;
      },
      onSettled:(saved,outcome)=>{
        entry.lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown');entry.busy=false;if(disposed)return;
        sync();recheck.hidden=false;
        if(saved)show(entry.state,'success','처리 결과를 확인했습니다.',`${entry.intent.catalog.employeeName} · ${entry.intent.grantedDate} 발생분을 처리했습니다. 다른 입력은 유지했습니다. 최신 목록은 새 탭에서 확인하세요.`);
      }
    });
    entry.change=event=>{
      if(disposed||session.invalid||session.pending)return;
      const name=event.target.name;
      if(name==='EffectiveDate'||name==='AddGrantedDate'||name==='AddExpiresDate')entry.dates[name]=true;
      if(operation==='AddGrant'&&name==='AddGrantedDate'&&!entry.dates.AddExpiresDate)form.elements.AddExpiresDate.value=C.expiry(value(entry,'AddGrantedDate'))||'';
      if(name==='EmployeeId'||name==='AddEmployeeId') {
        const dateName=operation==='Adjust'?'EffectiveDate':'AddGrantedDate',option=event.target.selectedOptions[0];
        if(!entry.dates[dateName]&&option?.dataset.defaultDate)form.elements[dateName].value=option.dataset.defaultDate;
        if(operation==='AddGrant'&&!entry.dates.AddExpiresDate)form.elements.AddExpiresDate.value=C.expiry(value(entry,'AddGrantedDate'))||'';
        warm(entry);
      }
      sync();
    };
    form.addEventListener('input',entry.change);form.addEventListener('change',entry.change);
  }
  function table(data) {
    if(tables.has(data.employeeId))return tables.get(data.employeeId);
    const body=document.createElement('tbody');body.dataset.grantList=data.employeeId;
    for(const row of data.grants) {
      const g=row.grant,tr=document.querySelector('[data-grant-row-template]').content.firstElementChild.cloneNode(true);tr.dataset.grantRow=g.id;
      const cells={type:C.types[g.type],grantedDate:g.grantedDate,expiresDate:g.expiresDate,days:g.days,note:g.note,allocated:row.allocated,settled:row.settled,remaining:row.remaining};
      for(const [name,text] of Object.entries(cells)) {
        tr.querySelector(`[data-grant-cell="${name}"]`).textContent=text??'';
      }
      const form=tr.querySelector('[data-grant-form]'),canDelete=context.canDelete&&row.allocated==='0'&&row.settled==='0';
      form.dataset.employee=data.employeeId;form.elements.grantId.value=g.id;form.hidden=!canDelete;form.querySelector('fieldset').disabled=!canDelete;tr.querySelector('[data-grant-unavailable]').hidden=canDelete;body.append(tr);
    }
    screen.querySelector('[data-grant-list]').parentElement.append(body);tables.set(data.employeeId,body);
    body.querySelectorAll('[data-grant-form]').forEach(attach);return body;
  }
  function showTable(data) {
    table(data);for(const [id,body] of tables)body.hidden=id!==data.employeeId;activeList=data.employeeId;
    screen.querySelector('[data-grant-list-name]').textContent='조회 직원: '+data.employeeName;
    const avatar=screen.querySelector('[data-grant-list-label] .cw-entity-avatar');avatar.dataset.entityFallback=Array.from(data.employeeName)[0]||'?';avatar.dataset.companyLocalEmployee=data.employeeId;window.CompanyEntityDisplay.scan();
    empty.hidden=data.grants.length!==0;if(!data.grants.length)show(empty,'empty','발생분이 없습니다.','이 직원에게 등록된 발생분이 없습니다.');
    listState.hidden=true;sync();
  }
  async function changeTable(event) {
    event.preventDefault();if(disposed||session.invalid||session.pending){filter.elements.employeeId.value=activeList;return;}
    const target=filter.elements.employeeId.value,sequence=++listSequence,revision=session.revision;
    show(listState,'loading','직원 발생분을 불러오는 중입니다.','다른 직원의 삭제 사유와 보정·추가 입력은 유지됩니다.');
    try {const data=await getCatalog(target);if(!disposed&&!session.invalid&&!session.pending&&sequence===listSequence&&revision===session.revision)showTable(data);}
    catch {if(!disposed&&!session.invalid&&sequence===listSequence&&revision===session.revision){filter.elements.employeeId.value=activeList;show(listState,'error','직원 발생분을 불러오지 못했습니다.','기존 목록과 입력을 유지했습니다. 직원을 다시 선택해 조회해 주세요.');}}
  }
  const unsubscribe=session.subscribe(sync);
  const invalidate=()=>{
    session.invalidate();readSession.dispose();reads.clear();
    for(const entry of entries.values()){entry.confirmation?.abort();entry.controller.dispose();}
    sync();show(listState,'denied','로그인 상태 또는 권한이 바뀌었습니다.','이전 요청을 다시 보내지 않습니다. 현재 계정으로 최신 내역을 확인해 주세요.');
  };
  const unload=event=>{if(session.pending||session.hasDraftExcept('')){event.preventDefault();event.returnValue='';}};
  const dispose=event=>{
    if(event?.persisted||disposed)return;disposed=true;
    readSession.dispose();reads.clear();
    for(const entry of entries.values()){entry.confirmation?.abort();entry.controller.dispose();entry.fields.disabled=true;entry.form.removeEventListener('submit',entry.submit,true);entry.form.removeEventListener('input',entry.change);entry.form.removeEventListener('change',entry.change);}
    unsubscribe();session.dispose();observer.disconnect();filter.removeEventListener('submit',changeTable);filter.removeEventListener('change',changeTable);
    document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);window.removeEventListener('pagehide',dispose);window.removeEventListener('beforeunload',unload);
  };
  const observer=new MutationObserver(()=>{if(!screen.isConnected||[...entries.values()].some(entry=>!entry.form.isConnected)){recheck.hidden=false;show(listState,'error','화면이 교체되었습니다.','진행 중인 작업이 있다면 결과를 확인한 뒤 최신 화면에서 다시 작업해 주세요.');dispose({persisted:false});}});
  try {
    const data=JSON.parse(document.querySelector('[data-grant-initial]').textContent);
    if(data)catalogs.set(data.employeeId,C.catalog(data,data.employeeId,context));
    screen.querySelectorAll('[data-grant-list]').forEach(body=>tables.set(body.dataset.grantList,body));
    screen.querySelectorAll('[data-grant-form]').forEach(attach);
    if(data)showTable(data);else show(empty,'empty','등록된 직원이 없습니다.','회사 직원 연결 상태를 확인해 주세요.');
    for(const entry of entries.values())if(entry.operation!=='DeleteGrant')warm(entry);
  } catch {session.invalidate();screen.querySelectorAll('[data-grant-form] fieldset').forEach(node=>node.disabled=true);show(listState,'error','발생분 기준값을 확인하지 못했습니다.','이 화면에서 저장하지 않습니다. 최신 내역을 확인해 주세요.');recheck.hidden=false;}
  filter.addEventListener('submit',changeTable);filter.addEventListener('change',changeTable);observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);window.addEventListener('beforeunload',unload);window.addEventListener('pagehide',dispose);sync();
})();
