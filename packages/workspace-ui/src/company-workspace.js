(function () {
  'use strict';
  // Shared Korean list search: consonants match initial sounds, other characters stay literal.
  function createSearchMatcher(query) {
    const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
    const normalize = value => String(value ?? '').normalize('NFC').toLowerCase()
      .replace(/[\u1100-\u1112]/g, c => initials[c.charCodeAt(0) - 0x1100])
      .replace(/\s+/g, '');
    const term = normalize(query);
    if (!term) return () => true;
    const pattern = Array.from(term, c => {
      const index = initials.indexOf(c);
      if (index >= 0) {
        const first = 0xac00 + index * 588;
        return '[' + c + String.fromCharCode(first) + '-' + String.fromCharCode(first + 587) + ']';
      }
      return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    const regex = new RegExp(pattern, 'u');
    return value => regex.test(normalize(value));
}
  window.CompanySearch = { createMatcher: createSearchMatcher, matches: (value, query) => createSearchMatcher(query)(value) };
  const scriptUrl = document.currentScript?.src;
  const BASE = scriptUrl ? new URL(scriptUrl).origin : location.origin;
  const COMPANY_LOGO = BASE + '/images/company-logo.png';
  const favicon = document.querySelector('link[rel~="icon"]') || document.head.appendChild(document.createElement('link'));
  favicon.setAttribute('rel','icon');favicon.setAttribute('type','image/png');favicon.setAttribute('href',COMPANY_LOGO);
  const KEY = 'company-ui-theme', COOKIE = 'CompanyUiTheme';
  const PROFILE_COOKIE = 'CompanyProfileRevision';
  const profileRevision = () => document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(PROFILE_COOKIE+'=')) || '';
  let lastProfileRevision = profileRevision();
  function publishProfileChange() {
    const domain=location.hostname.endsWith('.example.com')?'; Domain=.example.com':'';
    const value=Date.now().toString(36);
    document.cookie=PROFILE_COOKIE+'='+value+'; Path=/; Max-Age=31536000; SameSite=Lax'+domain+(location.protocol==='https:'?'; Secure':'');
    lastProfileRevision=profileRevision();
    try { localStorage.setItem(PROFILE_COOKIE,value); } catch {}
  }
  const THEMES = ['system', 'light', 'dark'];
  const names = { home:'회사 홈',leave:'연차관리',schedule:'팀 일정',cs:'CS',statistics:'게임 통계',sheet:'시트 관리',iap:'상품 관리' };
  function currentPage(service) {
    const path = value => (value.replace(/\/(?:index(?:\.html)?)\/?$/i,'/').replace(/\/+$/,'') || '/').toLowerCase();
    const actual = path(location.pathname).split('/').filter(Boolean);
    let best = null, bestScore = -1;
    for (const page of window.CompanyPageCatalog?.pages || []) {
      if (page.service !== service || Object.entries(page.query || {}).some(([key,value]) => new URLSearchParams(location.search).get(key) !== value)) continue;
      for (const candidate of [page.path,...page.aliases || []]) {
        const parts = path(candidate).split('/').filter(Boolean);
        if (parts.length !== actual.length || parts.some((part,index) => !part.startsWith(':') && part !== actual[index])) continue;
        const score = parts.filter(part => !part.startsWith(':')).length * 2 + Object.keys(page.query || {}).length;
        if (score > bestScore) { best = page; bestScore = score; }
      }
    }
    return best;
  }
  const paths = {
    bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    user:'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
    grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    moon:'M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z',
    menu:'M4 6h16M4 12h16M4 18h16',
    sidebar:'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 3v18',
    out:'M10 17l5-5-5-5m5 5H3m10-9h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6',
    down:'m8 10 4 4 4-4'
  };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let context, root, inflight, noticeSession, noticeFeed, contextRevision=0;
  let mobilePayload=null,mobileReplyPort=null,mobileRegistrationKey='';
  let pendingPushOpen=(()=>{const value=new URLSearchParams(location.search).get('open');return /^(leave|schedule):[1-9]\d*$/.test(value||'')?value:null;})();
  const contextReads=window.CompanyReadSession.create();
  const notificationAlerts=new Set();
  const isMobileApp=()=>!!mobilePayload||document.documentElement.dataset.companyAndroidApp==='true';
  async function registerMobileDevice() {
    if(!mobilePayload||!context?.authenticated)return;
    const key=String(context.user.id)+':'+mobilePayload.installationId+':'+mobilePayload.token;
    if(key===mobileRegistrationKey)return;
    try {
      const device=await api('/push/devices',{method:'POST',contentType:'application/json',body:JSON.stringify({
        expectedUserId:String(context.user.id),installationId:mobilePayload.installationId,token:mobilePayload.token,appVersion:mobilePayload.appVersion
      })});
      mobileRegistrationKey=key;
      mobileReplyPort?.postMessage(JSON.stringify({type:'company-workspace-fcm-registered',installationId:device.installationId}));
      document.dispatchEvent(new CustomEvent('company-mobile-device',{detail:device}));
    } catch(error) {
      mobileReplyPort?.postMessage(JSON.stringify({type:'company-workspace-fcm-error'}));
      if(document.querySelector('[data-profile-mobile-push]'))showStatus({key:'mobile-push',title:'모바일 알림을 연결하지 못했습니다.',message:error.message});
    }
  }
  function receiveMobileMessage(event) {
    if(event.origin!==BASE)return;
    let value=event.data;try{if(typeof value==='string')value=JSON.parse(value);}catch{return;}
    if(!value||value.type!=='company-workspace-fcm-token'||value.version!==1||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.installationId)||
      !/^[A-Za-z0-9_:\-]{20,2048}$/.test(value.token)||typeof value.appVersion!=='string'||value.appVersion.length>40)return;
    mobilePayload={installationId:value.installationId,token:value.token,appVersion:value.appVersion||'unknown'};
    mobileReplyPort=event.ports?.[0]||null;
    document.documentElement.dataset.companyAndroidApp='true';
    void registerMobileDevice();
  }
  window.addEventListener('message',receiveMobileMessage);
  function preference() {
    try {
      const item = document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
      const value = item ? decodeURIComponent(item.slice(COOKIE.length+1)) : localStorage.getItem(KEY);
      return THEMES.includes(value) ? value : 'system';
    } catch { return 'system'; }
  }
  function applyTheme(value) {
    value = THEMES.includes(value) ? value : 'system';
    const dark = value === 'dark' || (value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const html = document.documentElement;
    html.dataset.themePreference=value; html.dataset.theme=dark?'dark':'light';
    html.classList.toggle('theme-dark',dark); html.classList.toggle('theme-light',!dark); html.style.colorScheme=dark?'dark':'light';
    document.dispatchEvent(new CustomEvent('company-theme-change',{detail:{preference:value,resolved:html.dataset.theme}}));
    document.querySelectorAll('[data-cw-theme]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.cwTheme===value)));
  }
  function saveTheme(value) {
    if (!THEMES.includes(value)) return;
    try { localStorage.setItem(KEY,value); } catch {}
    const domain=location.hostname.endsWith('.example.com')?'; Domain=.example.com':'';
    document.cookie=COOKIE+'='+value+'; Path=/; Max-Age=31536000; SameSite=Lax'+domain+(location.protocol==='https:'?'; Secure':'');
    applyTheme(value);
  }
  function safeLink(value) {
    try { const url=new URL(value,BASE); return url.origin===BASE?url.href:BASE+'/'; } catch { return BASE+'/'; }
  }
  function showStatus({title,message,actionLabel,actionUrl,key='status'}) {
    document.querySelector('[data-company-status="'+key+'"]')?.remove();
    const node=document.createElement('section'); node.className='cw-status'; node.dataset.companyStatus=key; node.setAttribute('role','alert');
    window.CompanyState.render(node,{kind:'error',title,message,actionLabel:actionLabel||(actionUrl?'확인':'닫기'),onAction:()=>actionUrl?location.assign(safeLink(actionUrl)):node.remove()});
    document.body.append(node); return node;
  }
  function loginUrl() {
    const service=root?.dataset.companyService||'home';
    const target=service==='home'?location.pathname+location.search:('/workspace/'+service+'?returnUrl='+encodeURIComponent(location.pathname+location.search+location.hash));
    return BASE+'/Account/Login?returnUrl='+encodeURIComponent(target);
  }
  function sessionExpired(url) { showStatus({key:'session',title:'다시 로그인이 필요합니다.',message:'작성 중인 내용은 유지됩니다. 로그인 후 작업을 이어가세요.',actionLabel:'다시 로그인',actionUrl:url||loginUrl()}); }
  async function api(path,{method='GET',body,contentType,signal,expectedStatus}={}) {
    const headers={Accept:'application/json'};
    if(method!=='GET') {
      if(!context?.csrfToken) await refresh();
      headers['X-Workspace-CSRF']=context?.csrfToken||'';
      if(contentType) headers['Content-Type']=contentType;
    }
    const res=await fetch(BASE+'/api/workspace'+path,{method,body,headers,credentials:'include',cache:'no-store',redirect:'error',signal:signal||AbortSignal.timeout(10000)});
    if(!res.ok) {
      if(res.status===401) sessionExpired();
      let message; try { message=(await res.json()).error; } catch {}
      const error=new Error(message||'요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');error.status=res.status;throw error;
    }
    if(expectedStatus && res.status!==expectedStatus)throw Error('서버의 완료 응답을 확인하지 못했습니다.');
    return res.status===204?null:res.json();
  }
  const readContext=async signal=>window.CompanyContextContract.read(await api('/context',{signal}));
  const avatar = user => '<span class="cw-avatar" data-workspace-entity="employee" data-workspace-entity-id="'+esc(user.id)+'" data-workspace-entity-name="'+esc(user.name||'')+'" aria-hidden="true">'+esc(user.name?.slice(0,1)||'')+'</span>';
  function projectUrl(id) { const value=context?.authenticated && context.projectIcons?.[String(id)]; return value ? safeLink(value) : null; }
  function profileUrl(id) {
    if(!context?.authenticated) return null;
    const value=context.profiles?.[String(id)] || (String(id)===String(context.user.id)?context.user.avatarUrl:null);
    return value ? safeLink(value) : null;
  }
  function syncProfileElements() {
    window.CompanyEntityDisplay.scan();
  }
  const role = user => user.accountType==='shared'?'공용 계정':({master:'마스터',admin:'관리자',employee:'직원'}[user.role]||'직원');
  const SIDEBAR_COOKIE = 'CompanySidebarCollapsed';
  function sidebarPreference() {
    return document.cookie.split(';').some(value=>value.trim()===SIDEBAR_COOKIE+'=1');
  }
  let sidebarCollapsed=sidebarPreference();
  function syncSidebar() {
    const mobile=matchMedia('(max-width:900px)').matches;
    const sidebars=[...document.querySelectorAll('.cw-sidebar:not([hidden])')];
    const open=mobile?document.body.classList.contains('cw-nav-open'):!sidebarCollapsed;
    document.body.classList.toggle('cw-has-sidebar',sidebars.length>0);
    document.body.classList.toggle('cw-sidebar-collapsed',sidebarCollapsed);
    sidebars.forEach((sidebar,index)=>{
      sidebar.id ||= 'cw-sidebar-'+index;
      if(!sidebar.querySelector('[data-cw-sidebar-close]')) {
        const button=document.createElement('button');
        button.type='button'; button.className='cw-sidebar-close';
        button.setAttribute('data-cw-sidebar-close','');
        button.setAttribute('aria-label','사이드바 접기'); button.title='사이드바 접기';
        button.setAttribute('aria-controls',sidebar.id);
        button.innerHTML=icon('sidebar'); sidebar.append(button);
      }
      if(!open && sidebar.contains(document.activeElement)) root?.querySelector('[data-cw-nav]')?.focus();
      sidebar.inert=!open;
      sidebar.setAttribute('aria-hidden',String(!open));
    });
    const toggle=root?.querySelector('[data-cw-nav]');
    if(toggle) {
      toggle.setAttribute('aria-controls',sidebars.map(sidebar=>sidebar.id).join(' '));
      toggle.setAttribute('aria-expanded',String(sidebars.length>0&&open));
      toggle.setAttribute('aria-label',open?'사이드바 접기':'사이드바 펼치기');
      toggle.title=open?'사이드바 접기':'사이드바 펼치기';
    }
    scheduleServiceLayout();
  }
  function setSidebarOpen(open) {
    if(matchMedia('(max-width:900px)').matches) document.body.classList.toggle('cw-nav-open',open);
    else {
      sidebarCollapsed=!open;
      const domain=location.hostname.endsWith('.example.com')?'; Domain=.example.com':'';
      document.cookie=SIDEBAR_COOKIE+'='+(sidebarCollapsed?'1':'0')+'; Path=/; Max-Age=31536000; SameSite=Lax'+domain+(location.protocol==='https:'?'; Secure':'');
    }
    syncSidebar();
    if(open) document.querySelector('.cw-sidebar [data-cw-sidebar-close]')?.focus();
    else root?.querySelector('[data-cw-nav]')?.focus();
  }
  function closePanels() {
    root?.querySelectorAll('.cw-popover').forEach(p=>p.hidden=true);
    root?.querySelectorAll('[data-cw-panel]').forEach(b=>b.setAttribute('aria-expanded','false'));
  }
  let serviceLayoutFrame = 0;
  function scheduleServiceLayout() {
    if (!serviceLayoutFrame) serviceLayoutFrame = requestAnimationFrame(() => {
      serviceLayoutFrame = 0;
      const nav=root.querySelector('[data-cw-service-links]');
      const menu=root.querySelector('[data-cw-service-menu]');
      const right=root.querySelector('.cw-header-right');
      const left=root.querySelector('.cw-header-left');
      const width=element => element.getBoundingClientRect().width;
      const gap=element => parseFloat(getComputedStyle(element).columnGap) || 0;
      const rightItems=[...right.children].filter(el => el!==menu && width(el)>0);
      const leftItems=[root.querySelector('[data-cw-nav]'),root.querySelector('.cw-brand')].filter(el => width(el)>0);
      const fixedWidth=rightItems.reduce((sum,el)=>sum+width(el),0)+Math.max(0,rightItems.length-1)*gap(right)
        +leftItems.reduce((sum,el)=>sum+width(el),0)+leftItems.length*gap(left)+gap(root);
      const style=getComputedStyle(root);
      const available=root.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
      const expanded=!matchMedia('(max-width:900px)').matches && !!context?.authenticated && nav.childElementCount>0 && fixedWidth+width(nav)+12<=available;
      const wasExpanded=root.classList.contains('cw-services-expanded');
      nav.inert=!expanded;
      nav.setAttribute('aria-hidden',String(!expanded));
      root.classList.toggle('cw-services-expanded',expanded);
      menu.hidden=expanded;
      if (wasExpanded!==expanded) {
        const panel=root.querySelector('[data-cw-popover="services"]');
        const trigger=root.querySelector('[data-cw-panel="services"]');
        if (!expanded && nav.contains(document.activeElement)) trigger.focus();
        if (expanded && menu.contains(document.activeElement)) (nav.querySelector('[aria-current="page"]')||nav.querySelector('a'))?.focus();
        panel.hidden=true; trigger.setAttribute('aria-expanded','false');
      }
    });
  }
  function drawContext() {
    const area=root.querySelector('[data-cw-account]');
    const services=root.querySelector('[data-cw-services]');
    const nav=root.querySelector('[data-cw-service-links]');
    let links='';
    if(!context?.authenticated) {
      area.innerHTML='<a class="cw-action cw-login" href="'+esc(loginUrl())+'">로그인</a>';
      services.innerHTML='<p class="cw-empty">로그인하면 사용 가능한 서비스가 표시됩니다.</p>';
      root.querySelector('[data-cw-bell]').hidden=true;
    } else {
      const user=context.user;
      area.innerHTML='<button type="button" class="cw-action cw-account" data-cw-panel="account" aria-expanded="false" aria-label="계정 및 개인 설정">'+avatar(user)+'<span class="cw-account-copy"><strong>'+esc(user.name)+'</strong><small>'+esc(role(user))+'</small></span>'+icon('down')+'</button><div class="cw-popover cw-account-panel" data-cw-popover="account" hidden><strong>'+esc(user.name)+'</strong><p>'+esc(user.email)+'</p><p>'+esc(user.department||'부서 미지정')+' · '+esc(role(user))+'</p><a href="'+BASE+'/settings/profile">개인 설정</a>'+(context.isAdmin?'<a href="'+BASE+'/Admin/Users">계정·권한 관리</a>':'')+'<button type="button" data-cw-logout>'+icon('out')+' 회사 서비스 전체 로그아웃</button></div><button type="button" class="cw-action cw-logout" data-cw-logout aria-label="로그아웃" title="회사 서비스 전체 로그아웃">'+icon('out')+'</button>';
      links=context.services.map(s=>'<a href="'+esc(safeLink(s.href))+'"'+(s.key===root.dataset.companyService?' aria-current="page"':'')+'>'+esc(s.name)+'</a>').join('');
      services.innerHTML='<div class="cw-services-grid">'+links+'</div>';
      root.querySelector('[data-cw-bell]').hidden=false;
    }
    if(nav.innerHTML!==links) nav.innerHTML=links;
    scheduleServiceLayout();
    syncProfileElements();
    document.dispatchEvent(new CustomEvent('company-context',{detail:context}));
    void registerMobileDevice();
    const admin=document.querySelector('[data-cw-admin-nav]');
    if(admin) admin.hidden=!context?.isAdmin;
    const prefs=document.querySelector('[data-cw-profile]');
    if(prefs && context?.authenticated) {
      prefs.querySelector('[data-profile-summary]').innerHTML=avatar(context.user)+'<div><strong>'+esc(context.user.name)+'</strong><p>'+esc(context.user.email)+'</p><p>'+esc(context.user.department||'부서 미지정')+' · '+esc(role(context.user))+'</p></div>';
    }
  }
  let lastContextSnapshot;
  function applyContext(value) {
    const next=window.CompanyContextContract.read(value);
    const snapshot=JSON.stringify(next);
    context=next;
    contextRevision++;
    if(snapshot===lastContextSnapshot) {
      document.dispatchEvent(new Event('company-context-validated'));
      return;
    }
    lastContextSnapshot=snapshot;
    drawContext();
  }
  async function refresh() {
    if(inflight) return inflight;
    inflight=(async()=>{
      try {
        const previous=context,revision=contextRevision;
        const result=await contextReads.run('workspace-context',signal=>readContext(signal),10000);
        if(result.status==='cancelled'||!result.isCurrent?.()||revision!==contextRevision)return context;
        if(result.status==='error')throw result.error;
        applyContext(result.value);
        root.querySelector('[data-cw-connection]').hidden=true;
        if(previous?.authenticated && !context.authenticated) sessionExpired();
      } catch(e) {
        const message=root.querySelector('[data-cw-connection]'); message.hidden=false; message.textContent='계정 연결 재시도';
        if(!context) root.querySelector('[data-cw-services]').innerHTML='<p class="cw-empty">서비스 목록을 불러오지 못했습니다.</p>';
      } finally { inflight=null; }
      return context;
    })();
    return inflight;
  }
  function noticeType(type) {
    if (type === '업무 변경' || type === '새 댓글') return type;
    return ({LeaveRequestCreated:'연차 신청',LeaveRequestApproved:'신청 승인',LeaveRequestRejected:'신청 반려',LeaveCancelRequested:'취소 요청',LeaveCancelApproved:'취소 승인',LeaveCancelRejected:'취소 반려',LeaveRequestForceCreated:'관리자 추가',LeaveRequestForceDeleted:'관리자 삭제'}[type]||'알림');
  }
  function notices() { return noticeSession?.read(); }
  function renderNotices(feed) {
      const list=root.querySelector('[data-cw-notices]');
        if(noticeFeed && !isMobileApp() && root.dataset.companyService==='home' && 'Notification' in window && Notification.permission==='granted') {
          const known=new Set(noticeFeed.items.map(n=>n.source+':'+n.sourceId));
          const since=Math.max(0,...noticeFeed.items.map(n=>Date.parse(n.createdAtUtc)));
          for(const n of feed.items.filter(n=>!n.isRead && !known.has(n.source+':'+n.sourceId) && Date.parse(n.createdAtUtc)>since)) {
            try { const alert=new Notification(n.title,{body:n.message,tag:'company-'+n.source+'-'+n.sourceId});notificationAlerts.add(alert);alert.onclose=()=>notificationAlerts.delete(alert);alert.onclick=()=>{window.focus();location.assign(safeLink(n.link));alert.close();}; } catch {}
          }
        }
        noticeFeed=feed;
        const badge=root.querySelector('[data-cw-count]');
        const partial=feed.sources.some(s=>!s.available);
        badge.hidden=!feed.unreadCount&&!partial; badge.textContent=partial?'!':feed.unreadCount>99?'99+':feed.unreadCount;
        badge.title=partial?'일부 서비스 알림을 불러오지 못했습니다.':feed.unreadCount+'개 읽지 않은 알림';
        list.innerHTML=feed.items.map(n=>'<article class="cw-notice '+(n.isRead?'':'is-unread')+'"><small>'+esc(n.sourceLabel)+' · '+esc(noticeType(n.type))+' · '+esc(new Date(n.createdAtUtc.endsWith('Z')?n.createdAtUtc:n.createdAtUtc+'Z').toLocaleString('ko-KR'))+'</small><a data-cw-open-notice="'+esc(n.source)+':'+n.sourceId+'" href="'+esc(safeLink(n.link))+'"><strong>'+esc(n.title)+'</strong><p>'+esc(n.message)+'</p></a>'+(!n.isRead?'<button data-cw-read="'+esc(n.source)+':'+n.sourceId+'">읽음 표시</button>':'')+'</article>').join('');
        if(!feed.items.length){const empty=document.createElement('div');list.append(empty);window.CompanyState.render(empty,{kind:'empty',title:'새로운 알림이 없습니다.',message:'새 업무 알림이 도착하면 이곳에 표시합니다.'});}
        const old=root.dataset.latestLeave;
        const leaveItems=feed.items.filter(n=>n.source==='leave');
        const newer=(a,b)=>window.CompanyNotificationContract.compare(a,b)>0;
        const latest=leaveItems.reduce((max,n)=>!max||newer(n.sourceId,max)?n.sourceId:max,old||null);
        if(old && latest && newer(latest,old)) window.dispatchEvent(new CustomEvent('leave:notifications',{detail:{items:leaveItems.filter(n=>newer(n.sourceId,old))}}));
        if(latest)root.dataset.latestLeave=latest;
        if(pendingPushOpen) {
          const key=pendingPushOpen,known=feed.items.find(n=>n.source+':'+n.sourceId===key);pendingPushOpen=null;
          queueMicrotask(async()=>{try{
            const parsed=window.CompanyNotificationContract.key(key);
            const item=known||window.CompanyNotificationContract.feed(await api('/notifications/'+parsed.source+'/'+parsed.id+'?expectedUserId='+encodeURIComponent(context.user.id))).items[0];
            if(!item||item.source+':'+item.sourceId!==key)throw Error('현재 계정에서 확인할 수 없는 알림입니다.');
            await noticeSession.write(key,()=>location.assign(safeLink(item.link)));
          }catch(error){showStatus({key:'push-open',title:'알림을 열지 못했습니다.',message:error.message});}});
        }
  }
  function setupNotifications() {
    const list=root.querySelector('[data-cw-notices]'),state=document.createElement('div');
    state.dataset.cwNotificationState='';state.hidden=true;list.before(state);list.replaceChildren();
    const center=document.querySelector('[data-notification-center]');
    const centerState=center?.querySelector('[data-center-state]');
    let centerInvalid=false,centerInitialized=false;
    const centerMatches=()=>!center||!centerInvalid&&String(context?.user?.id)===center.dataset.centerOwner;
    const reset=()=>{
      noticeFeed=null;list.replaceChildren();root.querySelector('[data-cw-count]').hidden=true;delete root.dataset.latestLeave;
      for(const alert of notificationAlerts){try{alert.onclick=null;alert.close();}catch{}}notificationAlerts.clear();
      if(center && context!==undefined && (centerInitialized || !centerMatches() || context?.authenticated===false)) {
        centerInvalid=true;center.querySelector('.notification-feed')?.replaceChildren();
        const count=center.querySelector('.notification-summary strong');if(count)count.textContent='—';
      }
    };
    noticeSession=window.CompanyNotificationSession.attach({getContext:()=>context,request:api,onFeed:renderNotices,onReset:reset,
      onLock:locked=>{
        document.querySelectorAll('[data-cw-read],[data-cw-read-all],[data-cw-open-notice],[data-center-read],[data-center-open],[data-center-read-all]').forEach(button=>{
          const disabled=locked||!!button.closest('[data-notification-center]')&&!centerMatches();
          if(button.tagName==='BUTTON')button.disabled=disabled;
          button.setAttribute('aria-disabled',String(disabled));
        });
      },
      onState:value=>{
        const badge=root.querySelector('[data-cw-count]');
        if(value?.kind==='denied')badge.hidden=true;
        else if(value?.kind==='error'&&context?.authenticated){badge.hidden=false;badge.textContent='!';badge.title=value.title;}
        for(const node of [state,centerState].filter(Boolean)){
          if(node===centerState&&centerInvalid){node.hidden=false;window.CompanyState.render(node,{kind:'denied',title:'계정과 권한을 다시 확인해야 합니다.',message:'현재 계정의 알림 페이지를 다시 열어 주세요.',actionLabel:'현재 알림 열기',onAction:()=>location.assign(BASE+'/notifications')});continue;}
          node.hidden=!value;if(value)window.CompanyState.render(node,{kind:value.kind,title:value.title,message:value.message,actionLabel:value.retry?'목록 다시 확인':'',onAction:value.retry});
        }
      }});
    document.addEventListener('company-context',()=>{noticeSession.update();centerInitialized=!!context?.authenticated;});
    document.addEventListener('workspace-entity-scope-change',()=>noticeSession.invalidate());
    window.addEventListener('pagehide',event=>{if(!event.persisted)noticeSession.dispose();});
  }
  function setupProfile(form) {
    if(!form)return null;
    const lifetime=new AbortController();
    if(context?.authenticated)form.querySelector('[data-profile-summary]').innerHTML=avatar(context.user)+'<div><strong>'+esc(context.user.name)+'</strong><p>'+esc(context.user.email)+'</p><p>'+esc(context.user.department||'부서 미지정')+' · '+esc(role(context.user))+'</p></div>';
    const notificationButton=form.querySelector('[data-profile-browser-notifications]');
    if(notificationButton) {
      const update=()=> { notificationButton.hidden=isMobileApp();const permission='Notification' in window ? Notification.permission : 'unsupported'; notificationButton.disabled=permission==='denied'||permission==='unsupported'; notificationButton.textContent=permission==='granted'?'브라우저 알림 사용 중':permission==='denied'?'브라우저 설정에서 알림 허용이 필요합니다':'브라우저 알림 켜기'; };
      notificationButton.onclick=async()=> { if('Notification' in window) { await Notification.requestPermission(); update(); } }; update();
      document.addEventListener('company-mobile-device',update,{signal:lifetime.signal});
    }
    const mobileArea=form.querySelector('[data-profile-mobile-push]');
    if(mobileArea) {
      const render=devices=>{
        if(!devices.length){window.CompanyState.render(mobileArea,{kind:'empty',title:'연결된 모바일 앱이 없습니다.',message:'Android 앱에서 이 계정으로 로그인하면 기기별 알림 설정이 표시됩니다.'});return;}
        mobileArea.innerHTML=devices.map(device=>'<article class="cw-push-device" data-push-device="'+esc(device.installationId)+'"><div><strong>Android</strong><small>앱 '+esc(device.appVersion)+' · '+(device.enabled?'알림 사용':'알림 중지')+'</small></div><label><input type="checkbox" data-push-enabled '+(device.enabled?'checked':'')+'> 전체</label><label><input type="checkbox" data-push-leave '+(device.leaveEnabled?'checked':'')+'> 연차관리</label><label><input type="checkbox" data-push-schedule '+(device.scheduleEnabled?'checked':'')+'> 팀 일정</label><button type="button" class="cw-button" data-push-remove>기기 연결 해제</button></article>').join('');
      };
      const reload=async()=>{if(!context?.authenticated||lifetime.signal.aborted)return;mobileArea.setAttribute('aria-busy','true');try{const devices=(await api('/push/devices?expectedUserId='+encodeURIComponent(context.user.id))).devices||[];if(!lifetime.signal.aborted)render(devices);}catch(error){if(!lifetime.signal.aborted)window.CompanyState.render(mobileArea,{kind:'error',title:'모바일 알림 설정을 불러오지 못했습니다.',message:error.message,actionLabel:'다시 시도',onAction:reload});}finally{mobileArea.removeAttribute('aria-busy');}};
      mobileArea.addEventListener('change',async event=>{
        const row=event.target.closest('[data-push-device]');if(!row)return;
        const controls=[...row.querySelectorAll('input')];controls.forEach(input=>input.disabled=true);
        try{await api('/push/devices/'+encodeURIComponent(row.dataset.pushDevice),{method:'PATCH',contentType:'application/json',body:JSON.stringify({expectedUserId:String(context.user.id),enabled:row.querySelector('[data-push-enabled]').checked,leaveEnabled:row.querySelector('[data-push-leave]').checked,scheduleEnabled:row.querySelector('[data-push-schedule]').checked})});await reload();}catch(error){showStatus({key:'mobile-push',title:'모바일 알림 설정을 저장하지 못했습니다.',message:error.message});await reload();}
      },{signal:lifetime.signal});
      mobileArea.addEventListener('click',async event=>{
        const button=event.target.closest('[data-push-remove]');if(!button)return;const row=button.closest('[data-push-device]');button.disabled=true;
        try{await api('/push/devices/'+encodeURIComponent(row.dataset.pushDevice)+'?expectedUserId='+encodeURIComponent(context.user.id),{method:'DELETE',expectedStatus:204});await reload();}catch(error){button.disabled=false;showStatus({key:'mobile-push',title:'기기 연결을 해제하지 못했습니다.',message:error.message});}
      },{signal:lifetime.signal});
      document.addEventListener('company-context',()=>void reload(),{signal:lifetime.signal});
      document.addEventListener('company-mobile-device',()=>void reload(),{signal:lifetime.signal});
      void reload();
    }
    const imageLifetime=window.CompanyProfile.attach({root:form,getContext:()=>context,readContext,applyContext,publishChange:publishProfileChange});
    return {dispose(){lifetime.abort();if(notificationButton)notificationButton.onclick=null;imageLifetime?.dispose();}};
  }
  const pageLifetimes=new WeakMap();
  function mountPage(view) {
    view.querySelectorAll('[data-cw-profile]').forEach(profile=>{
      if(pageLifetimes.has(profile))return;
      const lifetime=setupProfile(profile);if(lifetime)pageLifetimes.set(profile,lifetime);
    });
    view.querySelectorAll('[data-cw-project-icon]').forEach(editor=>{
      if(pageLifetimes.has(editor))return;
      const lifetime=window.CompanyProjectIcon.attach({root:editor,getContext:()=>context,readContext,applyContext,publishChange:publishProfileChange});
      if(lifetime)pageLifetimes.set(editor,lifetime);
    });
  }
  function disposePage(view) {
    view.querySelectorAll('[data-cw-profile]').forEach(profile=>{
      pageLifetimes.get(profile)?.dispose();pageLifetimes.delete(profile);
    });
    view.querySelectorAll('[data-cw-project-icon]').forEach(editor=>{
      pageLifetimes.get(editor)?.dispose();pageLifetimes.delete(editor);
    });
  }
  async function mount() {
    root=document.querySelector('[data-company-workspace]'); if(!root) return;
    document.body.classList.add('has-company-workspace','company-service-'+root.dataset.companyService);
    root.className='cw-header';
    root.innerHTML='<div class="cw-header-left"><button type="button" class="cw-action cw-nav-toggle" aria-label="사이드바 펼치기" aria-expanded="false" data-cw-nav>'+icon('sidebar')+'</button><a class="cw-brand" href="'+BASE+'/"><span class="cw-logo"></span><strong>Company</strong></a><nav class="cw-services-inline" data-cw-service-links aria-label="사용 가능한 서비스" aria-hidden="true" inert></nav><span class="cw-current"><span class="cw-current-service">'+esc(names[root.dataset.companyService]||'회사 홈')+'</span><span class="cw-current-page"></span></span></div><div class="cw-header-right"><button class="cw-action cw-inline-error" data-cw-connection hidden>계정 연결 재시도</button><div class="cw-menu-wrap" data-cw-bell hidden><button class="cw-action" data-cw-panel="notifications" aria-label="알림" aria-expanded="false">'+icon('bell')+'<span class="cw-badge" data-cw-count hidden></span></button><section class="cw-popover cw-notification-panel" data-cw-popover="notifications" aria-label="최근 알림" hidden><div class="cw-panel-heading"><strong>알림</strong><button data-cw-read-all>모두 읽음</button></div><div data-cw-notices><p class="cw-empty">알림을 불러오는 중…</p></div><a class="cw-panel-footer" href="'+BASE+'/notifications">전체 알림 보기</a></section></div><div class="cw-menu-wrap cw-account-wrap" data-cw-account><span class="cw-skeleton" aria-label="계정 정보 확인 중"></span></div><div class="cw-menu-wrap" data-cw-service-menu><button class="cw-action" data-cw-panel="services" aria-label="서비스 전환" aria-expanded="false">'+icon('grid')+'<span class="cw-action-label">서비스</span></button><section class="cw-popover" data-cw-popover="services" aria-label="사용 가능한 서비스" hidden><div class="cw-panel-heading"><strong>사용 가능한 서비스</strong></div><div data-cw-services><p class="cw-empty">권한 확인 중…</p></div></section></div><div class="cw-menu-wrap"><button class="cw-action" data-cw-panel="theme" aria-label="화면 테마" aria-expanded="false">'+icon('moon')+'</button><div class="cw-popover cw-theme-panel" data-cw-popover="theme" role="menu" hidden>'+THEMES.map((t,i)=>'<button data-cw-theme="'+t+'" role="menuitemradio" aria-checked="false">'+['시스템','라이트','다크'][i]+'</button>').join('')+'</div></div></div>';
    const updateCurrentPage = () => {
      const current=root.querySelector('.cw-current'), title=currentPage(root.dataset.companyService)?.title || '';
      current.querySelector('.cw-current-page').textContent=title;
      current.classList.toggle('has-page',!!title);
      current.setAttribute('aria-label',[names[root.dataset.companyService]||'회사 홈',title].filter(Boolean).join(' · '));
    };
    updateCurrentPage();
    document.addEventListener('company-route-change',updateCurrentPage);
    window.addEventListener('popstate',updateCurrentPage);
    root.querySelector('.cw-brand').setAttribute('aria-label','회사 홈');
    const logo=root.querySelector('.cw-logo');
    const logoImage=document.createElement('img');
    logoImage.src=COMPANY_LOGO;
    logoImage.alt='';
    logoImage.addEventListener('error',()=>{logoImage.remove();logo.textContent='96';});
    logo.append(logoImage);
    if(root.dataset.companyService==='home') root.querySelector('.cw-brand').setAttribute('aria-current','page');
    const serviceResize=new ResizeObserver(scheduleServiceLayout);
    [root,root.querySelector('.cw-header-right'),root.querySelector('.cw-brand'),root.querySelector('[data-cw-service-links]')].forEach(el=>serviceResize.observe(el));
    window.addEventListener('resize',scheduleServiceLayout);
    document.fonts?.ready.then(scheduleServiceLayout);
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button,a'); if(!button) return;
      try {
        if(button.hasAttribute('data-cw-panel')) {
          const open=button.getAttribute('aria-expanded')==='true'; closePanels();
          if(!open) { root.querySelector('[data-cw-popover="'+button.dataset.cwPanel+'"]').hidden=false; button.setAttribute('aria-expanded','true'); if(button.dataset.cwPanel==='notifications') await notices(); }
        }
        if(button.hasAttribute('data-cw-nav')) {
          closePanels(); setSidebarOpen(button.getAttribute('aria-expanded')!=='true');
        }
        if(button.dataset.cwTheme) { saveTheme(button.dataset.cwTheme); closePanels(); }
        if(button.hasAttribute('data-cw-connection')) await refresh();
        if(button.hasAttribute('data-cw-logout')) {
          button.disabled=true; await api('/logout',{method:'POST'}); applyContext({authenticated:false});
          location.assign(BASE+'/');
        }
        if(button.matches('[data-cw-read],[data-cw-read-all],[data-cw-open-notice]')) {
          event.preventDefault();if(button.getAttribute('aria-disabled')==='true')return;
          const href=button.dataset.cwOpenNotice?safeLink(button.href):null;
          await noticeSession.write(button.dataset.cwRead||button.dataset.cwOpenNotice||'all',href?()=>location.assign(href):null);
        }
      } catch(e) { button.disabled=false; showStatus({title:'요청을 완료하지 못했습니다.',message:e.message}); }
    });
    document.addEventListener('click',event=>{
      if(!root.contains(event.target)) closePanels();
      if(event.target.closest('[data-cw-sidebar-close]')) { setSidebarOpen(false); return; }
      // A state action can synchronously replace its button. Use the original event path
      // so retrying an in-place request is not mistaken for clicking outside the drawer.
      if(event.composedPath().some(node=>node.matches?.('[data-state-action]')))return;
      if(document.body.classList.contains('cw-nav-open') && (event.target.closest('.cw-sidebar a,.cw-sidebar button') || !event.target.closest('.cw-sidebar,[data-cw-nav]'))) setSidebarOpen(false);
    });
    document.addEventListener('keydown',event=>{ if(event.key==='Escape') {
      const trigger=root.querySelector('[data-cw-panel][aria-expanded=true]'); closePanels();
      if(document.body.classList.contains('cw-nav-open')) setSidebarOpen(false);
      else trigger?.focus();
    } });
    const sidebarState=()=>{ syncSidebar(); syncProfileElements(); };
    matchMedia('(max-width:900px)').addEventListener('change',()=>{
      document.body.classList.remove('cw-nav-open'); syncSidebar();
      if(document.activeElement?.closest('.cw-sidebar[inert]')) root.querySelector('[data-cw-nav]').focus();
      else if(!matchMedia('(max-width:900px)').matches && !sidebarCollapsed && document.activeElement===root.querySelector('[data-cw-nav]')) document.querySelector('[data-cw-sidebar-close]')?.focus();
    });
    new MutationObserver(sidebarState).observe(document.body,{childList:true,subtree:true}); sidebarState();
    const pagePath = path => path.replace(/\/index(?:\.html)?\/?$/i,'').replace(/\/$/,'').toLowerCase();
    document.querySelectorAll('.cw-sidebar a').forEach(a=>{ if(pagePath(new URL(a.href,location.href).pathname)===pagePath(location.pathname) && (!new URL(a.href).search || new URL(a.href).searchParams.get('tab')===(new URL(location.href).searchParams.get('tab')||'departments'))) a.setAttribute('aria-current','page'); });
    document.querySelectorAll('[data-notification-type]').forEach(el => el.textContent=noticeType(el.textContent));
    document.addEventListener('click',async event=>{
      const button=event.target.closest('[data-center-read],[data-center-open],[data-center-read-all]'); if(!button) return;
      event.preventDefault();if(button.getAttribute('aria-disabled')==='true')return;
      const href=button.dataset.centerOpen?safeLink(button.href):null;
      await noticeSession.write(button.dataset.centerRead||button.dataset.centerOpen||'all',()=>href?location.assign(href):location.reload());
    });
    const entities = document.createElement('script'); entities.src=BASE+'/js/company-entities.js?v=20260909.1'; document.head.append(entities);
    setupNotifications();
    mountPage(document);
    applyTheme(preference()); await refresh(); await notices();
    let last=Date.now();
    async function tick(force=false) { if((document.hidden && !(root.dataset.companyService==='home' && !isMobileApp() && 'Notification' in window && Notification.permission==='granted')) || (!force && Date.now()-last<55000)) return; last=Date.now(); applyTheme(preference()); await refresh(); await notices(); }
    setInterval(()=>void tick(),60000);
    setInterval(()=>{
      const revision=profileRevision();
      if(!document.hidden && revision!==lastProfileRevision) { lastProfileRevision=revision; void refresh(); }
    },2000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) void tick(true);});
    window.addEventListener('focus',()=>void tick(true));
    window.addEventListener('storage',event=>{ if(event.key===PROFILE_COOKIE) void refresh(); });
    window.addEventListener('pagehide',event=>{if(!event.persisted)contextReads.dispose();});
  }
  applyTheme(preference());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>applyTheme(preference()));
  window.addEventListener('storage',e=>{if(e.key===KEY) applyTheme(preference());});
  window.CompanyWorkspace={applyTheme,preference,saveTheme,showStatus,sessionExpired,refresh,profileUrl,projectUrl,mountPage,disposePage,getIdentity:()=>context?.authenticated?String(context.user.id):''};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else void mount();
})();
