import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { createSignedToken } from '../lib/company-auth.js';

const secret = '0123456789abcdef0123456789abcdef0123456789abcdef';

test('Company Portal 로그인과 statistics 권한을 거친 뒤 대시보드에 접근한다', async t => {
  const port = await freePort();
  let portalStatus=204;
  const portal=http.createServer((req,res)=>{
    assert.equal(req.url,'/api/internal/workspace/session');
    const payload=JSON.parse(Buffer.from(req.headers.authorization.slice(7).split('.')[0],'base64url'));
    assert.equal(payload.aud,'workspace-session'); assert.equal(payload.sid,'test-session');
    res.writeHead(portalStatus); res.end();
  });
  await new Promise(resolve=>portal.listen(0,'127.0.0.1',resolve));
  t.after(()=>portal.close());

  const internalPort = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      STATISTICS_INTERNAL_PORT: String(internalPort),
      COMPANY_PORTAL_URL: 'http://127.0.0.1:5090',
      COMPANY_PORTAL_INTERNAL_URL: `http://127.0.0.1:${portal.address().port}`,
      COMPANY_SSO_ISSUER: 'company-portal',
      COMPANY_SSO_SHARED_SECRET: secret,
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
      STATISTICS_SESSION_CACHE_MS: '10',
      STATISTICS_SESSION_FAILURE_CACHE_MS: '10'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  await waitForHealth(port, child);

  const direct = await fetch(`http://127.0.0.1:${port}/?range=7d`, { redirect: 'manual' });
  assert.equal(direct.status, 303);
  const login = new URL(direct.headers.get('location'));
  assert.equal(login.pathname, '/Auth/Statistics');
  assert.equal(login.searchParams.get('returnUrl'), '/?range=7d');

  const now = Math.floor(Date.now() / 1000);
  const invalidToken = createSignedToken({ iss: 'company-portal', aud: 'statistics', sub: 'invalid', name: '누락 계정', permissions: ['statistics.access'], iat: now, exp: now + 60, jti: 'gateway-invalid-jti', returnUrl: '/' }, secret);
  const rejected = await fetch(`http://127.0.0.1:${port}/auth/sso/callback`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: invalidToken }) });
  assert.equal(rejected.status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);

  const token = createSignedToken({ iss: 'company-portal', aud: 'statistics', sub: '7', sid: 'test-session', name: '통계 담당자', email: 'stats@example.com', role: 'admin', permissions: ['statistics.access'], iat: now, exp: now + 60, jti: 'gateway-test-jti', returnUrl: '/' }, secret);
  const callback = await fetch(`http://127.0.0.1:${port}/auth/sso/callback`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  assert.equal(callback.status, 303);
  const cookie = callback.headers.get('set-cookie').split(';')[0];

  const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /라이브 대시보드/);

  const stylesheet = await fetch(`http://127.0.0.1:${port}/styles.css?v=test`, { headers: { Cookie: cookie } });
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('cache-control'), /no-store/);

  for (const route of ['/results', '/builds', '/builds/detail', '/bosses', '/bosses/detail']) {
    const detailPage = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { Cookie: cookie } });
    assert.equal(detailPage.status, 200);
  }

  const skillImage = await fetch(`http://127.0.0.1:${port}/assets/entities/skills/40.png`, { headers: { Cookie: cookie } });
  assert.equal(skillImage.status, 200);
  assert.equal(skillImage.headers.get('content-type'), 'image/png');
  assert.ok((await skillImage.arrayBuffer()).byteLength > 100);

  const skinImage = await fetch(`http://127.0.0.1:${port}/assets/entities/skins/0/2.png`, { headers: { Cookie: cookie } });
  assert.equal(skinImage.status, 200);
  assert.equal(skinImage.headers.get('content-type'), 'image/png');
  assert.ok((await skinImage.arrayBuffer()).byteLength > 100);

  const middleBossImage = await fetch(`http://127.0.0.1:${port}/assets/entities/bosses/E001.png`, { headers: { Cookie: cookie } });
  assert.equal(middleBossImage.status, 200);
  assert.ok((await middleBossImage.arrayBuffer()).byteLength > 100);

  for (const assetPath of [
    '/assets/entities/nodes/0/0.png',
    '/assets/entities/nodes/3/111.png',
    '/assets/entities/artifacts/normal-383.png'
  ]) {
    const addedImage = await fetch(`http://127.0.0.1:${port}${assetPath}`, { headers: { Cookie: cookie } });
    assert.equal(addedImage.status, 200);
    assert.equal(addedImage.headers.get('content-type'), 'image/png');
    assert.ok((await addedImage.arrayBuffer()).byteLength > 100);
  }

  const config = await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Cookie: cookie } });
  assert.equal(config.status, 200);
  const configPayload = await config.json();
  assert.equal(configPayload.currentUser.name, '통계 담당자');
  assert.equal(configPayload.currentUser.role, 'admin');
  assert.equal(configPayload.currentUser.isAdmin, true);
  assert.equal(configPayload.masterData.characters.find(item => item.name === '광전사').id, 21);
  assert.equal(configPayload.masterData.bosses.find(item => item.name === '탐욕').code, 'B001');
  const publicationStatus = await fetch(`http://127.0.0.1:${port}/api/analytics/publication`, { headers: { Cookie: cookie } });
  assert.equal(publicationStatus.status, 200);
  assert.equal(typeof (await publicationStatus.json()).publication.inProgress, 'boolean');

  const employeeToken = createSignedToken({ iss: 'company-portal', aud: 'statistics', sub: '8', sid: 'test-session', name: '일반 담당자', email: 'employee@example.com', role: 'employee', permissions: ['statistics.access'], iat: now, exp: now + 60, jti: 'gateway-employee-jti', returnUrl: '/' }, secret);
  const employeeCallback = await fetch(`http://127.0.0.1:${port}/auth/sso/callback`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: employeeToken }) });
  const employeeCookie = employeeCallback.headers.get('set-cookie').split(';')[0];
  const employeeConfig = await (await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Cookie: employeeCookie } })).json();
  assert.equal(employeeConfig.currentUser.isAdmin, false);
  const spoofedHeaders = { Cookie: employeeCookie, 'x-company-user-id': '7', 'x-company-user-role': 'master' };
  const spoofedConfig = await (await fetch(`http://127.0.0.1:${port}/api/config`, { headers: spoofedHeaders })).json();
  assert.equal(spoofedConfig.currentUser.id, '8');
  assert.equal(spoofedConfig.currentUser.isAdmin, false);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/analytics/refresh?force=1`, { method: 'POST', headers: spoofedHeaders })).status, 403);
  const employeeRefresh = await fetch(`http://127.0.0.1:${port}/api/analytics/refresh`, { method: 'POST', headers: { Cookie: employeeCookie } });
  assert.equal(employeeRefresh.status, 202);
  const rejectedForce = await fetch(`http://127.0.0.1:${port}/api/analytics/refresh?force=1`, { method: 'POST', headers: { Cookie: employeeCookie } });
  assert.equal(rejectedForce.status, 403);
  const adminRefresh = await fetch(`http://127.0.0.1:${port}/api/analytics/refresh?force=1`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(adminRefresh.status, 202);
  portalStatus=401;
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`,{headers:{Cookie:cookie}})).status,401);
  portalStatus=503;
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`,{headers:{Cookie:cookie}})).status,503);
});

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(port, child) {
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  for (let index = 0; index < 50; index += 1) {
    if (child.exitCode !== null) throw new Error(`게이트웨이 프로세스 종료: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`게이트웨이 시작 시간 초과: ${output}`);
}
