import test from 'node:test';
import assert from 'node:assert/strict';
import { services } from '../container-smoke.mjs';
import { remoteMainReport, sourceDriftReport, validateSourceManifest } from '../source-drift.mjs';

const names = Object.keys(services);
const manifest = { format: 1, sources: names.map((name, index) => ({ name, folder: `${name}-source`, remote: `https://github.com/example/${name}.git`,
  commit: '1234567'[index].repeat(40), tree: '789abcd'[index].repeat(40), refs: [] })) };
const states = () => Object.fromEntries(manifest.sources.map(source => [source.name, { available: true, branch: 'main', commit: source.commit, tree: source.tree,
  clean: true, remote: source.remote, relation: 'exact', aheadCommits: 0 }]));

test('all exact clean main checkouts are ready for final reconciliation', () => {
  assert.equal(validateSourceManifest(manifest), true);
  const report = sourceDriftReport(manifest, states());
  assert.equal(report.allExact, true); assert.equal(report.remoteFetched, false); assert.equal(report.deploymentApproved, false);
  assert.ok(report.sources.every(source => source.exact && source.issues.length === 0));
});

test('dirty, ahead, diverged, wrong branch, missing and remote changes are explicit drift', () => {
  const variants = [
    { clean: false, issue: 'working-tree-dirty' }, { branch: 'feature', issue: 'not-main' },
    { remote: 'https://github.com/example/other.git', issue: 'remote-mismatch' },
    { commit: 'a'.repeat(40), tree: 'b'.repeat(40), relation: 'descendant', aheadCommits: 2, issue: 'new-commits-after-import' },
    { commit: 'c'.repeat(40), tree: 'd'.repeat(40), relation: 'diverged', issue: 'history-diverged' }
  ];
  for (const { issue, ...patch } of variants) {
    const input = states(); input.portal = { ...input.portal, ...patch };
    const report = sourceDriftReport(manifest, input); assert.equal(report.allExact, false); assert.ok(report.sources.find(source => source.name === 'portal').issues.includes(issue));
  }
  const missing = states(); missing.portal = { available: false };
  assert.deepEqual(sourceDriftReport(manifest, missing).sources.find(source => source.name === 'portal').issues, ['missing-checkout']);
});

test('malformed manifests and inconsistent inspector results fail closed', () => {
  for (const changed of [
    { ...manifest, format: 2 },
    { ...manifest, sources: manifest.sources.slice(1) },
    { ...manifest, sources: manifest.sources.map((source, index) => index === 0 ? { ...source, folder: '../outside' } : source) },
    { ...manifest, sources: manifest.sources.map((source, index) => index === 0 ? { ...source, remote: 'file:///tmp/source' } : source) }
  ]) assert.throws(() => validateSourceManifest(changed));
  const input = states(); input.portal = { ...input.portal, commit: 'main' };
  assert.throws(() => sourceDriftReport(manifest, input));
});

test('remote main heads must all exactly match the imported commits', () => {
  const heads = Object.fromEntries(manifest.sources.map(source => [source.name, source.commit]));
  const exact = remoteMainReport(manifest, heads);
  assert.equal(exact.allExact, true); assert.equal(exact.scope, 'remote-main-read-only'); assert.equal(exact.remoteFetched, false);
  const changed = { ...heads, portal: 'f'.repeat(40) };
  const report = remoteMainReport(manifest, changed); assert.equal(report.allExact, false);
  assert.deepEqual(report.sources.find(source => source.name === 'portal').issues, ['remote-main-changed-after-import']);
  assert.equal(remoteMainReport(manifest, { ...heads, portal: null }).sources.find(source => source.name === 'portal').issues[0], 'remote-main-unavailable');
  assert.throws(() => remoteMainReport(manifest, { ...heads, portal: 'main' }));
});
