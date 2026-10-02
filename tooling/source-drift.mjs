import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { services } from './container-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, '..');
const expectedNames = Object.keys(services).sort((a, b) => a.localeCompare(b, 'en'));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const required = (condition, message) => { if (!condition) throw new Error(message); };
const sameSet = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));

export function validateSourceManifest(manifest) {
  required(manifest?.format === 1 && Array.isArray(manifest.sources) && manifest.sources.length === expectedNames.length, '원본 이관 manifest가 올바르지 않습니다.');
  required(sameSet(manifest.sources.map(source => source?.name), expectedNames), '원본 이관 서비스가 빠졌거나 중복되었습니다.');
  for (const source of manifest.sources) {
    required(typeof source.folder === 'string' && /^[A-Za-z0-9._-]+$/.test(source.folder) && source.folder !== '.' && source.folder !== '..', `${source.name}: 원본 폴더가 올바르지 않습니다.`);
    required(typeof source.remote === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(source.remote), `${source.name}: 원본 remote가 올바르지 않습니다.`);
    required(sha(source.commit) && sha(source.tree), `${source.name}: 수입 commit/tree가 올바르지 않습니다.`);
  }
  return true;
}

export function sourceDriftReport(manifest, states) {
  validateSourceManifest(manifest);
  required(states && typeof states === 'object' && !Array.isArray(states), '원본 checkout 상태가 필요합니다.');
  const sources = [...manifest.sources].sort((a, b) => a.name.localeCompare(b.name, 'en')).map(source => {
    const state = states[source.name];
    if (!state?.available) return { name: source.name, folder: source.folder, importedCommit: source.commit, available: false, exact: false, issues: ['missing-checkout'] };
    required(typeof state.branch === 'string' && sha(state.commit) && sha(state.tree) && typeof state.clean === 'boolean'
      && typeof state.remote === 'string' && ['exact', 'descendant', 'diverged'].includes(state.relation)
      && Number.isSafeInteger(state.aheadCommits) && state.aheadCommits >= 0, `${source.name}: 원본 checkout 조회 결과가 올바르지 않습니다.`);
    const issues = [];
    if (state.branch !== 'main') issues.push('not-main');
    if (!state.clean) issues.push('working-tree-dirty');
    if (state.remote !== source.remote) issues.push('remote-mismatch');
    if (state.relation === 'descendant') issues.push('new-commits-after-import');
    if (state.relation === 'diverged') issues.push('history-diverged');
    if (state.relation === 'exact' && (state.commit !== source.commit || state.tree !== source.tree || state.aheadCommits !== 0)) issues.push('inconsistent-exact-state');
    return { name: source.name, folder: source.folder, importedCommit: source.commit, available: true,
      branch: state.branch, currentCommit: state.commit, currentTree: state.tree, clean: state.clean,
      remoteMatches: state.remote === source.remote, relation: state.relation, aheadCommits: state.aheadCommits,
      exact: issues.length === 0, issues };
  });
  return { schema: 'workspace-source-drift-v1', allExact: sources.every(source => source.exact), sources,
    scope: 'local-source-checkouts-only', remoteFetched: false, deploymentApproved: false };
}

export function remoteMainReport(manifest, heads) {
  validateSourceManifest(manifest);
  required(heads && typeof heads === 'object' && !Array.isArray(heads), '원격 main 조회 결과가 필요합니다.');
  const sources = [...manifest.sources].sort((a, b) => a.name.localeCompare(b.name, 'en')).map(source => {
    const commit = heads[source.name];
    if (commit === null || commit === undefined) return { name: source.name, importedCommit: source.commit, available: false, exact: false, issues: ['remote-main-unavailable'] };
    required(sha(commit), `${source.name}: 원격 main commit이 올바르지 않습니다.`);
    const exact = commit === source.commit;
    return { name: source.name, importedCommit: source.commit, available: true, remoteMainCommit: commit, exact,
      issues: exact ? [] : ['remote-main-changed-after-import'] };
  });
  return { schema: 'workspace-source-remote-main-v1', allExact: sources.every(source => source.exact), sources,
    scope: 'remote-main-read-only', remoteFetched: false, deploymentApproved: false };
}

function git(cwd, args, allowFailure = false) {
  const executable = process.env.WORKSPACE_GIT || (process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git');
  const result = spawnSync(executable, ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`, '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(`Git 원본 조회에 실패했습니다: ${cwd}`);
  return { status: result.status, stdout: (result.stdout || '').trim() };
}

function remoteMain(source) {
  const executable = process.env.WORKSPACE_GIT || (process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git');
  const result = spawnSync(executable, ['ls-remote', '--exit-code', '--heads', source.remote, 'refs/heads/main'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${source.name}: 원격 main 조회에 실패했습니다.`);
  const rows = (result.stdout || '').trim().split('\n').filter(Boolean);
  required(rows.length === 1, `${source.name}: 원격 main 응답이 하나가 아닙니다.`);
  const [commit, ref, ...extra] = rows[0].trim().split(/\s+/);
  required(extra.length === 0 && sha(commit) && ref === 'refs/heads/main', `${source.name}: 원격 main 응답이 올바르지 않습니다.`);
  return commit;
}

function inspectSource(source) {
  const cwd = resolve(sourceRoot, source.folder);
  if (!existsSync(resolve(cwd, '.git'))) return { available: false };
  const branch = git(cwd, ['branch', '--show-current']).stdout;
  const commit = git(cwd, ['rev-parse', 'HEAD']).stdout;
  const tree = git(cwd, ['rev-parse', 'HEAD^{tree}']).stdout;
  const clean = git(cwd, ['status', '--porcelain', '--untracked-files=normal']).stdout === '';
  const remote = git(cwd, ['remote', 'get-url', 'origin']).stdout;
  const ancestor = git(cwd, ['merge-base', '--is-ancestor', source.commit, 'HEAD'], true).status === 0;
  const relation = commit === source.commit ? 'exact' : ancestor ? 'descendant' : 'diverged';
  const aheadCommits = relation === 'descendant' ? Number(git(cwd, ['rev-list', '--count', `${source.commit}..HEAD`]).stdout) : 0;
  return { available: true, branch, commit, tree, clean, remote, relation, aheadCommits };
}

export function main(args = process.argv.slice(2)) {
  required(args.length === 1 && ['inspect', 'check', 'remote-check'].includes(args[0]), 'inspect, check 또는 remote-check만 지정합니다.');
  const manifest = JSON.parse(readFileSync(resolve(root, 'migration-sources.json'), 'utf8'));
  validateSourceManifest(manifest);
  if (args[0] === 'remote-check') {
    const report = remoteMainReport(manifest, Object.fromEntries(manifest.sources.map(source => [source.name, remoteMain(source)])));
    required(report.allExact, `원격 main drift가 있습니다: ${report.sources.filter(source => !source.exact).map(source => source.name).join(', ')}`);
    console.log('Six source remotes exactly match the imported main commits; no remote main drift detected.');
    return report;
  }
  const states = Object.fromEntries(manifest.sources.map(source => [source.name, inspectSource(source)]));
  const report = sourceDriftReport(manifest, states);
  if (args[0] === 'inspect') console.log(JSON.stringify(report, null, 2));
  else {
    required(report.allExact, `원본 checkout drift가 있습니다: ${report.sources.filter(source => !source.exact).map(source => `${source.name}(${source.issues.join(',')})`).join(', ')}`);
    console.log('Six source checkouts exactly match the imported commits; no local drift detected.');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Source drift check rejected: ${error.message}`); process.exitCode = 1; }
}
