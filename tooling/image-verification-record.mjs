import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { services } from './container-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = (condition, message) => { if (!condition) throw new Error(message); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const repository = value => typeof value === 'string'
  && value.split('/').length === 2
  && value.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');

export function parseArguments(args) {
  required(args.length === 4, '--service와 --image만 지정해야 합니다.');
  const serviceIndex = args.indexOf('--service');
  const imageIndex = args.indexOf('--image');
  required(serviceIndex >= 0 && imageIndex >= 0, '--service와 --image가 필요합니다.');
  const service = args[serviceIndex + 1];
  const image = args[imageIndex + 1];
  required(Object.hasOwn(services, service), '지원하지 않는 서비스입니다.');
  required(image === `workspace-${service}:verify`, 'CI 검증용 서비스 이미지 태그만 기록할 수 있습니다.');
  return { service, image };
}

export function normalizeInspect(raw) {
  required(raw && typeof raw === 'object' && !Array.isArray(raw), '이미지 조회 결과가 올바르지 않습니다.');
  required(digest(raw.id), '불변 로컬 이미지 ID가 없습니다.');
  required(raw.os === 'linux' && ['amd64', 'arm64'].includes(raw.architecture), '지원하지 않는 이미지 플랫폼입니다.');
  required(Array.isArray(raw.repoDigests) && raw.repoDigests.every(item => typeof item === 'string' && /@sha256:[a-f0-9]{64}$/.test(item)), 'registry digest 목록이 올바르지 않습니다.');
  return { imageId: raw.id, platform: `${raw.os}/${raw.architecture}`, registryDigests: [...raw.repoDigests].sort() };
}

export function imageVerificationRecord({ service, image, inspect, context, checkout }) {
  required(Object.hasOwn(services, service) && image === `workspace-${service}:verify`, '서비스 이미지 범위가 올바르지 않습니다.');
  required(context && checkout && sha(context.sha) && context.sha === checkout.sha, 'CI commit과 checkout이 일치하지 않습니다.');
  required(sha(checkout.tree) && checkout.clean === true, '깨끗한 정확한 source tree가 필요합니다.');
  required(repository(context.repository), 'CI 저장소가 올바르지 않습니다.');
  required(typeof context.runId === 'string' && /^[1-9]\d*$/.test(context.runId), 'CI run ID가 올바르지 않습니다.');
  required(typeof context.attempt === 'string' && /^[1-9]\d*$/.test(context.attempt), 'CI run attempt가 올바르지 않습니다.');
  const normalized = normalizeInspect(inspect);
  return {
    schema: 'workspace-image-verification-v1',
    repository: context.repository,
    commit: context.sha,
    tree: checkout.tree,
    runId: context.runId,
    attempt: context.attempt,
    service,
    image,
    ...normalized,
    scope: 'ci-image-build-and-health-only',
    deploymentApproved: false
  };
}

const command = (file, args) => execFileSync(file, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function main(args = process.argv.slice(2), env = process.env) {
  required(env.GITHUB_ACTIONS === 'true', '이미지 검사 기록은 GitHub Actions 실행에서만 생성합니다.');
  const { service, image } = parseArguments(args);
  const git = process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git';
  const inspect = JSON.parse(command('docker', ['image', 'inspect', '--format', '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"repoDigests":{{json .RepoDigests}}}', image]));
  if (inspect.repoDigests === null) inspect.repoDigests = [];
  const record = imageVerificationRecord({
    service,
    image,
    inspect,
    context: { repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT },
    checkout: {
      sha: command(git, ['-C', root, 'rev-parse', 'HEAD']),
      tree: command(git, ['-C', root, 'rev-parse', 'HEAD^{tree}']),
      clean: command(git, ['-C', root, 'status', '--porcelain', '--untracked-files=normal']) === ''
    }
  });
  const directory = resolve(root, 'artifacts/images');
  mkdirSync(directory, { recursive: true });
  const output = resolve(directory, `${service}.json`);
  writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(`${service}: image verification record created at artifacts/images/${service}.json.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Image verification record rejected: ${error.message}`); process.exitCode = 1; }
}
