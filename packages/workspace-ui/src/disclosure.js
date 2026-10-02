/* Opt-in disclosure groups. Own visibility/ARIA/focus, never values, reads or writes. */
(() => {
  'use strict';
  const instances = new WeakMap();
  let sequence = 0;
  function attach(root, options = {}) {
    if (!(root instanceof HTMLElement)) throw Error('Disclosure requires an element root');
    if (instances.has(root)) return instances.get(root);
    root.setAttribute('data-cw-disclosure-root', '');
    let disposed = false, changing = false, entries = new Map(), pending = null;
    function cancelRequest() { const request = pending; pending = null; request?.abort.abort(); }
    const owned = selector => [...root.querySelectorAll(selector)].filter(el => el.closest('[data-cw-disclosure-root]') === root);
    function sync(entry) {
      for (const button of entry.buttons) {
        button.setAttribute('aria-expanded', String(!entry.panel.hidden));
        button.setAttribute('aria-controls', entry.panel.id);
        const label = entry.panel.hidden ? button.dataset.cwClosedLabel : button.dataset.cwOpenLabel;
        if (label !== undefined) button.textContent = label;
      }
    }
    function refresh() {
      if (disposed) return;
      cancelRequest();
      const next = new Map(), duplicates = new Set();
      for (const panel of owned('[data-cw-disclosure-panel]')) {
        const key = panel.dataset.cwDisclosurePanel;
        if (!key || next.has(key)) { duplicates.add(key); continue; }
        if (!panel.id) { let id; do { id = 'cw-disclosure-' + (++sequence); } while (document.getElementById(id)); panel.id = id; }
        if (document.getElementById(panel.id) && document.getElementById(panel.id) !== panel) { duplicates.add(key); continue; }
        next.set(key, {panel, buttons:[]});
      }
      // Ambiguous keys must not open an arbitrary panel or announce a false relationship.
      for (const key of duplicates) { next.delete(key); for(const panel of owned('[data-cw-disclosure-panel]'))if(panel.dataset.cwDisclosurePanel===key)panel.hidden=true; }
      for (const button of owned('button[data-cw-disclosure]')) {
        const entry = next.get(button.dataset.cwDisclosure);
        if (entry) entry.buttons.push(button);
        else { button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-controls'); }
      }
      let firstOpen = false;
      for (const entry of next.values()) {
        if (options.single && !entry.panel.hidden) { if (firstOpen) entry.panel.hidden = true; firstOpen = true; }
        sync(entry);
      }
      entries = next;
    }
    function setOpen(key, open, options = {}) {
      cancelRequest();
      return applyOpen(key, open, options, false);
    }
    async function requestOpen(key, open, settings = {}) {
      if (disposed || changing || pending || typeof open !== 'boolean') return false;
      if (!options.beforeRequest) return setOpen(key, open, settings);
      const entry = entries.get(key);
      if (!entry || !root.isConnected || !root.contains(entry.panel)) return false;
      if (entry.panel.hidden === !open) return true;
      const snapshot = [...entries].map(([id, value]) => ({id, panel:value.panel, hidden:value.panel.hidden}));
      const request = {abort:new AbortController()}; pending = request;
      let stop;
      const cancelled = new Promise(resolve => { stop = () => resolve(false); request.abort.signal.addEventListener('abort', stop, {once:true}); });
      try {
        const allowed = await Promise.race([options.beforeRequest({key, open, signal:request.abort.signal}), cancelled]);
        if (allowed !== true || disposed || pending !== request || request.abort.signal.aborted || !root.isConnected
          || snapshot.some(value => entries.get(value.id)?.panel !== value.panel || !root.contains(value.panel)
            || value.panel.dataset.cwDisclosurePanel !== value.id || value.panel.hidden !== value.hidden)) return false;
        pending = null;
        return applyOpen(key, open, settings, true);
      } catch { return false; }
      finally { if (pending === request) pending = null; request.abort.signal.removeEventListener('abort', stop); request.abort.abort(); }
    }
    function applyOpen(key, open, {returnFocus} = {}, requested = false) {
      if (disposed || changing || typeof open !== 'boolean') return false;
      const entry = entries.get(key);
      if (!entry || !root.contains(entry.panel) || entry.panel.dataset.cwDisclosurePanel !== key) return false;
      if (entry.panel.hidden === !open) return true;
      const changes = [...entries].filter(([id, value]) => id === key || (options.single && open && !value.panel.hidden))
        .map(([id, value]) => ({key:id, open:id === key ? open : false, panel:value.panel}));
      const active = document.activeElement;
      const closingFocused = changes.find(change => !change.open && change.panel.contains(active));
      const detail = {key, open, requested, changes:changes.map(({key,open}) => ({key,open}))};
      changing = true;
      try {
        const before = new CustomEvent('workspace-disclosure-before-change', {bubbles:true,cancelable:true,detail});
        if (!root.dispatchEvent(before)) return false;
        if (options.beforeChange) {
          // Explicitly synchronous. A Promise must not accidentally approve a destructive transition.
          const allowed = options.beforeChange(detail);
          if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
          if (allowed !== true) return false;
        }
        // A guard can synchronously replace DOM. Do not apply an old binding to the new content.
        if (disposed || changes.some(change => !root.contains(change.panel) || entries.get(change.key)?.panel !== change.panel || change.panel.dataset.cwDisclosurePanel !== change.key)) return false;
        for (const change of changes) { const value = entries.get(change.key); value.panel.hidden = !change.open; sync(value); }
        if (closingFocused) {
          const target = returnFocus || entry.buttons.find(button => !button.matches(':disabled') && !button.closest('[hidden]'));
          if (target?.isConnected) target.focus({preventScroll:true});
        }
        root.dispatchEvent(new CustomEvent('workspace-disclosure-change', {bubbles:true,detail}));
        return true;
      } catch { root.dispatchEvent(new CustomEvent('workspace-disclosure-error', {bubbles:true})); return false; }
      finally { changing = false; }
    }
    const click = event => {
      const button = event.target.closest?.('button[data-cw-disclosure]');
      if (!button || button.closest('[data-cw-disclosure-root]') !== root || button.matches(':disabled')) return;
      if (pending) { event.preventDefault(); return; }
      event.preventDefault(); refresh();
      const entry = entries.get(button.dataset.cwDisclosure);
      if (entry) {
        if (options.beforeRequest) void requestOpen(button.dataset.cwDisclosure, entry.panel.hidden);
        else setOpen(button.dataset.cwDisclosure, entry.panel.hidden);
      }
    };
    const controller = {setOpen, requestOpen, refresh, isOpen:key => !disposed && entries.has(key) && root.contains(entries.get(key).panel) && !entries.get(key).panel.hidden, destroy() {
      if (disposed) return; disposed = true; cancelRequest(); root.removeEventListener('click', click);
      document.removeEventListener('workspace-entity-scope-change', cancelRequest); instances.delete(root);
    }};
    document.addEventListener('workspace-entity-scope-change', cancelRequest);
    refresh(); root.addEventListener('click', click); instances.set(root, controller);
    return controller;
  }
  window.CompanyDisclosure = {attach};
})();
