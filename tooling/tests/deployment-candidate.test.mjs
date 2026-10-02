import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createCandidateBundle, parseArguments, remainingDeploymentChecks, writeCandidateBundle } from '../deployment-candidate.mjs';
import { targets } from '../deployment-preflight.mjs';
import { expectedImage, normalizePublishedImage } from '../image-publication-record.mjs';
import { publicationSet } from '../image-publication-set.mjs';
import { publicationPolicy, validatePublicationSource } from '../publication-source.mjs';

const source = validatePublicationSource({
  schema: 'workspace-publication-source-v1', repository: publicationPolicy.repository,
  commit: 'a'.repeat(40), tree: 'b'.repeat(40), verificationRunId: '123', verificationAttempt: '1',
  verificationRunUrl: `https://github.com/${publicationPolicy.repository}/actions/runs/123`, verificationReceiptSha256: 'c'.repeat(64),
  imageVerificationSetSha256: 'd'.repeat(64), publicationRunId: '456', publicationAttempt: '2', actor: 'github-user',
  scope: 'verified-main-publication-source-only', deploymentApproved: false
});
const names = [...publicationPolicy.services].sort((left, right) => left.localeCompare(right, 'en'));
const records = names.map((service, index) => {
  const image = expectedImage(service, source.commit);
  const subject = image.slice(0, image.lastIndexOf(':'));
  return normalizePublishedImage({ service, image, source, inspect: {
    id: `sha256:${String(index + 1).repeat(64)}`, os: 'linux', architecture: 'amd64',
    repoDigests: [`${subject}@sha256:${String(index + 2).repeat(64)}`]
  } });
});
const set = publicationSet(records, source);

test('candidate bundle binds every Compose service to publication registry digests only', () => {
  const raw = `${JSON.stringify(set, null, 2)}\n`;
  const bundle = createCandidateBundle(set, raw);
  assert.deepEqual(Object.keys(bundle.files), names.map(name => `${name}.image.compose.json`));
  assert.deepEqual(Object.keys(bundle.manifest.services), names);
  assert.equal(bundle.manifest.scope, 'digest-pinned-compose-overrides-only');
  assert.equal(bundle.manifest.deploymentApproved, false);
  assert.deepEqual(bundle.manifest.unverified, remainingDeploymentChecks);
  assert.match(bundle.manifest.publicationSetSha256, /^[a-f0-9]{64}$/);
  for (const app of names) {
    const override = JSON.parse(bundle.files[`${app}.image.compose.json`]);
    assert.deepEqual(Object.keys(override.services), [targets[app].service]);
    assert.deepEqual(override.services[targets[app].service], { image: set.images[app].registryDigest });
    assert.equal(bundle.manifest.services[app].composeService, targets[app].service);
    assert.equal(bundle.manifest.services[app].container, targets[app].container);
    assert.equal(bundle.manifest.services[app].image, set.images[app].registryDigest);
    assert.match(bundle.manifest.services[app].overrideSha256, /^[a-f0-9]{64}$/);
  }
});

test('candidate generation fails closed for mixed or deployment-approved publication data', () => {
  assert.throws(() => createCandidateBundle({ ...set, deploymentApproved: true }));
  assert.throws(() => createCandidateBundle({ ...set, commit: 'f'.repeat(40) }));
  assert.throws(() => createCandidateBundle({ ...set, images: { ...set.images,
    cs: { ...set.images.cs, registryDigest: `ghcr.io/company-org/company-workspace-portal@sha256:${'e'.repeat(64)}` } } }));
  assert.throws(() => createCandidateBundle(set, Buffer.alloc(256 * 1024 + 1)));
});

test('writer accepts a regular publication artifact once and never overwrites an output directory', t => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-candidate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'publication.json');
  const output = join(directory, 'candidate');
  writeFileSync(input, `${JSON.stringify(set, null, 2)}\n`);
  const manifest = writeCandidateBundle(input, output);
  assert.deepEqual(JSON.parse(readFileSync(join(output, 'candidate.json'), 'utf8')), manifest);
  for (const app of names) assert.equal(JSON.parse(readFileSync(join(output, `${app}.image.compose.json`), 'utf8')).services[targets[app].service].image, set.images[app].registryDigest);
  assert.throws(() => writeCandidateBundle(input, output), /새 경로/);
});

test('CLI requires exact absolute publication and output paths', () => {
  const input = resolve('publication.json'), output = resolve('candidate');
  assert.deepEqual(parseArguments(['--publication-set', input, '--output', output]), { publicationSet: input, output });
  for (const args of [[], ['--output', output, '--publication-set', input], ['--publication-set', 'relative.json', '--output', output],
    ['--publication-set', input, '--output', 'relative']]) assert.throws(() => parseArguments(args));
});

test('candidate generator contains no process execution or registry and Docker client', () => {
  const sourceText = readFileSync(resolve('tooling/deployment-candidate.mjs'), 'utf8');
  for (const forbidden of ['node:child_process', 'execFile', 'spawn(', "'docker'", 'docker compose', 'gh api']) assert.equal(sourceText.includes(forbidden), false, forbidden);
});
