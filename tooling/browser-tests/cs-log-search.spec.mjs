import { test, expect } from '@playwright/test';
import { assertCsControls, assertCsStatePill } from './support/cs-controls.mjs';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { root } from '../build-ui.mjs';
import { resolvePublicAsset } from '../../apps/cs/lib/public-assets.js';
import { createPlayFabLogSearchApi } from '../../apps/cs/lib/playfab-log-search.js';

const context = { authenticated: true, isAdmin: true, csrfToken: 'synthetic-only', user: { id: 1, name: '검증 직원', email: 'ui@example.test', role: 'admin' }, profiles: {}, projects: [], projectIcons: {}, employees: [], services: [{ key: 'cs', name: 'CS', href: '/workspace/cs' }] };
const raw = '{"CloudScriptExecutionResult":{"Logs":[{"Message":"젬 획득 <script>금지</script>"}]},"counter":9223372036854775807}';
test.use({ timezoneId: 'UTC' });

// Real module and job handler; all HTTP is intercepted, Azure/parquet are synthetic.
async function fixture(page, info) {
  const errors = [], unhandled = [], requests = [];
  let mode = 'rows', override = null, held = '', release, gate, transform = (action, value) => value;
  const dataDir = info.outputPath('synthetic-audit'); await mkdir(dataDir, { recursive: true });
  const api = createPlayFabLogSearchApi({ dataDir, storageAccount: 'syntheticstorage', sasToken: 'sp=rl&sig=synthetic', liveTitleId: 'TEST',
    fetchImpl: async () => new Response(mode === 'empty' ? '<EnumerationResults><Blobs></Blobs></EnumerationResults>' : '<EnumerationResults><Blobs><Blob><Name>data/title=TEST/date=20260814/hour=03/part.parquet</Name><Properties><Content-Length>1000</Content-Length></Properties></Blob></Blobs></EnumerationResults>'),
    parquetReader: async () => {
      if (gate) await gate;
      if (mode === 'partial') throw new Error('synthetic file failure');
      return [1, 2].map(id => ({ Timestamp: '2026-08-14T03:10:00Z', EventId: `event-${id}`, FullName_Name: 'cloudscript', EntityLineage_master_player_account: 'ABC123', EventData: raw }));
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === '/api/workspace/context') return route.fulfill({ json: context });
    if (path === '/api/workspace/notifications') return route.fulfill({ json: { items: [], sources: [], unreadCount: 0 } });
    if (path === '/api/config') return route.fulfill({ json: { csrfToken: 'synthetic-only', currentUser: context.user } });
    if (path.startsWith('/api/playfab/log-search/')) {
      const action = path.split('/').at(-1), body = req.postDataJSON(); requests.push({ action, body, csrf: req.headers()['x-csrf-token'] });
      const custom = override?.(action, body); if (custom) return route.fulfill(custom);
      try {
        const response = await api.handle({ path, body, authenticatedUser: context.user, requestId: `synthetic-${requests.length}`, ip: '127.0.0.1' });
        if (action === 'config') response.payload.pollIntervalMs = 40;
        if (held === action) await new Promise(resolve => { release = resolve; });
        return route.fulfill({ status: response.statusCode, json: transform(action, response.payload) });
      } catch (error) { return route.fulfill({ status: error.statusCode || 500, json: { error: error.message } }); }
    }
    if (req.method() !== 'GET') { unhandled.push(`${req.method()} ${path}`); return route.abort(); }
    const shared = { '/js/company-workspace.js': 'apps/portal/wwwroot/js/company-workspace.js', '/js/company-entities.js': 'apps/portal/wwwroot/js/company-entities.js', '/css/company-workspace.css': 'apps/portal/wwwroot/css/company-workspace.css', '/images/company-logo.png':'apps/portal/wwwroot/images/company-logo.png' }[path];
    if (shared) return route.fulfill({ body: readFileSync(resolve(root, shared)), contentType: {'.css':'text/css','.png':'image/png'}[extname(shared)] || 'application/javascript' });
    const asset = resolvePublicAsset(resolve(root, 'apps/cs/public'), path);
    if (asset) return route.fulfill({ body: readFileSync(asset.filePath), contentType: asset.contentType });
    if (path !== '/favicon.ico') unhandled.push(path); return route.abort();
  });
  return { errors, unhandled, requests, mode: value => { mode = value; }, override: fn => { override = fn; }, transform: fn => { transform = fn; },
    hold: action => { held = action; release = null; }, get pending() { return Boolean(release); }, release: () => { held = ''; release?.(); release = null; },
    blockScan: () => { let done; gate = new Promise(resolve => { done = resolve; }); return () => { gate = null; done(); }; }
  };
}
async function open(page) {
  await page.goto('https://cs.workspace.test/logs');
  await expect(page.locator('#logSearchButton')).toBeEnabled();
  await page.locator('#logFrom').fill('2026-08-14T03:00');
  await page.locator('#logTo').fill('2026-08-14T04:00');
  await page.locator('#logQuery').fill('젬');
}
async function search(page) { await page.locator('#logSearchButton').click(); }
async function complete(page) { await expect(page.locator('#logResultCard')).toBeVisible(); await expect(page.locator('#logSearchButton')).toBeEnabled(); }

for (const width of [320, 1440]) for (const theme of ['light', 'dark']) test(`CS log common states, lossless details and long range ${width}px ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme });
  const f = await fixture(page, info); await open(page);await expect(page.locator('#logMessageBox')).toBeHidden(); await search(page); await complete(page);
  await assertCsStatePill(page,'#logModeBadge','warning');
  await expect(page.locator('[data-toast-id="log-result"]')).toBeVisible();await expect(page.locator('#logMessageBox')).toBeHidden();
  await expect(page.locator('#logResultCriteria')).toContainText('검색어: 젬');
  await expect(page.locator('.log-message')).toHaveCount(2); await expect(page.locator('.log-message').first()).toHaveText('젬 획득 <script>금지</script>');
  await page.locator('[data-log-view="detail"]').click();
  await expect(page.locator('[data-log-view="detail"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-log-view="simple"]')).toHaveAttribute('aria-pressed','false');
  await assertCsControls(page);
  const buttons = page.locator('.log-details [data-cw-disclosure]'); await buttons.first().focus(); await page.keyboard.press('Enter');
  await expect(buttons.first()).toHaveAttribute('aria-expanded', 'true'); await expect(page.locator('.log-json').first()).toContainText('9223372036854775807');
  await buttons.last().click(); await expect(buttons.first()).toHaveAttribute('aria-expanded', 'false'); await expect(page.locator('[data-cw-disclosure-panel]:visible')).toHaveCount(1);
  expect(await page.locator('.log-result').first().evaluate(node => {
    const probe = document.createElement('span'); probe.style.background = 'var(--cw-surface)'; node.append(probe);
    const same = getComputedStyle(node).backgroundColor === getComputedStyle(probe).backgroundColor; probe.remove(); return same;
  })).toBe(true);
  await page.locator('#logResultCard').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('log-results.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  await page.locator('#logQuery').fill(''); await search(page); await expect(page.locator('#logResultCard')).toBeVisible();await expect(page.locator('#logQuery')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#logQueryError')).toContainText('검색어');await expect(page.locator('[data-toast-id="log-validation"]')).toBeVisible();await expect(page.locator('#logQuery')).toBeFocused(); expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1);
  await page.locator('#logQuery').fill('없는문구');await page.locator('#logFrom').fill('2026-08-15T04:00');await search(page);await expect(page.locator('#logTo')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#logToError')).toContainText('종료 시각');await expect(page.locator('#logTo')).toBeFocused();expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1);
  await page.locator('[data-hours="720"]').click(); await search(page);
  await expect(page.locator('#confirmLongRange')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#longRangeError')).toContainText('실행 확인란');await expect(page.locator('[data-toast-id="log-validation"]')).toContainText('실행 확인란');await expect(page.locator('#confirmLongRange')).toBeFocused(); expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1);
  const longRange=page.locator('#confirmLongRange'),longRangeControl=page.locator('#longRangeConfirmation');
  await expect(longRange).toHaveClass(/\bcw-checkbox\b/);await expect(longRangeControl).toHaveClass(/\bcw-check-control\b/);expect((await longRange.boundingBox()).width).toBe(18);
  const checkboxColors=await page.evaluate(()=>{const probe=document.createElement('span');document.body.append(probe);probe.style.backgroundColor='var(--cw-raised)';const raised=getComputedStyle(probe).backgroundColor;probe.style.backgroundColor='var(--cw-active)';const active=getComputedStyle(probe).backgroundColor;probe.remove();return{raised,active};});
  await expect(longRangeControl).toHaveCSS('background-color',checkboxColors.raised);await longRangeControl.screenshot({path:info.outputPath('long-range-unselected.png'),animations:'disabled'});
  await longRange.check();await expect(longRangeControl).toHaveCSS('background-color',checkboxColors.active);await longRangeControl.screenshot({path:info.outputPath('long-range-selected.png'),animations:'disabled'});f.mode('empty'); await search(page); await complete(page);
  await expect(page.locator('#logResults [data-state-kind="empty"]')).toBeVisible(); await expect(page.locator('#logCsvButton')).toBeDisabled();
  expect(f.requests.filter(r => r.action === 'search')[1].body.confirmLongRange).toBe(true);
  await page.locator('#logResultCard').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('log-empty.png'), animations: 'disabled' });
  expect(f.errors).toEqual([]); expect(f.unhandled).toEqual([]);
});

test('CS log transient status failure retains job and retry reads only; reload resumes', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page);
  f.override(action => action === 'status' ? { status: 503, json: { error: '일시적인 읽기 실패' } } : null);
  await search(page); await expect(page.getByRole('button', { name: '검색 상태 재확인' })).toBeVisible();
  const id = await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1')); expect(id).toBeTruthy();
  await expect(page.locator('#logSearchButton')).toBeDisabled();
  await page.locator('#logSearchForm').evaluate(node => node.requestSubmit()); expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1);
  await page.reload(); await expect(page.getByRole('button', { name: '검색 상태 재확인' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1'))).toBe(id);
  f.override(null); await page.getByRole('button', { name: '검색 상태 재확인' }).click(); await complete(page);
  expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1); expect(f.requests.filter(r => r.action === 'cancel')).toHaveLength(0);
  expect(await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1'))).toBeNull(); expect(f.errors).toEqual([]);
});

test('CS log partial-file failure is never presented as an empty successful search', async ({ page }, info) => {
  const f = await fixture(page, info); f.mode('partial'); await open(page); await search(page); await complete(page);
  await expect(page.locator('#logScanWarning')).toHaveAttribute('data-state-kind', 'error');
  await expect(page.locator('#logResults [data-state-kind="error"]')).toContainText('판단');
  await expect(page.locator('#logMessageBox')).toHaveAttribute('data-state-kind', 'error'); await expect(page.locator('#logCsvButton')).toBeDisabled(); expect(f.errors).toEqual([]);
});

for (const status of [401, 403, 404]) test(`CS log ${status} status clears inaccessible job without reexecuting`, async ({ page }, info) => {
  const f = await fixture(page, info); await open(page);
  f.override(action => action === 'status' ? { status, json: { error: '격리 접근/만료 응답' } } : null);
  await search(page); await expect(page.locator('#logMessageBox')).toHaveAttribute('data-state-kind', status === 404 ? 'error' : 'denied');
  expect(await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1'))).toBeNull();
  await expect(page.locator('#logResultCard')).toBeHidden(); await expect(page.locator('#logCsvButton')).toBeDisabled();
  if (status === 404) await expect(page.locator('#logSearchButton')).toBeEnabled(); else await expect(page.locator('#logSearchButton')).toBeDisabled();
  expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1); expect(f.errors).toEqual([]);
});

test('CS log malformed or mismatched completed result stays retryable and never exports', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page);
  f.transform((action, value) => action === 'status' ? { job: { ...value.job, id: '00000000-0000-0000-0000-000000000000' } } : value);
  await search(page); await expect(page.getByRole('button', { name: '검색 상태 재확인' })).toBeVisible();
  await expect(page.locator('#logResultCard')).toBeHidden(); await expect(page.locator('#logCsvButton')).toBeDisabled();
  f.transform((action, value) => value); await page.getByRole('button', { name: '검색 상태 재확인' }).click(); await complete(page);
  expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1); expect(f.errors).toEqual([]);
});

test('CS log scope change discards private results and ignores delayed search acknowledgement', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page); f.hold('search'); await search(page); await expect.poll(() => f.pending).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event('workspace-entity-scope-change'))); f.release();
  await expect(page.locator('#logMessageBox')).toHaveAttribute('data-state-kind', 'denied'); await expect(page.locator('#logSearchButton')).toBeDisabled();
  await expect(page.locator('#logQuery')).toHaveValue(''); await expect(page.locator('#logResultCard')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1'))).toBeNull(); expect(f.errors).toEqual([]);
});

test('CS log late cancellation reply cannot replace completed results or unlock new search', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page); await search(page); await complete(page);
  // A different query starts a real pending scan; the first completed query remains reusable.
  await page.locator('#logQuery').fill('젬 획득'); const unblock = f.blockScan(); f.hold('cancel'); await search(page);
  await expect(page.locator('#logCancelButton')).toBeEnabled(); await page.locator('#logCancelButton').click(); await expect.poll(() => f.pending).toBe(true);
  unblock(); await expect(page.locator('[data-toast-id="log-result"]')).toContainText('취소되었습니다');await expect(page.locator('#logMessageBox')).toBeHidden();
  await expect(page.locator('#logSearchButton')).toBeEnabled();
  await page.locator('#logQuery').fill('젬'); await search(page); await complete(page);
  f.release(); await expect(page.locator('[data-toast-id="log-result"]')).toBeVisible();await expect(page.locator('#logMessageBox')).toBeHidden();
  await expect(page.locator('#logJobCard')).toBeHidden(); expect(f.errors).toEqual([]);
});

for (const failure of ['html', 'network', 'incomplete']) test(`CS log uncertain start ${failure} cannot automatically resubmit`, async ({ page }, info) => {
  const f = await fixture(page, info); await open(page);
  await page.route('**/api/playfab/log-search/search', route => failure === 'network' ? route.abort() : route.fulfill(failure === 'html' ? { status: 524, contentType: 'text/html', body: '<h1>Proxy timeout</h1>' } : { json: {} }));
  let attempts = 0; page.on('request', req => { if (new URL(req.url()).pathname.endsWith('/log-search/search')) attempts++; });
  await search(page); await expect(page.locator('#logMessageBox')).toContainText('자동 재전송하지 않습니다');
  await expect(page.locator('#logSearchButton')).toBeDisabled(); await expect(page.locator('#logResultCard')).toBeHidden();
  await page.locator('#logSearchForm').evaluate(node => node.requestSubmit()); expect(attempts).toBe(1); expect(f.errors).toEqual([]);
});

test('CS log setup read failure retries settings only and retains entered conditions', async ({ page }, info) => {
  const f = await fixture(page, info); f.override(action => action === 'config' ? { status: 503, json: { error: '설정 읽기 실패' } } : null);
  await page.goto('https://cs.workspace.test/logs'); await expect(page.getByRole('button', { name: '설정 다시 확인' })).toBeVisible();
  await page.locator('#logQuery').fill('보존할 검색어'); f.override(null);
  await page.getByRole('button', { name: '설정 다시 확인' }).click(); await expect(page.locator('#logSearchButton')).toBeEnabled();
  await expect(page.locator('#logQuery')).toHaveValue('보존할 검색어'); expect(f.requests.filter(r => r.action === 'search')).toHaveLength(0); expect(f.errors).toEqual([]);
});

test('CS log scope change during decoded response clears existing data even when abort is ignored', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page); await search(page); await complete(page);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith('/log-search/search')) {
        const text = await response.text();
        response.text = () => new Promise(resolve => { window.releaseLogText = () => resolve(text); });
      }
      return response;
    };
  });
  await search(page); await page.waitForFunction(() => Boolean(window.releaseLogText));
  await page.evaluate(() => { document.dispatchEvent(new Event('workspace-entity-scope-change')); window.releaseLogText(); });
  await expect(page.locator('#logMessageBox')).toHaveAttribute('data-state-kind', 'denied');
  await expect(page.locator('.log-result')).toHaveCount(0); await expect(page.locator('#logResultCriteria')).toBeEmpty();
  await expect(page.locator('#logSearchButton')).toBeDisabled(); expect(f.requests.filter(r => r.action === 'search')).toHaveLength(2); expect(f.errors).toEqual([]);
});

test('CS log scope change rejects a delayed decoded status response from the common read session', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith('/log-search/status')) {
        const text = await response.text();
        response.text = () => new Promise(resolve => { window.releaseLogStatusText = () => resolve(text); });
      }
      return response;
    };
  });
  await search(page); await page.waitForFunction(() => Boolean(window.releaseLogStatusText));
  await page.evaluate(() => { document.dispatchEvent(new Event('workspace-entity-scope-change')); window.releaseLogStatusText(); });
  await expect(page.locator('#logMessageBox')).toHaveAttribute('data-state-kind', 'denied');
  await expect(page.locator('#logResultCard')).toBeHidden(); await expect(page.locator('#logSearchButton')).toBeDisabled();
  expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1); expect(f.requests.filter(r => r.action === 'status')).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1'))).toBeNull(); expect(f.errors).toEqual([]);
});

test('CS log page disposal ignores delayed response and another owner job is not resumed', async ({ page }, info) => {
  const f = await fixture(page, info); await page.addInitScript(() => sessionStorage.setItem('playfabLogSearchJobId:2', '00000000-0000-0000-0000-000000000002'));
  await open(page); expect(f.requests.filter(r => r.action === 'status')).toHaveLength(0);
  f.hold('search'); await search(page); await expect.poll(() => f.pending).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))); f.release();
  await expect(page.locator('#logResultCard')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1'))).toBeNull(); expect(f.errors).toEqual([]);
});

test('CS log request timeout preserves job and only a manual status read resumes', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page);
  // Shorten only this module's 45s observation timeout; do not accelerate backend jobs or polls.
  await page.evaluate(() => {
    const original = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => original(fn, ms === 45_000 ? 80 : ms, ...args);
  });
  f.hold('status'); await search(page); await expect.poll(() => f.pending).toBe(true);
  await expect(page.getByRole('button', { name: '검색 상태 재확인' })).toBeVisible();
  await expect(page.locator('#logMessageBox')).toContainText('서버 작업 취소를 의미하지 않습니다');
  f.release(); await page.getByRole('button', { name: '검색 상태 재확인' }).click(); await complete(page);
  expect(f.requests.filter(r => r.action === 'search')).toHaveLength(1); expect(f.errors).toEqual([]);
});

test('CS log non-JSON denial during cancellation immediately hides private scope', async ({ page }, info) => {
  const f = await fixture(page, info); await open(page); const unblock = f.blockScan();
  f.override(action => action === 'cancel' ? { status: 403, contentType: 'text/html', body: '<h1>Forbidden</h1>' } : null);
  await search(page); await expect(page.locator('#logCancelButton')).toBeEnabled(); await page.locator('#logCancelButton').click();
  await expect(page.locator('#logMessageBox')).toHaveAttribute('data-state-kind', 'denied'); unblock();
  await expect(page.locator('#logQuery')).toHaveValue(''); await expect(page.locator('#logSearchButton')).toBeDisabled();
  expect(await page.evaluate(() => sessionStorage.getItem('playfabLogSearchJobId:1'))).toBeNull(); expect(f.errors).toEqual([]);
});
