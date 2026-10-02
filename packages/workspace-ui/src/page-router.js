/* Same-service document navigation. Pages opt in only after their lifetime is safe to replace. */
(() => {
  'use strict';
  const adapters=new Map();
  let navigatePage=()=>Promise.resolve(false);
  window.CompanyPageRouter={
    register(pageId,adapter) {
      if(typeof pageId!=='string'||!adapter||typeof adapter!=='object')throw Error('Invalid page adapter');
      adapters.set(pageId,adapter);
    },
    navigate(...args) { return navigatePage(...args); }
  };
  function mount() {
  const service=document.querySelector('[data-company-workspace]')?.dataset.companyService;
  if(!['home','leave','cs'].includes(service))return;
  const pages=(window.CompanyPageCatalog?.pages||[]).filter(page=>page.service===service&&page.clientNavigation===true);
  if(!pages.length)return;
  const readSession=window.CompanyReadSession.create();
  const normal=path=>path.replace(/\/$/,'').toLowerCase()||'/';
  const pageFor=url=>{
    const matches=pages.filter(page=>[page.path,...page.aliases||[]].some(path=>normal(path)===normal(url.pathname)));
    return matches.sort((a,b)=>Object.keys(b.query||{}).length-Object.keys(a.query||{}).length)
      .find(page=>Object.entries(page.query||{}).every(([key,value])=>url.searchParams.get(key)===value));
  };
  const outlet=()=>document.querySelector('[data-workspace-view]');
  const loadedPageModules=new Set([...document.querySelectorAll('[data-workspace-page-scripts] script[type="module"][src]')].map(node=>node.src));
  let current=pages.find(page=>page.id===outlet()?.dataset.workspaceView);
  let routeGeneration=0;
  let accountGeneration=0;
  document.addEventListener('company-context',()=>{accountGeneration++;routeGeneration++;readSession.cancel('workspace-page');indicate(null,false);});
  let pendingTimer;
  function eligible(url) { return url.origin===location.origin&&pageFor(url)&&current&&outlet(); }
  function indicate(link,on) {
    clearTimeout(pendingTimer);
    document.querySelectorAll('[data-cw-page-loading]').forEach(node=>{node.removeAttribute('data-cw-page-loading');node.removeAttribute('aria-busy');});
    if(on&&link)pendingTimer=setTimeout(()=>{link.dataset.cwPageLoading='';link.setAttribute('aria-busy','true');},180);
  }
  function documentFor(html,url,expected,responseIdentity) {
    const parsed=new DOMParser().parseFromString(html,'text/html');
    const candidate=parsed.querySelector('[data-workspace-view]');
    const original=outlet();
    const identity=service==='cs' ? window.CompanyWorkspace?.getIdentity?.() : original?.dataset.workspaceIdentity;
    if(parsed.querySelector('[data-company-workspace]')?.dataset.companyService!==service ||
      candidate?.dataset.workspaceView!==expected.id || !parsed.title ||
      !identity || (service==='cs' ? responseIdentity!==identity :
        candidate?.dataset.workspaceIdentity!==identity || candidate?.dataset.workspaceRole!==original.dataset.workspaceRole) ||
      !pageFor(new URL(url,location.href)) || parsed.querySelectorAll('[data-workspace-view]').length!==1)throw Error('Invalid workspace page');
    const script=parsed.querySelector('script[data-cs-page-module]');
    const style=parsed.querySelector('link[data-cs-page-style]');
    const scriptUrl=script?new URL(script.getAttribute('src'),url):null;
    const styleUrl=style?new URL(style.getAttribute('href'),url):null;
    if(service==='cs' && (!scriptUrl||scriptUrl.origin!==location.origin||!styleUrl||styleUrl.origin!==location.origin))throw Error('Invalid CS assets');
    const scriptHost=parsed.querySelector('[data-workspace-page-scripts]');
    if(['home','leave'].includes(service)&&!scriptHost)throw Error('Missing page scripts outlet');
    const scripts=[...scriptHost?.querySelectorAll('script')||[]].map(node=>{
      const source=node.getAttribute('src'),type=node.getAttribute('type')||'';
      const scriptUrl=source?new URL(source,url):null;
      if(!['','module','text/javascript'].includes(type)||scriptUrl&&scriptUrl.origin!==location.origin)throw Error('Invalid page script');
      return {src:scriptUrl?.href||'',type,text:source?'':node.textContent};
    });
    const employeeMap=parsed.querySelector('[data-company-employee-map]')?.textContent;
    return {candidate,title:parsed.title,scriptUrl:scriptUrl?.href,styleUrl:styleUrl?.href,scripts,employeeMap};
  }
  async function request(url,page) {
    const result=await readSession.run('workspace-page',async signal=>{
      const response=await fetch(url.href,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'text/html'},signal});
      if(!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('Page unavailable');
      const html=await response.text();signal.throwIfAborted();
      return documentFor(html,url.href,page,response.headers.get('x-workspace-identity'));
    },15000);
    if(result.status==='error')throw result.error;
    return result;
  }
  async function prepareStyle(href) {
    if(!href)return null;
    const current=document.querySelector('link[data-cs-page-style]');
    if(current?.href===href)return null;
    const next=document.createElement('link');next.rel='stylesheet';next.href=href;next.media='print';next.dataset.csPageStyle='';
    let timer;
    const ready=new Promise((resolve,reject)=>{
      next.onload=resolve;next.onerror=()=>reject(Error('Page style unavailable'));
      timer=setTimeout(()=>reject(Error('Page style timed out')),8000);
    });
    document.head.append(next);
    try { await ready; } catch(error) {next.remove();throw error;} finally {clearTimeout(timer);}
    return {commit(){next.media='all';current?.remove();},dispose(){next.remove();}};
  }
  async function startPageScripts(scripts) {
    const host=document.querySelector('[data-workspace-page-scripts]');
    if(!host)return;
    host.replaceChildren();
    for(const definition of scripts) {
      if(definition.type==='module'&&definition.src) {
        const previouslyLoaded=loadedPageModules.has(definition.src);
        const module=await import(definition.src);
        if(typeof module.mountWorkspacePage!=='function')throw Error('Page module has no mount procedure');
        if(previouslyLoaded)module.mountWorkspacePage(outlet());
        loadedPageModules.add(definition.src);
        continue;
      }
      const node=document.createElement('script');
      if(definition.type)node.type=definition.type;
      if(definition.src) {
        node.src=definition.src;node.async=false;
        let timer;
        const ready=new Promise((resolve,reject)=>{
          node.onload=resolve;node.onerror=()=>reject(Error('Page script unavailable'));
          timer=setTimeout(()=>reject(Error('Page script timed out')),8000);
        });
        host.append(node);
        try {await ready;} finally {clearTimeout(timer);}
      } else {node.textContent=definition.text;host.append(node);}
    }
  }
  let currentUrl=location.href;
  async function navigate(url,{replace=false,scrollY=0,link=null,fromHistory=false}={}) {
    const target=pageFor(url);
    if(!target||!eligible(url))return false;
    if(target.id===current.id&&url.href===location.href&&!fromHistory)return true;
    const generation=++routeGeneration;
    const accountAtStart=accountGeneration;
    let preparedStyle=null;
    indicate(link,true);
    try {
      const result=await request(url,target);
      if(result.status==='cancelled'||generation!==routeGeneration||accountAtStart!==accountGeneration||!result.isCurrent?.())return true;
      const previous=outlet(),adapter=adapters.get(current.id);
      if(adapter?.beforeLeave && await adapter.beforeLeave({to:target.id})!==true) {
        if(fromHistory)history.pushState({...history.state,cwScrollY:window.scrollY},'',currentUrl);
        return true;
      }
      if(generation!==routeGeneration||accountAtStart!==accountGeneration||previous!==outlet())return true;
      preparedStyle=await prepareStyle(result.value.styleUrl);
      if(generation!==routeGeneration||accountAtStart!==accountGeneration||previous!==outlet())return true;
      await adapter?.dispose?.();
      if(service==='leave'||service==='home') {
        document.dispatchEvent(new Event('company-page-leave'));
      }
      if(service==='leave') {
        delete window.LeaveFormSession;delete window.LeaveAdminCalendar;delete window.LeaveExternalSchedule;
      }
      window.CompanyWorkspace?.disposePage?.(previous);
      if(generation!==routeGeneration)return true;
      const {candidate,title}=result.value;
      const swap=()=>{previous.replaceWith(document.importNode(candidate,true));document.title=title;};
      if(document.startViewTransition)await document.startViewTransition(swap).updateCallbackDone;else swap();
      preparedStyle?.commit();preparedStyle=null;
      if(!fromHistory) {
        history.replaceState({...history.state,cwScrollY:window.scrollY},'');
        if(replace)history.replaceState({...history.state,cwScrollY:scrollY},'',url.href);
        else history.pushState({cwScrollY:scrollY},'',url.href);
      }
      current=target;
      currentUrl=url.href;
      if(service==='leave'&&result.value.employeeMap!==undefined)document.querySelector('[data-company-employee-map]').textContent=result.value.employeeMap;
      window.CompanyWorkspace?.mountPage?.(outlet());
      await startPageScripts(result.value.scripts);
      await adapters.get(target.id)?.start?.(outlet(),{scriptUrl:result.value.scriptUrl});
      document.dispatchEvent(new Event('company-route-change'));
      window.scrollTo(0,scrollY);
      const heading=outlet().querySelector('h1')||outlet();
      heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
      return true;
    } catch {
      if(generation===routeGeneration)location.assign(url.href);
      return true;
    } finally {preparedStyle?.dispose();if(generation===routeGeneration)indicate(null,false);}
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[data-cw-soft-route]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;
    const url=new URL(link.href,location.href);
    if(!eligible(url))return;
    event.preventDefault();void navigate(url,{link});
  });
  window.addEventListener('popstate',event=>{
    const url=new URL(location.href);
    if(eligible(url))void navigate(url,{fromHistory:true,scrollY:event.state?.cwScrollY||0});
  });
  window.addEventListener('pagehide',event=>{if(!event.persisted)readSession.dispose();});
  navigatePage=navigate;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
