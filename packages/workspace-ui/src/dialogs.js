/* Shared modal lifetime and explicit confirmation. No reads, writes, retries or authorization. */
(() => {
  'use strict';
  let active = null, sequence = 0, generation = 0;
  const layers = [];

  function present(dialog, options = {}) {
    if (options.signal?.aborted) return {closed: Promise.resolve(null), finish() {}};
    if (active) throw Error('A workspace dialog is already open');
    return connect(dialog, options, true);
  }

  // React/native owners keep their nodes and draft state. Scope retention must
  // be explicit; it does not grant permission to display or write old data.
  function attach(dialog, options) {
    if (!['retain', 'dismiss'].includes(options?.scope)) throw Error('A modal requires an explicit scope policy');
    if (!dialog.isConnected) throw Error('An owned modal must already be mounted');
    if (layers.some(layer => layer.dialog === dialog)) throw Error('The modal is already attached');
    return connect(dialog, options, false);
  }

  function connect(dialog, options, transient) {
    const opener = options.returnFocus || document.activeElement;
    let resolve, done = false, closeRequest = null;
    const closed = new Promise(accept => { resolve = accept; });
    const parent = layers.at(-1);
    const layer = {dialog, parent, finish, raise};
    function raise() {
      dialog.removeEventListener('close', cancelled);
      try { if (dialog.open) dialog.close(); dialog.showModal(); }
      finally { if (!done) dialog.addEventListener('close', cancelled); }
    }
    function mayClose(reason) {
      try { return !options.canClose || options.canClose(reason) === true; } catch { return false; }
    }
    function requestClose(reason = 'request') {
      if (done || closeRequest || options.beforeCloseRequest || layers.at(-1) !== layer || (!transient && !mayClose(reason))) return false;
      finish(null, reason); return true;
    }
    function cancelCloseRequest() { const request = closeRequest; closeRequest = null; request?.abort.abort(); }
    async function requestCloseAsync(reason = 'request') {
      if (!options.beforeCloseRequest) return requestClose(reason);
      if (done || closeRequest || !dialog.isConnected || !dialog.open || layers.at(-1) !== layer || !mayClose(reason)) return false;
      const request = {abort:new AbortController()}; closeRequest = request;
      let stop;
      const cancelled = new Promise(accept => { stop = () => accept(null); request.abort.signal.addEventListener('abort', stop, {once:true}); });
      try {
        const approve = await Promise.race([options.beforeCloseRequest({reason,signal:request.abort.signal}), cancelled]);
        if (typeof approve !== 'function' || done || closeRequest !== request || request.abort.signal.aborted
          || !dialog.isConnected || !dialog.open || layers.at(-1) !== layer || approve() !== true || !mayClose(reason)) return false;
        finish(null, reason); return true;
      } catch { return false; }
      finally { if (closeRequest === request) closeRequest = null; request.abort.signal.removeEventListener('abort', stop); request.abort.abort(); }
    }
    const cancelled = event => {
      if (event.target !== dialog) return;
      event?.preventDefault();
      event?.stopPropagation();
      // A queued native close from an earlier mount must not close a reopened node.
      if (event.type === 'close' && dialog.open) return;
      if (!transient) {
        if (options.beforeCloseRequest) {
          // Native close must not hide a retained draft while its asynchronous
          // confirmation is pending. Keep existing child layers above the owner.
          if (!done && !dialog.open) for (const entry of layers.slice(layers.indexOf(layer))) entry.raise();
          void requestCloseAsync(event.type); return;
        }
        if (!requestClose(event.type) && !done && !dialog.open) {
          // An external native close cannot bypass a parent's draft guard or
          // bring that parent above its existing portal/confirmation children.
          for (const entry of layers.slice(layers.indexOf(layer))) entry.raise();
        }
        return;
      }
      // Only a user Escape can be held while an already submitted form settles.
      // Scope invalidation, abort and external close always release the lifetime.
      if (event?.type === 'cancel' && options.canCancel) {
        try { if (options.canCancel() !== true) return; } catch { return; }
      }
      finish(null);
    };
    const scopeChanged = () => { cancelCloseRequest(); if (transient || options.scope === 'dismiss') finish(null, 'scope'); };
    const aborted = () => finish(null, 'abort');
    function finish(result, reason = 'finish') {
      if (done) return;
      done = true;
      cancelCloseRequest();
      let top = layers.at(-1);
      while (top && top !== layer) top = top.parent;
      const wasTop = top === layer;
      // Portal children are owned by the modal stack, not only DOM ancestry.
      for (const child of [...layers].reverse()) {
        for (let ancestor = child.parent; ancestor; ancestor = ancestor.parent) {
          if (ancestor === layer) { child.finish(null, 'parent'); break; }
        }
      }
      const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1);
      if (active === finish) active = null;
      document.removeEventListener('workspace-entity-scope-change', scopeChanged);
      options.signal?.removeEventListener('abort', aborted);
      dialog.removeEventListener('cancel', cancelled);
      dialog.removeEventListener('close', cancelled);
      try { if (dialog.open) dialog.close(); } catch { /* Removal still releases the modal. */ }
      if (transient) dialog.remove();
      const focusGeneration = generation;
      const restoreFocus = () => {
        if (reason === 'parent' || !wasTop || generation !== focusGeneration || layers.at(-1) !== parent) return;
        try { if (opener?.isConnected) opener.focus({preventScroll: true}); } catch { /* A removed/disabled owner must not strand the promise. */ }
      };
      restoreFocus();
      resolve(result);
      if (!transient && !['dispose','error'].includes(reason)) {
        try { options.onClose?.(reason); } catch (error) { window.reportError?.(error); }
      }
      // React consumers release their disabled trigger after the promise settles.
      // Retry once after that render, without stealing focus from a new modal or a user-selected control.
      if (document.activeElement === document.body && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => { if (document.activeElement === document.body) restoreFocus(); });
      }
    }
    if (transient) active = finish;
    layers.push(layer); generation++;
    document.addEventListener('workspace-entity-scope-change', scopeChanged);
    options.signal?.addEventListener('abort', aborted, {once: true});
    dialog.addEventListener('cancel', cancelled);
    dialog.addEventListener('close', cancelled);
    try {
      if (transient) document.body.append(dialog);
      dialog.showModal();
      options.initialFocus?.focus();
      if (options.signal?.aborted) finish(null, 'abort');
    } catch (error) { finish(null, 'error'); throw error; }
    return transient ? {closed, finish} : {closed, requestClose, requestCloseAsync, dispose: () => finish(null, 'dispose')};
  }

  function confirm(options) {
    if (options.signal?.aborted) return Promise.resolve(null);
    const make = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
    const dialog = make('dialog'), id = 'cw-confirm-' + (++sequence);
    dialog.className = 'cw-review cw-confirm';
    dialog.setAttribute('aria-labelledby', id);
    dialog.setAttribute('aria-describedby', id + '-message');
    const header = make('header'), heading = make('h2', options.title), message = make('p', options.message);
    heading.id = id; heading.tabIndex = -1; message.id = id + '-message';
    header.append(heading, message); dialog.append(header);
    const body = make('div'); body.className = 'cw-review-body';
    if (options.details?.length) {
      const details = make('dl');
      for (const detail of options.details) {
        const row = make('div'), value = make('dd');
        if (detail.entity && ['employee','project'].includes(detail.entity.kind)) {
          value.className='cw-review-entity-line';
          const avatar=make('span');avatar.className='cw-entity-avatar';
          const name=detail.entity.name??String(detail.value??'');
          avatar.textContent=Array.from(name)[0]||'?';
          window.CompanyEntityDisplay?.render(avatar,{kind:detail.entity.kind,id:detail.entity.id,name});
          value.append(avatar,make('span',detail.value));
        } else value.textContent=detail.value;
        row.append(make('dt', detail.label),value);details.append(row);
      }
      body.append(details);
    }
    let input;
    if (options.confirmationText !== undefined) {
      if (typeof options.confirmationText !== 'string' || !options.confirmationText.length) throw Error('Confirmation requires a nonempty exact phrase');
      const label = make('label'), prompt = make('span', `계속하려면 “${options.confirmationText}”를 입력하세요.`);
      input = make('input'); input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.dataset.confirmText = '';
      label.append(prompt, input); body.append(label);
    }
    dialog.append(body);
    const footer = make('footer'), status = make('p'), cancel = make('button', '취소'), apply = make('button', options.confirmLabel || '확인');
    status.setAttribute('role', 'status'); status.id = id + '-status';
    apply.setAttribute('aria-describedby', status.id); if (input) input.setAttribute('aria-describedby', status.id);
    cancel.type = apply.type = 'button'; cancel.dataset.confirmCancel = ''; apply.dataset.confirmApply = '';
    if (options.tone === 'danger') apply.dataset.tone = 'danger';
    footer.append(status, cancel, apply); dialog.append(footer);
    const update = () => {
      apply.disabled = Boolean(options.disabledReason) || Boolean(input && input.value !== options.confirmationText);
      status.setAttribute('role', 'status');
      status.textContent = options.disabledReason || (input && apply.disabled ? '확인 문구를 정확히 입력해 주세요.' : '대상과 내용을 확인한 후 실행하세요.');
    };
    input?.addEventListener('input', update); update();
    const lifetime = present(dialog, {...options, initialFocus: heading});
    cancel.addEventListener('click', () => lifetime.finish(null));
    apply.addEventListener('click', () => {
      if (apply.disabled || !dialog.open) return;
      const result = {confirmation: input?.value || ''};
      let error;
      try { error = options.validate?.(result); }
      catch { error = '실행 조건을 확인하지 못했습니다. 취소 후 다시 확인해 주세요.'; }
      if (error) { status.textContent = error; status.setAttribute('role', 'alert'); return; }
      lifetime.finish(result);
    });
    return lifetime.closed;
  }
  window.CompanyDialog = {present, confirm, attach};
})();
