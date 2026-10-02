import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, publishedOrigin, runArguments, services, smoke } from '../container-smoke.mjs';

test('all isolated images have explicit loopback health contracts and synthetic settings', () => {
  assert.deepEqual(Object.keys(services).sort(), ['cs', 'iap', 'leave', 'portal', 'schedule', 'sheet', 'statistics']);
  for (const [service, spec] of Object.entries(services)) {
    assert.ok(Number.isInteger(spec.port) && spec.port > 0, service);
    assert.match(spec.path, /^\/(?:api\/)?health$/, service);
    assert.equal(Object.values(spec.env).some(value => /example\.com|localhost/i.test(value)), false, service);
  }
});

test('arguments accept only a known service and constrained image reference', () => {
  assert.deepEqual(parseArguments(['--service', 'portal', '--image', 'workspace-portal:verify']), { service: 'portal', image: 'workspace-portal:verify' });
  for (const args of [[], ['--service', 'unknown', '--image', 'x:y'], ['--service', 'portal', '--image', 'x;touch'], ['--service', 'portal', '--image', '--bad']])
    assert.throws(() => parseArguments(args));
});

test('docker run publishes one ephemeral loopback port and passes no host secrets', () => {
  const args = runArguments({ service: 'leave', image: 'workspace-leave:verify', name: 'workspace-smoke-leave-id' });
  assert.deepEqual(args.slice(0, 6), ['run', '--detach', '--name', 'workspace-smoke-leave-id', '--publish', '127.0.0.1::8080']);
  assert.equal(args.at(-1), 'workspace-leave:verify');
  assert.equal(args.includes('--env-file'), false);
  assert.equal(args.some(item => /\.env|example\.com/i.test(item)), false);
});

test('published port parser rejects ambiguous, remote and malformed bindings', () => {
  assert.deepEqual(publishedOrigin('127.0.0.1:49152\n', 8080), { origin: 'http://127.0.0.1:49152', containerPort: 8080 });
  for (const output of ['', '0.0.0.0:49152', '[::]:49152', '192.168.0.2:49152', '127.0.0.1:1\n127.0.0.1:2', '127.0.0.1:99999'])
    assert.throws(() => publishedOrigin(output, 8080));
});

test('smoke always removes only its generated container after success and failure', async () => {
  for (const fails of [false, true]) {
    const calls = [];
    const runtime = {
      docker: (...args) => {
        calls.push(args);
        if (args[0] === 'port') return '127.0.0.1:49152';
        return 'container-id';
      },
      waitForHealth: async url => {
        assert.equal(url, 'http://127.0.0.1:49152/health');
        if (fails) throw new Error('synthetic failure');
      }
    };
    if (fails) await assert.rejects(() => smoke({ service: 'portal', image: 'workspace-portal:verify' }, runtime), /synthetic failure/);
    else await smoke({ service: 'portal', image: 'workspace-portal:verify' }, runtime);
    const name = calls[0][3];
    assert.match(name, /^workspace-smoke-portal-[a-f0-9-]+$/);
    assert.deepEqual(calls.at(-1), ['rm', '--force', name]);
  }
});
