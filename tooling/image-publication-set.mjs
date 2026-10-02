import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { services } from './container-smoke.mjs';
import { publicationPolicy, validatePublicationSource } from './publication-source.mjs';
import { expectedImage, validatePublicationRecord } from './image-publication-record.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = Object.keys(services).sort((a, b) => a.localeCompare(b, 'en'));
const required = (condition, message) => { if (!condition) throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const sameSet = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));
const setKeys = ['schema', 'repository', 'commit', 'tree', 'verificationRunId', 'verificationAttempt', 'publicationRunId',
  'publicationAttempt', 'sourceSha256', 'images', 'provenanceSigned', 'scope', 'deploymentApproved'];
const imageKeys = ['image', 'imageId', 'platform', 'registryDigest', 'recordSha256'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);

export function validatePublicationSet(value) {
  required(value && typeof value === 'object' && !Array.isArray(value) && sameSet(Object.keys(value), setKeys), '게시 묶음 구조가 올바르지 않습니다.');
  required(value.schema === 'workspace-image-publication-set-v1' && value.repository === publicationPolicy.repository
    && sha(value.commit) && sha(value.tree) && positive(value.verificationRunId) && positive(value.verificationAttempt)
    && positive(value.publicationRunId) && positive(value.publicationAttempt) && digest(value.sourceSha256)
    && value.provenanceSigned === false && value.scope === 'registry-publication-set-only' && value.deploymentApproved === false,
  '게시 묶음 신원 또는 범위가 올바르지 않습니다.');
  required(value.images && typeof value.images === 'object' && !Array.isArray(value.images)
    && sameSet(Object.keys(value.images), names), '게시 묶음에는 등록된 모든 서비스가 있어야 합니다.');
  for (const service of names) {
    const image = value.images[service];
    required(image && typeof image === 'object' && !Array.isArray(image) && sameSet(Object.keys(image), imageKeys), `${service} 게시 이미지 구조가 올바르지 않습니다.`);
    const tagged = expectedImage(service, value.commit);
    const subject = tagged.slice(0, tagged.lastIndexOf(':'));
    required(image.image === tagged && /^sha256:[a-f0-9]{64}$/.test(image.imageId)
      && ['linux/amd64', 'linux/arm64'].includes(image.platform)
      && image.registryDigest.startsWith(`${subject}@`) && /^[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(image.registryDigest)
      && digest(image.recordSha256), `${service} 게시 이미지 신원이 올바르지 않습니다.`);
  }
  return value;
}

export function publicationSet(records, source, sourceSha256 = hash(JSON.stringify(source)), recordHashes = {}) {
  validatePublicationSource(source);
  required(/^[a-f0-9]{64}$/.test(sourceSha256), '게시 source hash가 올바르지 않습니다.');
  required(Array.isArray(records) && records.length === names.length && sameSet(records.map(record => record.service), names), '모든 게시 이미지 기록이 필요합니다.');
  const images = {};
  for (const service of names) {
    const record = records.find(item => item.service === service); validatePublicationRecord(record, source);
    const recordSha256 = recordHashes[service] ?? hash(JSON.stringify(record)); required(/^[a-f0-9]{64}$/.test(recordSha256), `${service} 게시 기록 hash가 올바르지 않습니다.`);
    images[service] = { image: record.image, imageId: record.imageId, platform: record.platform, registryDigest: record.registryDigest, recordSha256 };
  }
  return validatePublicationSet({
    schema: 'workspace-image-publication-set-v1', repository: source.repository, commit: source.commit, tree: source.tree,
    verificationRunId: source.verificationRunId, verificationAttempt: source.verificationAttempt,
    publicationRunId: source.publicationRunId, publicationAttempt: source.publicationAttempt,
    sourceSha256, images, provenanceSigned: false,
    scope: 'registry-publication-set-only', deploymentApproved: false
  });
}

function readJson(path, maxBytes) {
  required(existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), `필수 게시 기록이 없습니다: ${path}`);
  const raw = readFileSync(path); required(raw.length > 0 && raw.length <= maxBytes, `게시 기록 크기가 올바르지 않습니다: ${path}`);
  return { raw, value: JSON.parse(raw.toString('utf8')) };
}

export function main(args = process.argv.slice(2), env = process.env) {
  required(args.length === 0 && env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch', '게시 묶음은 수동 GitHub Actions 실행에서만 생성합니다.');
  required(env.SOURCE_RESULT === 'success' && env.PUBLISH_RESULT === 'success', 'source와 모든 게시·provenance 검증 작업이 성공해야 합니다.');
  const sourceDocument = readJson(resolve(root, 'artifacts/publication/source.json'), 64 * 1024);
  const source = validatePublicationSource(sourceDocument.value);
  required(source.repository === env.GITHUB_REPOSITORY && source.commit === env.GITHUB_SHA
    && source.publicationRunId === env.GITHUB_RUN_ID && source.publicationAttempt === env.GITHUB_RUN_ATTEMPT, '게시 묶음과 현재 실행이 일치하지 않습니다.');
  const directory = resolve(root, 'artifacts/publication-images');
  required(existsSync(directory) && lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), '게시 이미지 기록 디렉터리가 없습니다.');
  const entries = readdirSync(directory, { withFileTypes: true });
  required(entries.every(entry => entry.isFile() && !entry.isSymbolicLink()) && sameSet(entries.map(entry => entry.name), names.map(name => `${name}.json`)), '게시 이미지 기록은 서비스별 JSON 파일과 정확히 일치해야 합니다.');
  const documents = Object.fromEntries(names.map(name => [name, readJson(resolve(directory, `${name}.json`), 64 * 1024)]));
  const result = publicationSet(names.map(name => documents[name].value), source, hash(sourceDocument.raw),
    Object.fromEntries(names.map(name => [name, hash(documents[name].raw)])));
  const output = resolve(root, 'artifacts/publication', `${source.publicationRunId}-${source.publicationAttempt}-images.json`);
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(`Six-service publication set created for ${result.commit}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Image publication set rejected: ${error.message}`); process.exitCode = 1; }
}
