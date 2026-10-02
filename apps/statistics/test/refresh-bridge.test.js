import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRefreshBridge } from '../lib/refresh-bridge.js';
import { handleRefreshMessage } from '../lib/refresh-worker-handler.js';
import { REFRESH_PROTOCOL, publicationRevision, validRefreshReceipt } from '../lib/publication-contract.js';
import { respondToRefresh } from '../lib/refresh-http.js';

const initial = () => ({ status: 'idle', runId: null, startedAt: null, completedAt: null, dataThrough: null,
  nextAt: null, refreshAllowedAt: null, totalProfiles: 0, publishedProfiles: 0, currentProfile: '', error: '', inProgress: false });
const receipt = requestId => ({ ...initial(), runId: requestId, status: 'running', startedAt: '2026-09-11T00:00:00.000Z', inProgress: true });
function fixture(timeoutMs = 1000) {
  const messages = [];
  let callback;
  let worker = { connected: true, send: (message, cb) => { messages.push(message); callback = cb; } };
  const bridge = createRefreshBridge({ getWorker: () => worker, getPublication: initial, timeoutMs });
  return { bridge, messages, get worker() { return worker; }, replace() { worker = { ...worker }; },
    failSend: () => callback(new Error('IPC failed')),
    accept: (index = messages.length - 1) => bridge.receive(worker, { type: 'refresh-result', protocol: REFRESH_PROTOCOL,
      requestId: messages[index].requestId, ok: true, publication: receipt(messages[index].requestId) }) };
}

test('publication revision changes for a new run/state, not progress or schedule ticks', () => {
  const value = initial();
  assert.equal(publicationRevision(value), publicationRevision({ ...value, publishedProfiles: 2, currentProfile: '진행', nextAt: '2026-09-12T00:00:00Z' }));
  for (const [field, replacement] of Object.entries({ runId: 'run', status: 'running', startedAt: 'now', completedAt: 'now', dataThrough: 'now' })) {
    assert.notEqual(publicationRevision(value), publicationRevision({ ...value, [field]: replacement }));
  }
});

test('IPC send is not acceptance; exact worker and request receipt are required', async () => {
  const f = fixture();
  const request = f.bridge.request({ force: true, enforceCooldown: true });
  let settled = false;
  void request.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.messages[0].expectedRevision, publicationRevision(initial()));
  assert.equal(f.messages[0].force, true);
  assert.equal(f.bridge.receive({}, { type: 'refresh-result', requestId: f.messages[0].requestId }), false);
  assert.equal(f.bridge.receive(f.worker, { type: 'refresh-result', requestId: 'old' }), false);
  await assert.rejects(f.bridge.request(), { statusCode: 409 });
  assert.equal(f.messages.length, 1);
  f.accept();
  assert.deepEqual(await request, receipt(f.messages[0].requestId));
});

test('receipt validates complete publication and consistent running/finished state', () => {
  const id = 'a1111111-1111-4111-8111-111111111111';
  assert.equal(validRefreshReceipt(receipt(id), id), true);
  for (const field of Object.keys(receipt(id))) {
    const incomplete = receipt(id); delete incomplete[field];
    assert.equal(validRefreshReceipt(incomplete, id), false, field);
  }
  for (const change of [{ runId: 'other' }, { status: 'queued' }, { inProgress: false }, { startedAt: 'bad' }, { totalProfiles: -1 }, { publishedProfiles: 1.5 }, { completedAt: 17 }]) {
    assert.equal(validRefreshReceipt({ ...receipt(id), ...change }, id), false);
  }
  assert.equal(validRefreshReceipt({ ...receipt(id), status: 'ready', inProgress: false }, id), false);
  assert.equal(validRefreshReceipt({ ...receipt(id), status: 'ready', inProgress: false,
    completedAt: '2026-09-11T00:01:00Z', dataThrough: '2026-09-11T00:00:00Z' }, id), true);
});

for (const failure of ['timeout', 'send', 'disconnect', 'malformed', 'unknown']) {
  test(`${failure}: uncertain acceptance blocks repeats; a late exact receipt reconciles without resending`, async () => {
    const f = fixture(failure === 'timeout' ? 15 : 1000);
    const result = f.bridge.request();
    const rejected = assert.rejects(result, error => error.outcome === 'unknown');
    if (failure === 'send') f.failSend();
    if (failure === 'disconnect') f.bridge.disconnect(f.worker);
    if (failure === 'malformed') f.bridge.receive(f.worker, { type: 'refresh-result', protocol: REFRESH_PROTOCOL,
      requestId: f.messages[0].requestId, ok: true, publication: { ok: true } });
    if (failure === 'unknown') f.bridge.receive(f.worker, { type: 'refresh-result', protocol: REFRESH_PROTOCOL,
      requestId: f.messages[0].requestId, ok: false, status: 500, message: 'unknown' });
    await rejected;
    await assert.rejects(f.bridge.request(), { statusCode: 409 });
    assert.equal(f.messages.length, 1);
    f.accept();
    const next = f.bridge.request();
    f.accept();
    await next;
    assert.equal(f.messages.length, 2);
  });
}

test('replacing a disconnected worker allows a new request; old worker receipts cannot release it', async () => {
  const f = fixture();
  const oldWorker = f.worker;
  const first = f.bridge.request();
  const rejected = assert.rejects(first, { outcome: 'unknown' });
  f.bridge.disconnect(oldWorker);
  await rejected;
  f.replace();
  const next = f.bridge.request();
  assert.equal(f.bridge.receive(oldWorker, { type: 'refresh-result', protocol: REFRESH_PROTOCOL,
    requestId: f.messages[1].requestId, ok: true, publication: receipt(f.messages[1].requestId) }), false);
  await assert.rejects(f.bridge.request(), { statusCode: 409 });
  f.accept(); await next;
});

test('worker replies after acceptance, forwarding only fixed flags and exact queue revision', async () => {
  const id = 'a1111111-1111-4111-8111-111111111111';
  let resolve, options;
  const replies = [];
  const pending = handleRefreshMessage({ type: 'refresh', protocol: REFRESH_PROTOCOL, requestId: id,
    force: false, enforceCooldown: true, expectedRevision: publicationRevision(initial()) }, {
    analytics: { requestPublishedRefresh: value => { options = value; return new Promise(done => { resolve = done; }); } }, send: message => replies.push(message)
  });
  assert.equal(replies.length, 0);
  assert.deepEqual(options, { force: false, enforceCooldown: true, requestId: id,
    expectedRevision: publicationRevision(initial()), rejectIfRunning: true });
  resolve(receipt(id)); await pending;
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].publication, receipt(id));
});

test('worker rejects malformed requests without executing and hides internal failures', async () => {
  const base = { type: 'refresh', protocol: REFRESH_PROTOCOL, requestId: 'a1111111-1111-4111-8111-111111111111',
    force: false, enforceCooldown: true, expectedRevision: publicationRevision(initial()) };
  let calls = 0;
  const replies = [], logs = [];
  const options = { analytics: { requestPublishedRefresh: () => { calls++; throw new Error('private credentials'); } }, send: value => replies.push(value), log: value => logs.push(value) };
  for (const patch of [{ protocol: 'bad' }, { force: 'true' }, { enforceCooldown: undefined }, { expectedRevision: 'bad' }]) await handleRefreshMessage({ ...base, ...patch }, options);
  assert.equal(calls, 0);
  assert.ok(replies.every(value => value.status === 422));
  assert.equal(await handleRefreshMessage({ ...base, requestId: 'bad' }, options), false);
  await handleRefreshMessage(base, options);
  assert.equal(calls, 1);
  assert.equal(replies.at(-1).status, 500);
  assert.doesNotMatch(JSON.stringify(replies), /private credentials/);
  assert.match(logs[0], /private credentials/);
});

test('real HTTP response waits for worker acceptance; current admin check and worker cooldown survive', async t => {
  const f = fixture();
  const server = http.createServer(async (req, res) => {
    const respond = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
    try {
      await respondToRefresh({ user: { isAdmin: req.headers['x-test-role'] === 'admin' }, force: req.url.includes('force=1'),
        requestRefresh: value => f.bridge.request(value), respond });
    } catch (error) { respond(error.statusCode || 500, { error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/analytics/refresh`;
  assert.equal((await fetch(`${url}?force=1`, { method: 'POST' })).status, 403);
  assert.equal(f.messages.length, 0);
  const request = fetch(url, { method: 'POST' });
  let resolved = false;
  void request.then(() => { resolved = true; });
  await waitUntil(() => f.messages.length === 1);
  assert.equal(resolved, false);
  f.accept();
  const response = await request;
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.acceptance, 'accepted');
  assert.equal(payload.publication.status, 'running');
  const cooldown = fetch(url, { method: 'POST', headers: { 'x-test-role': 'admin' } });
  await waitUntil(() => f.messages.length === 2);
  await handleRefreshMessage(f.messages[1], { analytics: { requestPublishedRefresh: async () => {
    throw Object.assign(new Error('잠시 후 갱신 가능'), { statusCode: 429, retryAt: '2026-09-11T01:00:00Z' });
  } }, send: value => f.bridge.receive(f.worker, value) });
  const cooldownResponse = await cooldown;
  assert.equal(cooldownResponse.status, 429);
  assert.deepEqual(await cooldownResponse.json(), { error: '잠시 후 갱신 가능', retryAt: '2026-09-11T01:00:00Z', canForce: true });
});

async function waitUntil(predicate) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('request not dispatched');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
