const id=value=>typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
const token=value=>typeof value==='string'&&/^[A-F0-9]{64}$/.test(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const timestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))return false;
  const date=new Date(value.replace(' ','T')+':00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,16)===value.replace(' ','T');
};
export function validateWebhookSnapshot(value){
  if(!value||!id(value.actorEmployeeId)||!token(value.stateToken)||!Array.isArray(value.items))throw Error('Invalid webhook snapshot');
  const ids=new Set();let previous=0n;
  for(const row of value.items){
    if(!row||!id(row.id)||ids.has(row.id)||BigInt(row.id)<=previous||typeof row.memo!=='string'||
      typeof row.maskedUrl!=='string'||!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\*\*\*$/.test(row.maskedUrl)||
      !timestamp(row.createdAt))throw Error('Invalid webhook row');
    ids.add(row.id);previous=BigInt(row.id);
  }
  return value;
}
export function validateWebhookReceipt(data,operation,before,intent){
  if(data?.operation!==operation||data.previousStateToken!==before.stateToken||data.navigateTo!=='/Admin/NotificationSettings')throw Error('Webhook operation changed');
  const after=validateWebhookSnapshot(data.snapshot);
  if(after.actorEmployeeId!==before.actorEmployeeId)throw Error('Webhook owner changed');
  if(operation==='Test'){
    if(data.affected!==null||!equal(after,before))throw Error('Webhook test targets changed');
  }else if(operation==='Delete'){
    if(data.affected?.id!==intent.id||!before.items.some(row=>row.id===intent.id)||
      !equal(after.items,before.items.filter(row=>row.id!==intent.id))||after.stateToken===before.stateToken)throw Error('Unconfirmed webhook deletion');
  }else if(operation==='Add'){
    const affected=data.affected,newRow=after.items.find(row=>row.id===affected?.id);
    if(!affected||!id(affected.id)||affected.urlHash!==intent.urlHash||affected.memo!==intent.memo||
      !newRow||newRow.memo!==intent.memo||newRow.maskedUrl!==intent.maskedUrl||before.items.some(row=>row.id===affected.id)||
      !equal(after.items.filter(row=>row.id!==affected.id),before.items)||after.stateToken===before.stateToken)throw Error('Unconfirmed webhook creation');
  }else throw Error('Unknown webhook operation');
  return after;
}
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();}

function attach(screen){
  const fields=screen.querySelector('[data-webhook-fields]'),state=screen.querySelector('[data-webhook-state]'),recheck=screen.querySelector('[data-webhook-recheck]');
  const source=screen.querySelector('[data-webhook-snapshot]'),rows=screen.querySelector('[data-webhook-rows]'),add=screen.querySelector('[data-webhook-action="Add"]');
  let baseline=validateWebhookSnapshot(JSON.parse(source.textContent)),locked=screen.dataset.locked==='true',disposed=false,busy=false,accepted=null;
  const session=window.CompanyForm.createSession(),bindings=new Map(),owners=new Set();
  const draft=()=>JSON.stringify([add.elements.WebhookUrl.value,add.elements.Memo.value]);let savedDraft=draft();
  const signature=form=>JSON.stringify([...form.elements].filter(node=>node.name&&node.type!=='submit').map(node=>[node.name,node.value]));
  const show=(kind,title,message)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message});state.scrollIntoView({block:'nearest',behavior:'instant'});};
  const sync=()=>{fields.disabled=locked||disposed||busy||session.invalid;add.querySelector('button[type="submit"]').disabled=draft()===savedDraft;};
  function bind(form){
    const operation=form.dataset.webhookAction,owner=operation+(operation==='Delete'?':'+form.elements.namedItem('id').value:'');
    if(!owners.has(owner)){session.track(owner,operation==='Add'?()=>draft()!==savedDraft:()=>false);owners.add(owner);}
    for(const [name,value] of [['expectedEmployeeId',baseline.actorEmployeeId],['expectedStateToken',baseline.stateToken]]){
      const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
    }
    let captured,before,intent,lease,next;
    const gate=async event=>{
      if(accepted===form)return;event.preventDefault();event.stopImmediatePropagation();
      if(disposed||locked||busy||operation==='Add'&&draft()===savedDraft||!form.reportValidity())return;
      lease=session.begin(owner,[]);if(!lease)return;
      captured=signature(form);before=structuredClone(baseline);intent={id:form.elements.namedItem('id')?.value};
      const focus=event.submitter||document.activeElement;busy=true;sync();
      try{
        if(operation==='Add'){
          const url=add.elements.WebhookUrl.value.trim();intent.urlHash=await hash(url);intent.memo=add.elements.Memo.value.trim();
          const parsed=new URL(url);intent.maskedUrl=`${parsed.protocol}//${parsed.hostname.replace(/\.$/,'').toLowerCase()}/api/webhooks/***`;
        }
        if(!lease.current||disposed||locked||captured!==signature(form)||!form.isConnected)return;
        const target=before.items.find(row=>row.id===intent.id);
        const details=operation==='Add'?[{label:'웹훅',value:intent.maskedUrl},{label:'메모',value:intent.memo||'-'}]:operation==='Delete'?[{label:'메모',value:target?.memo||'-'},{label:'웹훅',value:target?.maskedUrl||''}]:[{label:'발송 대상',value:before.items.map(row=>row.memo||row.maskedUrl).join('\n')}];
        const yes=await window.CompanyDialog.confirm({title:operation==='Add'?'채널 웹훅을 등록할까요?':operation==='Delete'?'채널 웹훅을 삭제할까요?':'전체 채널에 테스트 메시지를 보낼까요?',
          message:operation==='Test'?'등록된 모든 채널에 실제 메시지를 보냅니다. 편집 중인 추가 양식은 저장하지 않습니다.':operation==='Delete'?'이 웹훅으로 보내는 채널 알림을 중단합니다. 개인 DM 설정은 유지합니다.':'새 연차 신청의 채널 알림 수신처를 추가합니다.',details,
          confirmLabel:operation==='Add'?'등록':operation==='Delete'?'삭제':'테스트 발송',tone:operation==='Delete'?'danger':undefined,signal:lease.signal,returnFocus:focus,
          validate:()=>captured!==signature(form)?'입력이 변경되었습니다. 취소 후 다시 확인하세요.':undefined});
        if(!yes||disposed||locked||!lease.current||captured!==signature(form)||!form.isConnected)return;
        fields.disabled=false;accepted=form;form.requestSubmit();accepted=null;
      }catch{if(!disposed&&!locked)show('error','요청을 보내지 않았습니다.','웹훅 URL과 입력을 확인하세요.');}
      finally{accepted=null;if(!controller.busy){lease?.finish('cancelled');busy=false;sync();if(focus?.isConnected&&!focus.disabled&&!disposed)focus.focus({preventScroll:true});}}
    };
    form.addEventListener('submit',gate,true);
    const controller=window.CompanyForm.attach(form,{state,canSubmit:()=>accepted===form&&lease?.current&&!disposed&&!locked,
      prepare:sent=>{if(signature(form)!==captured||sent.get('expectedEmployeeId')!==before.actorEmployeeId||sent.get('expectedStateToken')!==before.stateToken)throw Error('Changed webhook intent');sync();},
      onSaved:(data,sent,context)=>{if(!context.isCurrent()||disposed||locked||!lease.current||signature(form)!==captured)throw Error('Stale webhook response');next=validateWebhookReceipt(data,operation,before,intent);},
      onSettled:(saved,outcome)=>{
        if(disposed)return;lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown');busy=false;
        if(saved){
          if(operation==='Add')savedDraft=draft();
          apply(next);recheck.hidden=false;
          show('success',operation==='Test'?'테스트 발송 요청을 확인했습니다.':'설정 변경을 확인했습니다.',operation==='Test'?'실제 수신은 Discord 채널에서 확인하세요. 추가 양식의 초안은 저장하지 않았습니다.':'웹훅 목록을 갱신했습니다. 추가 양식의 입력은 그대로 보관했습니다.');
        }else if(outcome!=='invalid'){
          locked=true;recheck.hidden=false;
          show(outcome==='denied'?'denied':'error','처리 결과를 확인해 주세요.','일부 설정이 저장되었거나 메시지가 발송되었을 수 있습니다. 초안은 유지하며 자동 재전송하지 않습니다. 새 탭의 현재 설정과 Discord 수신 내역을 확인하세요.');
        }
        sync();
      }});
    bindings.set(form,()=>{controller.dispose();form.removeEventListener('submit',gate,true);});
  }
  function apply(value){
    baseline=value;source.textContent=JSON.stringify(value);
    for(const [form,remove] of bindings)if(form.dataset.webhookAction==='Delete'){remove();bindings.delete(form);}
    rows.replaceChildren();
    for(const row of value.items){
      const node=screen.querySelector('[data-webhook-row-template]').content.firstElementChild.cloneNode(true);
      node.dataset.webhookRow=row.id;node.querySelector('[data-webhook-memo]').textContent=row.memo||'-';node.querySelector('[data-webhook-url]').textContent=row.maskedUrl;
      node.querySelector('[data-webhook-created]').textContent=row.createdAt;node.querySelector('[name="id"]').value=row.id;rows.append(node);bind(node.querySelector('form'));
    }
    if(!value.items.length)rows.append(screen.querySelector('[data-webhook-empty-template]').content.cloneNode(true));
    for(const form of bindings.keys()){form.elements.expectedEmployeeId.value=value.actorEmployeeId;form.elements.expectedStateToken.value=value.stateToken;}
    screen.querySelector('[data-webhook-count]').textContent=value.items.length?`${value.items.length}개 설정됨`:'미설정';
    screen.querySelector('[data-webhook-description]').textContent=value.items.length?'등록된 웹훅으로 채널 알림을 발송합니다.':'아래에서 Discord 웹훅 URL을 추가하세요.';
    screen.querySelector('[data-webhook-action="Test"] button').disabled=!value.items.length;
  }
  screen.querySelectorAll('[data-webhook-action]').forEach(bind);
  const invalidate=()=>{if(disposed)return;locked=true;session.invalidate();for(const remove of bindings.values())remove();bindings.clear();busy=false;fields.replaceChildren();source.textContent='';recheck.hidden=false;sync();show('denied','로그인·권한이 변경되었습니다.','이전 계정의 웹훅 정보를 숨겼습니다. 현재 설정을 다시 확인하세요.');};
  const unload=event=>{if(busy||draft()!==savedDraft){event.preventDefault();event.returnValue='';}};
  const dispose=event=>{if(event?.persisted||disposed)return;disposed=true;session.dispose();for(const remove of bindings.values())remove();bindings.clear();observer.disconnect();add.removeEventListener('input',sync);document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);window.removeEventListener('pagehide',dispose);window.removeEventListener('beforeunload',unload);sync();};
  const observer=new MutationObserver(()=>{
    if(!screen.isConnected||!fields.isConnected)dispose({persisted:false});
    else if([...bindings.keys()].some(form=>!form.isConnected)){
      locked=true;recheck.hidden=false;show('error','처리 화면이 변경되었습니다.','설정이나 발송이 반영되었을 수 있습니다. 현재 내역을 확인하고 자동으로 다시 보내지 마세요.');dispose({persisted:false});
    }
  });observer.observe(document.body,{childList:true,subtree:true});
  add.addEventListener('input',sync);document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);window.addEventListener('pagehide',dispose);window.addEventListener('beforeunload',unload);recheck.hidden=!locked;sync();
}
export function mountWorkspacePage(root=document){
  const screen=root.querySelector('[data-webhook-screen]');if(screen)try{attach(screen);}catch{
    screen.querySelector('[data-webhook-fields]').disabled=true;
    const state=screen.querySelector('[data-webhook-state]');state.hidden=false;window.CompanyState?.render(state,{kind:'error',title:'설정을 확인하지 못했습니다.',message:'현재 설정 화면을 다시 열어 주세요.'});screen.querySelector('[data-webhook-recheck]').hidden=false;
  }
}
if(typeof document!=='undefined')mountWorkspacePage();
