import { REFRESH_PROTOCOL, REFRESH_MEDIA_TYPE, readRefreshContext, readRefreshReceipt } from './refresh-contract.js';

// This is an asynchronous job API, not a native form save. Shared dialogs,
// feedback and the document transaction session own the reusable UI behavior.
export function attachStatisticsRefresh({ button, statusNode, user, onPublication, onComplete, onBoundary = () => {}, onInvalidate = () => {}, onIdle = () => {},
  timeoutMs = 30_000, pollMs = 3000, fetchImpl = (...args) => fetch(...args), win = window, doc = document }) {
  const session = win.CompanyForm.createSession(), readSession = win.CompanyReadSession.create(), owner = 'statistics-refresh';
  session.track(owner);
  const scope = new AbortController();
  let disposed = false, denied = false, busy = false, unknown = false, timer = null;
  let latest = null, acceptedId = null, loadedId = null;
  const current = () => !disposed && !denied && !scope.signal.aborted;
  const syncButton = () => {
    button.disabled = !current() || busy || unknown || Boolean(latest?.pending || latest?.publication.inProgress);
    button.textContent = busy ? '갱신 요청 확인 중…' : latest?.publication.inProgress ? '집계 진행 중…' : '↻ 통계 갱신';
  };
  const show = (kind, title, message, canRead = false) => {
    if (!current()) return;
    statusNode.hidden = false;
    win.CompanyState.render(statusNode, { kind, title, message, ...(canRead ? { actionLabel: '집계 상태 확인', onAction: () => void readStatus() } : {}) });
  };
  const hideStatus = () => { statusNode.hidden = true; };
  const abortReads = () => { clearTimeout(timer); readSession.cancel('statistics-refresh-context'); readSession.cancel('statistics-refresh-status'); };
  function invalidate() {
    if (disposed || denied) return;
    denied = true; scope.abort(); abortReads(); readSession.dispose(); session.invalidate(); syncButton(); onInvalidate();
    statusNode.hidden = false;
    win.CompanyState.render(statusNode, { kind: 'denied', title: '회사 계정이나 권한이 변경되었습니다.', message: '이전 화면에서는 갱신하지 않습니다. 페이지를 새로고침해 주세요.' });
  }
  function dispose(event) {
    if (event?.persisted || disposed) return;
    disposed = true; scope.abort(); abortReads(); readSession.dispose(); session.dispose(); onBoundary(); syncButton();
    button.removeEventListener('click', start);
    doc.removeEventListener('workspace-entity-scope-change', invalidate);
    win.removeEventListener('pagehide', dispose);
  }
  async function requestJson(url, init, signal) {
    const response = await fetchImpl(url, { ...init, signal, credentials: 'same-origin', redirect: 'manual', cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-Statistics-Return-Url': win.location.pathname + win.location.search, ...init?.headers } });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (response.status === 401 || response.status === 403) throw Object.assign(Error('회사 계정 권한을 다시 확인해 주세요.'), { status: response.status });
    if (!String(response.headers.get('content-type') || '').includes(init?.method === 'POST' ? REFRESH_MEDIA_TYPE : 'application/json')) throw Error('서버 응답 형식을 확인하지 못했습니다.');
    const value = await response.json();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!response.ok) throw Object.assign(Error(value.message || value.error || '집계 요청을 처리하지 못했습니다.'), { status: response.status,
      definite: value.protocol === REFRESH_PROTOCOL && [409,422,429].includes(response.status) && ['invalid','conflict'].includes(value.outcome) });
    if (init?.method === 'POST' && response.status !== 202) throw Error('갱신 접수 상태를 확인하지 못했습니다.');
    return value;
  }
  async function requestMutation(url, init, signal = scope.signal) {
    const controller = new AbortController();
    let timeout, abortListener;
    const ended = new Promise((_, reject) => {
      abortListener = () => { controller.abort(); reject(new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) abortListener();
      timeout = setTimeout(() => { controller.abort(); reject(Error('응답 확인 시간이 초과되었습니다.')); }, timeoutMs);
    });
    const work = requestJson(url, init, controller.signal);
    try { return await Promise.race([work, ended]); }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', abortListener); controller.abort(); }
  }
  const contextUrl = () => '/api/analytics/refresh-context?' + new URLSearchParams({ expectedUserId: user.id });
  async function getContext(signal) { return readRefreshContext(await requestJson(contextUrl(), {}, signal), user); }
  const publish = context => { latest = context; onPublication(context.publication); syncButton(); };
  async function readStatus({ passive = false } = {}) {
    if (!current() || busy) return;
    abortReads(); let result;
    const isCurrent = () => current() && !busy && result?.isCurrent?.();
    if (!passive) show('loading', '집계 상태를 확인하고 있습니다.', '마지막 완료 집계는 유지합니다.');
    try {
      result = await readSession.run('statistics-refresh-status', getContext, timeoutMs);
      if (!current() || result.status === 'cancelled' || !result.isCurrent()) return;
      if (result.status === 'error') throw result.error;
      const context = result.value;
      publish(context);
      const publication = context.publication;
      if (unknown) { show('error', '이전 갱신 요청의 접수 여부가 미확정입니다.', `현재 집계 상태: ${publication.status}. 조회로 재실행 잠금을 해제하지 않습니다. 운영 상태를 확인한 뒤 새 문서에서 작업해 주세요.`, true); return; }
      if (context.pending || publication.inProgress) {
        if (passive) hideStatus();
        else show('loading', acceptedId ? '갱신 요청이 접수되어 집계 중입니다.' : '통계를 집계하고 있습니다.', `${publication.currentProfile || '집계 준비 중'} · ${publication.publishedProfiles}/${publication.totalProfiles} · 현재 화면은 마지막 완료 집계입니다.`);
        timer = setTimeout(() => void readStatus({ passive }), pollMs); return;
      }
      if (acceptedId && publication.runId !== acceptedId) { show('error', '접수한 작업의 최종 상태를 확인하지 못했습니다.', '워커 재시작 또는 다른 집계로 상태가 바뀌었습니다. 현재 완료본과 운영 상태를 확인해 주세요.', true); return; }
      if (publication.status === 'error') { show('error', '통계 집계에 실패했습니다.', `${publication.error || '운영 로그를 확인해 주세요.'} 마지막 완료 집계는 유지합니다.`, true); return; }
      if (publication.status === 'ready' && publication.runId !== loadedId) {
        if (!passive) show('loading', '집계가 완료되었습니다.', '최신 완료본을 불러오고 있습니다.');
        const loaded = await onComplete(isCurrent, publication);
        if (!isCurrent()) return;
        if (loaded === true) { loadedId = publication.runId; acceptedId = null; if (passive) hideStatus(); else show('success', '집계와 화면 갱신이 완료되었습니다.', '최신 완료 집계를 표시합니다.'); }
        else show('success', '집계는 완료됐지만 화면을 갱신하지 못했습니다.', '마지막 표시 데이터는 유지합니다. 상태 확인은 조회만 수행합니다.', true);
        return;
      }
      if (passive) { hideStatus(); return; }
      show('success', '집계 상태를 확인했습니다.', publication.completedAt ? '마지막 완료 집계를 사용합니다.' : '아직 완료된 집계가 없습니다.', true);
    } catch (error) {
      if (!isCurrent() || error.name === 'AbortError') return;
      if ([401,403].includes(error.status)) invalidate();
      else if (passive) { hideStatus(); timer = setTimeout(() => void readStatus({ passive: true }), pollMs); }
      else show('error', '집계 상태를 확인하지 못했습니다.', error.message, true);
    }
  }
  async function start() {
    if (!current() || busy || unknown || session.invalid) return;
    const lease = session.begin(owner); if (!lease) return;
    busy = true; abortReads(); onBoundary(); syncButton();
    let sent = false, outcome = 'cancelled', accepted = false;
    const isCurrent = () => current() && lease.current;
    try {
      show('loading', '갱신 조건을 확인하고 있습니다.', '현재 계정과 집계 상태를 확인합니다.');
      const contextRead = await readSession.run('statistics-refresh-context', getContext, timeoutMs);
      if (!isCurrent() || contextRead.status === 'cancelled' || !contextRead.isCurrent()) return;
      if (contextRead.status === 'error') throw contextRead.error;
      const context = contextRead.value;
      publish(context);
      if (!context.available || context.pending || context.publication.inProgress) { show('error', '지금은 새 갱신을 요청할 수 없습니다.', '워커 준비 또는 진행 중인 집계를 확인해 주세요.', true); return; }
      const force = Boolean(context.publication.refreshAllowedAt && Date.parse(context.publication.refreshAllowedAt) > Date.parse(context.serverTime));
      if (force && !['admin','master'].includes(user.role)) { show('error', '수동 갱신 대기 시간입니다.', `${new Date(context.publication.refreshAllowedAt).toLocaleString('ko-KR')} 이후 갱신할 수 있습니다.`, true); return; }
      const intent = Object.freeze({ protocol: REFRESH_PROTOCOL, requestId: win.crypto.randomUUID(), expectedUserId: user.id, expectedRole: user.role,
        mode: context.mode, titleId: context.titleId, expectedRevision: context.revision, force });
      const confirmed = await win.CompanyDialog.confirm({ title: force ? '통계를 강제로 갱신할까요?' : '통계를 갱신할까요?',
        message: force ? '한 시간 제한을 무시하는 관리자 작업입니다. 원본 로그 재집계로 서버 부하가 높아질 수 있습니다.' : '백그라운드 집계를 요청합니다. 완료 전까지 마지막 완료본을 유지합니다.',
        details: [{ label: '대상', value: context.mode === 'live' ? `라이브 · ${context.titleId}` : '데모 데이터' },
          { label: '현재 계정', value: user.name || user.id }, { label: '마지막 완료', value: context.publication.completedAt ? new Date(context.publication.completedAt).toLocaleString('ko-KR') : '없음' }],
        confirmLabel: force ? '강제 갱신 요청' : '갱신 요청', signal: lease.signal, returnFocus: button });
      if (!isCurrent()) return;
      if (!confirmed) { show('success', '갱신 요청을 취소했습니다.', '서버에 요청을 보내지 않았습니다.'); return; }
      show('loading', '갱신 요청의 접수를 확인하고 있습니다.', '아직 집계 완료가 아닙니다. 중복 요청하지 않습니다.');
      sent = true;
      const response = await requestMutation('/api/analytics/refresh', { method: 'POST', headers: { Accept: REFRESH_MEDIA_TYPE, 'Content-Type': 'application/json' }, body: JSON.stringify(intent) }, lease.signal);
      if (!isCurrent()) return;
      const publication = readRefreshReceipt(response, intent);
      acceptedId = publication.runId; accepted = true; outcome = 'saved';
      publish({ ...context, pending: false, publication });
      show('success', '갱신 요청이 접수되었습니다.', '집계 완료 여부를 확인하고 있습니다. 마지막 완료본은 유지합니다.');
    } catch (error) {
      if (!isCurrent() || error.name === 'AbortError') return;
      if ([401,403].includes(error.status)) { invalidate(); return; }
      if (sent && !error.definite) { unknown = true; outcome = 'unknown'; show('error', '갱신 요청의 접수 여부가 미확정입니다.', `${error.message} 다시 요청하지 말고 집계 상태를 확인해 주세요.`, true); }
      else { outcome = 'invalid'; show('error', sent ? '갱신 요청이 거부되었습니다.' : '갱신 조건을 확인하지 못했습니다.', error.message, true); }
    } finally {
      lease.finish(outcome); busy = false; syncButton();
      if (current()) onIdle();
      if (current() && accepted) timer = setTimeout(() => void readStatus(), pollMs);
    }
  }
  button.addEventListener('click', start);
  doc.addEventListener('workspace-entity-scope-change', invalidate);
  win.addEventListener('pagehide', dispose);
  syncButton();
  return { readStatus, dispose, get active() { return current(); }, get pending() { return busy; },
    startPolling() { if (current()) { hideStatus(); timer = setTimeout(() => void readStatus({ passive: true }), pollMs); } } };
}
