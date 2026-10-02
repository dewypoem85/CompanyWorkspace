import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { services } from './container-smoke.mjs';
import { publicationPolicy, validatePublicationSource } from './publication-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const sameSet = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));
const recordKeys = ['schema', 'repository', 'commit', 'tree', 'verificationRunId', 'verificationAttempt', 'publicationRunId',
  'publicationAttempt', 'service', 'image', 'imageId', 'platform', 'registryDigest', 'scope', 'deploymentApproved'];

export function expectedImage(service, commit) {
  required(Object.hasOwn(services, service) && typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit), '서비스 또는 commit이 올바르지 않습니다.');
  return `${publicationPolicy.registry}/${publicationPolicy.namespace}/${publicationPolicy.imagePrefix}${service}:${commit}`;
}

export function normalizePublishedImage({ service, image, source, inspect }) {
  validatePublicationSource(source);
  required(Object.hasOwn(services, service) && image === expectedImage(service, source.commit), '게시 이미지 태그가 source와 일치하지 않습니다.');
  required(inspect && sha256(inspect.id) && inspect.os === 'linux' && ['amd64', 'arm64'].includes(inspect.architecture)
    && Array.isArray(inspect.repoDigests), '게시 이미지 조회 결과가 올바르지 않습니다.');
  const subject = image.slice(0, image.lastIndexOf(':'));
  const matches = inspect.repoDigests.filter(value => typeof value === 'string' && value.startsWith(`${subject}@`) && /^[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(value));
  required(matches.length === 1, '게시 이미지의 registry digest를 하나로 확정할 수 없습니다.');
  return {
    schema: 'workspace-image-publication-v1', repository: source.repository, commit: source.commit, tree: source.tree,
    verificationRunId: source.verificationRunId, verificationAttempt: source.verificationAttempt,
    publicationRunId: source.publicationRunId, publicationAttempt: source.publicationAttempt,
    service, image, imageId: inspect.id, platform: `${inspect.os}/${inspect.architecture}`, registryDigest: matches[0],
    scope: 'registry-image-and-health-only', deploymentApproved: false
  };
}

export function validatePublicationRecord(record, source) {
  validatePublicationSource(source);
  required(record && typeof record === 'object' && !Array.isArray(record) && sameSet(Object.keys(record), recordKeys), '게시 이미지 기록 구조가 올바르지 않습니다.');
  const expected = normalizePublishedImage({ service: record.service, image: record.image, source,
    inspect: { id: record.imageId, os: record.platform?.split('/')[0], architecture: record.platform?.split('/')[1], repoDigests: [record.registryDigest] } });
  for (const key of recordKeys) required(record[key] === expected[key], `게시 이미지 기록의 ${key}가 검증된 source와 일치하지 않습니다.`);
  return record;
}

function readSource(path) {
  required(existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), '게시 source 파일이 없습니다.');
  const raw = readFileSync(path); required(raw.length > 0 && raw.length <= 64 * 1024, '게시 source 파일 크기가 올바르지 않습니다.');
  return validatePublicationSource(JSON.parse(raw.toString('utf8')));
}
const command = (file, args) => execFileSync(file, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function main(args = process.argv.slice(2), env = process.env) {
  required(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REPOSITORY === publicationPolicy.repository && env.GITHUB_RUN_ID && env.GITHUB_RUN_ATTEMPT, '게시 이미지 기록은 수동 게시 workflow 안에서만 생성합니다.');
  required(args.length === 4 && args[0] === '--service' && args[2] === '--image', '--service와 --image를 순서대로 지정해야 합니다.');
  const service = args[1], image = args[3];
  const source = readSource(resolve(root, 'artifacts/publication/source.json'));
  required(source.publicationRunId === env.GITHUB_RUN_ID && source.publicationAttempt === env.GITHUB_RUN_ATTEMPT && source.commit === env.GITHUB_SHA,
    '게시 실행과 source가 일치하지 않습니다.');
  const inspect = JSON.parse(command('docker', ['image', 'inspect', '--format', '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"repoDigests":{{json .RepoDigests}}}', image]));
  const record = normalizePublishedImage({ service, image, source, inspect });
  const directory = resolve(root, 'artifacts/publication-images'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${service}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  const [subjectName, subjectDigest] = record.registryDigest.split('@');
  required(env.GITHUB_OUTPUT, 'GITHUB_OUTPUT 경로가 없습니다.');
  appendFileSync(env.GITHUB_OUTPUT, `subject_name=${subjectName}\nsubject_digest=${subjectDigest}\nsubject_ref=${record.registryDigest}\n`);
  console.log(`${service}: published image record created for ${record.registryDigest}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Image publication record rejected: ${error.message}`); process.exitCode = 1; }
}
