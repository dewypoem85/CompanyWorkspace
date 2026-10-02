import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { services } from './container-smoke.mjs';
import { policy as verificationPolicy } from './verification-gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serviceNames = Object.keys(services).sort((a, b) => a.localeCompare(b, 'en'));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const repository = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const required = (condition, message) => { if (!condition) throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const sameSet = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));
const recordKeys = ['schema', 'repository', 'commit', 'tree', 'runId', 'attempt', 'service', 'image', 'imageId', 'platform', 'registryDigests', 'scope', 'deploymentApproved'];
const receiptKeys = ['schema', 'repository', 'commit', 'tree', 'runId', 'attempt', 'event', 'ref', 'workflowRef', 'runUrl', 'policySha256', 'workflowSha256', 'jobs', 'scope', 'deploymentApproved'];

export function validateReceipt(receipt) {
  required(receipt && typeof receipt === 'object' && !Array.isArray(receipt) && sameSet(Object.keys(receipt), receiptKeys), '검증 영수증이 올바르지 않습니다.');
  required(receipt.schema === 'workspace-verification-v1' && repository(receipt.repository), '검증 영수증의 저장소가 올바르지 않습니다.');
  required(sha(receipt.commit) && sha(receipt.tree), '검증 영수증의 commit/tree가 올바르지 않습니다.');
  required(typeof receipt.runId === 'string' && /^[1-9]\d*$/.test(receipt.runId) && typeof receipt.attempt === 'string' && /^[1-9]\d*$/.test(receipt.attempt), '검증 영수증의 실행 식별자가 올바르지 않습니다.');
  required(receipt.event === 'push' && receipt.ref === 'refs/heads/main' || receipt.event === 'pull_request' && /^refs\/pull\/[1-9]\d*\/merge$/.test(receipt.ref), '검증 영수증의 event/ref가 올바르지 않습니다.');
  required(receipt.workflowRef === `${receipt.repository}/${verificationPolicy.workflow}@${receipt.ref}`
    && receipt.runUrl === `https://github.com/${receipt.repository}/actions/runs/${receipt.runId}/attempts/${receipt.attempt}`,
  '검증 영수증의 workflow/run 연결이 올바르지 않습니다.');
  required(receipt.policySha256 === hash(JSON.stringify(verificationPolicy))
    && receipt.workflowSha256 === hash(readFileSync(resolve(root, verificationPolicy.workflow), 'utf8').replaceAll('\r\n', '\n')),
  '검증 영수증이 현재 workflow/policy와 일치하지 않습니다.');
  required(receipt.jobs && sameSet(Object.keys(receipt.jobs), Object.keys(verificationPolicy.jobs))
    && Object.values(receipt.jobs).every(result => result === 'success')
    && receipt.scope === 'ci-verification-only' && receipt.deploymentApproved === false, '전체 CI와 이미지 검증 성공 영수증이 필요합니다.');
}

export function validateRecord(record) {
  required(record && typeof record === 'object' && !Array.isArray(record) && sameSet(Object.keys(record), recordKeys), '이미지 검사 기록 구조가 올바르지 않습니다.');
  required(record.schema === 'workspace-image-verification-v1' && serviceNames.includes(record.service), '이미지 검사 서비스가 올바르지 않습니다.');
  required(repository(record.repository) && sha(record.commit) && sha(record.tree), '이미지 검사 source 식별자가 올바르지 않습니다.');
  required(typeof record.runId === 'string' && /^[1-9]\d*$/.test(record.runId) && typeof record.attempt === 'string' && /^[1-9]\d*$/.test(record.attempt), '이미지 검사 실행 식별자가 올바르지 않습니다.');
  required(record.image === `workspace-${record.service}:verify` && digest(record.imageId), '검증 이미지 식별자가 올바르지 않습니다.');
  required(['linux/amd64', 'linux/arm64'].includes(record.platform), '검증 이미지 플랫폼이 올바르지 않습니다.');
  required(Array.isArray(record.registryDigests) && record.registryDigests.every(value => typeof value === 'string' && /^[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(value)) && new Set(record.registryDigests).size === record.registryDigests.length, 'registry digest 목록이 올바르지 않습니다.');
  required(JSON.stringify(record.registryDigests) === JSON.stringify([...record.registryDigests].sort()), 'registry digest 목록은 정렬되어야 합니다.');
  required(record.scope === 'ci-image-build-and-health-only' && record.deploymentApproved === false, '이미지 검사 기록은 배포 승인이 아닙니다.');
}

export function imageVerificationSet(records, receipt, sourceHashes = {}, receiptSha256 = hash(JSON.stringify(receipt))) {
  validateReceipt(receipt);
  required(digest(`sha256:${receiptSha256}`), '검증 영수증 hash가 올바르지 않습니다.');
  required(Array.isArray(records) && records.length === serviceNames.length, '모든 서비스 이미지 검사 기록이 필요합니다.');
  for (const record of records) validateRecord(record);
  required(sameSet(records.map(record => record.service), serviceNames), '서비스별 이미지 검사 기록이 빠졌거나 중복되었습니다.');
  const expected = ['repository', 'commit', 'tree', 'runId', 'attempt'];
  for (const record of records) for (const field of expected)
    required(record[field] === receipt[field], `${record.service} 이미지 기록의 ${field}가 전체 검증 영수증과 다릅니다.`);
  const sorted = [...records].sort((a, b) => a.service.localeCompare(b.service, 'en'));
  const images = Object.fromEntries(sorted.map(record => {
    const sourceSha256 = sourceHashes[record.service] ?? hash(JSON.stringify(record));
    required(digest(`sha256:${sourceSha256}`), `${record.service} 원본 기록 hash가 올바르지 않습니다.`);
    return [record.service, { image: record.image, imageId: record.imageId, platform: record.platform,
      registryDigests: [...record.registryDigests].sort(), sourceRecordSha256: sourceSha256 }];
  }));
  const missingRegistryDigests = sorted.filter(record => record.registryDigests.length === 0).map(record => record.service);
  return {
    schema: 'workspace-image-verification-set-v1', repository: receipt.repository, commit: receipt.commit, tree: receipt.tree,
    runId: receipt.runId, attempt: receipt.attempt, event: receipt.event, ref: receipt.ref,
    verificationReceiptSha256: receiptSha256, images,
    registryPinned: missingRegistryDigests.length === 0, missingRegistryDigests,
    scope: 'ci-image-set-only', deploymentApproved: false
  };
}

function readBoundedJson(path, maxBytes) {
  required(existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), `필수 기록 파일이 없습니다: ${path}`);
  const raw = readFileSync(path);
  required(raw.length > 0 && raw.length <= maxBytes, `기록 파일 크기가 올바르지 않습니다: ${path}`);
  return { raw, value: JSON.parse(raw.toString('utf8')) };
}

export function main(args = process.argv.slice(2), env = process.env) {
  required(args.length === 0, '인수 없이 CI의 고정 artifact 경로만 사용합니다.');
  required(env.GITHUB_ACTIONS === 'true', '이미지 검사 묶음은 GitHub Actions 실행에서만 생성합니다.');
  required(/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') && /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'CI 실행 식별자가 올바르지 않습니다.');
  const input = resolve(root, 'artifacts/image-input');
  required(existsSync(input) && lstatSync(input).isDirectory() && !lstatSync(input).isSymbolicLink(), '이미지 입력 artifact 디렉터리가 없습니다.');
  const names = readdirSync(input, { withFileTypes: true });
  required(names.every(item => item.isFile() && !item.isSymbolicLink()) && sameSet(names.map(item => item.name), serviceNames.map(service => `${service}.json`)), '이미지 입력 artifact는 서비스별 JSON 파일과 정확히 일치해야 합니다.');
  const receiptDocument = readBoundedJson(resolve(root, `artifacts/verification/${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.json`), 128 * 1024);
  const documents = Object.fromEntries(serviceNames.map(service => [service, readBoundedJson(resolve(input, `${service}.json`), 64 * 1024)]));
  const result = imageVerificationSet(serviceNames.map(service => documents[service].value), receiptDocument.value,
    Object.fromEntries(serviceNames.map(service => [service, hash(documents[service].raw)])), hash(receiptDocument.raw));
  required(result.repository === env.GITHUB_REPOSITORY && result.commit === env.GITHUB_SHA && result.runId === env.GITHUB_RUN_ID && result.attempt === env.GITHUB_RUN_ATTEMPT,
    '이미지 검사 묶음과 현재 CI 실행이 일치하지 않습니다.');
  const directory = resolve(root, 'artifacts/verification'); mkdirSync(directory, { recursive: true });
  const output = resolve(directory, `${result.runId}-${result.attempt}-images.json`);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(`Six-service image verification set created at artifacts/verification/${result.runId}-${result.attempt}-images.json.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Image verification set rejected: ${error.message}`); process.exitCode = 1; }
}
