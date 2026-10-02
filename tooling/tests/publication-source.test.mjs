import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../build-ui.mjs';
import { services } from '../container-smoke.mjs';
import { imageVerificationSet } from '../image-verification-set.mjs';
import { policy, verificationReceipt } from '../verification-gate.mjs';
import { publicationPolicy, selectVerifiedRun, validatePublicationSource, verifiedPublicationSource } from '../publication-source.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const commit = 'a'.repeat(40), tree = 'b'.repeat(40), runId = '1234', attempt = '2';
const context = { repository: publicationPolicy.repository, sha: commit, runId, attempt, event: 'push', ref: 'refs/heads/main',
  workflowRef: `${publicationPolicy.repository}/${policy.workflow}@refs/heads/main` };
const results = Object.fromEntries(Object.keys(policy.jobs).map(name => [name, { result: 'success', outputs: {} }]));
const workflowSource = readFileSync(resolve(root, policy.workflow), 'utf8');
const receipt = verificationReceipt({ results, context, checkout: { sha: commit, tree, clean: true }, workflowSource });
const receiptRaw = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
const records = Object.keys(services).map((service, index) => ({ schema: 'workspace-image-verification-v1', repository: context.repository,
  commit, tree, runId, attempt, service, image: `workspace-${service}:verify`, imageId: `sha256:${String(index + 1).repeat(64)}`,
  platform: 'linux/amd64', registryDigests: [], scope: 'ci-image-build-and-health-only', deploymentApproved: false }));
const imageSet = imageVerificationSet(records, receipt, {}, hash(receiptRaw));
const imageSetRaw = Buffer.from(JSON.stringify(imageSet, null, 2) + '\n');
const run = { runId, attempt, commit, url: `https://github.com/${publicationPolicy.repository}/actions/runs/${runId}` };
const publication = { runId: '5678', attempt: '1', actor: 'github-user' };

const apiRun = (patch = {}) => ({ id: Number(runId), run_attempt: Number(attempt), name: policy.workflowName ?? 'Workspace Verification',
  path: policy.workflow, event: 'push', head_branch: 'main', head_sha: commit, status: 'completed', conclusion: 'success',
  repository: { full_name: publicationPolicy.repository }, html_url: run.url, ...patch });

test('current main selects only a successful exact verification push', () => {
  assert.deepEqual(selectVerifiedRun({ repository: publicationPolicy.repository, mainSha: commit, runs: [apiRun()] }), run);
  for (const patch of [{ head_sha: 'c'.repeat(40) }, { event: 'pull_request' }, { conclusion: 'failure' }, { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'other/repo' } }, { head_branch: 'release' }])
    assert.throws(() => selectVerifiedRun({ repository: publicationPolicy.repository, mainSha: commit, runs: [apiRun(patch)] }));
});

test('publication source binds trusted run, exact receipts and manual publication identity', () => {
  const source = verifiedPublicationSource({ run, receiptDocument: { value: receipt, raw: receiptRaw }, imageSetDocument: { value: imageSet, raw: imageSetRaw }, publication });
  assert.equal(source.commit, commit); assert.equal(source.verificationRunId, runId); assert.equal(source.publicationRunId, publication.runId);
  assert.equal(source.verificationReceiptSha256, hash(receiptRaw)); assert.equal(source.imageVerificationSetSha256, hash(imageSetRaw));
  assert.equal(source.deploymentApproved, false); assert.equal(validatePublicationSource(source), source);
});

test('mismatched run, artifact, actor and deployment claims fail closed', () => {
  const make = (overrides = {}) => verifiedPublicationSource({ run, receiptDocument: { value: receipt, raw: receiptRaw },
    imageSetDocument: { value: imageSet, raw: imageSetRaw }, publication, ...overrides });
  assert.throws(() => make({ run: { ...run, commit: 'c'.repeat(40) } }));
  assert.throws(() => make({ imageSetDocument: { value: { ...imageSet, commit: 'c'.repeat(40) }, raw: imageSetRaw } }));
  assert.throws(() => make({ publication: { ...publication, actor: '../actor' } }));
  const source = make(); assert.throws(() => validatePublicationSource({ ...source, deploymentApproved: true }));
});
