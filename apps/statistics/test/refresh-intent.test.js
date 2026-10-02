import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { respondToRefreshIntent, refreshContext } from '../lib/refresh-request.js';
import { REFRESH_PROTOCOL, REFRESH_MEDIA_TYPE, readRefreshContext, readRefreshReceipt } from '../public/refresh-contract.js';
const user = { id: '9007199254740993', role: 'admin', isAdmin: true };
const publication = { status: 'idle', runId: null, startedAt: null, completedAt: null, nextAt: null, dataThrough: null,
  refreshAllowedAt: null, inProgress: false, totalProfiles: 0, publishedProfiles: 0, currentProfile: '', error: '' };
const context = refreshContext({ user, mode: 'live', titleId: 'TEST', publication, available: true, pending: false });
const intent = { protocol: REFRESH_PROTOCOL, requestId: 'a1111111-1111-4111-8111-111111111111', expectedUserId: user.id,
  expectedRole: user.role, mode: 'live', titleId: 'TEST', force: true, expectedRevision: context.revision };
async function send(value, { headers = {}, actor = user, execute } = {}) {
  const req = Readable.from([Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]);
  req.headers = { 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/json', ...headers };
  let writes = 0, response;
  await respondToRefreshIntent({ req, user: actor, mode: 'live', titleId: 'TEST', requestRefresh: async options => {
    writes++; if (execute) return execute(options);
    return { ...publication, runId: options.requestId, status: 'running', startedAt: '2026-09-11T00:00:00Z', inProgress: true };
  }, respond: (status, body, type) => { response = { status, body, type }; } });
  return { ...response, writes };
}
test('enhanced intent preserves exact large account ID and complete queue acceptance receipt', async () => {
  assert.equal(readRefreshContext(context, user), context);
  assert.throws(()=>readRefreshContext({...context,user:{...user,role:'employee'}},user),{status:403});
  const result = await send(intent, { execute: options => {
    assert.deepEqual(options, { force: true, enforceCooldown: true, requestId: intent.requestId, expectedRevision: intent.expectedRevision, rejectIfRunning: true });
    return { ...publication, runId: options.requestId, status: 'running', startedAt: '2026-09-11T00:00:00Z', inProgress: true };
  } });
  assert.equal(result.status, 202); assert.equal(result.type, REFRESH_MEDIA_TYPE); assert.equal(result.writes, 1);
  assert.equal(readRefreshReceipt(result.body, intent).runId, intent.requestId);
  for (const key of ['protocol','requestId','user','mode','titleId','expectedRevision','force','acceptance','publication']) {
    const wrong = { ...result.body }; delete wrong[key]; assert.throws(() => readRefreshReceipt(wrong, intent), key);
  }
  for (const key of ['protocol','user','mode','titleId','revision','serverTime','available','pending','publication']) {
    const wrong = { ...context }; delete wrong[key]; assert.throws(() => readRefreshContext(wrong, user), key);
  }
});
for (const [label, patch, status] of [
  ['account', { expectedUserId: '9007199254740992' }, 403], ['numeric account', { expectedUserId: Number(user.id) }, 403],
  ['role', { expectedRole: 'master' }, 403], ['mode', { mode: 'demo' }, 409], ['title', { titleId: 'OTHER' }, 409],
  ['id', { requestId: 'bad' }, 422], ['revision', { expectedRevision: 'bad' }, 422], ['force', { force: 'true' }, 422]
]) test(`changed/invalid ${label} cannot enqueue`, async () => {
  const result = await send({ ...intent, ...patch }); assert.equal(result.status, status); assert.equal(result.writes, 0);
});
test('enhanced endpoint rejects simple/cross-site/malformed/oversized requests and employee force', async () => {
  for (const headers of [{ 'x-requested-with': '' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }]) {
    const result = await send(intent, { headers }); assert.equal(result.status, 403); assert.equal(result.writes, 0);
  }
  for (const body of ['bad json', ' '.repeat(8193)]) { const result = await send(body); assert.equal(result.status, 422); assert.equal(result.writes, 0); }
  const employee = { ...user, role: 'employee', isAdmin: false };
  const result = await send({ ...intent, expectedRole: 'employee' }, { actor: employee }); assert.equal(result.status, 403); assert.equal(result.writes, 0);
});
test('definite worker refusal differs from unknown effects and never exposes private failures', async () => {
  for (const statusCode of [409,422,429,500]) {
    const result = await send(intent, { execute: () => { throw Object.assign(Error('private failure'), { statusCode }); } });
    assert.equal(result.body.outcome, statusCode === 500 ? 'unknown' : statusCode === 409 ? 'conflict' : 'invalid');
    if (statusCode === 500) assert.doesNotMatch(JSON.stringify(result.body), /private failure/);
  }
});
