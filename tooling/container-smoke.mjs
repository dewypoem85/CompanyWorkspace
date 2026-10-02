import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const services = Object.freeze({
  portal: {
    port: 8080,
    path: '/health',
    env: {
      ASPNETCORE_ENVIRONMENT: 'Development',
      ASPNETCORE_URLS: 'http://+:8080',
      ConnectionStrings__Default: 'Data Source=/tmp/company-portal-smoke.db',
      DataProtection__KeyPath: '/tmp/company-portal-smoke-keys',
      Authentication__Google__ClientId: 'container-smoke-client',
      Authentication__Google__ClientSecret: 'container-smoke-secret',
      Provisioning__Leave__Enabled: 'false'
    }
  },
  leave: {
    port: 8080,
    path: '/health',
    env: {
      ASPNETCORE_ENVIRONMENT: 'Development',
      ConnectionStrings__Default: 'Data Source=/tmp/leave-smoke.db',
      DataProtection__KeyPath: '/tmp/leave-smoke-keys',
      CompanyPortal__BaseUrl: 'http://127.0.0.1',
      CompanyPortal__SsoSharedSecret: 'container-smoke-shared-secret-32-bytes',
      Backup__Enabled: 'false'
    }
  },
  schedule: {
    port: 8080,
    path: '/api/health',
    env: {
      ASPNETCORE_ENVIRONMENT: 'Development',
      DemoMode: 'false',
      DataPath: '/tmp/schedule-smoke',
      Sso__SharedSecret: 'container-smoke-shared-secret-32-bytes'
    }
  },
  cs: {
    port: 3000,
    path: '/health',
    env: {
      NODE_ENV: 'production',
      COMPANY_PORTAL_URL: 'https://company.example.test',
      COMPANY_SSO_SHARED_SECRET: 'container-smoke-shared-secret-32-bytes',
      CS_DATA_DIR: '/tmp/cs-smoke'
    }
  },
  statistics: {
    port: 3010,
    path: '/health',
    env: {
      NODE_ENV: 'production',
      COMPANY_PORTAL_URL: 'https://company.example.test',
      COMPANY_SSO_SHARED_SECRET: 'container-smoke-shared-secret-32-bytes',
      STATISTICS_DATA_DIR: '/tmp/statistics-smoke'
    }
  },
  sheet: {
    port: 4173,
    path: '/api/health',
    env: {
      NODE_ENV: 'production',
      ALLOW_SHEET_WRITES: 'false',
      COMPANY_SSO_REQUIRED: 'false'
    }
  },
  iap: {
    port: 4180,
    path: '/api/health',
    env: {
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      HOST: '0.0.0.0',
      COOKIE_SECURE: 'false',
      APP_ORIGIN: 'http://127.0.0.1:4180'
    }
  }
});

const value = (args, flag) => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${flag} 값이 필요합니다.`);
  return args[index + 1];
};

export function parseArguments(args) {
  if (args.length !== 4) throw new Error('--service와 --image만 지정해야 합니다.');
  const service = value(args, '--service');
  const image = value(args, '--image');
  if (!Object.hasOwn(services, service)) throw new Error(`지원하지 않는 서비스입니다: ${service}`);
  if (!/^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?:@sha256:[a-f0-9]{64})?$/.test(image))
    throw new Error('이미지 참조 형식이 올바르지 않습니다.');
  return { service, image };
}

export function runArguments({ service, image, name }) {
  const spec = services[service];
  return [
    'run', '--detach', '--name', name,
    '--publish', `127.0.0.1::${spec.port}`,
    ...Object.entries(spec.env).flatMap(([key, setting]) => ['--env', `${key}=${setting}`]),
    image
  ];
}

export function publishedOrigin(output, port) {
  const lines = String(output).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error('임시 컨테이너의 게시 포트를 하나로 확정할 수 없습니다.');
  const match = /^127\.0\.0\.1:(\d+)$/.exec(lines[0]);
  if (!match) throw new Error('임시 컨테이너의 게시 포트 응답이 올바르지 않습니다.');
  const hostPort = Number(match[1]);
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) throw new Error('게시 포트 범위가 올바르지 않습니다.');
  return { origin: `http://127.0.0.1:${hostPort}`, containerPort: port };
}

const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

async function waitForHealth(url, timeoutMilliseconds = 60_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError = '응답 없음';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3_000) });
      const body = await response.json();
      if (response.ok && body && (body.status === 'ok' || body.ok === true)) return body;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await wait(500);
  }
  throw new Error(`health 응답 시간이 초과되었습니다: ${lastError}`);
}

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export async function smoke({ service, image }, runtime = { docker, waitForHealth }) {
  const spec = services[service];
  const name = `workspace-smoke-${service}-${randomUUID()}`;
  let created = false;
  try {
    runtime.docker(...runArguments({ service, image, name }));
    created = true;
    let portOutput = '';
    for (let attempt = 0; attempt < 40 && !portOutput; attempt += 1) {
      try { portOutput = runtime.docker('port', name, `${spec.port}/tcp`); } catch { await wait(250); }
    }
    const { origin } = publishedOrigin(portOutput, spec.port);
    await runtime.waitForHealth(`${origin}${spec.path}`);
    return { service, image, endpoint: spec.path };
  } catch (error) {
    let logs = '';
    if (created) {
      try { logs = runtime.docker('logs', '--tail', '80', name); } catch { /* preserve the primary failure */ }
    }
    throw new Error(`${service} 컨테이너 smoke 실패: ${error.message}${logs ? `\n${logs}` : ''}`);
  } finally {
    if (created) {
      try { runtime.docker('rm', '--force', name); } catch { /* the exact temporary container may already be gone */ }
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const result = await smoke(parseArguments(args));
  console.log(`${result.service}: ${result.endpoint} container smoke passed (${result.image}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
