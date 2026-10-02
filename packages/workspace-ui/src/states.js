/* Shared state UI for static HTML, Razor and React adapters. No requests or business decisions here. */
(() => {
  'use strict';
  const definitions = {
    loading: { title:'불러오는 중', message:'잠시만 기다려 주세요.', icon:'M12 3a9 9 0 1 0 9 9', role:'status' },
    empty: { title:'표시할 내용이 없습니다.', message:'조건을 변경하거나 새 항목을 추가해 주세요.', icon:'M4 5h16v14H4zM8 9h8m-8 4h5', role:'status' },
    error: { title:'불러오지 못했습니다.', message:'연결을 확인한 뒤 다시 시도해 주세요.', icon:'M12 8v5m0 4h.01M12 3 2 21h20L12 3Z', role:'alert' },
    denied: { title:'접근 권한이 없습니다.', message:'관리자에게 접근 권한을 확인해 주세요.', icon:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4', role:'status' },
    success: { title:'완료했습니다.', message:'변경사항이 반영되었습니다.', icon:'m4 12 5 5L20 6', role:'status' }
  };
  const records = new WeakMap();
  const toastRecords = new Map();
  let toastSequence = 0;
  function render(node, options = {}) {
    const kind = options.kind || 'empty', definition = definitions[kind];
    if (!Object.hasOwn(definitions,kind)) throw new Error('Unknown workspace state: '+kind);
    const title = String(options.title ?? definition.title), message = String(options.message ?? definition.message);
    const actionLabel = String(options.actionLabel || '');
    const signature = JSON.stringify([kind,title,message,actionLabel]);
    const previous = records.get(node);
    records.set(node,{signature,options});
    if (previous?.signature === signature) return node;
    const hadFocus = node.contains(document.activeElement);
    node.classList.add('cw-feedback');node.dataset.stateKind=kind;
    node.setAttribute('role',definition.role);node.setAttribute('aria-atomic','true');node.tabIndex=-1;
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
    const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',definition.icon);icon.append(path);
    const copy=document.createElement('div');copy.className='cw-feedback-copy';
    const heading=document.createElement('strong');heading.textContent=title;
    const text=document.createElement('p');text.textContent=message;copy.append(heading,text);
    node.replaceChildren(icon,copy);
    if(actionLabel) {
      const button=document.createElement('button');button.type='button';button.dataset.stateAction='';button.textContent=actionLabel;
      button.disabled=kind==='loading';
      button.addEventListener('click',()=>{
        const event=new CustomEvent('workspace-state-action',{bubbles:true,cancelable:true});
        if(node.dispatchEvent(event))records.get(node)?.options.onAction?.();
      });
      copy.append(button);
    }
    if(hadFocus)(node.querySelector('button:not(:disabled)')||node).focus({preventScroll:true});
    return node;
  }
  function hydrate(root=document) {
    const nodes=[...(root.matches?.('[data-workspace-state]')?[root]:[]),...root.querySelectorAll('[data-workspace-state]')];
    for(const node of nodes) render(node,{kind:node.dataset.workspaceState,title:node.dataset.stateTitle,message:node.dataset.stateMessage,actionLabel:node.dataset.stateActionLabel});
  }
  function toastStack() {
    let stack=document.querySelector('.cw-toast-stack');
    if(stack)return stack;
    stack=document.createElement('div');stack.className='cw-toast-stack';stack.setAttribute('aria-label','업무 알림');stack.setAttribute('aria-live','polite');stack.setAttribute('aria-relevant','additions text');
    document.body.append(stack);return stack;
  }
  function dismissToast(id) {
    const key=String(id||''),record=toastRecords.get(key);
    if(!record)return false;
    if(record.timer)clearTimeout(record.timer);
    record.node.remove();toastRecords.delete(key);
    const stack=document.querySelector('.cw-toast-stack');if(stack&&!stack.children.length)stack.remove();
    return true;
  }
  function showToast(options={}) {
    const kind=options.kind||'empty';
    if(!Object.hasOwn(definitions,kind)||kind==='loading')throw new Error('Unknown workspace toast: '+kind);
    const id=String(options.id||`workspace-toast-${++toastSequence}`),existing=toastRecords.get(id);
    const node=existing?.node||document.createElement('section');node.className='cw-toast';node.dataset.toastId=id;
    let feedback=node.querySelector('.cw-feedback'),close=node.querySelector('.cw-toast-close');
    if(!feedback){feedback=document.createElement('div');node.append(feedback);}
    render(feedback,options);feedback.setAttribute('role',['error','denied'].includes(kind)?'alert':'status');
    if(!close){close=document.createElement('button');close.type='button';close.className='cw-button cw-toast-close';close.dataset.size='compact';close.dataset.layout='icon';close.setAttribute('aria-label','알림 닫기');close.textContent='×';close.addEventListener('click',()=>dismissToast(id));node.append(close);}
    if(!existing)toastStack().append(node);
    else if(existing.timer)clearTimeout(existing.timer);
    const requested=options.duration===undefined?(['success','empty'].includes(kind)?5000:0):Number(options.duration);
    const duration=Number.isFinite(requested)&&requested>0?requested:0;
    const record={node,timer:null};toastRecords.set(id,record);
    if(duration)record.timer=setTimeout(()=>dismissToast(id),duration);
    return id;
  }
  function dismissAllToasts(){for(const id of [...toastRecords.keys()])dismissToast(id);}
  function start(){
    hydrate();
    new MutationObserver(changes=>{
      for(const change of changes) {
        if(change.type==='attributes')hydrate(change.target);
        else for(const node of change.addedNodes)if(node.nodeType===1)hydrate(node);
      }
    }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-workspace-state','data-state-title','data-state-message','data-state-action-label']});
  }
  window.CompanyState={render,kinds:Object.freeze(Object.keys(definitions))};
  window.CompanyToast={show:showToast,dismiss:dismissToast};
  document.addEventListener('workspace-entity-scope-change',dismissAllToasts);
  document.addEventListener('company-page-leave',dismissAllToasts);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
