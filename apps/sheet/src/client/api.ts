import type {
  AnalysisResult,
  ApiError,
  KoreanSyncPreview,
  RuntimeConfig,
  SnapshotRecord,
} from '../shared/types';
import {readConfig, readAnalysis, readPreview, readSnapshots} from './sheetReads';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const current = () => { if(options?.signal?.aborted) throw new DOMException('Aborted','AbortError'); };
  current();
  const json = response.headers.get('content-type')?.toLowerCase().includes('application/json');
  let body: unknown = {};
  try { if (json) body = await response.json(); }
  catch { if (response.ok) throw new Error('서버 응답 형식을 확인하지 못했습니다. 다시 조회해 주세요.'); }
  current();
  if (!response.ok) {
    const error = body && typeof body === 'object' ? body as Partial<ApiError> & {loginUrl?: string} : {};
    if (response.status === 401 || response.status === 403) document.dispatchEvent(new Event('sheet-access-denied'));
    const loginUrl = typeof error.loginUrl === 'string' ? error.loginUrl : '';
    if (response.status === 401 && loginUrl) {
      window.CompanyWorkspace?.sessionExpired?.(loginUrl);
    }
    throw Object.assign(new Error(typeof error.error === 'string' ? error.error : `요청에 실패했습니다. (${response.status})`), {status:response.status});
  }
  if(!json) throw new Error('서버 응답 형식을 확인하지 못했습니다. 다시 조회해 주세요.');
  return body as T;
}

export const api = {
  config: (signal?: AbortSignal) => request<RuntimeConfig>('/api/config',{signal}).then(readConfig),
  analyze: (spreadsheet: string, signal?: AbortSignal) =>
    request<AnalysisResult>('/api/spreadsheets/analyze', {
      method: 'POST',
      body: JSON.stringify({ spreadsheet }),
      signal,
    }).then(readAnalysis),
  snapshots: (signal?: AbortSignal) =>
    request<Array<Omit<SnapshotRecord, 'entries'>>>('/api/snapshots',{signal}).then(readSnapshots),
  previewKoreanSync: (spreadsheet: string, signal?: AbortSignal) =>
    request<KoreanSyncPreview>('/api/sync/korean/preview', {
      method: 'POST',
      body: JSON.stringify({ spreadsheet }),
      signal,
    }).then(readPreview),
};
