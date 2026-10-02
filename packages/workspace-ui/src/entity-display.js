/* Server-filtered company IDs identify entities. Names are labels, never lookup keys. */
(() => {
  'use strict';
  const records=new WeakMap();
  const avatarToneCount=24;
  const companyId=value=>/^[1-9]\d*$/.test(String(value??''))?String(value):null;
  function avatarTone(kind,id,name,initial){
    if(kind!=='employee')return null;
    const seed=companyId(id)||String(name).trim()||initial;let hash=2166136261;
    for(const character of seed){hash^=character.codePointAt(0);hash=Math.imul(hash,16777619);}
    return String((hash>>>0)%avatarToneCount);
  }
  function localEmployeeId(value){
    try {
      const map=JSON.parse(document.querySelector('[data-company-employee-map]')?.textContent||'{}');
      return Object.hasOwn(map,String(value))?companyId(map[String(value)]):null;
    } catch { return null; }
  }
  function urlFor(kind,id){
    const key=companyId(id);if(!key)return null;
    return kind==='project'?window.CompanyWorkspace?.projectUrl(key):kind==='employee'?window.CompanyWorkspace?.profileUrl(key):null;
  }
  function render(node,{kind,id,name='',fallback}={}){
    if(!['employee','project'].includes(kind))throw Error('Unknown company entity kind');
    const initial=String(fallback??Array.from(String(name).trim())[0]??(kind==='project'?'P':'?'));
    const src=urlFor(kind,id)||'',tone=avatarTone(kind,id,name,initial),signature=JSON.stringify([kind,companyId(id),src,initial,tone]);
    if(records.get(node)===signature)return node;
    records.set(node,signature);node.textContent=initial;
    if(tone===null)delete node.dataset.workspaceAvatarTone;else node.dataset.workspaceAvatarTone=tone;
    if(src){
      const image=document.createElement('img');image.alt='';image.src=src;
      image.addEventListener('error',()=>{if(records.get(node)===signature&&image.parentElement===node)node.textContent=initial;});
      node.replaceChildren(image);
    }
    return node;
  }
  function scan(){
    document.querySelectorAll('[data-workspace-entity], [data-company-avatar], [data-company-project], [data-company-local-employee]').forEach(node=>{
      const explicit=node.dataset.workspaceEntity;
      const kind=explicit||(node.hasAttribute('data-company-project')?'project':'employee');
      if(!['employee','project'].includes(kind))return;
      const id=explicit?node.dataset.workspaceEntityId:node.hasAttribute('data-company-local-employee')?localEmployeeId(node.dataset.companyLocalEmployee):node.dataset.companyAvatar||node.dataset.companyProject;
      if(!explicit&&!node.dataset.entityFallback)node.dataset.entityFallback=Array.from(node.textContent.trim())[0]||(kind==='project'?'P':'?');
      render(node,{kind,id,name:node.dataset.workspaceEntityName,fallback:explicit?undefined:node.dataset.entityFallback});
    });
  }
  function start(){
    scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-workspace-entity','data-workspace-entity-id','data-workspace-entity-name','data-company-avatar','data-company-project','data-company-local-employee']});
  }
  window.CompanyEntityDisplay={render,scan,urlFor,localEmployeeId};
  document.addEventListener('company-context',scan);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
