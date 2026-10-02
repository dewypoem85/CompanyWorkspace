/* Audit is read-only. A failed read retains the last verified area, never redirects. */
(() => {
  'use strict';
  const start = () => {
    let area = document.getElementById('auditLogsArea');
    const status = document.getElementById('auditLogsState');
    if (!area || !status || !window.CompanyDisclosure || !window.CompanyState) return;
    const owner = area.dataset.auditOwner, readSession = window.CompanyReadSession.create(), channel = 'leave-audit';
    let active = null, blocked = false, disposed = false, disclosure = null;
    const current = request => active === request && !blocked && !disposed && area.isConnected;
    const show = options => { status.hidden = false; window.CompanyState.render(status, options); };
    function cancel() {
      active = null; readSession.cancel(channel);
      area.removeAttribute('aria-busy');
    }
    function deny() {
      if (disposed) return;
      blocked = true; cancel(); disclosure?.destroy(); area.replaceChildren();
      show({kind:'denied',title:'현재 계정의 감사 로그 접근을 확인해 주세요.',message:'이전 계정의 내용을 제거했습니다. 계정과 권한을 확인한 뒤 이 화면을 다시 열어 주세요.',actionLabel:'현재 계정으로 다시 열기',onAction:()=>window.location.reload()});
    }
    function criteria(url) {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin !== location.origin || parsed.pathname.toLowerCase() !== '/admin/auditlogs') throw Error('잘못된 감사 로그 주소입니다.');
      const p = parsed.searchParams, limit = p.get('AuditLimit') || '10';
      return {url:parsed.href,action:p.get('actionFilter') || '',actor:p.get('actorFilter') || '',target:p.get('targetFilter') || '',limit:['10','20','50','100'].includes(limit)?limit:'10'};
    }
    function validate(doc, expected) {
      const areas = doc.querySelectorAll('#auditLogsArea');
      if (areas.length !== 1) throw Error('감사 로그 응답 형식을 확인할 수 없습니다.');
      const next = areas[0], d = next.dataset;
      if (d.auditOwner !== owner) { deny(); return null; }
      if (d.auditAction !== expected.action || d.auditActor !== expected.actor || d.auditTarget !== expected.target || d.auditLimit !== expected.limit || next.querySelector('script') || next.querySelectorAll('#auditLogsFilterForm').length !== 1 || next.querySelectorAll('#auditLogsListForm').length !== 1 || next.querySelectorAll('table.audit-log-table').length !== 1)
        throw Error('검색 조건과 다른 감사 로그 응답입니다.');
      return next;
    }
    async function load(url) {
      if (blocked || disposed) return;
      let expected;
      try { expected = criteria(url); } catch { show({kind:'error',title:'감사 로그 검색 주소를 확인해 주세요.'}); return; }
      cancel();
      const request = {}; active = request;
      area.setAttribute('aria-busy','true');
      show({kind:'loading',title:'감사 로그를 조회하고 있습니다.',message:'조회가 끝날 때까지 이전 결과를 표시합니다.'});
      const failed = message => { if (!current(request)) return; cancel(); show({kind:'error',title:'감사 로그를 불러오지 못했습니다.',message,actionLabel:'같은 조건으로 다시 조회',onAction:()=>load(expected.url)}); };
      try {
        const result = await readSession.run(channel,async signal=>{
          const response = await fetch(expected.url,{headers:{'X-Requested-With':'XMLHttpRequest'},credentials:'same-origin',cache:'no-store',signal,redirect:'error'});
          if (response.status === 401 || response.status === 403) throw Object.assign(Error('HTTP '+response.status),{status:response.status});
          if (!response.ok) throw Error('HTTP '+response.status);
          const html = await response.text(); signal.throwIfAborted(); return html;
        },15000);
        if (result.status === 'cancelled' || !current(request) || !result.isCurrent?.()) return;
        if (result.status === 'error') throw result.error;
        const html = result.value;
        const next = validate(new DOMParser().parseFromString(html,'text/html'),expected);
        if (!next || !current(request)) return;
        active = null; disclosure?.destroy(); area.replaceWith(next); area = next;
        bind(); status.hidden = true;
      } catch (error) {
        if (current(request) && (error?.status === 401 || error?.status === 403)) { deny(); return; }
        failed('마지막 정상 결과와 검색 입력은 유지했습니다. 잠시 후 다시 조회해 주세요.');
      }
      finally { if (active === request) { active = null; area.removeAttribute('aria-busy'); } }
    }
    const formUrl = form => { const url = new URL(location.href); url.search = new URLSearchParams(new FormData(form)).toString(); return url.href; };
    function bind() {
      disclosure = window.CompanyDisclosure.attach(area,{single:true});
      window.setMobileTableLabels?.();
      const changed = event => {
        if (event.type === 'change' && event.target.matches('#auditLogsListForm select')) return;
        if (!active) return;
        cancel(); show({kind:'empty',title:'검색 조건이 바뀌었습니다.',message:'입력한 조건을 유지했습니다. 필터 적용을 눌러 다시 조회해 주세요.'});
      };
      area.addEventListener('input',changed);area.addEventListener('change',changed);
      area.addEventListener('submit',event=>{
        const form = event.target;
        if (!['auditLogsFilterForm','auditLogsListForm','auditLogsPageJumpForm'].includes(form.id)) return;
        event.preventDefault();
        const page = form.querySelector('input[type="number"][name="AuditPage"]');
        if (page) page.value = String(Math.max(Number(page.min)||1, Math.min(Number(page.max)||1, Number(page.value)||1)));
        load(formUrl(form));
      });
      area.querySelector('#auditLogsListForm select')?.addEventListener('change',event=>{
        const form = event.target.form; form.elements.AuditPage.value = '1'; load(formUrl(form));
      });
      area.querySelectorAll('.pager a[href]').forEach(link=>link.addEventListener('click',event=>{
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); if (!link.classList.contains('is-disabled')) load(link.href);
      }));
    }
    if (!/^[1-9]\d*$/.test(owner || '')) { deny(); return; }
    bind();
    document.addEventListener('workspace-entity-scope-change',deny);
    const dispose=event=>{
      if (event?.persisted) { cancel(); status.hidden=true; return; }
      if(disposed)return;
      disposed=true; cancel(); readSession.dispose(); disclosure?.destroy(); document.removeEventListener('workspace-entity-scope-change',deny);
      document.removeEventListener('company-page-leave',dispose);window.removeEventListener('pagehide',dispose);
    };
    window.addEventListener('pagehide',dispose);document.addEventListener('company-page-leave',dispose);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
