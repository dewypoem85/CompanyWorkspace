const sameSet=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function validateDiscordSnapshot(value) {
  if(!value || typeof value.employeeId!=='string' || !/^[1-9]\d{0,18}$/.test(value.employeeId)
      || BigInt(value.employeeId)>9223372036854775807n || !/^[A-F0-9]{64}$/.test(value.stateToken||'')
      || !(value.discordUserId===null || typeof value.discordUserId==='string'&&value.discordUserId.length>0&&value.discordUserId.length<=50)
      || !(value.discordUsername===null || typeof value.discordUsername==='string'&&value.discordUsername.length<=200)
      || typeof value.enabled!=='boolean' || !Array.isArray(value.selectedTypes) || value.selectedTypes.length>128
      || value.selectedTypes.some(x=>typeof x!=='string'||!x.length||x.length>100)
      || new Set(value.selectedTypes).size!==value.selectedTypes.length)throw Error('Invalid Discord snapshot');
  return value;
}
export function validateDiscordReceipt(data,operation,before,submitted) {
  if(data?.operation!==operation)throw Error('Discord operation changed');
  const value=validateDiscordSnapshot(data.snapshot);
  if(value.employeeId!==before.employeeId)throw Error('Discord owner changed');
  if(operation==='Unlink') {
    if(value.discordUserId!==null||value.discordUsername!==null||value.enabled||value.selectedTypes.length)throw Error('Unconfirmed unlink');
  } else if(operation==='Save') {
    if(value.discordUserId!==before.discordUserId||value.discordUsername!==before.discordUsername
        || value.enabled!==(submitted.get('discordDmEnabled')==='true'&&Boolean(before.discordUserId))
        || !sameSet(value.selectedTypes,[...new Set(submitted.getAll('selectedTypes'))]))throw Error('Discord settings mismatch');
  } else if(operation==='Test') {
    if(value.stateToken!==before.stateToken||value.discordUserId!==before.discordUserId||value.discordUsername!==before.discordUsername
        || value.enabled!==before.enabled||!sameSet(value.selectedTypes,before.selectedTypes))throw Error('Discord test scope changed');
  } else throw Error('Unexpected Discord action');
  return value;
}

function attach(root) {
  const fields=root.querySelector('#discordFields'),state=root.querySelector('#discordState'),recheck=root.querySelector('#discordRecheck');
  const source=root.querySelector('#discordSnapshot'),save=root.querySelector('[data-discord-action="Save"]');
  const forms=[...root.querySelectorAll('[data-discord-action]')],controllers=[],listeners=[];
  let baseline=validateDiscordSnapshot(JSON.parse(source.textContent)),scope=0,pending=null,modal=null,blocked=false,disposed=false,navigating=false;
  const enabled=save.querySelector('[type="checkbox"][name="discordDmEnabled"]'),choices=[...save.querySelectorAll('[name="selectedTypes"]')];
  const selection=()=>choices.filter(input=>input.checked).map(input=>input.value);
  const dirty=()=>Boolean(baseline)&&(enabled.checked!==baseline.enabled||!sameSet(selection(),baseline.selectedTypes.filter(type=>choices.some(input=>input.value===type))));
  const signature=()=>JSON.stringify([scope,baseline,enabled.checked,selection(),forms.map(form=>[form.dataset.discordAction,form.elements.namedItem('expectedEmployeeId').value,form.elements.namedItem('expectedStateToken').value])]);
  const show=(kind,title,message)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message});};
  const sync=()=>{
    fields.disabled=disposed||blocked||Boolean(pending)||Boolean(modal);
    const badge=root.querySelector('#discordDirty');if(badge){badge.textContent=dirty()?'저장하지 않은 변경':'변경 없음';badge.dataset.tone=dirty()?'warning':'neutral';}
  };
  const apply=value=>{
    baseline=value;source.textContent=JSON.stringify(value);
    root.querySelector('#discordIdentity').textContent=value.discordUserId?(value.discordUsername||value.discordUserId):'미연동';
    enabled.checked=value.enabled;enabled.disabled=!value.discordUserId;
    choices.forEach(input=>{input.checked=value.selectedTypes.includes(input.value);input.disabled=!value.discordUserId;});
    save.querySelector('button[type="submit"]').disabled=!value.discordUserId;
    forms.forEach(form=>{
      form.elements.namedItem('expectedEmployeeId').value=value.employeeId;
      form.elements.namedItem('expectedStateToken').value=value.stateToken;
      if(['Test','Unlink'].includes(form.dataset.discordAction))form.hidden=!value.discordUserId;
      if(form.dataset.discordAction==='Link')form.querySelector('button').textContent=value.discordUserId?'Discord 다시 연동':'Discord 연동';
    });
  };
  for(const form of forms) {
    const operation=form.dataset.discordAction;
    let captured,ticket=null;
    const gate=async event=>{
      if(disposed||blocked||pending||modal){event.preventDefault();event.stopImmediatePropagation();return;}
      if(operation!=='Unlink'&&!(operation==='Link'&&dirty())){if(operation==='Link')navigating=true;return;}
      const now=signature();
      if(ticket===now){ticket=null;if(operation==='Link')navigating=true;return;}
      event.preventDefault();event.stopImmediatePropagation();
      const returnFocus=event.submitter||document.activeElement;
      const abort=new AbortController();modal=abort;sync();
      try {
        const result=await window.CompanyDialog.confirm({title:operation==='Unlink'?'Discord 연동 해제':'Discord 연동 화면으로 이동',
          message:operation==='Unlink'?'개인 DM 연동과 수신 설정을 해제합니다. 저장하지 않은 변경도 사라집니다.':'저장하지 않은 설정 변경을 버리고 Discord 인증 화면으로 이동할까요?',
          details:[{label:'현재 Discord 계정',value:baseline.discordUsername||baseline.discordUserId||'미연동'}],
          confirmLabel:operation==='Unlink'?'연동 해제':'이동',tone:operation==='Unlink'?'danger':undefined,signal:abort.signal,returnFocus,
          validate:()=>signature()!==now?'설정이 변경되었습니다. 취소 후 다시 확인하세요.':undefined});
        if(result&&!disposed&&!blocked&&modal===abort&&signature()===now){ticket=now;modal=null;sync();form.requestSubmit();}
      } catch {if(!disposed&&!blocked)show('error','확인창을 열지 못했습니다.','요청은 보내지 않았습니다.');}
      finally {if(modal===abort){modal=null;sync();}}
    };
    form.addEventListener('submit',gate,true);listeners.push(()=>form.removeEventListener('submit',gate,true));
    if(operation==='Link')continue; // OAuth owns an external redirect and state cookie, not a save acknowledgement.
    controllers.push(window.CompanyForm.attach(form,{state,canSubmit:()=>!disposed&&!blocked&&!pending&&!modal&&Boolean(baseline?.discordUserId)&&!form.hidden,
      prepare:submitted=>{
        if(submitted.get('expectedEmployeeId')!==baseline.employeeId||submitted.get('expectedStateToken')!==baseline.stateToken)throw Error('Discord form scope changed');
        captured={scope,signature:signature(),before:structuredClone(baseline)};pending=form;sync();
      },
      onSaved:(data,submitted,context)=>{
        if(!context.isCurrent()||disposed||blocked||captured.scope!==scope||captured.signature!==signature())throw Error('Discord scope changed');
        const value=validateDiscordReceipt(data,operation,captured.before,submitted);
        if(operation!=='Test')apply(value);
      },
      onSettled:(saved,outcome)=>{
        if(disposed||captured.scope!==scope||pending!==form)return;
        pending=null;
        if(!saved){blocked=true;recheck.hidden=false;show(outcome==='denied'?'denied':'error','처리 결과를 확인해 주세요.',
          '설정 초안은 유지했습니다. 서버에 반영되었거나 DM이 발송되었을 수 있으므로 자동 재전송하지 않습니다. 현재 설정과 Discord 수신 여부를 확인하세요.');}
        else if(operation==='Test')show('success','테스트 DM 발송 요청을 확인했습니다.','실제 수신은 Discord에서 확인하세요. 편집 중인 수신 설정은 저장하지 않았습니다.');
        else if(operation==='Unlink')show('success','Discord 연동을 해제했습니다.','개인 DM 연동과 수신 설정을 해제했습니다.');
        sync();
      }
    }));
  }
  const changed=()=>sync();save.addEventListener('change',changed);
  const beforeunload=event=>{if(!navigating&&dirty()){event.preventDefault();event.returnValue='';}};
  const scopeChanged=()=>{
    if(disposed)return;scope++;blocked=true;pending=null;modal?.abort();modal=null;
    controllers.forEach(controller=>controller.dispose());baseline=null;source.textContent='';fields.replaceChildren();recheck.hidden=false;sync();
    show('denied','로그인·권한이 변경되었습니다.','이전 계정의 Discord 정보를 숨겼습니다. 현재 설정을 다시 확인하세요.');
  };
  const pagehide=event=>{
    if(event?.persisted||disposed)return;disposed=true;scope++;modal?.abort();modal=null;controllers.forEach(controller=>controller.dispose());listeners.forEach(remove=>remove());
    save.removeEventListener('change',changed);document.removeEventListener('workspace-entity-scope-change',scopeChanged);
    document.removeEventListener('company-page-leave',pagehide);window.removeEventListener('beforeunload',beforeunload);window.removeEventListener('pagehide',pagehide);sync();
  };
  document.addEventListener('workspace-entity-scope-change',scopeChanged);document.addEventListener('company-page-leave',pagehide);window.addEventListener('beforeunload',beforeunload);window.addEventListener('pagehide',pagehide);sync();
}
export function mountWorkspacePage(root=document){const screen=root.querySelector('#discordSettings');if(screen)attach(screen);}
if(typeof document!=='undefined')mountWorkspacePage();
