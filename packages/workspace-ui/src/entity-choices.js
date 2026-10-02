/* Search enhances real server-rendered checkboxes; it never replaces their posted values. */
(() => {
  'use strict';
  const groups=new WeakMap();
  const scopeOf=value=>JSON.stringify([value?.authenticated,value?.user?.id,value?.user?.role,value?.isAdmin,(value?.services||[]).map(s=>s.key).sort()]);
  let scope=null;
  function refresh(group){
    const search=group.querySelector('[data-choice-search]'),status=group.querySelector('[data-choice-status]');
    const query=search?.value.trim()||'',match=window.CompanySearch?.createMatcher(query)||(()=>true);
    const labels=[...group.querySelectorAll('[data-choice-label]')];let shown=0,selected=0;
    for(const label of labels){
      const input=label.querySelector('input[type="checkbox"]');
      const text=label.querySelector('[data-choice-text]')?.textContent||label.textContent;
      const include=match(text);label.classList.toggle('cw-choice-filtered',!include);
      if(!label.hidden){if(include)shown++;if(input?.checked)selected++;}
    }
    const message=`${selected}개 선택 · ${shown}개 표시`+(shown===0?' · 검색 결과가 없습니다.':'');
    if(status&&status.textContent!==message)status.textContent=message;
  }
  function upsertCheckbox(group,options={}){
    if(!(group instanceof Element)||!group.hasAttribute('data-workspace-choices'))throw Error('Invalid choice group');
    const kind=group.dataset.workspaceChoices,{name,value,label,entityId=value}=options;
    if(!['employee','project'].includes(kind)||typeof name!=='string'||!name.length||typeof value!=='string'||!value.length||typeof label!=='string'||!/^[1-9]\d*$/.test(String(entityId)))throw Error('Invalid checkbox choice');
    const matches=[...group.querySelectorAll('[data-choice-label] input[type="checkbox"]')].filter(input=>input.name===name&&input.value===value);
    if(matches.length>1)throw Error('Duplicate checkbox choice');
    let input=matches[0],choice=input?.closest('[data-choice-label]'),created=false;
    if(!input){
      created=true;choice=document.createElement('label');choice.dataset.choiceLabel='';
      input=document.createElement('input');input.type='checkbox';input.name=name;input.value=value;
      const icon=document.createElement('span');icon.className='cw-entity-avatar';icon.dataset.workspaceEntity=kind;icon.dataset.workspaceEntityId=String(entityId);
      const text=document.createElement('span');text.dataset.choiceText='';choice.append(input,icon,text);group.append(choice);
    }
    const text=choice.querySelector('[data-choice-text]');if(!text)throw Error('Invalid checkbox choice markup');
    let icon=choice.querySelector('.cw-entity-avatar');
    if(!icon){icon=document.createElement('span');icon.className='cw-entity-avatar';choice.insertBefore(icon,text);}
    icon.dataset.workspaceEntity=kind;icon.dataset.workspaceEntityId=String(entityId);
    text.textContent=label;
    if(Object.hasOwn(options,'disabled'))input.disabled=Boolean(options.disabled);
    if(Object.hasOwn(options,'checked'))input.checked=Boolean(options.checked);
    window.CompanyEntityDisplay?.render(icon,{kind,id:String(entityId),name:label});
    refresh(group);return {input,created};
  }
  function scan(){
    document.querySelectorAll('[data-workspace-choices]').forEach(group=>{
      if(!groups.has(group)){
        groups.set(group,true);group.classList.add('cw-choice-group');
        if(!group.querySelector('[data-choice-status]')){const status=document.createElement('p');status.dataset.choiceStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');group.append(status);}
        group.addEventListener('input',()=>refresh(group));group.addEventListener('change',()=>refresh(group));
      }
      refresh(group);
    });
  }
  function start(){
    scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','checked']});
    document.addEventListener('reset',()=>setTimeout(scan,0));
  }
  window.CompanyEntityChoices={refresh:scan,scopeOf,upsertCheckbox};
  document.addEventListener('company-context',event=>{
    const next=scopeOf(event.detail),changed=scope!==null&&scope!==next;scope=next;
    if(changed)document.dispatchEvent(new Event('workspace-entity-scope-change'));
    scan();
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
