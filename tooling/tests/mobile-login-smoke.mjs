// Run only against an isolated Development Portal database and localhost server.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.MOBILE_TEST_DB;
const baseUrl = process.env.MOBILE_TEST_URL;
assert.ok(baseUrl?.startsWith('http://127.0.0.1:'), 'Test only against localhost.');
assert.ok(dbPath?.includes('.local') && dbPath.endsWith('mobile-auth-test.db'), 'Test only against isolated DB.');
const db = new DatabaseSync(dbPath);
const userId = db.prepare('SELECT Id FROM Users WHERE Email=?').get('mobile-test@example.invalid').Id;
const sourceSession = randomBytes(16).toString('hex');
db.prepare('INSERT INTO WorkspaceSessions(Id,UserId,ExpiresAt) VALUES(?,?,?)')
  .run(sourceSession, userId, Math.floor(Date.now() / 1000) + 3600);

const encoded = bytes => Buffer.from(bytes).toString('base64url');
const hash = value => createHash('sha256').update(value, 'ascii').digest('hex').toUpperCase();
function issue(expires = Math.floor(Date.now() / 1000) + 120) {
  const code = encoded(randomBytes(32));
  const verifier = encoded(randomBytes(32));
  const state = randomBytes(16).toString('hex');
  const challenge = encoded(createHash('sha256').update(verifier, 'ascii').digest());
  db.prepare('INSERT INTO WorkspaceMobileLoginCodes(CodeHash,UserId,SourceSessionId,Challenge,State,ExpiresAtUtc) VALUES(?,?,?,?,?,?)')
    .run(hash(code), userId, sourceSession, challenge, state, expires);
  return [code, verifier, state];
}
async function exchange(values, expected) {
  const response = await fetch(baseUrl + '/mobile/exchange', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(['code', 'verifier', 'state'].map((key, index) => [key, values[index]]))),
  });
  assert.equal(response.status, expected, await response.text());
  return response.headers.get('set-cookie');
}

try {
  const valid = issue();
  const cookie = await exchange(valid, 302);
  assert.match(cookie, /CompanyPortal\.Auth=/);
  const context = await fetch(baseUrl + '/api/workspace/context', { headers: { cookie: cookie.split(';')[0] } });
  assert.equal((await context.json()).authenticated, true);
  const browserVerifier = encoded(randomBytes(32));
  const browserChallenge = encoded(createHash('sha256').update(browserVerifier, 'ascii').digest());
  const browserState = randomBytes(16).toString('hex');
  const authorize = await fetch(baseUrl + '/mobile/authorize?' + new URLSearchParams({ challenge: browserChallenge, state: browserState }), {
    headers: { cookie: cookie.split(';')[0] }, redirect: 'manual',
  });
  assert.equal(authorize.status, 200);
  assert.equal(authorize.headers.get('cache-control'), 'no-store');
  const authPage = await authorize.text();
  const browserCode = authPage.match(/companyworkspace:\/\/auth\?code=([A-Za-z0-9_-]{43})&amp;state=/)?.[1];
  assert.ok(browserCode, 'Browser authorization must return a one-time app link.');
  await exchange([browserCode, browserVerifier, browserState], 302);
  await exchange(valid, 401);

  const wrong = issue();
  await exchange([wrong[0], issue()[1], wrong[2]], 401);
  await exchange([wrong[0], wrong[1], randomBytes(16).toString('hex')], 401);
  await exchange(wrong, 302);
  await exchange(issue(Math.floor(Date.now() / 1000) - 1), 401);

  const revoked = issue();
  db.prepare('UPDATE WorkspaceSessions SET Revoked=1 WHERE Id=?').run(sourceSession);
  await exchange(revoked, 401);
  console.log('mobile login exchange: valid, replay, verifier, state, expiry, revoked session passed');
} finally {
  db.close();
}
