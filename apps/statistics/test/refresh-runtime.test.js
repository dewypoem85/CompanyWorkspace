import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validRefreshReceipt } from '../lib/publication-contract.js';
import { REFRESH_PROTOCOL, REFRESH_MEDIA_TYPE, readRefreshContext, readRefreshReceipt } from '../public/refresh-contract.js';

test('actual app-server and analytics-worker exchange acceptance over IPC without production network or data', { timeout: 30_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-refresh-runtime-'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const completedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  await fs.writeFile(path.join(directory, 'statistics-publication-state.json'), JSON.stringify({ completedAt }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(key)));
  Object.assign(env, { HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
    STATISTICS_DATA_DIR: directory, STATISTICS_INTERNAL_GATEWAY_USERNAME: 'fixture', STATISTICS_INTERNAL_GATEWAY_PASSWORD: 'synthetic',
    AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT: 'storagefixture', AZURE_PLAYFAB_LOG_CONTAINER: 'logs',
    AZURE_PLAYFAB_LOG_SAS_TOKEN: 'sp=rl&sig=synthetic', PLAYFAB_LIVE_TITLE_ID: 'FIXTURE' });
  const child = spawn(process.execPath, ['--import', new URL('../test-support/empty-azure-loader.js', import.meta.url).href, 'app-server.js'], {
    cwd: new URL('..', import.meta.url), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  // The forked worker inherits these pipes. 'exit' alone can precede its SQLite
  // close on Windows; wait for 'close' before removing the isolated data tree.
  const closed = once(child, 'close');
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await fs.rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Basic ${Buffer.from('fixture:synthetic').toString('base64')}`,
    'x-company-user-id': '9007199254740993', 'x-company-user-role': 'employee' };
  const started = await poll(async () => {
    assert.equal(child.exitCode, null, output);
    try {
      const response = await fetch(`${origin}/health`);
      const health = await response.json();
      return health.worker.connected && health.publication.status === 'error' && health;
    } catch { return false; }
  });
  assert.equal(started.publication.completedAt, completedAt);
  assert.equal((await fetch(`${origin}/api/analytics/refresh`, { method: 'POST' })).status, 401);
  const cooldown = await fetch(`${origin}/api/analytics/refresh`, { method: 'POST', headers });
  assert.equal(cooldown.status, 429);
  const cooldownBody = await cooldown.json();
  assert.equal(cooldownBody.canForce, false);
  assert.equal(cooldownBody.retryAt, new Date(Date.parse(completedAt) + 60 * 60_000).toISOString());
  assert.equal((await fetch(`${origin}/api/analytics/refresh?force=1`, { method: 'POST', headers })).status, 403);
  const accepted = await fetch(`${origin}/api/admin/analytics/refresh?force=1`, { method: 'POST', headers: { ...headers, 'x-company-user-role': 'admin' } });
  assert.equal(accepted.status, 202, output);
  const value = await accepted.json();
  assert.equal(value.acceptance, 'accepted');
  assert.equal(validRefreshReceipt(value.publication, value.publication.runId), true);
  assert.notEqual(value.publication.runId, started.publication.runId);
  const duplicate = await fetch(`${origin}/api/analytics/refresh?force=1`, { method: 'POST', headers: { ...headers, 'x-company-user-role': 'admin' } });
  assert.equal(duplicate.status, 409);
  const failed = await poll(async () => {
    const publication = (await (await fetch(`${origin}/api/analytics/publication`, { headers })).json()).publication;
    return publication.runId === value.publication.runId && !publication.inProgress && publication;
  });
  assert.equal(failed.status, 'error');
  assert.equal(failed.completedAt, completedAt, 'an accepted but failed run preserves the last completed dataset');
  const adminHeaders={...headers,'x-company-user-role':'admin'};
  const contextResponse=await fetch(`${origin}/api/analytics/refresh-context?expectedUserId=9007199254740993`,{headers:adminHeaders});
  assert.equal(contextResponse.status,200);
  const context=readRefreshContext(await contextResponse.json(),{id:'9007199254740993',role:'admin'});
  const intent={protocol:REFRESH_PROTOCOL,requestId:'a3333333-3333-4333-8333-333333333333',expectedUserId:context.user.id,
    expectedRole:context.user.role,mode:context.mode,titleId:context.titleId,expectedRevision:context.revision,force:true};
  const postHeaders={...adminHeaders,Accept:REFRESH_MEDIA_TYPE,'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'};
  const changed=await fetch(`${origin}/api/analytics/refresh`,{method:'POST',headers:postHeaders,body:JSON.stringify({...intent,expectedUserId:'other'})});
  assert.equal(changed.status,403);
  const enhanced=await fetch(`${origin}/api/analytics/refresh`,{method:'POST',headers:postHeaders,body:JSON.stringify(intent)});
  assert.equal(enhanced.status,202);assert.match(enhanced.headers.get('content-type'),/vnd.company.statistics-refresh/);
  assert.equal(readRefreshReceipt(await enhanced.json(),intent).runId,intent.requestId);
  await poll(async()=>{const p=(await(await fetch(`${origin}/api/analytics/publication`,{headers})).json()).publication;return p.runId===intent.requestId&&!p.inProgress;});
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.doesNotMatch(output, /Unexpected external request/);
});

async function poll(read) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const value = await read(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('isolated worker did not reach expected state');
}
