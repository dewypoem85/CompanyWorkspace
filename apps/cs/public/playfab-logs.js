import { extractLogMessages } from './playfab-log-format.js';
import { prettyPrintJsonLossless } from './json-lossless.js';
import { isLogJobId, validateLogConfig, validateLogJob } from './log-search-contract.js';

let activeLifecycle;
export function currentLifecycle() { return activeLifecycle; }
export function mount() {
const state = {
  csrfToken: '',
  config: null,
  results: [],
  lastSearch: null,
  viewMode: 'simple',
  activeJobId: '',
  operation: null,
  busy: false,
  blocked: false,
  disposed: false,
  startUncertain: false,
  cancelPending: false,
  owner: '',
  disclosure: null
};
const readSession = window.CompanyReadSession.create();
const LOG_READ_CHANNELS = Object.freeze(['log-bootstrap', 'log-status']);
const LOG_READ_PATHS = new Set(['/api/config', '/api/playfab/log-search/config', '/api/playfab/log-search/status']);
const LOG_MUTATION_PATHS = new Set(['/api/playfab/log-search/search', '/api/playfab/log-search/cancel']);

const elements = {
  modeBadge: document.querySelector('#logModeBadge'),
  messageBox: document.querySelector('#logMessageBox'),
  form: document.querySelector('#logSearchForm'),
  sourceSummary: document.querySelector('#sourceSummary'),
  titleIdText: document.querySelector('#logTitleIdText'),
  playFabId: document.querySelector('#logPlayFabId'),
  query: document.querySelector('#logQuery'),
  queryError: document.querySelector('#logQueryError'),
  mode: document.querySelector('#logSearchMode'),
  eventName: document.querySelector('#logEventName'),
  from: document.querySelector('#logFrom'),
  fromError: document.querySelector('#logFromError'),
  to: document.querySelector('#logTo'),
  toError: document.querySelector('#logToError'),
  sort: document.querySelector('#logSort'),
  limit: document.querySelector('#logLimit'),
  searchButton: document.querySelector('#logSearchButton'),
  rangeHint: document.querySelector('#rangeHint'),
  longRangeConfirmation: document.querySelector('#longRangeConfirmation'),
  confirmLongRange: document.querySelector('#confirmLongRange'),
  longRangeConfirmationText: document.querySelector('#longRangeConfirmationText'),
  longRangeError: document.querySelector('#longRangeError'),
  jobCard: document.querySelector('#logJobCard'),
  jobTitle: document.querySelector('#logJobTitle'),
  jobStatus: document.querySelector('#logJobStatus'),
  jobProgressBar: document.querySelector('#logJobProgressBar'),
  jobProgressText: document.querySelector('#logJobProgressText'),
  jobStats: document.querySelector('#logJobStats'),
  cancelButton: document.querySelector('#logCancelButton'),
  resultCard: document.querySelector('#logResultCard'),
  resultSummary: document.querySelector('#logResultSummary'),
  resultCriteria: document.querySelector('#logResultCriteria'),
  scanStats: document.querySelector('#logScanStats'),
  scanWarning: document.querySelector('#logScanWarning'),
  results: document.querySelector('#logResults'),
  csvButton: document.querySelector('#logCsvButton'),
  viewButtons: [...document.querySelectorAll('[data-log-view]')]
};

setQuickRange(6);
initialize();

const scopeChanged = () => {
  state.blocked = true;
  cancelLogReads();
  state.operation?.controller.abort();
  state.operation = null;
  clearSavedJobId();
  state.activeJobId = '';
  state.csrfToken = '';
  clearResults();
  for (const input of [elements.query, elements.playFabId, elements.eventName]) input.value = '';
  elements.jobCard.classList.add('hidden');
  setBusy(false);
  showMessage('denied', '로그인 또는 접근 권한이 변경되었습니다. 새 화면에서 다시 확인해 주세요. 서버 검색이 취소된 것은 아닙니다.');
};
document.addEventListener('workspace-entity-scope-change', scopeChanged);
const dispose = event => {
  if (event?.persisted || state.disposed) return;
  state.disposed = true;
  readSession.dispose();
  state.operation?.controller.abort();
  state.operation = null;
  state.disclosure?.destroy();
  document.removeEventListener('workspace-entity-scope-change', scopeChanged);
  window.removeEventListener('pagehide', dispose);
};
window.addEventListener('pagehide', dispose);

elements.form.addEventListener('submit', handleSearch);
elements.query.addEventListener('input',()=>clearLogValidation(elements.query,elements.queryError));
elements.from.addEventListener('change', resetLongRangeConfirmation);
elements.from.addEventListener('change',()=>clearLogValidation(elements.from,elements.fromError));
elements.to.addEventListener('change', resetLongRangeConfirmation);
elements.to.addEventListener('change',()=>clearLogValidation(elements.to,elements.toError));
elements.confirmLongRange.addEventListener('change',()=>clearLogValidation(elements.confirmLongRange,elements.longRangeError));
elements.playFabId.addEventListener('input', resetLongRangeConfirmation);
elements.cancelButton.addEventListener('click', cancelActiveJob);
elements.csvButton.addEventListener('click', downloadCsv);
for (const button of elements.viewButtons) {
  button.addEventListener('click', () => setViewMode(button.dataset.logView));
}
for (const button of document.querySelectorAll('.quick-range')) {
  button.addEventListener('click', () => setQuickRange(Number(button.dataset.hours)));
}

async function initialize() {
  if (state.blocked || state.disposed || state.busy) return;
  const operation = beginOperation();
  showMessage('loading', '라이브 로그 검색 설정을 확인하고 있습니다.');
  try {
    const baseConfig = await readJson('log-bootstrap', '/api/config', undefined, operation);
    if (!baseConfig.csrfToken || !baseConfig.currentUser?.id) throw new Error('회사 계정 정보를 확인하지 못했습니다.');
    state.csrfToken = baseConfig.csrfToken;
    state.owner = String(baseConfig.currentUser.id);
    const config = validateLogConfig(await readJson('log-bootstrap', '/api/playfab/log-search/config', {}, operation));
    state.config = config;
    clearMessage();
    renderConfig(config);
    if (config.configured) {
      const jobId = readSavedJobId();
      if (jobId) {
        state.activeJobId = jobId;
        await readAndMonitorJob(operation, jobId);
      }
    }
  } catch (error) {
    if (isCurrent(operation)) reportFailure(error, Boolean(state.activeJobId));
  }
  finally { finishOperation(operation); }
}

function renderConfig(config) {
  if (!config.storageConfigured) {
    elements.modeBadge.textContent = 'LOG STORAGE DISABLED';
    setStatePill(elements.modeBadge, 'danger');
    elements.titleIdText.textContent = 'Azure 로그 저장소 설정 없음';
    elements.sourceSummary.textContent = 'Azure 로그 저장소 설정 없음';
    elements.searchButton.disabled = true;
    showMessage('error', 'Azure PlayFab 로그 저장소 설정이 없습니다. 서버 환경변수를 확인해 주세요.');
    return;
  }

  if (!config.titleConfigured) {
    elements.modeBadge.textContent = 'LIVE TITLE DISABLED';
    setStatePill(elements.modeBadge, 'danger');
    elements.titleIdText.textContent = 'PLAYFAB_LIVE_TITLE_ID 설정 없음';
    elements.sourceSummary.textContent = '라이브 Title 설정 없음';
    elements.searchButton.disabled = true;
    showMessage('error', 'PLAYFAB_LIVE_TITLE_ID가 설정되지 않았습니다. 로그 검색은 라이브 Title만 조회합니다.');
    return;
  }

  elements.searchButton.disabled = false;
  elements.titleIdText.textContent = `Title ID ${config.titleId}`;
  elements.sourceSummary.textContent = `라이브 Title ${config.titleId} · Azure Blob Parquet · 최대 ${config.maxConcurrentJobs || 1}개 검색 병렬 처리`;
  elements.modeBadge.textContent = 'LIVE LOG SEARCH';
  setStatePill(elements.modeBadge, 'warning');
  updateRangeHint();
}

function setStatePill(element, tone) {
  element.className = 'cw-state-pill';
  element.dataset.tone = tone;
}

async function handleSearch(event) {
  event.preventDefault();
  if (state.busy || state.blocked || state.disposed || state.activeJobId || state.startUncertain) return;

  let request;
  try {
    clearAllLogValidation();
    request = collectRequest();
  } catch (error) {
    showLogValidation(error.message);
    return;
  }

  const operation = beginOperation();
  clearResults();
  showMessage('loading', '검색 작업을 요청하고 있습니다.');
  try {
    const started = await mutateJson('/api/playfab/log-search/search', request, operation);
    // Retain a valid acknowledged ID even if the remainder needs a fresh status read.
    if (isLogJobId(started.job?.id)) saveJobId(started.job.id);
    validateLogJob(started.job, { titleId: state.config.titleId, request });
    saveJobId(started.job.id);
    await monitorJob(started.job, operation, request);
  } catch (error) {
    if (!isCurrent(operation)) return;
    if (!state.activeJobId && ![400, 409, 429].includes(error.statusCode)) state.startUncertain = true;
    reportFailure(error, Boolean(state.activeJobId));
  } finally {
    finishOperation(operation);
  }
}

function collectRequest() {
  if (!state.config?.configured) throw new Error('라이브 PlayFab 로그 검색 설정이 완료되지 않았습니다.');

  const query = elements.query.value.trim();
  if (!query) throw new Error('로그 검색어를 입력해 주세요.');

  const from = parseLocalInput(elements.from.value, '시작 시각');
  const to = parseLocalInput(elements.to.value, '종료 시각');
  if (to <= from) throw new Error('종료 시각은 시작 시각보다 뒤여야 합니다.');
  const longSearch = getLongRangeContext(from, to, elements.playFabId.value.trim());
  if (longSearch.required && !elements.confirmLongRange.checked) {
    throw new Error('장기 검색 안내를 확인하고 실행 확인란을 선택해 주세요.');
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    query,
    mode: elements.mode.value,
    sort: elements.sort.value,
    playFabId: elements.playFabId.value.trim(),
    eventName: elements.eventName.value.trim(),
    limit: Number(elements.limit.value),
    confirmLongRange: longSearch.required && elements.confirmLongRange.checked
  };
}

function renderResults(payload) {
  elements.resultCard.classList.remove('hidden');
  elements.resultSummary.textContent = `${payload.results.length}건 검색됨`;
  elements.resultCriteria.textContent = `${formatDate(payload.from)} ~ ${formatDate(payload.to)} · 검색어: ${payload.query} · UID: ${payload.playFabId || '전체'} · 이벤트: ${payload.eventName || '전체'}`;
  elements.scanStats.replaceChildren();

  addStat('라이브 Title', payload.titleId || '-');
  addStat('시간 파티션', `${formatNumber(payload.stats.partitions)}개`);
  addStat('발견한 Parquet', `${formatNumber(payload.stats.blobsListed)}개`);
  addStat('본문 검사 파일', `${formatNumber(payload.stats.blobsScanned)}개`);
  addStat('검사 이벤트', `${formatNumber(payload.stats.rowsScanned)}건`);
  if (payload.playFabId) addStat('UID로 건너뜀', `${formatNumber(payload.stats.blobsSkippedByUid)}개`);
  addStat('파일 오류', `${formatNumber(payload.stats.blobErrors)}개`);
  addStat('검색 시간', formatDuration(payload.durationMs));
  addStat('정렬', payload.sort === 'asc' ? '오래된순' : '최신순');

  elements.scanWarning.hidden = !payload.stats.blobErrors;
  if (payload.stats.blobErrors) window.CompanyState.render(elements.scanWarning, {
    kind: 'error', title: '일부 파일을 읽지 못했습니다.',
    message: `Parquet ${payload.stats.blobErrors}개를 읽지 못해 결과가 불완전합니다. 표시된 로그만 확인되었으며, 0건이어도 해당 기간에 로그가 없다는 뜻은 아닙니다.`
  });

  renderResultItems(payload.results);

  elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function resumeSavedJob() {
  if (state.busy || state.blocked || state.disposed) return;
  const jobId = state.activeJobId || readSavedJobId();
  if (!jobId) return;
  const operation = beginOperation();
  try {
    await readAndMonitorJob(operation, jobId);
  } catch (error) {
    if (isCurrent(operation)) reportFailure(error, true);
  } finally {
    finishOperation(operation);
  }
}

async function readAndMonitorJob(operation, jobId) {
  showMessage('loading', '기존 검색 작업의 상태를 확인합니다. 검색을 다시 실행하지 않습니다.');
  const payload = await readJson('log-status', '/api/playfab/log-search/status', { jobId }, operation);
  validateLogJob(payload.job, { jobId, titleId: state.config.titleId });
  saveJobId(jobId);
  await monitorJob(payload.job, operation);
}

async function monitorJob(initialJob, operation, request) {
  state.activeJobId = initialJob.id;
  let job = initialJob;
  elements.jobCard.classList.remove('hidden');

  while (isCurrent(operation)) {
    validateLogJob(job, { jobId: initialJob.id, titleId: state.config.titleId, request });
    renderJob(job);
    if (job.status === 'completed') {
      const result = job.result;
      clearSavedJobId();
      state.activeJobId = '';
      state.results = result.results;
      state.lastSearch = result;
      renderResults(result);
      showMessage(
        result.stats.blobErrors ? 'error' : (state.results.length ? 'success' : 'empty'),
        `라이브 로그 검색 완료: ${state.results.length}건 표시 · Parquet ${formatNumber(result.stats?.blobsScanned || 0)}개 본문 검사 · ${formatDuration(result.durationMs)}`
      );
      elements.jobCard.classList.add('hidden');
      elements.csvButton.disabled = !state.results.length;
      return;
    }
    if (job.status === 'failed') {
      clearSavedJobId();
      state.activeJobId = '';
      elements.jobCard.classList.add('hidden');
      showMessage('error', job.error || '로그 검색 작업에 실패했습니다.');
      return;
    }
    if (job.status === 'cancelled') {
      clearSavedJobId();
      state.activeJobId = '';
      elements.jobCard.classList.add('hidden');
      showMessage('empty', '검색 작업이 취소되었습니다. 완료된 검색 결과는 없습니다.');
      return;
    }

    showMessage('loading', job.cancelRequested ? '현재 파일 처리 후 취소합니다. 서버의 취소 완료를 기다리고 있습니다.' : '서버에서 로그를 검색하고 있습니다. 페이지를 잠시 벗어나도 검색은 계속됩니다.');
    await wait(state.config.pollIntervalMs, operation.controller.signal);
    assertCurrent(operation);
    const payload = await readJson('log-status', '/api/playfab/log-search/status', { jobId: job.id }, operation);
    job = payload.job;
  }
}

function renderJob(job) {
  const progress = job.progress || {};
  const total = Math.max(0, Number(progress.partitions || 0));
  const scanned = Math.max(0, Number(progress.partitionsScanned || 0));
  const percent = total > 0 ? Math.min(100, Math.round(scanned / total * 100)) : 0;
  const labels = {
    queued: '검색 대기 중',
    starting: '검색 준비 중',
    listing: 'Azure 파일 확인 중',
    scanning: 'Parquet 검색 중',
    yielding: '다음 시간대 준비 중',
    cancelling: '현재 파일 처리 후 취소 중',
    cancelled: '검색 취소됨',
    completed: '검색 완료',
    failed: '검색 실패'
  };
  const statusText = labels[progress.stage] || labels[job.status] || '검색 처리 중';
  elements.jobTitle.textContent = statusText;
  elements.jobStatus.textContent = job.status === 'queued' ? 'QUEUED' : 'RUNNING';
  setStatePill(elements.jobStatus, job.status === 'queued' ? 'neutral' : 'warning');
  elements.cancelButton.disabled = state.cancelPending || Boolean(job.cancelRequested);
  elements.cancelButton.textContent = job.cancelRequested ? '취소 요청됨' : '검색 취소';
  elements.cancelButton.classList.toggle('hidden', ['completed', 'failed', 'cancelled'].includes(job.status));
  elements.jobProgressBar.style.width = `${percent}%`;
  elements.jobProgressBar.setAttribute('aria-valuenow', String(percent));
  elements.jobProgressText.textContent = total
    ? `시간 파티션 ${formatNumber(scanned)} / ${formatNumber(total)} · ${percent}% · ${formatDuration(job.durationMs)}`
    : `${statusText} · ${formatDuration(job.durationMs)}`;
  elements.jobStats.replaceChildren();
  addJobStat('발견한 파일', `${formatNumber(progress.blobsListed)}개`);
  addJobStat('본문 검사', `${formatNumber(progress.blobsScanned)}개`);
  addJobStat('UID로 건너뜀', `${formatNumber(progress.blobsSkippedByUid)}개`);
  addJobStat('현재 결과', `${formatNumber(progress.resultCount)}건`);
}

function addJobStat(label, value) {
  const item = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = value;
  item.append(`${label} `, strong);
  elements.jobStats.append(item);
}

function saveJobId(jobId) {
  state.activeJobId = jobId;
  try {
    sessionStorage.setItem(`playfabLogSearchJobId:${state.owner}`, jobId);
    sessionStorage.removeItem('playfabLogSearchJobId');
  } catch { /* 저장소 비활성화 시 현재 탭에서만 추적 */ }
}

function readSavedJobId() {
  try {
    // Adopt legacy IDs only after the server verifies ownership on status lookup.
    const id = sessionStorage.getItem(`playfabLogSearchJobId:${state.owner}`) || sessionStorage.getItem('playfabLogSearchJobId');
    return isLogJobId(id) ? id : '';
  } catch { return ''; }
}

function clearSavedJobId() {
  try {
    sessionStorage.removeItem(`playfabLogSearchJobId:${state.owner}`);
    sessionStorage.removeItem('playfabLogSearchJobId');
  } catch { /* 무시 */ }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('관찰 중단', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function renderResultItems(results = state.results) {
  state.disclosure?.destroy();
  elements.results.replaceChildren();
  if (!results.length) {
    const empty = document.createElement('div');
    window.CompanyState.render(empty, state.lastSearch?.stats.blobErrors
      ? { kind: 'error', title: '확인된 결과가 없습니다.', message: '파일 오류가 있어 전체 기간의 로그 유무를 판단할 수 없습니다.' }
      : { kind: 'empty', title: '조건에 일치하는 로그가 없습니다.', message: '검색어 또는 기간을 변경해 확인해 주세요.' });
    elements.results.append(empty);
  } else {
    for (const [index, item] of results.entries()) {
      elements.results.append(state.viewMode === 'simple'
        ? createSimpleResultCard(item)
        : createDetailedResultCard(item, index));
    }
  }
  state.disclosure = window.CompanyDisclosure.attach(elements.results, { single: true });
}

function addStat(label, value) {
  const wrapper = document.createElement('div');
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  wrapper.append(dt, dd);
  elements.scanStats.append(wrapper);
}

function createSimpleResultCard(item) {
  const card = document.createElement('article');
  card.className = 'log-result log-result-simple';

  const messages = document.createElement('div');
  messages.className = 'log-message-list';
  for (const message of extractLogMessages(item.eventData, item.snippet)) {
    const row = document.createElement('p');
    row.className = 'log-message';
    row.textContent = message;
    messages.append(row);
  }

  const context = document.createElement('div');
  context.className = 'log-simple-context';
  context.append(
    metaText(formatDate(item.timestamp)),
    metaText(item.playFabId || 'UID 없음')
  );

  card.append(messages, context);
  return card;
}

function createDetailedResultCard(item, index) {
  const card = document.createElement('article');
  card.className = 'log-result';

  const header = document.createElement('div');
  header.className = 'log-result-header';
  header.append(
    headerValue('시각', formatDate(item.timestamp)),
    headerValue('이벤트', item.eventName || '-'),
    headerValue('PlayFab UID', item.playFabId || '-')
  );

  const body = document.createElement('div');
  body.className = 'log-result-body';
  const snippet = document.createElement('p');
  snippet.className = 'log-snippet';
  snippet.textContent = item.snippet || '(본문 없음)';

  const meta = document.createElement('div');
  meta.className = 'log-meta';
  meta.append(
    metaText(`Namespace: ${item.namespace || '-'}`),
    metaText(`Entity: ${item.entityType || '-'} / ${item.entityId || '-'}`),
    metaText(`Event ID: ${item.eventId || '-'}`)
  );

  const details = document.createElement('div');
  details.className = 'log-details';
  const summaryTemplate = document.createElement('template');
  summaryTemplate.innerHTML = '<button type="button" class="cw-button" data-size="compact"></button>';
  const summary = summaryTemplate.content.firstElementChild;
  summary.dataset.cwDisclosure = `log-${index}`;
  summary.textContent = item.eventDataTruncated ? 'EventData 보기 (응답 크기 제한으로 일부 생략)' : 'EventData 전체 보기';
  const panel = document.createElement('div');
  panel.dataset.cwDisclosurePanel = `log-${index}`;
  panel.hidden = true;
  const pre = document.createElement('pre');
  pre.className = 'log-json';
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', 'EventData 원문 JSON');
  pre.textContent = prettyEventData(item.eventData);
  const source = document.createElement('div');
  source.className = 'log-meta';
  source.textContent = `Source: ${item.sourceBlob || '-'}`;
  panel.append(pre, source);
  details.append(summary, panel);

  body.append(snippet, meta, details);
  card.append(header, body);
  return card;
}

function headerValue(label, value) {
  const wrapper = document.createElement('div');
  const small = document.createElement('small');
  const strong = document.createElement('strong');
  small.textContent = label;
  strong.textContent = value;
  wrapper.append(small, strong);
  return wrapper;
}

function metaText(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}

function prettyEventData(value) {
  const text = String(value || '');
  try {
    return prettyPrintJsonLossless(text);
  } catch {
    return text;
  }
}

function setQuickRange(hours) {
  const to = new Date();
  to.setSeconds(0, 0);
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  elements.from.value = toLocalInputValue(from);
  elements.to.value = toLocalInputValue(to);
  elements.confirmLongRange.checked = false;
  updateRangeHint();
}

function updateRangeHint() {
  const from = new Date(elements.from.value);
  const to = new Date(elements.to.value);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    elements.rangeHint.classList.remove('range-warning');
    elements.longRangeConfirmation.classList.add('hidden');
    elements.confirmLongRange.checked = false;
    elements.rangeHint.textContent = '검색 기간을 확인해 주세요.';
    return;
  }
  const hours = (to - from) / 3_600_000;
  const uid = elements.playFabId.value.trim();
  const firstPartitionMs = Math.floor(from.getTime() / 3_600_000) * 3_600_000;
  const estimatedPartitions = Math.max(1, Math.ceil((to.getTime() - firstPartitionMs) / 3_600_000));
  const longSearch = getLongRangeContext(from, to, uid);
  elements.rangeHint.classList.toggle('range-warning', longSearch.required);
  elements.longRangeConfirmation.classList.toggle('hidden', !longSearch.required);
  elements.longRangeConfirmationText.textContent = longSearch.message;
  elements.rangeHint.textContent = [
    formatRange(hours),
    `약 ${estimatedPartitions.toLocaleString('ko-KR')}개 시간 파티션`,
    uid ? 'UID 파일 선별 사용' : 'UID 없음: 해당 기간 전체 본문 검사',
    longSearch.required ? '확인 후 실행되며 언제든 취소할 수 있습니다.' : ''
  ].filter(Boolean).join(' · ');
}

function resetLongRangeConfirmation() {
  elements.confirmLongRange.checked = false;
  updateRangeHint();
}

function getLongRangeContext(from, to, playFabId) {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  const thresholds = state.config?.longSearchConfirmation || {};
  const warningHours = playFabId
    ? Number(thresholds.withUidHours || 24 * 7)
    : Number(thresholds.withoutUidHours || 24);
  return {
    required: hours > warningHours,
    message: playFabId
      ? `${formatRange(warningHours)}을 넘는 UID 검색입니다. 약 ${formatNumber(Math.ceil(hours))}개 시간대의 UID 컬럼을 나누어 확인합니다.`
      : `${formatRange(warningHours)}을 넘는 전체 본문 검색입니다. 약 ${formatNumber(Math.ceil(hours))}개 시간대의 EventData를 검사하므로 오래 걸릴 수 있습니다.`
  };
}

async function cancelActiveJob() {
  const operation = state.operation, jobId = state.activeJobId;
  if (!jobId || !isCurrent(operation) || elements.cancelButton.disabled || state.cancelPending) return;
  state.cancelPending = true;
  elements.cancelButton.disabled = true;
  elements.cancelButton.textContent = '취소 요청 중...';
  try {
    const payload = await mutateJson('/api/playfab/log-search/cancel', { jobId }, operation);
    validateLogJob(payload.job, { jobId, titleId: state.config.titleId });
    // Polling owns completion; a late cancel reply cannot replace completed/new results.
    if (!isCurrent(operation) || state.activeJobId !== jobId) return;
    if (!['completed', 'failed', 'cancelled'].includes(payload.job.status)) renderJob(payload.job);
  } catch (error) {
    if (isCurrent(operation) && state.activeJobId === jobId) {
      if ([401, 403].includes(error.statusCode)) reportFailure(error, true);
      else showMessage('error', `취소 여부를 확인하지 못했습니다. 검색 상태는 계속 확인합니다. ${error.message}`);
    }
  } finally {
    if (isCurrent(operation) && state.activeJobId === jobId) state.cancelPending = false;
  }
}

function toLocalInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseLocalInput(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}을 입력해 주세요.`);
  return date;
}

function downloadCsv() {
  if (!state.results.length || !state.lastSearch) return;
  const rows = [[
    'Timestamp', 'TitleId', 'PlayFabId', 'EventName', 'Namespace', 'EntityType', 'EntityId', 'EventId', 'Snippet', 'EventData', 'SourceBlob'
  ]];
  for (const item of state.results) {
    rows.push([
      item.timestamp,
      item.titleId,
      item.playFabId,
      item.eventName,
      item.namespace,
      item.entityType,
      item.entityId,
      item.eventId,
      item.snippet,
      item.eventData,
      item.sourceBlob
    ]);
  }
  const csv = '\ufeff' + rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `playfab-log-search-live-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function cancelLogReads() {
  for (const channel of LOG_READ_CHANNELS) readSession.cancel(channel);
}

async function readJson(channel, path, body, operation) {
  assertCurrent(operation);
  if (!LOG_READ_CHANNELS.includes(channel) || !LOG_READ_PATHS.has(path)) throw new Error('허용되지 않은 로그 조회 요청입니다.');
  const result = await readSession.run(channel, async signal => {
    const payload = await transportJson(path, body, signal);
    signal.throwIfAborted();
    assertCurrent(operation);
    return payload;
  }, 45_000);
  if (result.status === 'cancelled' || !isCurrent(operation) || !result.isCurrent?.()) {
    assertCurrent(operation);
    throw new DOMException('이전 로그 조회 응답', 'AbortError');
  }
  if (result.status === 'error') {
    if (result.error?.message === '조회 시간이 초과되었습니다. 다시 시도해 주세요.') {
      throw new Error('응답 확인 시간이 초과되었습니다. 서버 작업 취소를 의미하지 않습니다.');
    }
    throw result.error;
  }
  return result.value;
}

async function mutateJson(path, body, operation) {
  assertCurrent(operation);
  if (!LOG_MUTATION_PATHS.has(path) || body === undefined) throw new Error('허용되지 않은 로그 변경 요청입니다.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  operation.controller.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 45_000);
  try {
    const payload = await transportJson(path, body, controller.signal);
    assertCurrent(operation);
    if (controller.signal.aborted) throw new Error('응답 확인 시간이 초과되었습니다. 서버 작업 취소를 의미하지 않습니다.');
    return payload;
  } catch (error) {
    if (isCurrent(operation) && controller.signal.aborted) throw new Error('응답 확인 시간이 초과되었습니다. 서버 작업 취소를 의미하지 않습니다.');
    throw error;
  } finally {
    clearTimeout(timer);
    operation.controller.signal.removeEventListener('abort', abort);
  }
}

async function transportJson(path, body, signal) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken, 'X-CS-Return-Url': currentReturnUrl() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  signal.throwIfAborted();
  const payload = await parseResponse(response);
  signal.throwIfAborted();
  return payload;
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      const error = new Error(`서버 응답을 해석하지 못했습니다. (HTTP ${response.status})`);
      if (!response.ok) error.statusCode = response.status;
      throw error;
    }
  }
  if (!response.ok) {
    const error = new Error(typeof payload?.error === 'string' ? payload.error : `요청에 실패했습니다. (HTTP ${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('검색 응답 형식이 올바르지 않습니다.');
  return payload;
}

function setViewMode(mode) {
  if (!['simple', 'detail'].includes(mode) || state.viewMode === mode) return;
  state.viewMode = mode;
  for (const button of elements.viewButtons) {
    const selected = button.dataset.logView === mode;
    button.setAttribute('aria-pressed', String(selected));
  }
  renderResultItems();
}

function currentReturnUrl() {
  return `${window.location.pathname}${window.location.search}`;
}

function setBusy(busy) {
  state.busy = busy;
  elements.searchButton.disabled = busy || state.blocked || state.startUncertain || Boolean(state.activeJobId) || !state.config?.configured;
  elements.form.setAttribute('aria-busy', String(busy));
  elements.searchButton.textContent = busy ? 'Parquet 검색 중...' : '로그 검색';
}

function showMessage(kind, text, action) {
  if((kind==='success'||kind==='empty')&&!action){elements.messageBox.hidden=true;window.CompanyToast.show({id:'log-result',kind,title:kind==='success'?'로그 검색 완료':'검색 결과 안내',message:text});return;}
  elements.messageBox.hidden = false;
  const titles = { loading: '검색 진행 중', error: '로그 검색 확인 필요', denied: '계정 확인 필요', success: '로그 검색 완료', empty: '검색 결과 안내' };
  window.CompanyState.render(elements.messageBox, { kind, title: titles[kind], message: text, ...action });
  if (kind === 'error' || kind === 'denied') elements.messageBox.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function showLogValidation(message){
  const candidates=[[/검색어/,elements.query,elements.queryError],[/종료 시각/,elements.to,elements.toError],[/시작 시각/,elements.from,elements.fromError],[/장기 검색/,elements.confirmLongRange,elements.longRangeError]];
  const [,target,errorNode]=candidates.find(([pattern])=>pattern.test(message))||candidates[0];
  target.setAttribute('aria-invalid','true');errorNode.hidden=false;errorNode.textContent=message;
  window.CompanyToast.show({id:'log-validation',kind:'error',title:'검색 조건 확인 필요',message,duration:0});target.focus();
}
function clearLogValidation(target,errorNode){target.removeAttribute('aria-invalid');errorNode.hidden=true;errorNode.textContent='';if(!elements.form.querySelector('[aria-invalid="true"]'))window.CompanyToast.dismiss('log-validation');}
function clearAllLogValidation(){for(const [target,error] of [[elements.query,elements.queryError],[elements.from,elements.fromError],[elements.to,elements.toError],[elements.confirmLongRange,elements.longRangeError]])clearLogValidation(target,error);}

function clearMessage() {
  elements.messageBox.hidden = true;
}

function clearResults() {
  state.results = [];
  state.lastSearch = null;
  state.disclosure?.destroy();
  state.disclosure = null;
  elements.results.replaceChildren();
  elements.scanStats.replaceChildren();
  elements.resultCriteria.textContent = '';
  elements.scanWarning.hidden = true;
  elements.resultCard.classList.add('hidden');
  elements.csvButton.disabled = true;
}
function beginOperation() {
  cancelLogReads();
  state.operation?.controller.abort();
  state.cancelPending = false;
  const operation = { controller: new AbortController() };
  state.operation = operation;
  setBusy(true);
  return operation;
}
function isCurrent(operation) {
  return Boolean(operation && state.operation === operation && !operation.controller.signal.aborted && !state.blocked && !state.disposed);
}
function assertCurrent(operation) {
  if (!isCurrent(operation)) throw new DOMException('이전 계정 또는 화면의 응답', 'AbortError');
}
function finishOperation(operation) {
  if (state.operation !== operation) return;
  cancelLogReads();
  state.operation = null;
  operation.controller.abort();
  if (!state.disposed) setBusy(false);
}
function reportFailure(error, hasJob) {
  elements.jobCard.classList.add('hidden');
  if ([401, 403].includes(error.statusCode)) {
    state.blocked = true;
    cancelLogReads();
    state.operation?.controller.abort();
    clearSavedJobId();
    state.activeJobId = '';
    clearResults();
    for (const input of [elements.query, elements.playFabId, elements.eventName]) input.value = '';
    setBusy(false);
    showMessage('denied', '회사 계정 또는 로그 검색 접근 권한을 확인해 주세요. 기존 화면의 검색은 재전송하지 않습니다.', { actionLabel: '새 화면에서 확인', onAction: () => location.reload() });
    return;
  }
  if (hasJob && error.statusCode === 404) {
    clearSavedJobId();
    state.activeJobId = '';
    showMessage('error', '검색 작업이 만료되었거나 현재 계정에서 찾을 수 없습니다. 조건을 확인한 뒤 새 검색을 실행해 주세요.');
    return;
  }
  const action = hasJob
    ? { actionLabel: '검색 상태 재확인', onAction: resumeSavedJob }
    : state.startUncertain
      ? { actionLabel: '새 화면에서 확인', onAction: () => location.reload() }
      : !state.config
        ? { actionLabel: '설정 다시 확인', onAction: initialize } : {};
  showMessage('error', `${error.message}${hasJob ? ' 서버 검색은 계속될 수 있습니다. 기존 작업의 상태만 다시 확인합니다.' : state.startUncertain ? ' 검색 요청의 수신 여부가 불확실합니다. 자동 재전송하지 않습니다.' : ''}`, action);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}초`;
  return `${(value / 60_000).toFixed(1)}분`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(Number(value || 0));
}

function formatRange(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}분`;
  if (hours <= 48) return `${hours.toFixed(hours % 1 ? 1 : 0)}시간`;
  return `${(hours / 24).toFixed(1)}일`;
}
const lifetime={
  dispose,
  async beforeLeave(){
    if(!state.activeJobId&&!state.busy&&!state.startUncertain&&!state.cancelPending)return true;
    const job=state.activeJobId;
    const approved=await window.CompanyDialog.confirm({title:'로그 검색 진행 중',message:'이동하면 이 화면의 진행 상황 확인을 멈춥니다. 서버의 검색 작업은 계속될 수 있습니다.',confirmLabel:'이동',returnFocus:elements.searchButton});
    return approved&&job===state.activeJobId&&!state.cancelPending;
  }
};
activeLifecycle=lifetime;
return lifetime;
}
mount();
