/* CS pages keep their own operation state, but share one document lifetime. */
const scripts = new Map([
  ['cs.refunds', '/app.js'],
  ['cs.products', '/product-commands.js'],
  ['cs.logs', '/playfab-logs.js'],
  ['cs.players', '/player-data.js']
]);
const loaded = new Map();
let active = null;

async function activate(id, source, initial = false) {
  const expected = scripts.get(id);
  const url = new URL(source, location.href);
  if (!expected || url.origin !== location.origin || url.pathname !== expected) throw Error('Unknown CS page module');
  const cached = loaded.get(id);
  const module = cached || await import(url.href);
  if (!cached) loaded.set(id, module);
  active = cached && !initial ? module.mount() : module.currentLifecycle();
  if (!active || typeof active.dispose !== 'function' || typeof active.beforeLeave !== 'function') throw Error('CS page did not initialize');
}

const currentId = document.querySelector('[data-workspace-view]')?.dataset.workspaceView;
const initialScript = document.querySelector('script[data-cs-page-module]')?.src;
const initial = currentId && initialScript ? activate(currentId, initialScript, true) : Promise.resolve();

for (const id of scripts.keys()) {
  window.CompanyPageRouter?.register(id, {
    async beforeLeave() { await initial; return active?.beforeLeave() ?? true; },
    async dispose() { await initial; active?.dispose(); active = null; },
    async start(_view, details) { await activate(id, details.scriptUrl); }
  });
}
