async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });

  const json = response.headers.get('content-type')?.toLowerCase().includes('application/json');
  let body: any = {};
  if (json) {
    try {
      body = await response.json();
    } catch {}
  }

  if (!response.ok) {
    throw new Error(body?.error || `요청 실패 (${response.status})`);
  }

  return body as T;
}

// 테스트 모드 화면과 자동 번역 스케줄이 함께 쓰는 기본 테스트 시트 주소
export const DEFAULT_TEST_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1U3RiHe6Ww8SOFW9vs5ae5yrMHypiMIMEUVgMBc7jFf0/edit?gid=0#gid=0';

// 실제로 연결된 용어집 시트 (엔진 open_glossary_worksheet 결과)
export interface GlossarySource {
  sheet_key: string;
  sheet_title: string;
  tab: string;
  gid: number;
  url: string;
  note?: string;
}

export interface ScheduleConfig {
  enabled: boolean;
  time: string;
  days: number[];
  mode: 'main' | 'test';
  sheet_name: string;
  sheet_url: string;
  test_sheet_url: string;
  operation_mode: 'fill_empty' | 'inspect_only' | 'audit_apply';
  languages: string[];
  catch_up_minutes: number;
}

export interface ScheduleRunRecord {
  at: string;
  trigger: 'schedule' | 'manual' | 'dry-run';
  status: 'started' | 'success' | 'error' | 'skipped' | 'dry-run';
  message: string;
  mode?: 'main' | 'test';
  totalIssues?: number;
  target?: string;
  operation_mode?: 'fill_empty' | 'inspect_only' | 'audit_apply';
  languages?: string[];
  started_at?: string;
  duration_sec?: number;
  counts?: { new: number; corrected: number; suggested: number; passed: number };
}

export interface ScheduleSnapshot {
  success: boolean;
  schedule: ScheduleConfig;
  next_run: string | null;
  server_time: string;
  running: boolean;
  history: ScheduleRunRecord[];
  result?: ScheduleRunRecord;
  error?: string;
}

export const api = {
  getSheets: (refresh = false, signal?: AbortSignal) =>
    request<{ success: boolean; configured?: boolean; error?: string; message?: string; sheets: Array<{ name: string; key: string; url: string }> }>(
      `/api/smart-translator/sheets${refresh ? '?refresh=true' : ''}`,
      { signal }
    ),
  getConfig: (signal?: AbortSignal) =>
    request<{ success: boolean; config: any }>('/api/smart-translator/config', { signal }),
  getResults: (mode: 'main' | 'test' = 'main', signal?: AbortSignal) =>
    request<{ success: boolean; data: any }>(`/api/smart-translator/results?mode=${mode}`, { signal }),
  clearResults: (mode: 'main' | 'test' = 'main', signal?: AbortSignal) =>
    request<{ success: boolean; message: string }>(`/api/smart-translator/results/clear?mode=${mode}`, {
      method: 'POST',
      signal,
    }),
  getStatus: (mode: 'main' | 'test' = 'main', signal?: AbortSignal) =>
    request<{ success: boolean; job: any }>(`/api/smart-translator/status?mode=${mode}`, { signal }),
  startJob: (options: any, signal?: AbortSignal) =>
    request<{ success: boolean; message: string }>('/api/smart-translator/start', {
      method: 'POST',
      body: JSON.stringify(options),
      signal,
    }),
  saveConfig: (options: any, signal?: AbortSignal) =>
    request<{ success: boolean; message: string }>('/api/smart-translator/config', {
      method: 'POST',
      body: JSON.stringify(options),
      signal,
    }),
  testKey: (payload: { provider: string; key?: string }, signal?: AbortSignal) =>
    request<{ success: boolean; message: string; models?: string[]; error?: string }>(
      '/api/smart-translator/test-key',
      {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      }
    ),
  getModels: (provider: string, refresh = false, signal?: AbortSignal) =>
    request<{ success: boolean; provider?: string; models?: string[]; error?: string }>(
      `/api/smart-translator/models?provider=${encodeURIComponent(provider)}${refresh ? '&refresh=1' : ''}`,
      { signal }
    ),
  detectLanguages: (payload: { target_sheet_url?: string; target_source_mode?: string; current_sheet_name?: string; refresh?: boolean; filename?: string }, signal?: AbortSignal) =>
    request<{
      success: boolean;
      count: number;
      languages: Array<{ code: string; name: string; label: string; raw_header: string }>;
      error?: string;
    }>('/api/smart-translator/detect-languages', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
  applyExcel: (
    payload?: {
      mode?: 'main' | 'test';
      target_sheet_url?: string;
      target_source_mode?: string;
      apply_corrections?: boolean;
      apply_suggestions?: boolean;
      apply_news?: boolean;
    },
    signal?: AbortSignal
  ) =>
    request<{
      success: boolean;
      message: string;
      details?: any;
      appliedItems?: Array<{
        key: string;
        korean: string;
        lang: string;
        old_val: string;
        new_val: string;
        reason: string;
        type: string;
      }>;
      logs?: string[];
    }>('/api/smart-translator/apply', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
      signal,
    }),
  getGlossary: (refresh = false, signal?: AbortSignal) =>
    request<{
      success: boolean;
      headers: string[];
      rows: Array<Record<string, any>>;
      synced_from_sheet: boolean;
      total: number;
      source?: GlossarySource | null;
      sheet_error?: string;
      sheet_empty?: boolean;
    }>(`/api/smart-translator/glossary${refresh ? '?refresh=true' : ''}`, { signal }),
  testGlossary: (url: string, signal?: AbortSignal) =>
    request<{ success: boolean; source?: GlossarySource; total?: number; languages?: string[]; warnings?: string[]; is_default?: boolean; error?: string }>(
      '/api/smart-translator/glossary/test',
      { method: 'POST', body: JSON.stringify({ url }), signal }
    ),
  saveGlossary: (
    payload: { headers: string[]; rows: Array<Record<string, any>>; expected_source?: GlossarySource | null; loaded_from_sheet?: boolean },
    signal?: AbortSignal
  ) =>
    request<{ success: boolean; message: string; sheet_synced: boolean; sheet_skip_reason?: string; source_changed?: boolean; error?: string }>(
      '/api/smart-translator/glossary',
      {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      }
    ),
  clearCache: (signal?: AbortSignal) =>
    request<{ success: boolean; cleared_count: number }>('/api/smart-translator/clear-cache', {
      method: 'POST',
      signal,
    }),
  getServiceAccounts: (mode: 'main' | 'test' = 'main', signal?: AbortSignal) =>
    request<{
      success: boolean;
      active: { filename: string; project_id: string; client_email: string; is_active: boolean } | null;
      accounts: Array<{ filename: string; project_id: string; client_email: string; is_active: boolean }>;
    }>(`/api/smart-translator/service-accounts?mode=${mode}`, { signal }),
  uploadServiceAccount: (
    payload: { filename?: string; content?: string; json?: any; mode?: 'main' | 'test' },
    signal?: AbortSignal
  ) =>
    request<{
      success: boolean;
      message: string;
      active: { filename: string; project_id: string; client_email: string; is_active: boolean } | null;
      accounts: Array<{ filename: string; project_id: string; client_email: string; is_active: boolean }>;
      error?: string;
    }>('/api/smart-translator/service-accounts/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
  selectServiceAccount: (filename: string, mode: 'main' | 'test' = 'main', signal?: AbortSignal) =>
    request<{
      success: boolean;
      message: string;
      active: { filename: string; project_id: string; client_email: string; is_active: boolean } | null;
      accounts: Array<{ filename: string; project_id: string; client_email: string; is_active: boolean }>;
      error?: string;
    }>('/api/smart-translator/service-accounts/select', {
      method: 'POST',
      body: JSON.stringify({ filename, mode }),
      signal,
    }),
  deleteServiceAccount: (filename: string, mode: 'main' | 'test' = 'main', signal?: AbortSignal) =>
    request<{
      success: boolean;
      message: string;
      active: { filename: string; project_id: string; client_email: string; is_active: boolean } | null;
      accounts: Array<{ filename: string; project_id: string; client_email: string; is_active: boolean }>;
      error?: string;
    }>('/api/smart-translator/service-accounts/delete', {
      method: 'POST',
      body: JSON.stringify({ filename, mode }),
      signal,
    }),
  testServiceAccount: (
    options?: string | { filename?: string; sheet_url?: string; target_sheet_url?: string },
    signal?: AbortSignal
  ) => {
    const payload = typeof options === 'string' ? { filename: options } : options || {};
    return request<{
      success: boolean;
      message?: string;
      email?: string;
      project_id?: string;
      filename?: string;
      sheet_info?: { title: string; worksheets: string[]; count: number };
      error?: string;
    }>('/api/smart-translator/service-accounts/test', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    });
  },
  getSchedule: (signal?: AbortSignal) =>
    request<ScheduleSnapshot>('/api/smart-translator/schedule', { signal }),
  saveSchedule: (schedule: ScheduleConfig, signal?: AbortSignal) =>
    request<ScheduleSnapshot>('/api/smart-translator/schedule', {
      method: 'POST',
      body: JSON.stringify({ schedule }),
      signal,
    }),
  runSchedule: (dryRun: boolean, signal?: AbortSignal) =>
    request<ScheduleSnapshot>('/api/smart-translator/schedule/run', {
      method: 'POST',
      body: JSON.stringify({ dry_run: dryRun }),
      signal,
    }),
};
