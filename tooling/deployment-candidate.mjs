import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets } from './deployment-preflight.mjs';
import { validatePublicationSet } from './image-publication-set.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = Object.keys(targets).sort((left, right) => left.localeCompare(right, 'en'));
const required = (condition, message) => { if (!condition) throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
export const remainingDeploymentChecks = Object.freeze([
  'trusted CI and image provenance',
  'environment and secret values',
  'commands and security/resource policy',
  'backup consistency and schema compatibility',
  'runtime authentication and business reads',
  'rollout and rollback rehearsal'
]);

export function parseArguments(args) {
  required(args.length === 4 && args[0] === '--publication-set' && args[2] === '--output',
    '--publication-set <절대 경로>와 --output <새 절대 디렉터리>를 순서대로 지정해야 합니다.');
  const publicationSet = args[1], output = args[3];
  required((isAbsolute(publicationSet) || win32.isAbsolute(publicationSet)) && (isAbsolute(output) || win32.isAbsolute(output)),
    '게시 묶음과 출력 디렉터리는 절대 경로여야 합니다.');
  return { publicationSet, output };
}

export function createCandidateBundle(publicationSet, publicationSetRaw = JSON.stringify(publicationSet)) {
  validatePublicationSet(publicationSet);
  required(Buffer.isBuffer(publicationSetRaw) || typeof publicationSetRaw === 'string', '게시 묶음 원문이 필요합니다.');
  const raw = Buffer.isBuffer(publicationSetRaw) ? publicationSetRaw : Buffer.from(publicationSetRaw, 'utf8');
  required(raw.length > 0 && raw.length <= 256 * 1024, '게시 묶음 원문 크기가 올바르지 않습니다.');
  const files = {};
  const services = {};
  for (const app of names) {
    const target = targets[app];
    const file = `${app}.image.compose.json`;
    const document = `${JSON.stringify({ services: { [target.service]: { image: publicationSet.images[app].registryDigest } } }, null, 2)}\n`;
    files[file] = document;
    services[app] = {
      app,
      composeService: target.service,
      container: target.container,
      image: publicationSet.images[app].registryDigest,
      overrideFile: file,
      overrideSha256: hash(document)
    };
  }
  const manifest = {
    schema: 'workspace-deployment-candidate-v1',
    repository: publicationSet.repository,
    commit: publicationSet.commit,
    tree: publicationSet.tree,
    verificationRunId: publicationSet.verificationRunId,
    verificationAttempt: publicationSet.verificationAttempt,
    publicationRunId: publicationSet.publicationRunId,
    publicationAttempt: publicationSet.publicationAttempt,
    publicationSetSha256: hash(raw),
    services,
    scope: 'digest-pinned-compose-overrides-only',
    deploymentApproved: false,
    unverified: [...remainingDeploymentChecks]
  };
  return { manifest, files };
}

function readPublicationSet(path) {
  required(existsSync(path), '게시 묶음 파일이 없습니다.');
  const stat = lstatSync(path);
  required(stat.isFile() && !stat.isSymbolicLink(), '게시 묶음은 심볼릭 링크가 아닌 일반 파일이어야 합니다.');
  const raw = readFileSync(path);
  required(raw.length > 0 && raw.length <= 256 * 1024, '게시 묶음 파일 크기가 올바르지 않습니다.');
  let value;
  try { value = JSON.parse(raw.toString('utf8')); } catch { throw new Error('게시 묶음 JSON을 해석할 수 없습니다.'); }
  return { raw, value };
}

export function writeCandidateBundle(input, output) {
  required(!existsSync(output), '출력 디렉터리는 새 경로여야 하며 기존 파일을 덮어쓰지 않습니다.');
  const parent = dirname(output);
  required(existsSync(parent), '출력 상위 디렉터리가 없습니다.');
  const parentStat = lstatSync(parent);
  required(parentStat.isDirectory() && !parentStat.isSymbolicLink(), '출력 상위 경로는 심볼릭 링크가 아닌 디렉터리여야 합니다.');
  const document = readPublicationSet(input);
  const bundle = createCandidateBundle(document.value, document.raw);
  mkdirSync(output, { recursive: false });
  for (const [file, contents] of Object.entries(bundle.files)) writeFileSync(resolve(output, file), contents, { flag: 'wx' });
  writeFileSync(resolve(output, 'candidate.json'), `${JSON.stringify(bundle.manifest, null, 2)}\n`, { flag: 'wx' });
  return bundle.manifest;
}

export function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const result = writeCandidateBundle(options.publicationSet, options.output);
  process.stdout.write(`Digest-pinned candidate files created for ${result.commit}. Deployment remains unapproved.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`Deployment candidate rejected: ${error.message}\n`); process.exitCode = 1; }
}
