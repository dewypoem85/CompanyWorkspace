import type { Filters } from './types';

const responseCache = new Map<string, { etag: string; value: unknown }>();

export function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.version) params.set('version', filters.version);
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.minModeLevel) params.set('minModeLevel', filters.minModeLevel);
  if (filters.afterFirstMiddleBoss) params.set('afterFirstMiddleBoss', '1');
  return params;
}

export async function api<T>(path: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const cached = responseCache.get(path);
  const response = await fetch(path, {
    ...init, signal, credentials: 'same-origin', redirect: 'manual',
    headers: { Accept: 'application/json', ...(cached ? { 'If-None-Match': cached.etag } : {}), ...init?.headers }
  });
  if (response.status === 304 && cached) return cached.value as T;
  const payload = await response.json().catch(() => ({ error: '서버 응답을 해석하지 못했습니다.' }));
  if (!response.ok) {
    const error = new Error(payload.error || `요청에 실패했습니다. (HTTP ${response.status})`) as Error & { status?: number; payload?: unknown };
    error.status = response.status; error.payload = payload; throw error;
  }
  const etag = response.headers.get('etag');
  if (etag && response.status === 200) responseCache.set(path, { etag, value: payload });
  return payload as T;
}

export function clearApiCache(): void { responseCache.clear(); }
