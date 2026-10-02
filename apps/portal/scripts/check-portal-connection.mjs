// Run inside each Node service container, using its actual runtime and network.
// No credentials: 401 proves routing and host filtering reached the auth endpoint.
const base = process.env.COMPANY_PORTAL_INTERNAL_URL || 'http://company-portal:8080';
try {
  const response = await fetch(base.replace(/\/$/, '') + '/api/internal/workspace/session', {
    headers: { Host: 'company.example.com' },
    redirect: 'error', signal: AbortSignal.timeout(5000)
  });
  await response.body?.cancel();
  if (response.status !== 401) throw new Error('Expected unauthenticated HTTP 401, received ' + response.status);
  console.log('PASS: internal Portal session endpoint reachable; unauthenticated access rejected (401).');
} catch (error) {
  console.error('FAIL: Portal dependency check:', error.message, error.cause?.code || '');
  process.exitCode = 1;
}
