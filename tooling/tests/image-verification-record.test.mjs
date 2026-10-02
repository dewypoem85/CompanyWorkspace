import test from 'node:test';
import assert from 'node:assert/strict';
import { imageVerificationRecord, normalizeInspect, parseArguments } from '../image-verification-record.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const inspect = { id: imageId, os: 'linux', architecture: 'amd64', repoDigests: [] };
const context = { repository: 'synthetic/workspace', sha: 'b'.repeat(40), runId: '123', attempt: '2' };
const checkout = { sha: context.sha, tree: 'c'.repeat(40), clean: true };

test('only the service-specific verification tag is accepted', () => {
  assert.deepEqual(parseArguments(['--service', 'portal', '--image', 'workspace-portal:verify']), { service: 'portal', image: 'workspace-portal:verify' });
  for (const args of [[], ['--service', 'unknown', '--image', 'workspace-unknown:verify'], ['--service', 'portal', '--image', 'workspace-leave:verify'], ['--service', 'portal', '--image', 'registry.test/portal@sha256:' + 'd'.repeat(64)]])
    assert.throws(() => parseArguments(args));
});

test('image inspection requires a content-addressed Linux image and valid optional registry digests', () => {
  assert.deepEqual(normalizeInspect(inspect), { imageId, platform: 'linux/amd64', registryDigests: [] });
  const repoDigest = `registry.test/workspace/portal@sha256:${'d'.repeat(64)}`;
  assert.deepEqual(normalizeInspect({ ...inspect, architecture: 'arm64', repoDigests: [repoDigest] }).registryDigests, [repoDigest]);
  for (const patch of [{ id: 'latest' }, { os: 'windows' }, { architecture: '386' }, { repoDigests: null }, { repoDigests: ['latest'] }])
    assert.throws(() => normalizeInspect({ ...inspect, ...patch }));
});

test('record binds exact clean commit, tree, run and image but never approves deployment', () => {
  const record = imageVerificationRecord({ service: 'portal', image: 'workspace-portal:verify', inspect, context, checkout });
  assert.equal(record.commit, context.sha);
  assert.equal(record.tree, checkout.tree);
  assert.equal(record.imageId, imageId);
  assert.equal(record.scope, 'ci-image-build-and-health-only');
  assert.equal(record.deploymentApproved, false);
  assert.deepEqual(record.registryDigests, []);
});

test('mismatched identity, dirty source and malformed CI context fail closed', () => {
  const make = (overrides = {}) => imageVerificationRecord({ service: 'portal', image: 'workspace-portal:verify', inspect, context, checkout, ...overrides });
  assert.throws(() => make({ checkout: { ...checkout, sha: 'd'.repeat(40) } }));
  assert.throws(() => make({ checkout: { ...checkout, clean: false } }));
  for (const patch of [{ repository: '../outside' }, { sha: 'main' }, { runId: '0' }, { attempt: '../1' }])
    assert.throws(() => make({ context: { ...context, ...patch } }));
});
