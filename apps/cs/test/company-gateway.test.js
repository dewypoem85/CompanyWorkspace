import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createSignedToken } from '../lib/company-auth.js';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const secret = '0123456789abcdef0123456789abcdef0123456789abcdef';

test('Company Portal SSO가 경로, 단일 CS 권한, 실제 직원 정보를 게이트웨이에 연결한다', { timeout: 20_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cs-company-gateway-test-'));
  const port = await getFreePort();
  let portalStatus=204;
  const portal=http.createServer((req,res)=>{
    assert.equal(req.url,'/api/internal/workspace/session');
    const payload=JSON.parse(Buffer.from(req.headers.authorization.slice(7).split('.')[0],'base64url'));
    assert.equal(payload.aud,'workspace-session'); assert.equal(payload.sid,'test-session');
    res.writeHead(portalStatus); res.end();
  });
  await new Promise(resolve=>portal.listen(0,'127.0.0.1',resolve));
  t.after(()=>portal.close());

  let internalPort = await getFreePort();
  while (internalPort === port) internalPort = await getFreePort();
  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CS_INTERNAL_PORT: String(internalPort),
      CS_DATA_DIR: dataDir,
      COMPANY_PORTAL_URL: 'https://company.example.com',
      COMPANY_PORTAL_INTERNAL_URL: `http://127.0.0.1:${portal.address().port}`,
      COMPANY_SSO_ISSUER: 'company-portal',
      COMPANY_SSO_SHARED_SECRET: secret,
      CS_SESSION_MINUTES: '5',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
      STEAM_PUBLISHER_KEY: '',
      STEAM_REFUND_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await rm(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child, () => output);

  const direct = await fetch(`${baseUrl}/playfab-logs.html?range=6h`, { redirect: 'manual' });
  assert.equal(direct.status, 303);
  const directLocation = new URL(direct.headers.get('location'));
  assert.equal(directLocation.origin, 'https://company.example.com');
  assert.equal(directLocation.pathname.toLowerCase(), '/auth/cs');
  assert.equal(directLocation.searchParams.get('returnUrl'), '/playfab-logs.html?range=6h');

  const apiLogin = await fetch(`${baseUrl}/api/config`, {
    headers: { 'X-CS-Return-Url': '/product-commands.html?environment=test' }
  });
  assert.equal(apiLogin.status, 401);
  const apiLoginUrl = new URL((await apiLogin.json()).loginUrl);
  assert.equal(apiLoginUrl.searchParams.get('returnUrl'), '/product-commands.html?environment=test');

  const now = Math.floor(Date.now() / 1000);
  const deniedToken = createSignedToken(companyPayload(now, {
    permissions: [],
    jti: 'denied-token'
  }), secret);
  const denied = await postToken(`${baseUrl}/auth/sso/callback`, deniedToken);
  assert.equal(denied.status, 403);

  const token = createSignedToken(companyPayload(now, {
    permissions: ['cs.access'],
    returnUrl: '/playfab-logs.html?range=6h',
    jti: 'valid-token'
  }), secret);
  const callback = await postToken(`${baseUrl}/auth/sso/callback`, token);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), '/playfab-logs.html?range=6h');
  const sessionCookie = cookiePair(callback.headers.get('set-cookie'));
  assert.match(sessionCookie, /^CsSession=/);

  const replay = await postToken(`${baseUrl}/auth/sso/callback`, token);
  assert.equal(replay.status, 401);

  const agingSession = createSignedToken({
    iss: 'company-cs-gateway',
    aud: 'cs-session',
    sub: '15', sid: 'test-session',
    name: '홍길동',
    email: 'hong@example.com',
    permissions: ['cs.access'],
    iat: now - 240,
    exp: now + 60,
    jti: 'aging-session'
  }, secret);
  const renewal = await fetch(`${baseUrl}/api/config`, {
    headers: { Cookie: `CsSession=${agingSession}` }
  });
  assert.equal(renewal.status, 200);
  assert.match(renewal.headers.get('set-cookie') || '', /CsSession=/);

  const configResponse = await fetch(`${baseUrl}/api/config`, {
    headers: {
      Cookie: sessionCookie,
      'X-Company-User-Id': '999',
      'X-Company-User-Name': encodeURIComponent('공격자'),
      'X-Company-User-Email': encodeURIComponent('attacker@example.com'),
      'X-CS-Return-Url': '/playfab-logs.html?range=6h'
    }
  });
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.deepEqual(config.currentUser, {
    id: '15',
    name: '홍길동',
    email: 'hong@example.com'
  });

  for (const pagePath of ['/', '/product-commands.html', '/playfab-logs.html', '/player-data.html']) {
    const page = await fetch(`${baseUrl}${pagePath}`, { headers: { Cookie: sessionCookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.doesNotMatch(html, /href="\/auth\/company-home"/);
    assert.match(html, /cw-sidebar/);
    assert.doesNotMatch(html, /href="\/auth\/logout"/);
  }

  const diffModule = await fetch(`${baseUrl}/text-diff.js`, { headers: { Cookie: sessionCookie } });
  assert.equal(diffModule.status, 200);
  assert.match(diffModule.headers.get('content-type'), /^text\/javascript/);
  assert.match(await diffModule.text(), /export function diffTextLines/);

  const csrfCookie = cookiePair(configResponse.headers.get('set-cookie'));
  const secondTabConfigResponse = await fetch(`${baseUrl}/api/config`, {
    headers: { Cookie: `${sessionCookie}; ${csrfCookie}` }
  });
  assert.equal(secondTabConfigResponse.status, 200);
  const secondTabConfig = await secondTabConfigResponse.json();
  assert.equal(secondTabConfig.csrfToken, config.csrfToken);
  assert.doesNotMatch(secondTabConfigResponse.headers.get('set-cookie') || '', /cs_tool_csrf=/);

  for (const asset of ['/steam-transaction-contract.js','/steam-refunds.css']) {
    const resource = await fetch(`${baseUrl}${asset}`, { headers: { Cookie: sessionCookie } });
    assert.equal(resource.status, 200);
  }
  for (const action of ['query','refund']) {
    const missingCsrf = await fetch(`${baseUrl}/api/transactions/${action}`, {
      method: 'POST', headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(missingCsrf.status, 403);
    assert.match((await missingCsrf.json()).error, /보안 토큰/);
    const wrongOrigin = await fetch(`${baseUrl}/api/transactions/${action}`, {
      method: 'POST', headers: { Cookie: `${sessionCookie}; ${csrfCookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': config.csrfToken, Origin: 'https://untrusted.example.test' }, body: '{}'
    });
    assert.equal(wrongOrigin.status, 403);
    assert.match((await wrongOrigin.json()).error, /출처/);
  }

  const refund = await fetch(`${baseUrl}/api/transactions/refund`, {
    method: 'POST',
    headers: {
      Cookie: `${sessionCookie}; ${csrfCookie}`,
      Origin: baseUrl,
      'Content-Type': 'application/json',
      'X-CSRF-Token': config.csrfToken,
      'X-CS-Return-Url': '/'
    },
    body: JSON.stringify({})
  });
  assert.equal(refund.status, 503);
  assert.doesNotMatch((await refund.json()).error, /회사 시스템 권한|CS 접근 권한/);

  const home = await fetch(`${baseUrl}/auth/company-home`, { redirect: 'manual' });
  assert.equal(home.status, 303);
  assert.equal(home.headers.get('location'), 'https://company.example.com');

  portalStatus=401;
  assert.equal((await fetch(`${baseUrl}/api/config`,{headers:{Cookie:sessionCookie}})).status,401);
  portalStatus=503;
  assert.equal((await fetch(`${baseUrl}/api/config`,{headers:{Cookie:sessionCookie}})).status,503);
  portalStatus=204;
  const logout = await fetch(`${baseUrl}/auth/logout`, {
    redirect: 'manual',
    headers: { Cookie: sessionCookie }
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/);
});

function companyPayload(now, overrides = {}) {
  return {
    iss: 'company-portal',
    aud: 'cs',
    sub: '15', sid: 'test-session',
    name: '홍길동',
    email: 'hong@example.com',
    permissions: ['cs.access'],
    iat: now,
    exp: now + 60,
    jti: 'token',
    ...overrides
  };
}

async function postToken(url, token) {
  return fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token })
  });
}

function cookiePair(setCookie) {
  return String(setCookie || '').split(';', 1)[0];
}

async function waitForHealth(baseUrl, child, readOutput) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      assert.fail(`CS 서버가 시작 전에 종료되었습니다.\n${readOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // 서버가 포트를 열 때까지 재시도합니다.
    }
    await delay(100);
  }
  assert.fail(`CS health 확인 시간이 초과되었습니다.\n${readOutput()}`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
