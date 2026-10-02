import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedImage, normalizePublishedImage, validatePublicationRecord } from '../image-publication-record.mjs';
import { publicationSet, validatePublicationSet } from '../image-publication-set.mjs';
import { publicationPolicy, validatePublicationSource } from '../publication-source.mjs';

const source = validatePublicationSource({ schema: 'workspace-publication-source-v1', repository: publicationPolicy.repository,
  commit: 'a'.repeat(40), tree: 'b'.repeat(40), verificationRunId: '123', verificationAttempt: '1',
  verificationRunUrl: `https://github.com/${publicationPolicy.repository}/actions/runs/123`, verificationReceiptSha256: 'c'.repeat(64),
  imageVerificationSetSha256: 'd'.repeat(64), publicationRunId: '456', publicationAttempt: '2', actor: 'github-user',
  scope: 'verified-main-publication-source-only', deploymentApproved: false });
const names = [...publicationPolicy.services].sort((a, b) => a.localeCompare(b, 'en'));
const record = (service, index) => {
  const image = expectedImage(service, source.commit); const subject = image.slice(0, image.lastIndexOf(':'));
  return normalizePublishedImage({ service, image, source, inspect: { id: `sha256:${String(index + 1).repeat(64)}`, os: 'linux', architecture: 'amd64',
    repoDigests: [`${subject}@sha256:${String(index + 2).repeat(64)}`] } });
};

test('published record binds exact GHCR repository, commit tag, local image and registry digest', () => {
  const value = record('portal', 0); assert.equal(value.image, `ghcr.io/company-org/company-workspace-portal:${source.commit}`);
  assert.match(value.registryDigest, /^ghcr\.io\/company-org\/company-workspace-portal@sha256:/);
  assert.equal(validatePublicationRecord(value, source), value); assert.equal(value.deploymentApproved, false);
});

test('wrong tag, missing or ambiguous digest and unsupported platform fail closed', () => {
  const image = expectedImage('portal', source.commit), subject = image.slice(0, image.lastIndexOf(':'));
  const inspect = { id: `sha256:${'1'.repeat(64)}`, os: 'linux', architecture: 'amd64', repoDigests: [`${subject}@sha256:${'2'.repeat(64)}`] };
  assert.throws(() => normalizePublishedImage({ service: 'portal', image: image.replace(source.commit, 'latest'), source, inspect }));
  assert.throws(() => normalizePublishedImage({ service: 'portal', image, source, inspect: { ...inspect, repoDigests: [] } }));
  assert.throws(() => normalizePublishedImage({ service: 'portal', image, source, inspect: { ...inspect, repoDigests: [...inspect.repoDigests, ...inspect.repoDigests] } }));
  assert.throws(() => normalizePublishedImage({ service: 'portal', image, source, inspect: { ...inspect, architecture: '386' } }));
});

test('all exact publication records form an unsigned and non-deployment-approved set', () => {
  const records = names.map(record); const result = publicationSet(records, source);
  assert.deepEqual(Object.keys(result.images), names); assert.equal(result.provenanceSigned, false);
  assert.equal(result.scope, 'registry-publication-set-only'); assert.equal(result.deploymentApproved, false);
  for (const value of Object.values(result.images)) assert.match(value.registryDigest, /@sha256:[a-f0-9]{64}$/);
  assert.equal(validatePublicationSet(result), result);
});

test('missing, duplicate, mixed-source and mutable publication records fail closed', () => {
  const records = names.map(record);
  assert.throws(() => publicationSet(records.slice(1), source));
  assert.throws(() => publicationSet(records.map((value, index) => index === 0 ? records[1] : value), source));
  assert.throws(() => publicationSet(records.map((value, index) => index === 0 ? { ...value, commit: 'e'.repeat(40) } : value), source));
  assert.throws(() => publicationSet(records.map((value, index) => index === 0 ? { ...value, deploymentApproved: true } : value), source));
});

test('completed publication set validation rejects omissions, mutable tags and broadened scope', () => {
  const value = publicationSet(names.map(record), source);
  assert.throws(() => validatePublicationSet({ ...value, images: Object.fromEntries(Object.entries(value.images).slice(1)) }));
  assert.throws(() => validatePublicationSet({ ...value, deploymentApproved: true }));
  assert.throws(() => validatePublicationSet({ ...value, provenanceSigned: true }));
  assert.throws(() => validatePublicationSet({ ...value, unexpected: true }));
  assert.throws(() => validatePublicationSet({ ...value, images: { ...value.images,
    portal: { ...value.images.portal, image: 'ghcr.io/company-org/company-workspace-portal:latest' } } }));
  assert.throws(() => validatePublicationSet({ ...value, images: { ...value.images,
    portal: { ...value.images.portal, registryDigest: `ghcr.io/other/image@sha256:${'f'.repeat(64)}` } } }));
});
