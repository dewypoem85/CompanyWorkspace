/* Shared native/JSON write observation. Business validation and saved values belong to each server. */
(() => {
  'use strict';
  const mediaType = 'application/vnd.company.workspace-form+json';
  // A document-scoped transaction coordinator, not a transport or a server lock.
  // Consumers finish a lease as saved only after validating the entire receipt.
  function createSession() {
    const owners = new Map(), spent = new Set(), listeners = new Set();
    let active = null, invalid = false, disposed = false, scheduled = false, revision = 0, recoverableScope = false;
    const notify = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) for (const listener of [...listeners]) {
          try { listener(); } catch { /* One view must not prevent other views synchronizing. */ }
        }
      });
    };
    const keys = resources => {
      if (!Array.isArray(resources) || resources.some(key => typeof key !== 'string' || !key.length)) throw Error('Invalid form resources');
      return [...new Set(resources)];
    };
    const blocked = (owner, resources = []) => disposed || invalid || !owners.has(owner) ||
      (active !== null && active.owner !== owner) || keys(resources).some(key => spent.has(key));
    const invalidate = () => {
      if (disposed || invalid) return;
      invalid = true; revision++;
      recoverableScope = !active?.sent;
      const previous = active; active = null;
      previous?.abort.abort(); notify();
    };
    const dispose = event => {
      if (event?.persisted || disposed) return;
      disposed = true; revision++;
      const previous = active; active = null; previous?.abort.abort();
      document.removeEventListener('workspace-entity-scope-change', invalidate);
      document.removeEventListener('company-page-leave', dispose);
      window.removeEventListener('pagehide', dispose);
      owners.clear(); listeners.clear();
    };
    document.addEventListener('workspace-entity-scope-change', invalidate);
    document.addEventListener('company-page-leave', dispose);
    window.addEventListener('pagehide', dispose);
    return {
      get pending() { return active !== null; },
      get invalid() { return invalid || disposed; },
      get revision() { return revision; },
      track(owner, hasDraft = () => false) {
        if (disposed || typeof owner !== 'string' || !owner.length || owners.has(owner) || typeof hasDraft !== 'function') throw Error('Invalid form owner');
        owners.set(owner, hasDraft);
        return () => { if (active?.owner === owner) invalidate(); owners.delete(owner); notify(); };
      },
      hasDraftExcept(owner) {
        for (const [key, read] of owners) if (key !== owner) {
          try { if (read()) return true; } catch { return true; }
        }
        return false;
      },
      blocked,
      begin(owner, resources = []) {
        const captured = keys(resources);
        if (active || blocked(owner, captured)) return null;
        const token = {owner, sent:false, abort:new AbortController()}; active = token; revision++; notify();
        return {
          signal:token.abort.signal,
          get current() { return !disposed && !invalid && active === token; },
          markSent() { if (disposed || invalid || active !== token) return false; token.sent=true;return true; },
          finish(outcome) {
            if (active !== token || invalid || disposed) return false;
            if (!['saved','conflict','invalid','cancelled','unknown'].includes(outcome)) throw Error('Invalid form outcome');
            active = null;
            if (outcome === 'saved' || outcome === 'conflict') captured.forEach(key => spent.add(key));
            else if (outcome === 'unknown') {invalid = true;recoverableScope = false;}
            token.abort.abort(); notify(); return true;
          }
        };
      },
      subscribe(listener) {
        if (disposed || typeof listener !== 'function') throw Error('Invalid form listener');
        listeners.add(listener); return () => listeners.delete(listener);
      },
      recoverScope() {
        // Only domains with an explicit, original-owner revalidation may call this.
        // A sent/unknown write and page disposal can never be recovered by a GET.
        if(disposed||!invalid||!recoverableScope||active)return false;
        invalid=false;recoverableScope=false;revision++;notify();return true;
      },
      invalidate, dispose
    };
  }
  function createTransport(options) {
    let active = null, disposed = false;
    const connected = () => !disposed && options.isConnected?.() !== false;
    const show = (kind, title, message, action) => {
      if (!connected()) return;
      try { options.onState({kind, title, message, actionLabel:action?'변경 내용 비교':'', onAction:action}); }
      catch { /* A view notification cannot change the outcome of a write. */ }
    };
    const uncertain = () => show('error', '저장 결과를 확인하지 못했습니다.',
      '입력한 변경사항은 유지했습니다. 서버에는 반영되었을 수도 있으니 다른 탭에서 최신 상태를 확인한 뒤 저장하세요. 자동으로 다시 전송하지 않습니다.');
    const scopeChanged = () => {
      if (!active) return;
      const request = active;
      request.abort.abort();
      if (connected()) show('denied', '로그인 상태 또는 권한이 바뀌었습니다.',
        '이전 저장 응답은 적용하지 않습니다. 입력은 유지했지만 서버에는 반영되었을 수 있습니다. 최신 계정과 저장 상태를 확인해 주세요.');
      request.finish(false, 'scope-changed');
    };
    const send = input => {
      if (!connected() || active || input.signal?.aborted) return Promise.resolve({saved:false,outcome:'not-sent'});
      let url, method, headers, body, data;
      try {
        url = new URL(input.url, location.href); method = (input.method || 'POST').toUpperCase();
        if (url.origin !== location.origin || url.username || url.password || !['POST','PUT','PATCH','DELETE'].includes(method)) throw Error('Invalid write destination');
        if (typeof options.onSaved !== 'function') throw Error('Acknowledgement validator required');
        headers = new Headers(input.headers);
        headers.set('Accept',mediaType);headers.set('X-Requested-With','XMLHttpRequest');
        if (Object.hasOwn(input,'json')) {
          body = JSON.stringify(input.json);
          if (typeof body !== 'string' || input.formData !== undefined) throw Error('Invalid JSON body');
          // Domain reconciliation gets the exact transmitted snapshot, not a mutable caller object.
          data = JSON.parse(body);headers.set('Content-Type','application/json');
        } else {
          if (!(input.formData instanceof FormData) || method !== 'POST') throw Error('Invalid native form body');
          body = data = input.formData;
          headers.delete('Content-Type'); // Let the browser supply the multipart boundary.
        }
      } catch {
        show('error', '저장 요청을 보내지 않았습니다.', '요청 대상 또는 변경 내용을 확인해 주세요. 입력은 유지되어 있습니다.');
        return Promise.resolve({saved:false,outcome:'not-sent'});
      }
      const abort = new AbortController();
      let saved = false, outcome = 'unknown', timer, restore, resolve;
      const completed = new Promise(done => {resolve=done;});
      const cancelled = () => {
        if (active !== request) return;
        abort.abort();
        if (connected()) uncertain();
        request.finish(false,'unknown');
      };
      const request = {abort, finish(success, reason) {
        if (active !== request) return;
        active = null; clearTimeout(timer);
        input.signal?.removeEventListener('abort',cancelled);
        try { restore?.(); } catch { /* Restoration cannot prevent completion. */ }
        if (connected()) {
          try { options.onSettled?.(success, reason); } catch { /* Consumer notification only. */ }
          try { options.afterSettled?.(); } catch { /* Focus restoration only. */ }
        }
        resolve({saved:success,outcome:reason});
      }};
      active = request;
      const isCurrent = () => connected() && active === request && !abort.signal.aborted;
      try { restore=options.onStart?.(); }
      catch { request.finish(false,'not-sent'); return completed; }
      if (active !== request) { try {restore?.();} catch {} return completed; }
      if (!connected() || input.signal?.aborted) {request.finish(false,'not-sent');return completed;}
      input.signal?.addEventListener('abort',cancelled,{once:true});
      timer = setTimeout(() => {
        if (active !== request) return;
        abort.abort();
        if (connected()) uncertain();
        request.finish(false, 'unknown');
      }, options.timeoutMs ?? 30000);
      const observe = async () => { try {
        if (!isCurrent()) { request.finish(false,'not-sent');return; }
        show('loading', '저장 중입니다.', '변경 내용을 확인하고 있습니다. 창을 닫지 마세요.');
        const response = await fetch(url.href, {method, body, credentials:'same-origin', redirect:'manual', headers, signal:abort.signal});
        if (!isCurrent()) return;
        if (response.status === 401 || response.status === 403) {
          outcome = 'denied';
          show('denied', response.status === 401 ? '로그인 확인이 필요합니다.' : '저장 권한이 없습니다.',
            '입력한 내용은 이 화면에 남아 있습니다. 다른 탭에서 로그인 상태와 권한을 확인해 주세요.');
          return;
        }
        if ((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== mediaType) throw new Error('Unconfirmed response');
        const result = await response.json();
        if (!isCurrent()) return;
        if (!result || result.protocol !== 'workspace-form-v1' || typeof result.message !== 'string') throw new Error('Invalid form response');
        if (response.ok && result.outcome === 'saved') {
          // Consumers must validate the whole acknowledgement before reconciling any field or version.
          // Async consumers must check isCurrent after their own awaits, before mutating DOM.
          await options.onSaved(result.data, data, {signal:abort.signal, isCurrent});
          if (!isCurrent()) return;
          saved = true;
          outcome = 'saved';
          show('success', '저장했습니다.', result.message);
        } else if (response.status === 409 && result.outcome === 'conflict' || response.status === 422 && result.outcome === 'invalid') {
          outcome = result.outcome;
          show('error', result.outcome === 'conflict' ? '다른 변경사항과 충돌했습니다.' : '입력 내용을 확인해 주세요.',
            result.message + ' 입력한 변경사항은 유지했습니다.', result.outcome === 'conflict' ? options.onConflict : undefined);
        } else throw new Error('Unconfirmed write');
      } catch {
        if (isCurrent()) uncertain();
      } finally {
        request.finish(saved, outcome);
      }};
      void observe();
      return completed;
    };
    document.addEventListener('workspace-entity-scope-change',scopeChanged);
    const dispose = event => {
      if (event?.persisted || disposed) return;
      disposed = true;
      document.removeEventListener('workspace-entity-scope-change',scopeChanged);
      window.removeEventListener('pagehide',dispose);
      const request = active;
      if(request){request.abort.abort();request.finish(false,'disposed');}
    };
    window.addEventListener('pagehide',dispose);
    return {send,get busy(){return active !== null;},dispose};
  }
  function attach(form, options) {
    let focus;
    const show = spec => {
      options.state.hidden = false;
      window.CompanyState.render(options.state,spec);
      options.state.scrollIntoView?.({block:'nearest',behavior:'instant'});
    };
    const controller=createTransport({...options,isConnected:()=>form.isConnected,onState:show,
      onStart:()=>{
        const controls=[...form.elements].filter(el=>'disabled' in el),disabled=controls.map(el=>el.disabled);
        focus=document.activeElement;
        const oldBusy=form.getAttribute('aria-busy');form.setAttribute('aria-busy','true');
        controls.forEach(el=>{el.disabled=true;});
        return ()=>{controls.forEach((el,i)=>{el.disabled=disabled[i];});if(oldBusy===null)form.removeAttribute('aria-busy');else form.setAttribute('aria-busy',oldBusy);};
      },
      afterSettled:()=>{if(focus?.isConnected&&!focus.disabled&&(document.activeElement===document.body||document.activeElement===focus))focus.focus({preventScroll:true});}
    });
    const submit=event=>{
      event.preventDefault();
      if(controller.busy||options.canSubmit?.()===false||!form.reportValidity())return;
      if(form.method.toLowerCase()!=='post') {show({kind:'error',title:'저장 요청을 보내지 않았습니다.',message:'같은 서비스의 POST 양식만 사용할 수 있습니다.'});return;}
      // Serialize before locking native checkbox, multi-value and antiforgery controls.
      try {
        const data=new FormData(form);
        if(event.submitter?.name)data.append(event.submitter.name,event.submitter.value);
        options.prepare?.(data);
        void controller.send({url:form.action,formData:data});
      } catch {show({kind:'error',title:'저장 요청을 보내지 않았습니다.',message:'변경 내용을 준비하지 못했습니다. 입력은 유지되어 있습니다.'});}
    };
    form.addEventListener('submit',submit);
    return {get busy(){return controller.busy;},dispose(){form.removeEventListener('submit',submit);controller.dispose();}};
  }
  const documentSessions=new Map();
  const documentSession=key=>{
    if(typeof key!=='string'||!key.length)throw Error('Invalid document session key');
    if(!documentSessions.has(key))documentSessions.set(key,createSession());
    return documentSessions.get(key);
  };
  window.CompanyForm = {attach, createTransport, documentSession, createSession, mediaType};
})();
