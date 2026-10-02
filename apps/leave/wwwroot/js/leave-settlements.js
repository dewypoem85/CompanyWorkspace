/* Settlement domain adapter. Shared form/dialog/state own transport and interaction. */
(() => {
  'use strict';
  const screen=document.querySelector('[data-settlement-screen]'),form=screen?.querySelector('[data-settlement-form]');
  if(!form)return;
  const state=screen.querySelector('[data-settlement-state]'),recheck=screen.querySelector('[data-settlement-recheck]'),fields=form.querySelector('fieldset');
  const grant=form.elements.grantId,employee=document.getElementById('settlementEmployee'),summary=screen.querySelector('[data-settlement-summary]');
  const actor=screen.dataset.actor,today=screen.dataset.today,required=screen.dataset.reasonRequired==='true';
  const session=window.CompanyForm.createSession(),owner='settlement';
  let busy=false,locked=screen.dataset.locked==='true',disposed=false,accepted=false,saved=false,captured='',intent=null,confirmation=null,lease=null;
  // Only enhanced requests add the preview contract; no-JS native POST remains compatible.
  for(const [name,value] of [['expectedEmployeeId',actor],['expectedSnapshot','']]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}
  const snapshot=()=>JSON.stringify(['grantId','type','days','note','expectedEmployeeId','expectedSnapshot'].map(key=>form.elements.namedItem(key).value));
  const baseline=snapshot();session.track(owner,()=>!saved&&snapshot()!==baseline);
  const id=value=>typeof value==='string'&&/^[1-9][0-9]*$/.test(value);
  const canonical=value=>{if(!/^\d+(?:\.\d+)?$/.test(value))return null;const [whole,part='']=value.split('.'),fraction=part.replace(/0+$/,'');return whole.replace(/^0+(?=\d)/,'')+(fraction?'.'+fraction:'');};
  function show(kind,title,message){state.hidden=false;window.CompanyState.render(state,{kind,title,message});}
  function sync(){fields.disabled=busy||locked||disposed||session.invalid;}
  function choose(){
    if(busy||locked||disposed)return;
    const option=grant.selectedOptions[0];form.elements.expectedSnapshot.value=option?.dataset.snapshot||'';
    form.elements.days.max=option?.dataset.available||'';
    summary.textContent=option?`선택한 발생분 · 잔여 ${option.dataset.available}일`:'';
  }
  const filter=()=>{
    if(busy||locked||disposed)return;
    for(const option of grant.options)option.hidden=option.disabled=option.dataset.employee!==employee.value;
    if(grant.selectedOptions[0]?.disabled)grant.value=[...grant.options].find(option=>!option.disabled)?.value||'';
    choose();
  };
  screen.querySelector('[data-settlement-employee]').hidden=false;
  employee.addEventListener('change',filter);grant.addEventListener('change',choose);filter();sync();
  const submit=async event=>{
    if(accepted)return;event.preventDefault();event.stopImmediatePropagation();
    if(busy||locked||disposed||!form.reportValidity())return;
    const option=grant.selectedOptions[0],amount=canonical(form.elements.days.value);
    if(!option||option.disabled||!id(option.value)||!/^[a-f0-9]{64}$/.test(option.dataset.snapshot)||!amount||amount==='0')return;
    lease=session.begin(owner,['leave-grant:'+option.value+':'+option.dataset.snapshot]);if(!lease)return;
    captured=snapshot();intent={employeeId:option.dataset.employee,grantId:option.value,days:amount,note:form.elements.note.value.trim()||'사유 미입력',label:option.label};
    const focus=document.activeElement;busy=true;confirmation=new AbortController();sync();
    try {
      const yes=await window.CompanyDialog.confirm({title:'연차 정산을 처리할까요?',message:form.elements.type.value==='CarryOver'?'선택한 발생분에서 차감하고 같은 일수의 이월 발생분을 생성합니다.':'선택한 발생분의 잔여량을 차감하고 정산 기록을 남깁니다. 실제 급여 지급은 실행하지 않습니다.',details:[{label:'발생분',value:intent.label},{label:'처리',value:form.elements.type.selectedOptions[0].label+' · '+intent.days+'일'},{label:'사유',value:intent.note}],confirmLabel:'정산 처리',returnFocus:focus,signal:confirmation.signal});
      if(!yes||disposed||locked||!lease.current||snapshot()!==captured||!form.isConnected)return;
      // requestSubmit must retain the enabled native fields in FormData.
      fields.disabled=false;accepted=true;form.requestSubmit();accepted=false;
    } catch {if(!disposed&&!locked)show('error','정산 확인을 열지 못했습니다.','입력과 현재 내역을 확인해 주세요.');}
    finally {confirmation=null;if(!controller.busy){lease?.finish('cancelled');busy=false;sync();if(focus?.isConnected&&!focus.disabled&&!disposed)focus.focus({preventScroll:true});}}
  };
  form.addEventListener('submit',submit,true);
  const controller=window.CompanyForm.attach(form,{state,
    canSubmit:()=>accepted&&lease?.current&&!locked&&!disposed,
    prepare:()=>{if(snapshot()!==captured||form.elements.expectedEmployeeId.value!==actor||required&&!form.elements.note.value.trim())throw Error('Changed settlement intent');},
    onSaved:(data,sent)=>{
      if(!data||snapshot()!==captured||data.operation!=='Settle'||data.actorEmployeeId!==actor||data.employeeId!==intent.employeeId||
        data.grantId!==sent.get('grantId')||data.previousSnapshot!==sent.get('expectedSnapshot')||data.type!==sent.get('type')||
        data.days!==intent.days||data.note!==intent.note||data.processedDate!==today||!id(data.id)||data.navigateTo!=='/Admin/Settlements'||
        (data.type==='CarryOver'?(!id(data.createdGrantId)||data.createdGrantId===data.grantId):data.createdGrantId!==null))throw Error('Unconfirmed settlement receipt');
      saved=true;locked=true;recheck.hidden=false;
    },
    onSettled:(confirmed,outcome)=>{
      lease?.finish(confirmed?'saved':outcome==='invalid'?'invalid':'unknown');busy=false;if(disposed)return;
      if(!confirmed&&outcome!=='invalid')locked=true;sync();recheck.hidden=false;
      if(confirmed)show('success','정산 처리 결과를 확인했습니다.','제출한 입력을 보관했습니다. 잔여량과 새 이월 발생분은 최신 정산 내역에서 확인하세요.');
    }
  });
  const invalidate=()=>{locked=true;confirmation?.abort();controller.dispose();busy=false;session.invalidate();sync();recheck.hidden=false;show('denied','로그인 상태 또는 권한이 바뀌었습니다.','이전 계정의 정산을 다시 보내지 않습니다. 현재 계정과 최신 내역을 확인하세요.');};
  const unload=event=>{if(!saved&&(busy||form.elements.days.value||form.elements.note.value)){event.preventDefault();event.returnValue='';}};
  const dispose=event=>{if(event?.persisted||disposed)return;disposed=true;confirmation?.abort();controller.dispose();session.dispose();sync();observer.disconnect();form.removeEventListener('submit',submit,true);employee.removeEventListener('change',filter);grant.removeEventListener('change',choose);document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);window.removeEventListener('beforeunload',unload);window.removeEventListener('pagehide',dispose);};
  const observer=new MutationObserver(()=>{if(!form.isConnected){if(controller.busy){locked=true;recheck.hidden=false;show('error','정산 결과를 확인하지 못했습니다.','화면이 교체되었습니다. 최신 내역을 확인하고 반복 처리하지 마세요.');}dispose({persisted:false});}});observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);window.addEventListener('beforeunload',unload);window.addEventListener('pagehide',dispose);
})();
