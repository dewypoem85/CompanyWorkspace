import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { services } from './container-smoke.mjs';
import { validateReceipt } from './image-verification-set.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const publicationPolicy = JSON.parse(readFileSync(resolve(root, 'tooling/publication-policy.json'), 'utf8'));
const serviceNames = Object.keys(services).sort((a, b) => a.localeCompare(b, 'en'));
const required = (condition, message) => { if (!condition) throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const sameSet = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));
const sourceKeys = ['schema', 'repository', 'commit', 'tree', 'verificationRunId', 'verificationAttempt', 'verificationRunUrl',
  'verificationReceiptSha256', 'imageVerificationSetSha256', 'publicationRunId', 'publicationAttempt', 'actor', 'scope', 'deploymentApproved'];

function workflowIdentity(run) {
  return run?.path === publicationPolicy.verificationWorkflow
    || run?.workflow_url?.endsWith(`/actions/workflows/${publicationPolicy.verificationWorkflow.split('/').at(-1)}`);
}

export function selectVerifiedRun({ repository, mainSha, runs }) {
  required(repository === publicationPolicy.repository && sha(mainSha), '게시 저장소 또는 main commit이 올바르지 않습니다.');
  required(Array.isArray(runs), '검증 실행 목록이 올바르지 않습니다.');
  const matches = runs.filter(run => Number.isSafeInteger(run?.id) && run.id > 0
    && Number.isSafeInteger(run?.run_attempt) && run.run_attempt > 0
    && run.name === publicationPolicy.verificationWorkflowName && workflowIdentity(run)
    && run.event === 'push' && run.head_branch === publicationPolicy.branch && run.head_sha === mainSha
    && run.status === 'completed' && run.conclusion === 'success'
    && run.repository?.full_name === repository
    && run.html_url === `https://github.com/${repository}/actions/runs/${run.id}`);
  required(matches.length > 0, '현재 main commit에 성공한 전체 검증 실행이 없습니다.');
  matches.sort((left, right) => right.run_attempt - left.run_attempt || right.id - left.id);
  const run = matches[0];
  return { runId: String(run.id), attempt: String(run.run_attempt), commit: mainSha, url: run.html_url };
}

function validateImageSet(value, receipt, rawReceipt) {
  const keys = ['schema', 'repository', 'commit', 'tree', 'runId', 'attempt', 'event', 'ref', 'verificationReceiptSha256',
    'images', 'registryPinned', 'missingRegistryDigests', 'scope', 'deploymentApproved'];
  required(value && typeof value === 'object' && !Array.isArray(value) && sameSet(Object.keys(value), keys), '이미지 검증 묶음 구조가 올바르지 않습니다.');
  required(value.schema === 'workspace-image-verification-set-v1' && value.repository === receipt.repository
    && value.commit === receipt.commit && value.tree === receipt.tree && value.runId === receipt.runId && value.attempt === receipt.attempt
    && value.event === receipt.event && value.ref === receipt.ref, '이미지 검증 묶음과 전체 검증 영수증이 다릅니다.');
  required(value.verificationReceiptSha256 === hash(rawReceipt), '이미지 검증 묶음이 원본 영수증과 연결되지 않았습니다.');
  required(value.images && typeof value.images === 'object' && !Array.isArray(value.images)
    && sameSet(Object.keys(value.images), serviceNames), '이미지 검증 서비스가 빠졌거나 중복되었습니다.');
  const missing = [];
  for (const service of serviceNames) {
    const image = value.images[service];
    required(image && sameSet(Object.keys(image), ['image', 'imageId', 'platform', 'registryDigests', 'sourceRecordSha256']), `${service} 이미지 검증 항목이 올바르지 않습니다.`);
    required(image.image === `workspace-${service}:verify` && /^sha256:[a-f0-9]{64}$/.test(image.imageId)
      && ['linux/amd64', 'linux/arm64'].includes(image.platform) && digest(image.sourceRecordSha256), `${service} 이미지 검증 신원이 올바르지 않습니다.`);
    required(Array.isArray(image.registryDigests) && image.registryDigests.every(item => /^[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(item))
      && new Set(image.registryDigests).size === image.registryDigests.length, `${service} registry digest가 올바르지 않습니다.`);
    if (image.registryDigests.length === 0) missing.push(service);
  }
  required(JSON.stringify(value.missingRegistryDigests) === JSON.stringify(missing)
    && value.registryPinned === (missing.length === 0)
    && value.scope === 'ci-image-set-only' && value.deploymentApproved === false, '이미지 검증 묶음의 범위가 올바르지 않습니다.');
}

function readExactArtifact(directory, runId, attempt) {
  required(existsSync(directory) && lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), '검증 artifact 디렉터리가 없습니다.');
  const expected = [`${runId}-${attempt}.json`, `${runId}-${attempt}-images.json`];
  const entries = readdirSync(directory, { withFileTypes: true });
  required(entries.every(entry => entry.isFile() && !entry.isSymbolicLink()) && sameSet(entries.map(entry => entry.name), expected), '검증 artifact는 정확한 영수증 두 개만 포함해야 합니다.');
  const read = name => {
    const path = resolve(directory, name); const raw = readFileSync(path);
    required(raw.length > 0 && raw.length <= 256 * 1024, `검증 artifact 크기가 올바르지 않습니다: ${name}`);
    return { raw, value: JSON.parse(raw.toString('utf8')) };
  };
  return { receipt: read(expected[0]), imageSet: read(expected[1]) };
}

export function verifiedPublicationSource({ run, receiptDocument, imageSetDocument, publication }) {
  validateReceipt(receiptDocument.value);
  validateImageSet(imageSetDocument.value, receiptDocument.value, receiptDocument.raw);
  const receipt = receiptDocument.value;
  required(run.runId === receipt.runId && run.attempt === receipt.attempt && run.commit === receipt.commit
    && run.url === receipt.runUrl.replace(`/attempts/${receipt.attempt}`, ''), 'GitHub 실행과 검증 artifact가 일치하지 않습니다.');
  required(receipt.repository === publicationPolicy.repository && receipt.event === 'push' && receipt.ref === `refs/heads/${publicationPolicy.branch}`,
    'main push 검증 artifact만 게시 입력으로 사용할 수 있습니다.');
  required(publication && positive(publication.runId) && positive(publication.attempt)
    && typeof publication.actor === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(publication.actor), '게시 실행 신원이 올바르지 않습니다.');
  return {
    schema: 'workspace-publication-source-v1', repository: receipt.repository, commit: receipt.commit, tree: receipt.tree,
    verificationRunId: receipt.runId, verificationAttempt: receipt.attempt, verificationRunUrl: run.url,
    verificationReceiptSha256: hash(receiptDocument.raw), imageVerificationSetSha256: hash(imageSetDocument.raw),
    publicationRunId: publication.runId, publicationAttempt: publication.attempt, actor: publication.actor,
    scope: 'verified-main-publication-source-only', deploymentApproved: false
  };
}

export function validatePublicationSource(source) {
  required(source && typeof source === 'object' && !Array.isArray(source) && sameSet(Object.keys(source), sourceKeys), '게시 source 구조가 올바르지 않습니다.');
  required(source.schema === 'workspace-publication-source-v1' && source.repository === publicationPolicy.repository
    && sha(source.commit) && sha(source.tree) && positive(source.verificationRunId) && positive(source.verificationAttempt)
    && source.verificationRunUrl === `https://github.com/${source.repository}/actions/runs/${source.verificationRunId}`
    && digest(source.verificationReceiptSha256) && digest(source.imageVerificationSetSha256)
    && positive(source.publicationRunId) && positive(source.publicationAttempt)
    && typeof source.actor === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(source.actor)
    && source.scope === 'verified-main-publication-source-only' && source.deploymentApproved === false, '게시 source 신원이 올바르지 않습니다.');
  return source;
}

const ghJson = path => JSON.parse(execFileSync('gh', ['api', path], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
function assertContext(env) {
  required(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REPOSITORY === publicationPolicy.repository && env.GITHUB_REF === `refs/heads/${publicationPolicy.branch}`
    && env.GITHUB_WORKFLOW_REF === `${publicationPolicy.repository}/${publicationPolicy.workflow}@refs/heads/${publicationPolicy.branch}`,
  '게시 source는 main의 수동 GitHub Actions 실행에서만 만들 수 있습니다.');
}
function resolveRun(env) {
  const ref = ghJson(`repos/${publicationPolicy.repository}/git/ref/heads/${publicationPolicy.branch}`);
  const mainSha = ref?.object?.sha;
  const response = ghJson(`repos/${publicationPolicy.repository}/actions/workflows/${publicationPolicy.verificationWorkflow.split('/').at(-1)}/runs?branch=${publicationPolicy.branch}&event=push&status=success&per_page=20`);
  return selectVerifiedRun({ repository: env.GITHUB_REPOSITORY, mainSha, runs: response?.workflow_runs });
}
function appendOutputs(path, values) {
  required(typeof path === 'string' && path.length > 0, 'GITHUB_OUTPUT 경로가 없습니다.');
  appendFileSync(path, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

export function main(args = process.argv.slice(2), env = process.env) {
  assertContext(env);
  required(args.length === 1 && ['resolve', 'verify'].includes(args[0]), 'resolve 또는 verify만 지원합니다.');
  const run = resolveRun(env);
  required(env.GITHUB_SHA === run.commit, '수동 게시 실행 commit이 현재 검증된 main과 다릅니다.');
  if (args[0] === 'resolve') {
    appendOutputs(env.GITHUB_OUTPUT, { run_id: run.runId, attempt: run.attempt, commit: run.commit });
    console.log(`Verified main run selected: ${run.runId} attempt ${run.attempt} (${run.commit}).`); return;
  }
  const documents = readExactArtifact(resolve(root, 'artifacts/source-verification'), run.runId, run.attempt);
  const source = verifiedPublicationSource({ run, receiptDocument: documents.receipt, imageSetDocument: documents.imageSet,
    publication: { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, actor: env.GITHUB_ACTOR } });
  const directory = resolve(root, 'artifacts/publication'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'source.json'), JSON.stringify(source, null, 2) + '\n', { flag: 'wx' });
  console.log(`Verified publication source created for ${source.commit}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Publication source rejected: ${error.message}`); process.exitCode = 1; }
}
