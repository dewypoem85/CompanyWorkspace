/* Framework-neutral navigation. Page definitions are data, never page-owned markup. */
(() => {
  'use strict';
  const catalog = window.CompanyPageCatalog;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    chart:'M4 3v17h17M8 15v-4m5 4V7m5 8V4',
    shield:'m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z',
    card:'M4 7h16M7 11h2m3 0h2M6 17h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z',
    layers:'m12 3 8 4.5-8 4.5-8-4.5L12 3Zm-8 9 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5',
    log:'M4 5h16v14H4zM8 9h8m-8 4h5',
    database:'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm-8 3v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6m-16 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'
  };
  function normalize(path) { return path.replace(/\/$/, '').toLowerCase() || '/'; }
  function requestFilterNavigation(event) {
    const control=event.target.closest?.('[data-cw-auto-submit]');
    const form=control?.form;
    if (!control || control.disabled || event.defaultPrevented || !form || form.method.toLowerCase() !== 'get' || form.getAttribute('aria-busy') === 'true') return false;
    form.requestSubmit(); return true;
  }
  const serverPages = new Map();
  const serverBadges = new Map();
  const badgeRevisions = new Map();
  const serverStates = new Map();
  let badgeRevision = 0;
  const eligible = (service, context) => context?.authenticated && (service?.permission === 'authenticated' || context.services?.some(s=>s.key===service?.id));
  function setBadge(service, id, count) {
    if (!Number.isSafeInteger(count) || count < 0 || !catalog.pages.some(p=>p.service===service&&p.id===id&&p.badge)) return;
    if (!serverBadges.has(service)) serverBadges.set(service,new Map());
    if (!badgeRevisions.has(service)) badgeRevisions.set(service,new Map());
    serverBadges.get(service).set(id,count);badgeRevisions.get(service).set(id,++badgeRevision);refresh();
  }
  let authorizationGeneration = 0;
  let authorizationRequest, authorizationScope;
  const authorizationChannels = new Set();
  const readSession = window.CompanyReadSession.create();
  const channelFor = service => `workspace-navigation-${service}`;
  function cancelAuthorizationReads() {
    for (const channel of authorizationChannels) readSession.cancel(channel);
    authorizationChannels.clear();
  }
  function validateAuthorization(service, data) {
    if (!data || !Array.isArray(data.pages) || data.pages.some(id=>typeof id!=='string'||!catalog.pages.some(p=>p.id===id&&p.service===service.id&&p.nav!==false))) throw Error('Invalid navigation permissions');
    const badges=data.badges??{};
    if (!badges || Array.isArray(badges) || typeof badges!=='object') throw Error('Invalid navigation badges');
    const allowedBadges=new Map();
    for(const [id,count] of Object.entries(badges)) if(data.pages.includes(id)&&catalog.pages.some(p=>p.id===id&&p.service===service.id&&p.badge)&&Number.isSafeInteger(count)&&count>=0)allowedBadges.set(id,count);
    return {pages:new Set(data.pages),badges:allowedBadges};
  }
  function visiblePages(service, context, capabilities = []) {
    const definition = catalog.services.find(item => item.id === service);
    if (!context?.authenticated || (definition?.permission !== 'authenticated' && !context.services?.some(s => s.key === service))) return [];
    return catalog.pages.filter(page => page.service === service && page.nav !== false && (!definition.navigationEndpoint || serverPages.get(service)?.has(page.id)) && (!page.roles || page.roles.includes(context.user?.role)) && (!page.capability || capabilities.includes(page.capability)));
  }
  function render(node, context, path = location.pathname + location.search) {
    const service = node.dataset.workspaceNavigation;
    const definition = catalog.services.find(item => item.id === service);
    let capabilities=[];try { const parsed=JSON.parse(node.dataset.workspaceCapabilities||'[]');if(Array.isArray(parsed))capabilities=parsed; } catch {}
    const pages = visiblePages(service, context, capabilities);
    const url = new URL(path, location.origin), query = new Map();
    for (const [key, value] of url.searchParams) if (!query.has(key.toLowerCase())) query.set(key.toLowerCase(), value);
    const current = catalog.pages.filter(page => page.service === service && [page.path, ...(page.aliases || [])].some(value => normalize(value) === normalize(url.pathname) || (value.endsWith('/:id') && normalize(url.pathname).startsWith(value.slice(0,-3)) && /^[1-9]\d*$/.test(normalize(url.pathname).slice(value.length-3)))))
      .sort((a,b)=>Object.keys(b.query||{}).length-Object.keys(a.query||{}).length)
      .find(page=>Object.entries(page.query||{}).every(([key,value])=>query.get(key.toLowerCase())===value));
    const active = current?.parent || current?.id;
    const phase = definition?.navigationEndpoint && eligible(definition,context) ? (serverStates.get(service)||'loading') : null;
    const state = phase === 'ready' ? (pages.length ? null : 'empty') : phase;
    const structureSignature=JSON.stringify([service,pages.map(page=>[page.id,page.title,page.description,page.navigationSection,serverBadges.get(service)?.get(page.id)]),state]);
    const signature = JSON.stringify([structureSignature, active]);
    if (node.dataset.navigationSignature === signature) return;
    if(node.dataset.navigationStructure===structureSignature) {
      node.querySelectorAll('[data-workspace-page]').forEach(link=>{
        if(link.dataset.workspacePage===active)link.setAttribute('aria-current','page');
        else link.removeAttribute('aria-current');
      });
      node.dataset.navigationSignature=signature;
      return;
    }
    node.dataset.navigationSignature = signature;
    node.dataset.navigationStructure = structureSignature;
    node.classList.add('cw-sidebar');
    node.setAttribute('aria-label', `${definition?.title || ''} 메뉴`);
    node.hidden = !pages.length && !state;
    // Keep the shell's collapse button and focus when only the route changes.
    let content = node.querySelector('[data-workspace-navigation-content]');
    if (!content) { content = document.createElement('div'); content.dataset.workspaceNavigationContent = ''; node.prepend(content); }
    const focused = document.activeElement?.dataset.workspacePage;
    const stateFocused = !!document.activeElement?.closest('.cw-feedback') && content.contains(document.activeElement);
    const pageLink=page=>'<a class="cw-page-link" data-workspace-page="'+escape(page.id)+'" href="'+escape(page.path+(page.query?'?'+new URLSearchParams(page.query):''))+'"'+(['static-spa','react'].includes(definition.adapter) ? ' data-route-link' : '')+(page.clientNavigation===true ? ' data-cw-soft-route' : '')+(page.id === active ? ' aria-current="page"' : '')+'><svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(paths[page.icon] || paths.log)+'"/></svg><span><strong>'+escape(page.title)+'</strong>'+(page.description ? '<small>'+escape(page.description)+'</small>' : '')+'</span></a>';
    const sections=[];
    for(const page of pages){const label=typeof page.navigationSection==='string'?page.navigationSection.trim():'';let section=sections.find(item=>item.label===label);if(!section){section={label,pages:[]};sections.push(section);}section.pages.push(page);}
    const navigation=sections.map(section=>'<div class="cw-page-section"'+(section.label?' data-navigation-section="'+escape(section.label)+'" role="group" aria-label="'+escape(section.label)+'"':'')+'>'+(section.label?'<div class="cw-page-section-label">'+escape(section.label)+'</div>':'')+section.pages.map(pageLink).join('')+'</div>').join('');
    content.innerHTML = '<div class="cw-sidebar-title">'+escape(definition?.title)+'</div><nav class="cw-page-nav">'+navigation+'</nav>';
    if(state) {
      const options = {
        loading: {kind:'loading',title:'메뉴 확인 중',message:'이용 가능한 페이지를 확인하고 있습니다.'},
        error: {kind:'error',title:'메뉴를 불러오지 못했습니다.',message:'작성 중인 내용은 유지됩니다. 연결을 확인하고 다시 시도해 주세요.',actionLabel:'다시 시도',onAction:()=>void refreshAuthorization()},
        expired: {kind:'denied',title:'로그인 확인이 필요합니다.',message:'이 서비스의 로그인 상태를 확인해 주세요. 작성 중인 내용은 그대로 유지됩니다.',actionLabel:'로그인 안내',onAction:()=>window.CompanyWorkspace?.sessionExpired()},
        denied: {kind:'denied',title:'이용 권한을 확인해 주세요.',message:'메뉴 접근이 거부되었습니다. 관리자에게 권한을 확인한 후 다시 시도해 주세요.',actionLabel:'권한 다시 확인',onAction:()=>void refreshAuthorization()},
        empty: {kind:'empty',title:'이용 가능한 메뉴가 없습니다.',message:'필요한 페이지가 있다면 관리자에게 접근 권한을 확인해 주세요.',actionLabel:'다시 확인',onAction:()=>void refreshAuthorization()}
      }[state];
      const feedback=document.createElement('div');content.append(feedback);window.CompanyState.render(feedback,options);
    }
    for (const page of pages.filter(p=>p.badge)) {
      const link=[...content.querySelectorAll('[data-workspace-page]')].find(el=>el.dataset.workspacePage===page.id);
      const badge=document.createElement('span'), count=serverBadges.get(service)?.get(page.id)||0;
      badge.className='cw-state-pill';badge.dataset.tone='danger';badge.dataset.workspaceBadge=page.id;
      badge.textContent=count>99?'99+':String(count);badge.hidden=count<=0;
      badge.setAttribute('aria-label',`대기 ${count}건`);link.append(badge);
    }
    if (focused) [...content.querySelectorAll('[data-workspace-page]')].find(el => el.dataset.workspacePage === focused)?.focus();
    if(stateFocused)(content.querySelector('[aria-current="page"]') || content.querySelector('.cw-feedback button:not(:disabled)') || content.querySelector('.cw-feedback') || content.querySelector('.cw-page-link'))?.focus({preventScroll:true});
  }
  let context;
  function refresh() { document.querySelectorAll('[data-workspace-navigation]').forEach(node => render(node, context)); }
  async function performAuthorizationRefresh() {
    const generation = ++authorizationGeneration;
    const services = new Set([...document.querySelectorAll('[data-workspace-navigation]')].map(node=>node.dataset.workspaceNavigation));
    if (!context?.authenticated) { cancelAuthorizationReads(); serverPages.clear(); serverBadges.clear(); badgeRevisions.clear(); serverStates.clear(); refresh(); return; }
    await Promise.all(catalog.services.filter(service=>services.has(service.id)&&service.navigationEndpoint&&eligible(service,context)).map(async service=>{
      if(!serverPages.get(service.id)?.size){serverStates.set(service.id,'loading');refresh();}
      const badgeRevisionAtStart=new Map(badgeRevisions.get(service.id)||[]);
      const channel=channelFor(service.id);authorizationChannels.add(channel);
      const result=await readSession.run(channel,async signal=>{
        const response = await fetch(service.navigationEndpoint, { credentials:'same-origin', cache:'no-store', redirect:'error', headers:{Accept:'application/json'}, signal });
        if (!response.ok) {const error=Error('Navigation permission unavailable');error.failure=response.status===401?'expired':response.status===403?'denied':'error';throw error;}
        const data=await response.json();signal.throwIfAborted();
        return validateAuthorization(service,data);
      },8000);
      if(result.status==='cancelled'||generation!==authorizationGeneration||!result.isCurrent?.())return;
      if(result.status==='error') {
        serverPages.delete(service.id);serverStates.set(service.id,result.error?.failure||'error');return;
      }
      const badges=new Map(serverBadges.get(service.id)||[]),currentRevisions=badgeRevisions.get(service.id);
      for(const page of catalog.pages.filter(page=>page.service===service.id&&page.badge)){
        if((currentRevisions?.get(page.id)||0)!==(badgeRevisionAtStart.get(page.id)||0))continue;
        if(result.value.badges.has(page.id))badges.set(page.id,result.value.badges.get(page.id));else badges.delete(page.id);
      }
      serverPages.set(service.id,result.value.pages);serverBadges.set(service.id,badges);serverStates.set(service.id,'ready');
    }));
    if (generation === authorizationGeneration) refresh();
  }
  function refreshAuthorization() {
    const scope=JSON.stringify([context?.authenticated,context?.user?.id,context?.user?.role,context?.isAdmin,(context?.services||[]).map(service=>service.key).sort()]);
    if(authorizationRequest && authorizationScope===scope) return authorizationRequest;
    authorizationScope=scope;
    const request=performAuthorizationRefresh();
    authorizationRequest=request;
    const clear=()=>{if(authorizationRequest===request)authorizationRequest=null;};
    void request.then(clear,clear);
    return request;
  }
  document.addEventListener('company-context', event => {
    const scope = value => JSON.stringify([value?.authenticated,value?.user?.id,value?.user?.role,value?.isAdmin,(value?.services||[]).map(s=>s.key).sort()]);
    if (scope(context) !== scope(event.detail)) { cancelAuthorizationReads(); serverPages.clear(); serverBadges.clear(); badgeRevisions.clear(); serverStates.clear(); }
    context = event.detail; refresh(); void refreshAuthorization();
  });
  document.addEventListener('company-context-validated',()=>void refreshAuthorization());
  window.addEventListener('focus', () => void refreshAuthorization());
  window.addEventListener('popstate', refresh);
  document.addEventListener('company-route-change', refresh);
  document.addEventListener('change', requestFilterNavigation);
  window.addEventListener('pagehide',event=>{if(!event.persisted)readSession.dispose();});
  function start() { refresh(); void refreshAuthorization(); new MutationObserver(refresh).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-workspace-capabilities'] }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.CompanyNavigation = { visiblePages, render, refresh, setBadge, refreshPermissions:refreshAuthorization, requestFilterNavigation };
})();
