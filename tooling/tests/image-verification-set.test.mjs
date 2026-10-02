import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { imageVerificationSet } from '../image-verification-set.mjs';
import { services } from '../container-smoke.mjs';
import { policy } from '../verification-gate.mjs';
import { root } from '../build-ui.mjs';

const names = Object.keys(services);
const base = { repository: 'synthetic/workspace', commit: 'a'.repeat(40), tree: 'b'.repeat(40), runId: '123', attempt: '2' };
const hash = value => createHash('sha256').update(value).digest('hex');
const ref = 'refs/heads/main';
const receipt = { schema: 'workspace-verification-v1', ...base, event: 'push', ref,
  workflowRef: `${base.repository}/${policy.workflow}@${ref}`, runUrl: `https://github.com/${base.repository}/actions/runs/${base.runId}/attempts/${base.attempt}`,
  policySha256: hash(JSON.stringify(policy)), workflowSha256: hash(readFileSync(resolve(root, policy.workflow), 'utf8').replaceAll('\r\n', '\n')),
  jobs: Object.fromEntries(Object.keys(policy.jobs).map(name => [name, 'success'])), scope: 'ci-verification-only', deploymentApproved: false };
const records = names.map((service, index) => ({ schema: 'workspace-image-verification-v1', ...base, service, image: `workspace-${service}:verify`,
  imageId: `sha256:${String(index + 1).repeat(64)}`, platform: 'linux/amd64', registryDigests: [], scope: 'ci-image-build-and-health-only', deploymentApproved: false }));

test('all exact image records bind to one verified commit without approving deployment', () => {
  const result = imageVerificationSet(records, receipt);
  assert.deepEqual(Object.keys(result.images), [...names].sort());
  assert.equal(result.commit, base.commit); assert.equal(result.registryPinned, false);
  assert.deepEqual(result.missingRegistryDigests, [...names].sort());
  assert.equal(result.scope, 'ci-image-set-only'); assert.equal(result.deploymentApproved, false);
  for (const image of Object.values(result.images)) assert.match(image.sourceRecordSha256, /^[a-f0-9]{64}$/);
});

test('a complete registry digest set is reported but still never becomes deployment approval', () => {
  const pinned = records.map(record => ({ ...record, registryDigests: [`ghcr.io/synthetic/${record.service}@sha256:${'c'.repeat(64)}`] }));
  const result = imageVerificationSet(pinned, receipt);
  assert.equal(result.registryPinned, true); assert.deepEqual(result.missingRegistryDigests, []); assert.equal(result.deploymentApproved, false);
});

test('missing, duplicate, mismatched and mutable records fail closed', () => {
  assert.throws(() => imageVerificationSet(records.slice(1), receipt));
  assert.throws(() => imageVerificationSet(records.map((record, index) => index === 0 ? { ...record, service: records[1].service, image: records[1].image } : record), receipt));
  for (const patch of [{ commit: 'd'.repeat(40) }, { runId: '999' }, { imageId: 'latest' }, { deploymentApproved: true }, { registryDigests: ['latest'] }])
    assert.throws(() => imageVerificationSet(records.map((record, index) => index === 0 ? { ...record, ...patch } : record), receipt));
  assert.throws(() => imageVerificationSet(records, { ...receipt, jobs: { ...receipt.jobs, images: 'failure' } }));
  assert.throws(() => imageVerificationSet(records, { ...receipt, workflowSha256: 'd'.repeat(64) }));
});

test('local CLI cannot manufacture a CI image set', () => {
  const run = spawnSync(process.execPath, ['tooling/image-verification-set.mjs'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' } });
  assert.equal(run.status, 1); assert.match(run.stderr, /GitHub Actions/);
});
