import { isValidJson, prettyPrintJsonLossless } from './json-lossless.js';
import { diffTextLines } from './text-diff.js';
import { mutationKey, validateMutationResult, validatePlayerLookup, validatePlayerConfig, validatePlayerBaseConfig } from './player-data-contract.js';

let activeLifecycle;
export function currentLifecycle() { return activeLifecycle; }
export function mount() {
const state = {
  csrfToken: '', config: null, lookup: null, lookups: {}, activeKey: '', originals: {},
  dirty: false, saving: false, loading: false, rows: new Map(), pendingDeleteKey: '', editorDiff: null, diffTimer: null,
  diffPaintFrame: null, activeChangeIndex: -1, editorView: null,
  reviewing: false, scope: 0, scopeInvalid: false, mutationBlocked: false, recovery: null,
  dialogLifetime: null, dialogTarget: null, confirmationAbort: null,
  readOperation: null, disposed: false, requests: new Set(), disclosureApproval: null
};
const readSession = window.CompanyReadSession.create();
const PLAYER_READ_CHANNELS = Object.freeze(['player-bootstrap', 'player-lookup']);
const PLAYER_READ_PATHS = new Set(['/api/config', '/api/playfab/player-data/config', '/api/playfab/player-data/lookup']);
const PLAYER_MUTATION_PATHS = new Set(['/api/playfab/player-data/save', '/api/playfab/player-data/add', '/api/playfab/player-data/delete']);

const elements = Object.fromEntries([
  'modeBadge', 'messageBox', 'mutationState', 'addState', 'deleteState', 'interactionFields', 'addFields', 'deleteFields', 'lookupForm', 'environmentSelect', 'environmentMeta', 'playFabIdInput', 'playFabIdError',
  'lookupButton', 'editorCard', 'targetUid', 'dataSummary', 'keyFilterInput', 'refreshButton',
  'dataStoresContainer', 'detailPanel', 'closeDetailButton', 'keyMeta',
  'versionMeta', 'sizeMeta', 'updatedMeta', 'formatMeta', 'compressionMeta', 'permissionMeta',
  'jsonStatus', 'changeStatus', 'diffSummary', 'diffNavigator', 'previousChangeButton', 'changePosition',
  'nextChangeButton', 'jsonDiffLayer', 'jsonEditor', 'formatButton', 'resetButton', 'reasonInput',
  'confirmCheck', 'confirmTargetText', 'confirmKeyText', 'writeNotice', 'saveButton',
  'addDialog', 'addForm', 'addKeyInput', 'addValueInput', 'addValueStatus', 'formatAddValueButton',
  'addReasonInput', 'addConfirmCheck', 'addTargetText', 'addStoreText',
  'addStorePlayFabName', 'addSubmitButton', 'deleteDialog', 'deleteForm', 'deleteStoreText',
  'deleteKeyText', 'deleteKeyPreview', 'deleteValuePreview',
  'deleteReasonInput', 'deleteConfirmCheck', 'deleteTargetText',
  'deleteConfirmKeyText', 'deleteSubmitButton'
].map((id) => [id, document.querySelector(`#${id}`)]));

let restoringSelection = false;
const disclosures = window.CompanyDisclosure.attach(elements.dataStoresContainer, {
  single: true,
  beforeRequest: async ({key, open, signal}) => {
    if (!open || activeDisclosureKey() === key) return true;
    const approve = await confirmDiscard('현재 상세 편집 내용을 버리고 다른 키를 열까요?', signal);
    state.disclosureApproval = approve ? {key, approve} : null;
    return Boolean(approve?.());
  },
  beforeChange: ({key, open, requested}) => {
    if (!open) { rememberEditorView(); return true; } // No draft is discarded on close.
    if ((state.saving || state.loading || state.reviewing) && !restoringSelection) return false;
    const target = state.rows.get(key);
    const approval = state.disclosureApproval; state.disclosureApproval = null;
    return Boolean(target && !target.row.hidden && state.lookups[target.dataStore]?.keys.includes(target.key))
      && (restoringSelection || activeDisclosureKey() === key
        || (requested ? approval?.key === key && approval.approve() : !state.dirty));
  }
});
elements.dataStoresContainer.addEventListener('workspace-disclosure-change', ({detail}) => {
  if (!detail.open) return;
  const target = state.rows.get(detail.key);
  if (!target) return;
  if (activeDisclosureKey() !== detail.key) {
    state.lookup = state.lookups[target.dataStore];
    state.activeKey = target.key;
    state.dirty = false;
    state.editorView = null;
    elements.jsonEditor.value = originalValue() ?? '';
    elements.reasonInput.value = '';
    elements.confirmCheck.checked = false;
    renderRecordMetadata();
    validateEditor();
  }
  if (elements.detailPanel.parentNode !== target.content) target.content.append(elements.detailPanel);
  elements.detailPanel.hidden = false;
  if (state.editorView) {
    const {start,end,direction,top,left} = state.editorView;
    elements.jsonEditor.setSelectionRange(start,end,direction);
    elements.jsonEditor.scrollTo({top,left,behavior:'instant'});
  }
  scheduleDiffPaint();
});

initialize();
elements.lookupForm.addEventListener('submit', lookupPlayer);
elements.playFabIdInput.addEventListener('input', clearPlayerIdValidation);
elements.environmentSelect.addEventListener('change', handleEnvironmentChange);
elements.keyFilterInput.addEventListener('input', filterDataStores);
elements.refreshButton.addEventListener('click', refreshPlayerData);
elements.dataStoresContainer.addEventListener('click', handleStoreAction);
elements.closeDetailButton.addEventListener('click', closeDetail);
elements.jsonEditor.addEventListener('input', validateEditor);
elements.jsonEditor.addEventListener('scroll', scheduleDiffPaint, { passive: true });
elements.jsonEditor.addEventListener('keydown', handleDiffShortcut);
elements.previousChangeButton.addEventListener('click', () => navigateChange(-1));
elements.nextChangeButton.addEventListener('click', () => navigateChange(1));
elements.reasonInput.addEventListener('input', updateSaveButton);
elements.confirmCheck.addEventListener('change', updateSaveButton);
elements.formatButton.addEventListener('click', formatCurrentJson);
elements.resetButton.addEventListener('click', resetEditor);
elements.saveButton.addEventListener('click', savePlayerData);
elements.addForm.addEventListener('submit', addPlayerData);
for (const input of [elements.addKeyInput, elements.addValueInput, elements.addReasonInput]) {
  input.addEventListener('input', validateAddForm);
}
elements.addConfirmCheck.addEventListener('change', validateAddForm);
elements.formatAddValueButton.addEventListener('click', formatAddValue);
elements.deleteForm.addEventListener('submit', deletePlayerData);
for (const input of [elements.deleteReasonInput]) {
  input.addEventListener('input', validateDeleteForm);
}
elements.deleteConfirmCheck.addEventListener('change', validateDeleteForm);
for (const button of document.querySelectorAll('[data-close-dialog]')) {
  button.addEventListener('click', () => { if (!state.saving) state.dialogLifetime?.finish(null); });
}
const scopeChanged = () => {
  state.scope++;
  cancelPlayerReads();
  for (const request of state.requests) request.abort();
  if (state.readOperation) { state.readOperation = null; state.loading = false; }
  state.scopeInvalid = true;
  state.mutationBlocked = true;
  state.recovery = null;
  state.confirmationAbort?.abort();
  state.dialogLifetime?.finish(null);
  updateInteractionLock(); updateSaveButton(); validateAddForm(); validateDeleteForm();
  showMessage('denied', '로그인·권한이 변경되었습니다. 이전 조회 응답을 적용하지 않습니다.', state.config ? lookupPlayer : initialize);
  renderMutationState('denied', '로그인·권한이 변경되었습니다.', '이전 편집 초안은 유지했습니다. 계정 확인 후 새로 조회해야 저장할 수 있습니다.');
};
document.addEventListener('workspace-entity-scope-change', scopeChanged);
const beforeUnload = (event) => {
  if (!state.dirty && !state.saving && !state.reviewing && !state.dialogLifetime) return;
  event.preventDefault();
  event.returnValue = '';
};
window.addEventListener('beforeunload', beforeUnload);
const editorObserver = new ResizeObserver(scheduleDiffPaint);
editorObserver.observe(elements.jsonEditor);
const themeObserver = new MutationObserver(scheduleDiffPaint);
themeObserver.observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
const dispose = event => {
  if (event?.persisted || state.disposed) return;
  state.disposed = true; state.scope++; state.readOperation = null;
  readSession.dispose();
  for (const request of state.requests) request.abort();
  state.confirmationAbort?.abort(); state.dialogLifetime?.finish(null);
  editorObserver.disconnect(); themeObserver.disconnect(); disclosures.destroy();
  clearTimeout(state.diffTimer); cancelAnimationFrame(state.diffPaintFrame);
  updateInteractionLock();
  document.removeEventListener('workspace-entity-scope-change', scopeChanged);
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('pagehide', dispose);
};
window.addEventListener('pagehide', dispose);

async function initialize() {
  if (state.loading || state.saving || state.reviewing || state.disposed) return;
  const operation = beginRead('config');
  showMessage('loading', '플레이어 데이터 설정을 확인하고 있습니다.');
  try {
    const base = validatePlayerBaseConfig(await readJson('player-bootstrap', '/api/config', undefined, operation.scope));
    assertRead(operation);
    state.csrfToken = base.csrfToken;
    const config = validatePlayerConfig(await readJson('player-bootstrap', '/api/playfab/player-data/config', {}, operation.scope));
    assertRead(operation);
    state.config = config;
    populateEnvironments(); renderEnvironment();
  } catch (error) {
    if (isCurrentRead(operation)) showMessage([401,403].includes(error.status) ? 'denied' : 'error', error.message, initialize);
  } finally { finishRead(operation); }
}

function readSignature() {
  return JSON.stringify([selectedEnvironment(), elements.playFabIdInput.value, state.activeKey,
    elements.jsonEditor.value, elements.reasonInput.value, elements.confirmCheck.checked]);
}
function beginRead(kind) {
  cancelPlayerReads();
  const operation = {kind, scope:state.scope, signature:readSignature()};
  state.readOperation = operation; state.loading = true;
  updateInteractionLock();
  return operation;
}
function isCurrentRead(operation) {
  return !state.disposed && state.readOperation === operation && state.scope === operation.scope;
}
function assertRead(operation) {
  assertCurrentScope(operation.scope);
  if (!isCurrentRead(operation)) throw Object.assign(new Error('이전 조회 응답은 적용하지 않았습니다.'), {stale:true});
  if (operation.signature !== readSignature()) throw new Error('조회 중 대상 또는 초안이 바뀌었습니다. 입력을 유지했으며 다시 조회해 주세요.');
}
function finishRead(operation) {
  if (!isCurrentRead(operation)) return;
  cancelPlayerReads();
  state.readOperation = null; state.loading = false;
  updateInteractionLock(); updateSaveButton();
}

function populateEnvironments() {
  elements.environmentSelect.replaceChildren();
  for (const id of ['live', 'test']) {
    const config = state.config?.environments?.[id];
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id === 'test' ? '테스트 서버' : '라이브 서버';
    option.disabled = !config?.configured;
    elements.environmentSelect.append(option);
  }
  const preferred = state.config?.environments?.[state.config.defaultEnvironment]?.configured
    ? state.config.defaultEnvironment
    : ['live', 'test'].find((id) => state.config?.environments?.[id]?.configured);
  if (preferred) elements.environmentSelect.value = preferred;
}

function renderEnvironment() {
  const config = selectedEnvironmentConfig();
  const label = selectedEnvironment() === 'test' ? '테스트 서버' : '라이브 서버';
  if (!config?.configured) {
    elements.modeBadge.textContent = 'PLAYFAB DISABLED';
    setModeTone('danger');
    elements.environmentMeta.textContent = `${label} · 설정 없음`;
    elements.lookupButton.disabled = true;
    showMessage('error', `${label} PlayFab Title ID 또는 Secret Key가 설정되지 않았습니다.`);
    return;
  }
  elements.lookupButton.disabled = false;
  elements.environmentMeta.textContent = `${label} · ${config.titleId ? `Title ID ${config.titleId}` : 'Mock 환경'}`;
  if (config.mode === 'mock') {
    elements.modeBadge.textContent = `PLAYFAB ${selectedEnvironment().toUpperCase()} · MOCK`;
    setModeTone('warning');
  } else if (config.writeEnabled) {
    elements.modeBadge.textContent = `PLAYFAB ${selectedEnvironment().toUpperCase()} · WRITE ENABLED`;
    setModeTone(selectedEnvironment() === 'live' ? 'danger' : 'warning');
  } else {
    elements.modeBadge.textContent = `PLAYFAB ${selectedEnvironment().toUpperCase()} · READ ONLY`;
    setModeTone('neutral');
  }
  clearMessage();
}

function setModeTone(tone) { elements.modeBadge.className = 'cw-state-pill'; elements.modeBadge.dataset.tone = tone; }

async function handleEnvironmentChange() {
  if (state.loading || state.saving || state.reviewing || state.disposed) return;
  const selected = selectedEnvironment(), previous = state.lookup?.environment || selected;
  const approve = await confirmDiscard('편집 중인 변경사항을 버리고 서버를 변경할까요?');
  if (!approve?.()) {
    if (selectedEnvironment() === selected) elements.environmentSelect.value = previous;
    return;
  }
  clearLookup();
  renderEnvironment();
}

async function lookupPlayer(event) {
  event?.preventDefault();
  if (state.loading || state.saving || state.reviewing || state.disposed || !state.config) return;
  const approve = await confirmDiscard('편집 중인 변경사항을 버리고 새로 조회할까요?');
  if (!approve?.()) return;
  const playFabId = elements.playFabIdInput.value.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(playFabId)) {
    showPlayerIdValidation('올바른 PlayFab UID를 입력해 주세요.'); return;
  }
  await readPlayer({environment:selectedEnvironment(), playFabId});
}
async function refreshPlayerData() {
  if (state.loading || state.saving || state.reviewing || state.disposed || !state.lookup) return;
  const approve = await confirmDiscard('편집 중인 변경사항을 버리고 최신 데이터를 불러올까요?');
  if (!approve?.()) return;
  await readPlayer({environment:state.lookup.environment, playFabId:state.lookup.playFabId},
    {dataStore:state.lookup.dataStore, key:state.activeKey});
}
async function readPlayer(target, preferred = null) {
  const operation = beginRead('lookup');
  showMessage('loading', '세 저장소의 데이터를 조회하고 있습니다.');
  try {
    const result = await requestLookup(target.environment, target.playFabId, operation.scope);
    assertRead(operation);
    applyLookup(result, preferred);
    clearMessage();window.CompanyToast.show({id:'player-lookup',kind:'success',title:'조회 완료',message:`${result.environmentLabel} · ${result.playFabId}의 세 저장소 ${result.totalKeys}개 키를 조회했습니다.`});
    elements.editorCard.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (error) {
    if (!isCurrentRead(operation)) return;
    state.mutationBlocked = true;
    if ([401,403].includes(error.status)) state.scopeInvalid = true;
    showMessage([401,403].includes(error.status) ? 'denied' : 'error',
      `${error.message} 기존 조회 결과와 편집 초안은 유지했습니다. 새 조회 성공 전에는 저장하지 않습니다.`,
      preferred ? refreshPlayerData : lookupPlayer);
  } finally { finishRead(operation); }
}
async function requestLookup(environment, playFabId, scope = state.scope) {
  if (state.scopeInvalid) {
    const base = validatePlayerBaseConfig(await readJson('player-bootstrap', '/api/config', undefined, scope));
    assertCurrentScope(scope);
    state.csrfToken = base.csrfToken;
    const config = validatePlayerConfig(await readJson('player-bootstrap', '/api/playfab/player-data/config', {}, scope));
    assertCurrentScope(scope); state.config = config;
  }
  const target = {environment, playFabId};
  const result = validatePlayerLookup(await readJson('player-lookup', '/api/playfab/player-data/lookup', {...target, dataStore:'all'}, scope), target);
  assertCurrentScope(scope);
  return result;
}

function applyLookup(result, preferred = null) {
  state.scopeInvalid = false;
  state.mutationBlocked = false;
  state.recovery = null;
  elements.mutationState.hidden = true;
  state.lookups = Object.fromEntries((result.stores || []).map((store) => [store.dataStore, store]));
  state.lookup = state.lookups[preferred?.dataStore] || state.lookups.user || result.stores?.[0] || null;
  state.originals = Object.fromEntries((result.stores || []).map((store) => [
    store.dataStore,
    Object.fromEntries(Object.entries(store.records || {}).map(([key, record]) => [key, displayEditorValue(record)]))
  ]));
  state.activeKey = '';
  state.dirty = false;
  elements.targetUid.textContent = result.playFabId;
  elements.confirmTargetText.textContent = result.playFabId;
  elements.addTargetText.textContent = result.playFabId;
  elements.deleteTargetText.textContent = result.playFabId;
  elements.reasonInput.value = '';
  elements.confirmCheck.checked = false;
  elements.keyFilterInput.value = '';
  elements.editorCard.classList.remove('hidden');
  elements.dataSummary.textContent = `${result.environmentLabel} · 3개 저장소 · 총 ${result.totalKeys}개 키`;
  renderDataStores();
  if (preferred?.key && state.lookup?.keys.includes(preferred.key)) {
    restoreSelection(state.lookup.dataStore, preferred.key);
  } else {
    hideDetailPanel();
  }
}

function renderDataStores() {
  if (!Object.keys(state.lookups).length) return;
  // Park the single editor before replacing wrappers; values, caret and scroll stay on the node.
  elements.detailPanel.hidden = true;
  elements.editorCard.append(elements.detailPanel);
  state.rows.clear();
  const sections = (state.config?.dataStores || [])
    .map((config) => state.lookups[config.id])
    .filter(Boolean)
    .map((lookup) => createStoreSection(lookup));
  elements.dataStoresContainer.replaceChildren(...sections);
  disclosures.refresh();
  filterDataStores();
}

function filterDataStores() {
  const query = elements.keyFilterInput.value.trim().toLocaleLowerCase('ko-KR');
  for (const lookup of Object.values(state.lookups)) {
    let visible = 0;
    for (const key of lookup.keys) {
      const entry = state.rows.get(disclosureKey(lookup.dataStore, key));
      if (!entry) continue;
      const matches = !query || key.toLocaleLowerCase('ko-KR').includes(query)
        || String(lookup.records[key]?.value ?? '').toLocaleLowerCase('ko-KR').includes(query);
      if (!matches) disclosures.setOpen(disclosureKey(lookup.dataStore, key), false, {returnFocus:elements.keyFilterInput});
      entry.row.hidden = !matches;
      if (matches) visible++;
    }
    const section = [...elements.dataStoresContainer.children].find(node => node.dataset.dataStore === lookup.dataStore);
    if (!section) continue;
    section.querySelector('[data-store-count]').textContent = `${visible}${query ? ` / ${lookup.keys.length}` : ''}개 키 · DataVersion ${lookup.dataVersion ?? '-'}`;
    const empty = section.querySelector('.empty-data');
    empty.hidden = visible > 0;
    if (!empty.hidden) window.CompanyState.render(empty, {kind:'empty',
      title:query ? '검색 결과가 없습니다.' : `설정된 ${lookup.dataStoreLabel}가 없습니다.`,
      message:query ? '다른 검색어를 입력해 주세요. 숨겨진 키의 편집 초안은 유지됩니다.'
        : lookup.writeEnabled ? '추가 버튼으로 새 키를 만들 수 있습니다.' : '현재 저장소는 읽기 전용입니다.'});
  }
}

function createStoreSection(lookup) {
  const section = document.createElement('section');
  section.className = 'data-store-section';
  section.dataset.dataStore = lookup.dataStore;

  const heading = document.createElement('header');
  heading.className = 'data-store-heading';
  const title = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'store-playfab-name';
  eyebrow.textContent = lookup.dataStorePlayFabName;
  const name = document.createElement('h3');
  name.textContent = lookup.dataStoreLabel;
  const meta = document.createElement('small');
  meta.dataset.storeCount = '';
  title.append(eyebrow, name, meta);
  const addTemplate = document.createElement('template');
  addTemplate.innerHTML = '<button type="button" class="cw-button" data-size="compact"></button>';
  const addButton = addTemplate.content.firstElementChild;
  addButton.dataset.action = 'add';
  addButton.dataset.store = lookup.dataStore;
  addButton.textContent = '+ 추가';
  addButton.disabled = !lookup.writeEnabled;
  heading.append(title, addButton);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'data-table-wrap cw-table-scroll';
  tableWrap.tabIndex = 0;
  tableWrap.setAttribute('role', 'region');
  tableWrap.setAttribute('aria-label', `${lookup.dataStoreLabel} 데이터 표`);
  const tableTemplate = document.createElement('template');
  tableTemplate.innerHTML = '<table class="data-table cw-data-table"><thead><tr><th>키</th><th>값 미리보기</th><th>형식</th><th>크기</th><th>마지막 변경</th><th><span class="sr-only">작업</span></th></tr></thead></table>';
  const table = tableTemplate.content.firstElementChild;
  const body = document.createElement('tbody');
  for (const key of lookup.keys) {
    const row = createDataRow(lookup, key), panel = document.createElement('tr');
    panel.className = 'inline-detail-row';
    panel.dataset.cwDisclosurePanel = disclosureKey(lookup.dataStore, key);
    panel.hidden = true;
    const cell = document.createElement('td'), content = document.createElement('div');
    cell.colSpan = 6;
    content.className = 'cw-table-detail';
    cell.append(content);panel.append(cell);body.append(row, panel);
    state.rows.set(disclosureKey(lookup.dataStore, key), {dataStore:lookup.dataStore, key, row, panel, content});
  }
  table.append(body);
  tableWrap.append(table);
  {
    const empty = document.createElement('div');
    empty.className = 'empty-data';
    tableWrap.append(empty);
  }
  section.append(heading, tableWrap);
  return section;
}

function createDataRow(lookup, key) {
  const record = lookup.records[key];
  const row = document.createElement('tr');
  row.dataset.key = key;
  row.dataset.store = lookup.dataStore;

  const keyCell = document.createElement('td');
  const keyTemplate = document.createElement('template');
  keyTemplate.innerHTML = '<button type="button" class="cw-button key-link" data-variant="quiet" data-size="compact" data-layout="content"></button>';
  const keyButton = keyTemplate.content.firstElementChild;
  keyButton.dataset.cwDisclosure = disclosureKey(lookup.dataStore, key);
  keyButton.dataset.store = lookup.dataStore;
  keyButton.dataset.key = key;
  const keyName = document.createElement('strong');
  keyName.textContent = key;
  const keyInfo = document.createElement('small');
  keyInfo.textContent = record?.compression === 'gzip-v1' ? 'GZip 자동 해제' : lookup.dataStorePlayFabName;
  keyButton.append(keyName, keyInfo);
  keyCell.append(keyButton);

  const valueCell = document.createElement('td');
  valueCell.className = 'value-preview-cell';
  const valuePreview = document.createElement('code');
  valuePreview.textContent = compactPreview(record?.value);
  valuePreview.title = String(record?.value || '');
  valueCell.append(valuePreview);

  const typeCell = document.createElement('td');
  const typeBadge = document.createElement('span');
  typeBadge.className = `data-type ${record?.jsonValid ? 'json' : 'text'}`;
  typeBadge.textContent = record?.jsonValid ? 'JSON' : 'TEXT';
  typeCell.append(typeBadge);

  const sizeCell = document.createElement('td');
  sizeCell.textContent = record?.compression !== 'plain'
    ? `${formatBytes(record?.bytes)} / ${formatBytes(record?.decodedBytes)}` : formatBytes(record?.bytes);
  const updatedCell = document.createElement('td');
  updatedCell.textContent = record?.lastUpdated ? formatDate(record.lastUpdated) : '-';

  const actionCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const detailButton = rowButton('상세', 'detail', lookup.dataStore, key);
  detailButton.dataset.cwDisclosure = disclosureKey(lookup.dataStore, key);
  detailButton.dataset.cwOpenLabel = '닫기';
  detailButton.dataset.cwClosedLabel = '상세';
  actions.append(
    detailButton,
    rowButton('삭제', 'delete', lookup.dataStore, key, !lookup.writeEnabled)
  );
  actionCell.append(actions);
  row.append(keyCell, valueCell, typeCell, sizeCell, updatedCell, actionCell);
  return row;
}

function rowButton(label, action, dataStore, key, disabled = false) {
  const template = document.createElement('template');
  template.innerHTML = '<button type="button" class="cw-button" data-size="compact"></button>';
  const button = template.content.firstElementChild;
  if (action === 'delete') button.dataset.variant = 'danger';
  button.dataset.action = action;
  button.dataset.store = dataStore;
  button.dataset.key = key;
  button.textContent = label;
  button.disabled = disabled;
  return button;
}

function handleStoreAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || button.matches(':disabled') || state.loading || state.saving || state.reviewing) return;
  if (button.dataset.action === 'add') openAddDialog(button.dataset.store);
  if (button.dataset.action === 'delete') openDeleteDialog(button.dataset.store, button.dataset.key);
}

function disclosureKey(dataStore, key) { return `${dataStore}:${key}`; }
function activeDisclosureKey() { return state.activeKey ? disclosureKey(state.lookup?.dataStore, state.activeKey) : ''; }
function rememberEditorView() {
  const editor = elements.jsonEditor;
  if (!state.activeKey || !editor.getClientRects().length) return;
  state.editorView = {start:editor.selectionStart,end:editor.selectionEnd,direction:editor.selectionDirection,top:editor.scrollTop,left:editor.scrollLeft};
}
function restoreSelection(dataStore, key) {
  const target = state.rows.get(disclosureKey(dataStore, key));
  if (!target || target.row.hidden) return false;
  restoringSelection = true;
  try { return disclosures.setOpen(disclosureKey(dataStore, key), true); }
  finally { restoringSelection = false; }
}
function closeDetail() {
  disclosures.setOpen(activeDisclosureKey(), false);
}

function hideDetailPanel() {
  closeDetail();
  state.activeKey = '';
  state.dirty = false;
  state.editorDiff = null;
  state.activeChangeIndex = -1;
  state.editorView = null;
  elements.detailPanel.hidden = true;
  elements.jsonEditor.value = '';
  elements.diffSummary.classList.add('hidden');
  elements.diffSummary.replaceChildren();
  elements.diffNavigator.classList.add('hidden');
  scheduleDiffPaint();
}

function renderRecordMetadata() {
  const record = currentRecord();
  elements.keyMeta.textContent = `${state.lookup.dataStoreLabel} / ${state.activeKey}`;
  elements.versionMeta.textContent = state.lookup.dataVersion ?? '-';
  elements.sizeMeta.textContent = record?.compression !== 'plain'
    ? `${formatBytes(record?.bytes)} 저장 · ${formatBytes(record?.decodedBytes)} 해제`
    : formatBytes(record?.bytes || 0);
  elements.updatedMeta.textContent = record?.lastUpdated ? formatDate(record.lastUpdated) : '-';
  elements.formatMeta.textContent = record?.jsonValid ? 'JSON · lossless 편집' : '일반 문자열';
  elements.compressionMeta.textContent = record?.compressionLabel || '압축 없음';
  elements.permissionMeta.textContent = record?.permission || 'Private';
  elements.formatButton.disabled = !record?.jsonValid;
  elements.confirmKeyText.textContent = state.activeKey;
  elements.writeNotice.textContent = state.lookup.writeEnabled
    ? (isCompressedSaveStore() && isSaveDataKey(state.activeKey)
      ? (record?.fallbackUsed
        ? `압축 오류로 기존 SaveData를 표시했습니다: ${record.compressionError} 저장하면 정상 gzip-v1으로 복구합니다.`
        : 'JSON의 64비트 숫자 원문을 보존하며, 저장할 때 gzip-v1으로 압축하고 기존 SaveData 키를 제거합니다.')
      : `선택한 ${state.lookup.dataStorePlayFabName} 키 하나만 갱신합니다. JSON 숫자 토큰은 원문 그대로 보존됩니다.`)
    : '현재 서버는 조회 전용입니다.';
}

function validateEditor() {
  const raw = elements.jsonEditor.value;
  const jsonValid = isValidJson(raw);
  let valid = true;
  let message = jsonValid ? '유효한 JSON · lossless 편집' : '일반 문자열';
  if (!jsonValid && isCompressedSaveStore() && isSaveDataKey(state.activeKey)) {
    valid = false;
    message = 'SaveData는 올바른 JSON이어야 합니다.';
  }
  const bytes = utf8Bytes(raw);
  if (bytes > Number(state.config?.maxValueBytes || 33554432)) {
    valid = false;
    message = `허용 크기를 초과했습니다 (${formatBytes(bytes)})`;
  }
  state.dirty = Boolean(state.lookup && state.activeKey) && raw !== (originalValue() ?? '');
  elements.jsonStatus.textContent = message;
  elements.jsonStatus.className = `json-status ${valid ? 'valid' : 'invalid'}`;
  elements.changeStatus.textContent = `${currentRecord()?.fallbackUsed ? '압축 복구 필요' : state.dirty ? '변경됨' : '변경 없음'} · 편집 ${formatBytes(bytes)}`;
  elements.jsonEditor.dataset.valid = String(valid);
  scheduleEditorDiff();
  updateSaveButton();
}

function scheduleEditorDiff() {
  window.clearTimeout(state.diffTimer);
  state.diffTimer = window.setTimeout(renderEditorDiff, 70);
}

function renderEditorDiff() {
  window.clearTimeout(state.diffTimer);
  state.diffTimer = null;
  if (!state.activeKey) {
    state.editorDiff = null;
    state.activeChangeIndex = -1;
    elements.diffSummary.classList.add('hidden');
    elements.diffSummary.replaceChildren();
    elements.diffNavigator.classList.add('hidden');
    scheduleDiffPaint();
    return;
  }

  state.editorDiff = diffTextLines(originalValue() ?? '', elements.jsonEditor.value);
  state.activeChangeIndex = -1;
  renderDiffSummary(state.editorDiff);
  renderDiffNavigator(state.editorDiff);
  scheduleDiffPaint();
}

function renderDiffSummary(diff) {
  elements.diffSummary.replaceChildren();
  elements.diffSummary.classList.toggle('hidden', !diff.changed);
  if (!diff.changed) return;
  if (diff.modifiedCount > 0) elements.diffSummary.append(diffChip('modified', `수정 ${diff.modifiedCount}줄`));
  if (diff.addedCount > 0) elements.diffSummary.append(diffChip('added', `추가 ${diff.addedCount}줄`));
  if (diff.removedCount > 0) elements.diffSummary.append(diffChip('removed', `삭제 ${diff.removedCount}줄`));
}

function diffChip(kind, label) {
  const chip = document.createElement('span');
  chip.className = 'diff-chip cw-state-pill';
  chip.dataset.tone = { modified: 'warning', added: 'success', removed: 'danger' }[kind];
  chip.textContent = label;
  return chip;
}

function renderDiffNavigator(diff) {
  const count = diff.changes.length;
  elements.diffNavigator.classList.toggle('hidden', count === 0);
  elements.previousChangeButton.disabled = count === 0;
  elements.nextChangeButton.disabled = count === 0;
  updateChangePosition();
}

function updateChangePosition() {
  const count = state.editorDiff?.changes?.length || 0;
  elements.changePosition.textContent = state.activeChangeIndex >= 0
    ? `${state.activeChangeIndex + 1} / ${count}`
    : `변경 ${count}곳`;
}

function handleDiffShortcut(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  if (!state.editorDiff?.changes?.length) return;
  event.preventDefault();
  navigateChange(event.key === 'ArrowUp' ? -1 : 1);
}

function navigateChange(direction) {
  const changes = state.editorDiff?.changes || [];
  if (changes.length === 0) return;

  let nextIndex;
  if (state.activeChangeIndex >= 0) {
    nextIndex = (state.activeChangeIndex + direction + changes.length) % changes.length;
  } else {
    const cursorLine = lineIndexAtOffset(elements.jsonEditor.value, elements.jsonEditor.selectionStart);
    if (direction > 0) {
      nextIndex = changes.findIndex((change) => change.targetLine >= cursorLine);
      if (nextIndex < 0) nextIndex = 0;
    } else {
      nextIndex = changes.findLastIndex((change) => change.targetLine <= cursorLine);
      if (nextIndex < 0) nextIndex = changes.length - 1;
    }
  }

  state.activeChangeIndex = nextIndex;
  const change = changes[nextIndex];
  const editor = elements.jsonEditor;
  const lineStart = offsetAtLine(editor.value, change.targetLine);
  const lineEnd = editor.value.indexOf('\n', lineStart);
  const lineText = editor.value.slice(lineStart, lineEnd < 0 ? editor.value.length : lineEnd);
  const firstContent = lineText.match(/^[ \t]*/)?.[0].length || 0;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(lineStart + firstContent, lineStart + firstContent);

  const { lineHeight, paddingTop } = readEditorLineMetrics(editor);
  editor.scrollTo({
    top: Math.max(0, paddingTop + (change.targetLine * lineHeight) - ((editor.clientHeight - lineHeight) / 2)),
    behavior: 'smooth'
  });
  updateChangePosition();
  scheduleDiffPaint();
}

function lineIndexAtOffset(value, offset) {
  let line = 0;
  for (let index = 0; index < Math.min(offset, value.length); index += 1) {
    if (value.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function offsetAtLine(value, targetLine) {
  if (targetLine <= 0) return 0;
  let line = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 10) continue;
    line += 1;
    if (line === targetLine) return index + 1;
  }
  return value.length;
}

function scheduleDiffPaint() {
  if (state.diffPaintFrame) return;
  state.diffPaintFrame = window.requestAnimationFrame(() => {
    state.diffPaintFrame = null;
    paintDiffLayer();
  });
}

function readEditorLineMetrics(editor, canvas = null) {
  const style = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(style.lineHeight) || 18;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  let contentTop = paddingTop;

  if (canvas) {
    const editorBounds = editor.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    contentTop = editorBounds.top - canvasBounds.top + borderTop + paddingTop;
  }

  return { lineHeight, paddingTop, contentTop };
}

function paintDiffLayer() {
  const canvas = elements.jsonDiffLayer;
  const editor = elements.jsonEditor;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(bounds.width * ratio);
  const height = Math.round(bounds.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  const colors = getComputedStyle(document.documentElement);
  const color = token => colors.getPropertyValue(token).trim();
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!state.editorDiff?.changed) return;

  const { lineHeight, paddingTop, contentTop } = readEditorLineMetrics(editor, canvas);
  const firstVisible = Math.max(0, Math.floor((editor.scrollTop - paddingTop) / lineHeight));
  const lastVisible = Math.min(state.editorDiff.lines.length - 1,
    Math.ceil((editor.scrollTop + editor.clientHeight) / lineHeight));

  for (let index = firstVisible; index <= lastVisible; index += 1) {
    const kind = state.editorDiff.lines[index]?.kind;
    if (kind === 'unchanged') continue;
    const y = contentTop + (index * lineHeight) - editor.scrollTop;
    context.fillStyle = kind === 'added' ? color('--cw-success-bg') : color('--cw-warning-bg');
    context.fillRect(0, y, bounds.width, lineHeight);
    context.fillStyle = kind === 'added' ? color('--cw-success') : color('--cw-warning');
    context.fillRect(0, y, 3, lineHeight);
  }

  for (const change of state.editorDiff.changes) {
    if (change.removedLines === 0 || change.targetLine < firstVisible || change.targetLine > lastVisible) continue;
    const y = contentTop + (change.targetLine * lineHeight) - editor.scrollTop;
    context.fillStyle = color('--cw-danger');
    context.fillRect(0, y - 1, bounds.width, 2);
  }

  const activeChange = state.editorDiff.changes[state.activeChangeIndex];
  if (!activeChange) return;
  const firstLine = activeChange.currentEnd > activeChange.currentStart
    ? activeChange.currentStart : activeChange.targetLine;
  const finalLine = activeChange.currentEnd > activeChange.currentStart
    ? activeChange.currentEnd - 1 : activeChange.targetLine;
  const y = contentTop + (firstLine * lineHeight) - editor.scrollTop;
  const activeHeight = Math.max(lineHeight, (finalLine - firstLine + 1) * lineHeight);
  context.strokeStyle = color('--cw-accent');
  context.lineWidth = 2;
  context.strokeRect(3, y, Math.max(0, bounds.width - 6), activeHeight);
}

function formatCurrentJson() {
  try {
    elements.jsonEditor.value = prettyPrintJsonLossless(elements.jsonEditor.value);
    validateEditor();
  } catch (error) {
    showMessage('error', `JSON을 정리할 수 없습니다: ${error.message}`);
  }
}

async function resetEditor() {
  const approve = await confirmDiscard('현재 편집 내용을 조회 당시 값으로 되돌릴까요?');
  if (!approve?.()) return;
  elements.jsonEditor.value = originalValue() ?? '';
  validateEditor();
}

function updateSaveButton() {
  const valid = elements.jsonEditor.dataset.valid === 'true';
  const repairNeeded = Boolean(currentRecord()?.fallbackUsed);
  elements.saveButton.disabled = state.saving || state.reviewing || state.scopeInvalid || state.mutationBlocked || state.disposed || !state.lookup?.writeEnabled || !valid || (!state.dirty && !repairNeeded)
    || elements.reasonInput.value.trim().length < 3 || !elements.confirmCheck.checked;
}

async function savePlayerData() {
  if (elements.saveButton.disabled) return;
  await runMutation('save', () => mutationRequest(state.activeKey, elements.jsonEditor.value,
    elements.reasonInput.value, elements.confirmCheck.checked));
}

function applySavedMutation(result) {
  const lookup = state.lookups[result.dataStore];
  if (!lookup || !result.editToken || !result.record) {
    throw new Error('저장은 완료되었지만 연속 편집 정보를 받지 못했습니다. 최신 데이터를 다시 조회해 주세요.');
  }

  const originals = state.originals[result.dataStore] || (state.originals[result.dataStore] = {});
  let replacementIndex = lookup.keys.length;
  for (const removedKey of result.removedKeys || []) {
    const removedIndex = lookup.keys.indexOf(removedKey);
    if (removedIndex >= 0) replacementIndex = Math.min(replacementIndex, removedIndex);
    lookup.keys = lookup.keys.filter((key) => key !== removedKey);
    delete lookup.records[removedKey];
    delete originals[removedKey];
  }

  if (!lookup.keys.includes(result.key)) lookup.keys.splice(replacementIndex, 0, result.key);
  lookup.records[result.key] = result.record;
  lookup.dataVersion = result.dataVersion;
  lookup.editToken = result.editToken;
  lookup.editTokenExpiresAt = result.editTokenExpiresAt;
  originals[result.key] = displayEditorValue(result.record);

  state.lookup = lookup;
  state.activeKey = result.key;
  state.dirty = false;
  state.editorView = null;
  elements.jsonEditor.value = originals[result.key];
  elements.reasonInput.value = '';
  elements.confirmCheck.checked = false;
  renderDataStores();
  restoreSelection(lookup.dataStore, result.key);
  renderRecordMetadata();
  validateEditor();
}

async function openAddDialog(dataStore) {
  if (!canMutate()) return;
  const opener = document.activeElement;
  const lookup = state.lookups[dataStore];
  if (!lookup?.writeEnabled) return;
  const approve = await confirmDiscard('상세 편집 내용을 버리고 새 데이터를 추가할까요?');
  if (!approve?.() || !canMutate() || state.lookups[dataStore] !== lookup) return;
  discardEditorChanges();
  hideDetailPanel();
  state.lookup = lookup;
  elements.addForm.reset();
  elements.addValueInput.value = '{}';
  elements.addTargetText.textContent = state.lookup.playFabId;
  elements.addStoreText.textContent = state.lookup.dataStoreLabel;
  elements.addStorePlayFabName.textContent = state.lookup.dataStorePlayFabName;
  validateAddForm();
  presentEditorDialog('add', opener);
}

function validateAddForm() {
  const key = elements.addKeyInput.value.trim();
  const value = elements.addValueInput.value;
  const jsonValid = isValidJson(value);
  const saveData = isCompressedSaveStore() && isSaveDataKey(key);
  const duplicate = Boolean(state.lookup) && (state.lookup.keys.includes(key)
    || (saveData && state.lookup.keys.some(isSaveDataKey)));
  const bytes = utf8Bytes(value);
  const validValue = bytes <= Number(state.config?.maxValueBytes || 33554432) && (!saveData || jsonValid);
  let status = jsonValid ? `유효한 JSON · ${formatBytes(bytes)}` : `일반 문자열 · ${formatBytes(bytes)}`;
  if (saveData && !jsonValid) status = 'SaveData는 올바른 JSON이어야 합니다.';
  if (bytes > Number(state.config?.maxValueBytes || 33554432)) status = '허용 크기를 초과했습니다.';
  if (duplicate) status = '같은 이름의 키가 이미 존재합니다.';
  elements.addValueStatus.textContent = status;
  elements.addValueStatus.className = `json-status ${validValue && !duplicate ? 'valid' : 'invalid'}`;
  elements.formatAddValueButton.disabled = !jsonValid;
  const keyValid = Boolean(key) && key.length <= 200 && !/[\u0000-\u001f]/.test(key) && !duplicate;
  elements.addSubmitButton.disabled = state.saving || state.reviewing || state.scopeInvalid || state.mutationBlocked || !state.lookup?.writeEnabled || !keyValid || !validValue
    || elements.addReasonInput.value.trim().length < 3 || !elements.addConfirmCheck.checked;
}

function formatAddValue() {
  try {
    elements.addValueInput.value = prettyPrintJsonLossless(elements.addValueInput.value);
    validateAddForm();
  } catch (error) {
    elements.addValueStatus.textContent = `JSON 오류: ${error.message}`;
    elements.addValueStatus.className = 'json-status invalid';
  }
}

async function addPlayerData(event) {
  event.preventDefault();
  if (elements.addSubmitButton.disabled || !elements.addDialog.open) return;
  await runMutation('add', () => mutationRequest(elements.addKeyInput.value.trim(), elements.addValueInput.value,
    elements.addReasonInput.value, elements.addConfirmCheck.checked));
}

async function openDeleteDialog(dataStore, key) {
  if (!canMutate()) return;
  const opener = document.activeElement;
  const lookup = state.lookups[dataStore];
  if (!lookup?.records?.[key] || !lookup.writeEnabled) return;
  const approve = await confirmDiscard('상세 편집 내용을 버리고 데이터 삭제를 진행할까요?');
  if (!approve?.() || !canMutate() || state.lookups[dataStore] !== lookup) return;
  discardEditorChanges();
  hideDetailPanel();
  state.lookup = lookup;
  state.pendingDeleteKey = key;
  const record = state.lookup.records[key];
  elements.deleteForm.reset();
  elements.deleteKeyText.textContent = key;
  elements.deleteStoreText.textContent = state.lookup.dataStoreLabel;
  elements.deleteKeyPreview.textContent = key;
  elements.deleteValuePreview.textContent = compactPreview(record.value, 180);
  elements.deleteTargetText.textContent = state.lookup.playFabId;
  elements.deleteConfirmKeyText.textContent = key;
  validateDeleteForm();
  presentEditorDialog('delete', opener);
}

function validateDeleteForm() {
  elements.deleteSubmitButton.disabled = state.saving || state.reviewing || state.scopeInvalid || state.mutationBlocked || !state.lookup?.writeEnabled || !state.pendingDeleteKey
    || elements.deleteReasonInput.value.trim().length < 3 || !elements.deleteConfirmCheck.checked;
}

async function deletePlayerData(event) {
  event.preventDefault();
  if (elements.deleteSubmitButton.disabled || !elements.deleteDialog.open) return;
  await runMutation('delete', () => mutationRequest(state.pendingDeleteKey, undefined,
    elements.deleteReasonInput.value, elements.deleteConfirmCheck.checked));
}

function canMutate() {
  return Boolean(state.lookup && !state.disposed && !state.loading && !state.saving && !state.reviewing
    && !state.scopeInvalid && !state.mutationBlocked);
}

function mutationRequest(key, value, reason, confirmed) {
  return {editToken:state.lookup?.editToken, environment:state.lookup?.environment,
    playFabId:state.lookup?.playFabId, dataStore:state.lookup?.dataStore,
    key, ...(value === undefined ? {} : {value}), reason:reason.trim(), confirmed};
}

function presentEditorDialog(action, returnFocus) {
  const dialog = elements[`${action}Dialog`];
  const scope = state.scope, lookup = state.lookup;
  state.dialogTarget = {scope, lookup, token:lookup.editToken};
  elements[`${action}State`].hidden = true;
  const lifetime = window.CompanyDialog.present(dialog, {
    returnFocus,
    initialFocus:elements[action === 'add' ? 'addKeyInput' : 'deleteReasonInput'],
    canCancel:() => !state.saving && !state.reviewing
  });
  state.dialogLifetime = lifetime;
  lifetime.closed.finally(() => {
    if (state.dialogLifetime === lifetime) { state.dialogLifetime = null; state.dialogTarget = null; }
  });
}

function renderMutationState(kind, title, message, recovery = false) {
  const options = {kind, title, message,
    ...(recovery ? {actionLabel:'목록 다시 확인', onAction:recoverMutation} : {})};
  elements.mutationState.hidden = false;
  window.CompanyState.render(elements.mutationState, options);
  let visibleState = elements.mutationState;
  for (const action of ['add','delete']) if (elements[`${action}Dialog`].open) {
    elements[`${action}State`].hidden = false;
    window.CompanyState.render(elements[`${action}State`], options);
    visibleState = elements[`${action}State`];
  }
  visibleState.scrollIntoView({block:'nearest', behavior:'instant'});
}

async function runMutation(action, readRequest) {
  if (!canMutate()) return;
  const request = Object.freeze({...readRequest()}), lookup = state.lookup, scope = state.scope;
  const opener = document.activeElement;
  const dialogTarget = state.dialogTarget;
  const valid = () => state.scope === scope && !state.scopeInvalid && state.lookup === lookup
    && lookup.editToken === request.editToken && lookup.writeEnabled && selectedEnvironment() === request.environment
    && Object.entries(request).every(([key,value]) => readRequest()[key] === value)
    && (action === 'save' || (state.dialogTarget === dialogTarget && dialogTarget?.scope === scope
      && dialogTarget.lookup === lookup && dialogTarget.token === request.editToken));
  if (!valid() || request.confirmed !== true) return;
  let attempted = false, confirmed = false;
  state.reviewing = true;
  updateInteractionLock();
  try {
    if (action === 'save') {
      const abort = new AbortController(); state.confirmationAbort = abort;
      const intent = await window.CompanyDialog.confirm({
        title:'플레이어 데이터 저장', message:'아래 대상의 값을 변경합니다. 복구하려면 별도 데이터가 필요합니다.',
        details:[{label:'서버', value:lookup.environmentLabel}, {label:'플레이어 UID', value:request.playFabId},
          {label:'저장소', value:lookup.dataStoreLabel}, {label:'저장할 키', value:mutationKey(request, action)},
          {label:'처리 사유', value:request.reason}],
        tone:'danger', confirmLabel:'변경사항 저장', signal:abort.signal, returnFocus:opener,
        validate:() => valid() ? null : '대상 또는 입력이 바뀌었습니다. 취소 후 다시 확인해 주세요.'
      });
      if (!intent) return;
    }
    if (!valid()) throw new Error('확인한 대상 또는 입력이 바뀌었습니다.');
    state.reviewing = false; state.saving = true; updateInteractionLock();
    renderMutationState('loading', '변경을 처리하고 있습니다.', '창을 닫지 마세요. 중복 요청은 보내지 않습니다.');
    attempted = true;
    const result = validateMutationResult(action, request,
      await mutateJson(`/api/playfab/player-data/${action}`, request, scope));
    assertCurrentScope(scope);
    confirmed = true;
    if (!valid()) throw new Error('저장 중 화면의 대상 또는 초안이 바뀌어 응답을 적용하지 않았습니다.');
    if (action === 'save') {
      applySavedMutation(result);
      renderMutationState('success', '저장했습니다.', `${result.message} 저장 크기 ${formatBytes(result.bytes)}.`);
    } else {
      state.dialogLifetime?.finish({saved:true});
      state.pendingDeleteKey = '';
      state.mutationBlocked = true;
      state.recovery = {scope, request, key:action === 'delete' ? '' : result.key, message:result.message};
      await readAfterMutation(state.recovery);
    }
  } catch (error) {
    if (state.scope !== scope || error.stale) return;
    if (confirmed) {
      state.mutationBlocked = true;
      renderMutationState('success', '변경은 완료되었지만 화면을 갱신하지 못했습니다.',
        `${error.message} 같은 작업을 다시 실행하지 말고 최신 데이터를 확인해 주세요.`, Boolean(state.recovery));
    } else {
      const rejected = [400,401,403,409,413,422,429].includes(error.status);
      if (error.status === 401) state.scopeInvalid = true;
      state.mutationBlocked = attempted && !rejected;
      if ([401,403,409].includes(error.status)) state.mutationBlocked = true;
      renderMutationState([401,403].includes(error.status) ? 'denied' : 'error',
        !attempted ? '변경 요청을 보내지 않았습니다.' : rejected ? '변경 요청이 거부되었습니다.' : '변경 결과를 확인하지 못했습니다.',
        `${error.message} 입력한 초안은 유지했습니다.${attempted && !rejected ? ' 서버에 반영되었을 수 있으므로 최신 데이터를 확인한 뒤 작업하세요. 자동 재전송하지 않습니다.' : ''}`);
    }
  } finally {
    state.reviewing = false; state.saving = false; state.confirmationAbort = null;
    updateInteractionLock(); updateSaveButton(); validateAddForm(); validateDeleteForm();
    if (opener?.isConnected && document.activeElement === document.body && !opener.matches(':disabled')) opener.focus({preventScroll:true});
    else if (document.activeElement === document.body && !elements.mutationState.hidden) elements.mutationState.focus({preventScroll:true});
  }
}

async function readAfterMutation(recovery) {
  const {request, scope, key, message} = recovery;
  const result = await requestLookup(request.environment, request.playFabId, scope);
  assertCurrentScope(scope);
  if (state.recovery !== recovery) return;
  elements.playFabIdInput.value = result.playFabId;
  applyLookup(result, {dataStore:request.dataStore, key});
  renderMutationState('success', '변경했습니다.', message);
}

async function recoverMutation() {
  const recovery = state.recovery;
  if (!recovery || state.loading || state.saving || state.reviewing || recovery.scope !== state.scope) return;
  const approve = await confirmDiscard('편집 중인 변경사항을 버리고 완료된 작업의 최신 목록을 불러올까요?');
  if (!approve?.() || state.recovery !== recovery) return;
  state.loading = true; updateInteractionLock();
  renderMutationState('loading', '완료된 작업의 목록을 확인합니다.', '읽기만 수행하며 변경 요청을 다시 보내지 않습니다.');
  try { await readAfterMutation(recovery); }
  catch (error) {
    if (state.scope === recovery.scope) renderMutationState('success', '변경은 완료되었지만 목록을 읽지 못했습니다.', error.message, true);
  } finally { state.loading = false; updateInteractionLock(); updateSaveButton(); }
}

function assertCurrentScope(scope) {
  if (state.disposed || scope !== state.scope) throw Object.assign(new Error('로그인·권한 범위가 변경되어 이전 응답을 적용하지 않았습니다.'), {stale:true});
}

function displayEditorValue(record) {
  const value = String(record?.value ?? '');
  if (!record?.jsonValid) return value;
  try { return prettyPrintJsonLossless(value); } catch { return value; }
}

async function confirmDiscard(message, signal) {
  if (state.disposed || state.loading || state.saving || state.reviewing || signal?.aborted) return null;
  const scope = state.scope, lookup = state.lookup, lookups = state.lookups, signature = readSignature();
  const stable = () => !state.disposed && state.scope === scope && state.lookup === lookup
    && state.lookups === lookups && readSignature() === signature && !signal?.aborted;
  const approve = () => stable() && !state.loading && !state.saving && !state.reviewing;
  if (!state.dirty) return approve;
  const abort = new AbortController(), cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  state.confirmationAbort = abort; state.reviewing = true;
  const opener = document.activeElement;
  updateInteractionLock(); updateSaveButton();
  try {
    const intent = await window.CompanyDialog.confirm({
      title:'편집 내용 버리기', message, tone:'danger', confirmLabel:'버리기',
      details:[{label:'서버',value:lookup?.environmentLabel || selectedEnvironment()},
        {label:'플레이어 UID',value:lookup?.playFabId || elements.playFabIdInput.value},
        {label:'데이터 키',value:state.activeKey || '없음'}],
      signal:abort.signal, returnFocus:opener,
      validate:() => stable() ? null : '대상 또는 초안이 바뀌었습니다. 취소 후 다시 확인해 주세요.'
    });
    return intent && !abort.signal.aborted && stable() ? approve : null;
  } catch {
    if (stable()) showMessage('error', '공통 확인창을 열지 못했습니다. 수정 내용을 유지했습니다.');
    return null;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (state.confirmationAbort === abort) {
      state.confirmationAbort = null; state.reviewing = false;
      updateInteractionLock(); updateSaveButton(); validateAddForm(); validateDeleteForm();
    }
  }
}
function discardEditorChanges() {
  if (!state.activeKey) return;
  elements.jsonEditor.value = originalValue() ?? '';
  state.dirty = false;
  validateEditor();
}
function clearLookup() {
  closeDetail();
  state.lookup = null;
  state.lookups = {};
  state.originals = {};
  state.activeKey = '';
  state.dirty = false;
  state.recovery = null;
  state.mutationBlocked = false;
  elements.mutationState.hidden = true;
  elements.editorCard.classList.add('hidden');
  hideDetailPanel();
}
function updateInteractionLock() {
  elements.lookupButton.disabled = !selectedEnvironmentConfig()?.configured;
  elements.refreshButton.disabled = !state.lookup;
  for (const fields of [elements.interactionFields, elements.addFields, elements.deleteFields]) {
    fields.disabled = state.disposed || state.loading || state.saving || state.reviewing;
  }
  for (const button of elements.dataStoresContainer.querySelectorAll('[data-action="add"], [data-action="delete"]'))
    button.disabled = state.scopeInvalid || state.mutationBlocked || !state.lookups[button.dataset.store]?.writeEnabled;
}
function selectedEnvironment() { return elements.environmentSelect.value === 'live' ? 'live' : 'test'; }
function selectedEnvironmentConfig() { return state.config?.environments?.[selectedEnvironment()] || null; }
function isCompressedSaveStore() { return state.lookup?.dataStore === 'user'; }
function currentRecord() { return state.lookup?.records?.[state.activeKey] || null; }
function originalValue() { return state.originals?.[state.lookup?.dataStore]?.[state.activeKey]; }
function isSaveDataKey(key) { return key === 'SaveData' || key === 'SaveData-Compression'; }

function cancelPlayerReads() { for (const channel of PLAYER_READ_CHANNELS) readSession.cancel(channel); }
async function readJson(channel, path, body, scope) {
  assertCurrentScope(scope);
  if (!PLAYER_READ_CHANNELS.includes(channel) || !PLAYER_READ_PATHS.has(path)) throw new Error('허용되지 않은 플레이어 데이터 조회 요청입니다.');
  const result = await readSession.run(channel, async signal => {
    const payload = await transportJson(path, body, signal, scope); signal.throwIfAborted(); assertCurrentScope(scope); return payload;
  }, 45_000);
  if (result.status === 'cancelled' || state.disposed || scope !== state.scope || !result.isCurrent?.()) {
    assertCurrentScope(scope); throw Object.assign(new Error('이전 조회 응답은 적용하지 않았습니다.'), {stale:true});
  }
  if (result.status === 'error') {
    if (result.error?.message === '조회 시간이 초과되었습니다. 다시 시도해 주세요.') throw new Error('응답 관찰 시간이 초과되었습니다. 서버 처리의 취소나 롤백을 뜻하지 않습니다.');
    throw result.error;
  }
  return result.value;
}
async function mutateJson(path, body, scope) {
  const abort = new AbortController();
  assertCurrentScope(scope);
  if (!PLAYER_MUTATION_PATHS.has(path) || body === undefined) throw new Error('허용되지 않은 플레이어 데이터 변경 요청입니다.');
  state.requests.add(abort);
  const timeout = setTimeout(() => abort.abort(), 45_000);
  let onAbort;
  try {
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(new DOMException('변경 응답 관찰 중단', 'AbortError'));
      abort.signal.addEventListener('abort', onAbort, {once:true});
    });
    const payload = await Promise.race([transportJson(path, body, abort.signal, scope), interrupted]); assertCurrentScope(scope);
    if (abort.signal.aborted) throw new Error('응답 관찰 시간이 초과되었습니다. 서버 처리의 취소나 롤백을 뜻하지 않습니다.');
    return payload;
  } catch (error) {
    assertCurrentScope(scope);
    if (abort.signal.aborted) throw new Error('응답 관찰 시간이 초과되었습니다. 서버 처리의 취소나 롤백을 뜻하지 않습니다.');
    throw error;
  } finally { clearTimeout(timeout); abort.signal.removeEventListener('abort', onAbort); state.requests.delete(abort); }
}
async function transportJson(path, body, signal, scope) {
  const response = await fetch(path, {
    method:body === undefined ? 'GET' : 'POST', cache:'no-store', redirect:'error', credentials:'same-origin', signal,
    headers:{'Content-Type':'application/json', 'X-CSRF-Token':state.csrfToken, 'X-CS-Return-Url':currentReturnUrl()},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  signal.throwIfAborted(); assertCurrentScope(scope);
  let payload;
  try { payload = await response.json(); }
  catch { throw Object.assign(new Error(`서버 응답을 확인하지 못했습니다. (HTTP ${response.status})`), {status:response.status}); }
  signal.throwIfAborted(); assertCurrentScope(scope);
  if (response.status === 401) {
    if (payload?.loginUrl) window.CompanyWorkspace?.sessionExpired?.(payload.loginUrl);
    throw Object.assign(new Error('회사 계정 로그인이 필요합니다.'), {status:401});
  }
  if (!response.ok) throw Object.assign(new Error(payload?.error || `요청에 실패했습니다. (HTTP ${response.status})`), {status:response.status});
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('서버 응답 형식이 올바르지 않습니다.');
  return payload;
}
function showMessage(kind, message, retry = null) {
  elements.messageBox.hidden = false;
  window.CompanyState.render(elements.messageBox, {kind:kind === 'warning' ? 'error' : kind,
    title:({loading:'확인 중',success:'조회 완료',error:'확인 필요',denied:'접근 확인 필요'})[kind] || '안내',
    message, actionLabel:retry ? '다시 확인' : '', onAction:retry ? ()=>retry() : undefined});
}
function showPlayerIdValidation(message){elements.playFabIdInput.setAttribute('aria-invalid','true');elements.playFabIdError.hidden=false;elements.playFabIdError.textContent=message;window.CompanyToast.show({id:'player-validation',kind:'error',title:'입력 확인 필요',message,duration:0});elements.playFabIdInput.focus();}
function clearPlayerIdValidation(){elements.playFabIdInput.removeAttribute('aria-invalid');elements.playFabIdError.hidden=true;elements.playFabIdError.textContent='';window.CompanyToast.dismiss('player-validation');}
function clearMessage() { elements.messageBox.hidden = true; }
function currentReturnUrl() { return `${location.pathname}${location.search}`; }
function compactPreview(value, limit = 100) {
  const compact = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '(빈 문자열)';
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}
function utf8Bytes(value) { return new TextEncoder().encode(String(value ?? '')).length; }
function formatBytes(value) {
  const bytes = Number(value || 0);
  return bytes < 1024 ? `${bytes.toLocaleString('ko-KR')} B`
    : `${(bytes / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} KB`;
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}
const lifetime={
  dispose,
  async beforeLeave(){
    if(state.saving||state.reviewing||state.dialogLifetime)return false;
    if(!state.dirty&&!elements.addKeyInput.value&&!elements.addValueInput.value&&!elements.deleteReasonInput.value)return true;
    const snapshot=[elements.jsonEditor.value,elements.addKeyInput.value,elements.addValueInput.value,elements.deleteReasonInput.value].join('\n');
    const approved=await window.CompanyDialog.confirm({title:'플레이어 데이터 초안',message:'저장하지 않은 변경사항이 있습니다. 버리고 이동하시겠습니까?',confirmLabel:'버리고 이동',returnFocus:elements.saveButton});
    return approved&&snapshot===[elements.jsonEditor.value,elements.addKeyInput.value,elements.addValueInput.value,elements.deleteReasonInput.value].join('\n')&&!state.saving&&!state.reviewing;
  }
};
activeLifecycle=lifetime;
return lifetime;
}
mount();
