import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  CONFIG_PATH,
  DATA_DIR,
  isJobRunning,
  onJobFinished,
  startJobInternal,
} from './smart-translator.js';

// ── 자동 번역 스케줄 ──────────────────────────────────────────────
// 설정은 config.json 의 `schedule` 항목에 저장하고(환경 설정 화면에서 편집),
// 실행 이력은 schedule_state.json 에 남긴다. 서버 프로세스가 켜져 있는 동안에만 동작한다.

export type OperationMode = 'fill_empty' | 'inspect_only' | 'audit_apply';

export interface ScheduleConfig {
  enabled: boolean;
  time: string; // 'HH:MM' (서버 PC 로컬 시간)
  days: number[]; // 0=일 ... 6=토
  mode: 'main' | 'test';
  sheet_name: string; // main: 시트 이름 또는 '[전체 공식 시트 일괄 검수]'
  sheet_url: string; // main: 해당 시트 URL ('ALL_OFFICIAL_I2_SHEETS' 가능)
  test_sheet_url: string; // test: 구글 시트 URL
  operation_mode: OperationMode;
  languages: string[]; // 빈 배열 = 시트에서 감지된 전체 언어
  catch_up_minutes: number; // 예정 시각을 놓쳤을 때(서버 재시작 등) 이 시간 안이면 늦게라도 실행
}

export interface ScheduleRunRecord {
  at: string; // ISO
  trigger: 'schedule' | 'manual' | 'dry-run';
  status: 'started' | 'success' | 'error' | 'skipped' | 'dry-run';
  message: string;
  mode?: 'main' | 'test';
  totalIssues?: number;
  target?: string; // 대상 시트 (메인: 시트 이름, 테스트: 시트 주소)
  operation_mode?: OperationMode;
  languages?: string[]; // 비어 있으면 시트에서 감지된 전체 언어
  started_at?: string; // 작업 시작 시각 (완료 기록에 소요 시간 계산용)
  duration_sec?: number;
  counts?: { new: number; corrected: number; suggested: number; passed: number };
}

interface ScheduleState {
  lastTriggerKey: string; // 'YYYY-MM-DD HH:MM' — 같은 예약 시각의 중복 실행 방지
  history: ScheduleRunRecord[];
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled: false,
  time: '03:00',
  days: [0, 1, 2, 3, 4, 5, 6],
  mode: 'main',
  sheet_name: '',
  sheet_url: '',
  test_sheet_url: '',
  operation_mode: 'fill_empty',
  languages: [],
  catch_up_minutes: 30,
};

const STATE_PATH = path.join(DATA_DIR, 'schedule_state.json');
const TICK_MS = 15_000;

// ── 순수 함수 (테스트 가능) ───────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseTime(time: string): { h: number; m: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((time || '').trim());
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

export function normalizeSchedule(input: any): ScheduleConfig {
  const base = { ...DEFAULT_SCHEDULE, ...(input && typeof input === 'object' ? input : {}) };
  const t = parseTime(String(base.time));
  const days = Array.isArray(base.days)
    ? Array.from(new Set(base.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))).sort()
    : DEFAULT_SCHEDULE.days;
  const ops: OperationMode[] = ['fill_empty', 'inspect_only', 'audit_apply'];
  return {
    enabled: Boolean(base.enabled),
    time: t ? `${pad(t.h)}:${pad(t.m)}` : DEFAULT_SCHEDULE.time,
    days: days as number[], // 비어 있으면 저장 시 검증에서 거부 (임의로 매일로 바꾸지 않음)
    mode: base.mode === 'test' ? 'test' : 'main',
    sheet_name: String(base.sheet_name || ''),
    sheet_url: String(base.sheet_url || ''),
    test_sheet_url: String(base.test_sheet_url || '').trim(),
    operation_mode: ops.includes(base.operation_mode) ? base.operation_mode : 'fill_empty',
    languages: Array.isArray(base.languages) ? base.languages.map(String).filter(Boolean) : [],
    catch_up_minutes: Math.min(720, Math.max(0, Math.floor(Number(base.catch_up_minutes ?? 30)) || 0)),
  };
}

/** 설정 검증: 문제가 있으면 사용자에게 보여줄 한국어 메시지 */
export function validateSchedule(cfg: ScheduleConfig): string | null {
  if (!parseTime(cfg.time)) return '실행 시각 형식이 올바르지 않습니다. (HH:MM)';
  if (cfg.days.length === 0) return '실행 요일을 하나 이상 선택해 주세요.';
  if (cfg.mode === 'test') {
    if (!cfg.test_sheet_url) {
      return '테스트 모드 예약에는 구글 스프레드시트 주소를 입력해야 합니다. (주소 칸이 비어 있습니다)';
    }
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\/(u\/\d+\/)?d\/[\w-]+/.test(cfg.test_sheet_url)) {
      return '구글 스프레드시트 주소 형식이 아닙니다. https://docs.google.com/spreadsheets/d/<시트ID>/... 형태로 입력해 주세요.';
    }
  } else if (!cfg.sheet_name) {
    return '번역할 대상 시트를 선택해 주세요.';
  }
  return null;
}

/** 다음 실행 예정 시각 (비활성/요일 없음이면 null) */
export function computeNextRun(cfg: ScheduleConfig, from: Date): Date | null {
  const t = parseTime(cfg.time);
  if (!cfg.enabled || !t || cfg.days.length === 0) return null;
  for (let i = 0; i < 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, t.h, t.m, 0, 0);
    if (d.getTime() > from.getTime() && cfg.days.includes(d.getDay())) return d;
  }
  return null;
}

/**
 * 지금 실행해야 하는 예약이 있는지 판단.
 * 오늘 예정 시각이 지났고, 늦어진 시간이 catch_up 범위 안이며, 같은 예약을 아직 실행하지 않았을 때 해당 키를 돌려준다.
 */
export function dueTriggerKey(cfg: ScheduleConfig, lastTriggerKey: string, now: Date): string | null {
  const t = parseTime(cfg.time);
  if (!cfg.enabled || !t || !cfg.days.includes(now.getDay())) return null;
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m, 0, 0);
  const lateMs = now.getTime() - scheduled.getTime();
  if (lateMs < 0 || lateMs > cfg.catch_up_minutes * 60_000 + TICK_MS) return null;
  const key = `${dateKey(now)} ${pad(t.h)}:${pad(t.m)}`;
  return key === lastTriggerKey ? null : key;
}

/** 예약 설정 → 수동 [번역 시작]과 같은 형식의 작업 옵션 */
export function buildJobOptions(cfg: ScheduleConfig): Record<string, unknown> {
  const isTest = cfg.mode === 'test';
  const isAll = !isTest && (cfg.sheet_url === 'ALL_OFFICIAL_I2_SHEETS' || cfg.sheet_name.includes('전체'));
  return {
    isTestMode: isTest,
    target_source_mode: isTest ? 'custom_url' : 'i2_official',
    i2_selected_sheet: isTest ? '테스트_시트' : cfg.sheet_name,
    target_sheet_url: isTest ? cfg.test_sheet_url : isAll ? 'ALL_OFFICIAL_I2_SHEETS' : cfg.sheet_url,
    target_languages: cfg.languages,
    operation_mode: cfg.operation_mode,
    full_audit_mode: cfg.operation_mode !== 'fill_empty',
    audit_apply_changes: cfg.operation_mode === 'audit_apply',
  };
}

// ── 저장소 ───────────────────────────────────────────────────────

function readConfigFile(): any {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {}
  return {};
}

export function loadSchedule(): ScheduleConfig {
  return normalizeSchedule(readConfigFile().schedule);
}

function saveScheduleToConfig(cfg: ScheduleConfig): void {
  const file = readConfigFile();
  file.schedule = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2), 'utf-8');
}

function loadState(): ScheduleState {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      return { lastTriggerKey: String(s.lastTriggerKey || ''), history: Array.isArray(s.history) ? s.history : [] };
    }
  } catch {}
  return { lastTriggerKey: '', history: [] };
}

function saveState(state: ScheduleState): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ...state, history: state.history.slice(-30) }, null, 2), 'utf-8');
  } catch {}
}

function record(rec: ScheduleRunRecord): void {
  const st = loadState();
  st.history.push(rec);
  saveState(st);
}

// ── 실행 ─────────────────────────────────────────────────────────

// 예약/수동 실행으로 시작한 작업의 종료를 이력에 반영하기 위한 표식
let pendingTrigger: 'schedule' | 'manual' | null = null;
// 완료 기록에도 같은 대상/방식을 남기기 위해 시작 시점의 설정을 보관
let pendingContext: Pick<ScheduleRunRecord, 'target' | 'operation_mode' | 'languages'> | null = null;

export function describeTarget(cfg: ScheduleConfig): string {
  if (cfg.mode === 'test') return `테스트 시트: ${cfg.test_sheet_url}`;
  return cfg.sheet_name ? `시트: ${cfg.sheet_name}` : '시트 미선택';
}

export function runScheduleNow(trigger: 'schedule' | 'manual', opts: { dryRun?: boolean } = {}): ScheduleRunRecord {
  const cfg = loadSchedule();
  const now = new Date();
  const invalid = validateSchedule(cfg);
  const mk = (status: ScheduleRunRecord['status'], message: string, extra: Partial<ScheduleRunRecord> = {}): ScheduleRunRecord => {
    const rec: ScheduleRunRecord = {
      at: now.toISOString(),
      trigger: opts.dryRun ? 'dry-run' : trigger,
      status,
      message,
      mode: cfg.mode,
      target: describeTarget(cfg),
      operation_mode: cfg.operation_mode,
      languages: cfg.languages,
      ...extra,
    };
    record(rec);
    return rec;
  };

  if (invalid) return mk('error', `설정 오류: ${invalid}`);
  if (isJobRunning()) return mk('skipped', '이미 다른 번역/검수 작업이 진행 중이라 이번 실행을 건너뜁니다.');

  const options = buildJobOptions(cfg);
  const desc = `${cfg.mode === 'test' ? '테스트' : '메인'} · ${cfg.mode === 'test' ? cfg.test_sheet_url : cfg.sheet_name} · ${cfg.operation_mode}`;
  if (opts.dryRun) {
    return mk('dry-run', `시뮬레이션: 번역 엔진을 시작하지 않고 작업 옵션만 확인했습니다. (${desc})`);
  }

  const result = startJobInternal(options);
  if (!result.ok) return mk('skipped', result.error);
  pendingTrigger = trigger;
  pendingContext = { target: describeTarget(cfg), operation_mode: cfg.operation_mode, languages: cfg.languages };
  return mk('started', `번역 작업을 시작했습니다. (${desc})`);
}

function tick(): void {
  try {
    const cfg = loadSchedule();
    const state = loadState();
    const key = dueTriggerKey(cfg, state.lastTriggerKey, new Date());
    if (!key) return;
    // 같은 예약을 다시 실행하지 않도록 먼저 표시한 뒤 시작
    state.lastTriggerKey = key;
    saveState(state);
    const rec = runScheduleNow('schedule');
    console.log(`[Schedule] ${key} → ${rec.status}: ${rec.message}`);
  } catch (err: any) {
    console.error('[Schedule] 틱 처리 오류:', err?.message || err);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (timer) return;
  onJobFinished((info) => {
    if (!pendingTrigger) return; // 수동 [번역 시작]으로 돌린 작업은 이력에 남기지 않음
    const trigger = pendingTrigger;
    const ctx = pendingContext;
    pendingTrigger = null;
    pendingContext = null;
    const started = info.startedAt ? new Date(info.startedAt).getTime() : NaN;
    const ended = info.completedAt ? new Date(info.completedAt).getTime() : Date.now();
    const duration = Number.isFinite(started) ? Math.max(0, Math.round((ended - started) / 1000)) : undefined;
    const sm = info.summary;
    record({
      at: info.completedAt || new Date().toISOString(),
      trigger,
      status: info.error ? 'error' : 'success',
      message: info.error
        ? `작업 실패: ${info.error}`
        : sm
        ? `작업 완료 — 신규 ${sm.new} · 교정 ${sm.corrected} · 제안 ${sm.suggested} (통과 ${sm.passed})`
        : `작업 완료 (${info.totalIssues ?? 0}건)`,
      mode: info.mode,
      totalIssues: info.totalIssues,
      ...(ctx || {}),
      started_at: info.startedAt || undefined,
      duration_sec: duration,
      counts: sm ? { new: sm.new, corrected: sm.corrected, suggested: sm.suggested, passed: sm.passed } : undefined,
    });
  });
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  const cfg = loadSchedule();
  const next = computeNextRun(cfg, new Date());
  console.log(`[Schedule] 스케줄러 시작 (${cfg.enabled ? `사용 중, 다음 실행: ${next ? next.toLocaleString() : '-'}` : '꺼짐'})`);
}

// ── API ──────────────────────────────────────────────────────────

function snapshot() {
  const schedule = loadSchedule();
  const next = computeNextRun(schedule, new Date());
  const state = loadState();
  return {
    success: true,
    schedule,
    next_run: next ? next.toISOString() : null,
    server_time: new Date().toISOString(),
    running: isJobRunning(),
    history: state.history.slice(-10).reverse(),
  };
}

export function handleGetSchedule(_req: Request, res: Response): void {
  res.json(snapshot());
}

export function handleSaveSchedule(req: Request, res: Response): void {
  const cfg = normalizeSchedule(req.body?.schedule ?? req.body);
  const invalid = cfg.enabled ? validateSchedule(cfg) : null;
  if (invalid) {
    res.status(400).json({ success: false, error: invalid });
    return;
  }
  try {
    saveScheduleToConfig(cfg);
    // 시각/요일을 바꾸면 이전 실행 표시를 새 설정 기준으로 다시 맞춘다
    // (오늘 이미 지난 시각으로 저장했을 때 즉시 실행되는 일을 막기 위해, 지난 시각이면 오늘 분은 실행 완료로 표시)
    const st = loadState();
    const t = parseTime(cfg.time);
    const now = new Date();
    const todayKey = t ? `${dateKey(now)} ${pad(t.h)}:${pad(t.m)}` : '';
    const passed = t ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m).getTime() <= now.getTime() : false;
    st.lastTriggerKey = passed ? todayKey : '';
    saveState(st);
  } catch (err: any) {
    res.status(500).json({ success: false, error: `스케줄 저장 실패: ${err?.message || err}` });
    return;
  }
  res.json(snapshot());
}

export function handleRunSchedule(req: Request, res: Response): void {
  const dryRun = req.body?.dry_run !== false; // 기본은 시뮬레이션 (실제 번역은 dry_run:false 를 명시해야 시작)
  const rec = runScheduleNow('manual', { dryRun });
  res.json({ ...snapshot(), result: rec });
}
