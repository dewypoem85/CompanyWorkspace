import { validateProductConfig, validateProductPreview, validateProductExecution, validateProductLookup, validateProductDeletion } from './product-command-contract.js';
import { validateSteamConfig } from './steam-transaction-contract.js';
import { prettyPrintJsonLossless } from './json-lossless.js';
import {
  findProductCatalogItem,
  inspectProductCatalogValue
} from './product-catalog.js?v=20260824.3';

let activeLifecycle;
export function currentLifecycle() { return activeLifecycle; }
export function mount() {
const PRODUCT_TYPE_LABELS = Object.freeze({ characters: '캐릭터', pets: '펫', skins: '스킨', weapons: '무기' });

const state = {
  csrfToken: '',
  baseConfig: null,
  productConfig: null,
  preview: null,
  results: [],
  lastExecutionDryRun: true,
  managePlayFabIds: [],
  manageEnvironment: null,
  operation: null, blocked: false, disposed: false, writeUncertain: false,
  previewRequest: null, resultPlan: null, batchExecuted: false, manageStale: true
};
const readSession = window.CompanyReadSession.create();
let dirty = false;
const pageRoot = document.querySelector('.workspace-content');
const noteEdit = () => { dirty = true; };
pageRoot.addEventListener('input', noteEdit);
pageRoot.addEventListener('change', noteEdit);
const PRODUCT_READ_CHANNELS = Object.freeze(['product-bootstrap', 'product-preview', 'product-lookup']);
const PRODUCT_READ_PATHS = new Set(['/api/config', '/api/playfab/product-commands/config', '/api/playfab/product-commands/preview', '/api/playfab/product-commands/lookup']);
const PRODUCT_MUTATION_PATHS = new Set(['/api/playfab/product-commands/execute', '/api/playfab/product-commands/delete']);

const elements = {
  productModeBadge: document.querySelector('#productModeBadge'),
  commandTab: document.querySelector('#commandTab'),
  manageTab: document.querySelector('#manageTab'),
  commandPanel: document.querySelector('#commandPanel'),
  managePanel: document.querySelector('#managePanel'),
  environmentNotice: document.querySelector('#environmentNotice'),
  environmentSelect: document.querySelector('#environmentSelect'),
  environmentTitleText: document.querySelector('#environmentTitleText'),
  manageEnvironmentText: document.querySelector('#manageEnvironmentText'),
  productMessageBox: document.querySelector('#productMessageBox'),
  targetCountText: document.querySelector('#targetCountText'),
  operationSelect: document.querySelector('#operationSelect'),
  productMemo: document.querySelector('#productMemo'),
  uidInput: document.querySelector('#uidInput'),
  uidValidation: document.querySelector('#uidValidation'),
  currencyGem: document.querySelector('#currencyGem'),
  currencySoul: document.querySelector('#currencySoul'),
  currencyPrayer: document.querySelector('#currencyPrayer'),
  currencyRift: document.querySelector('#currencyRift'),
  currencyMileage: document.querySelector('#currencyMileage'),
  charactersInput: document.querySelector('#charactersInput'),
  petsInput: document.querySelector('#petsInput'),
  skinsInput: document.querySelector('#skinsInput'),
  weaponsInput: document.querySelector('#weaponsInput'),
  packagesInput: document.querySelector('#packagesInput'),
  productInputResults: document.querySelector('#productInputResults'),
  executionSummary: document.querySelector('#executionSummary'),
  executionEnvironment: document.querySelector('#executionEnvironment'),
  executionOperation: document.querySelector('#executionOperation'),
  executionTargets: document.querySelector('#executionTargets'),
  executionCommands: document.querySelector('#executionCommands'),
  executionRisk: document.querySelector('#executionRisk'),
  previewButton: document.querySelector('#previewButton'),
  previewCard: document.querySelector('#previewCard'),
  previewBadge: document.querySelector('#previewBadge'),
  previewSummary: document.querySelector('#previewSummary'),
  existingWarning: document.querySelector('#existingWarning'),
  lookupWarning: document.querySelector('#lookupWarning'),
  mergeWarning: document.querySelector('#mergeWarning'),
  previewRows: document.querySelector('#previewRows'),
  dryRunCheck: document.querySelector('#dryRunCheck'),
  mergeCheckWrap: document.querySelector('#mergeCheckWrap'),
  mergeCheck: document.querySelector('#mergeCheck'),
  previewExpiresText: document.querySelector('#previewExpiresText'),
  openConfirmButton: document.querySelector('#openConfirmButton'),
  resultCard: document.querySelector('#resultCard'),
  resultSummary: document.querySelector('#resultSummary'),
  resultRows: document.querySelector('#resultRows'),
  retryFailedButton: document.querySelector('#retryFailedButton'),
  downloadCsvButton: document.querySelector('#downloadCsvButton'),
  manageUidInput: document.querySelector('#manageUidInput'),
  manageMemo: document.querySelector('#manageMemo'),
  lookupButton: document.querySelector('#lookupButton'),
  manageMessageBox: document.querySelector('#manageMessageBox'),
  manageResultWrap: document.querySelector('#manageResultWrap'),
  manageRows: document.querySelector('#manageRows'),
  productFields: document.querySelector('#productFields')
};

initialize();
setupWorkflowTabs();
setupPreviewInvalidation();
setupProductInputResults();

elements.uidInput.addEventListener('input', updateUidValidation);
elements.environmentSelect.addEventListener('change', handleEnvironmentChange);
elements.previewButton.addEventListener('click', createPreview);
elements.openConfirmButton.addEventListener('click', openConfirmDialog);

elements.retryFailedButton.addEventListener('click', retryFailed);
elements.downloadCsvButton.addEventListener('click', downloadResultsCsv);
elements.lookupButton.addEventListener('click', lookupCurrentCommands);

function setupWorkflowTabs() {
  const tabs=[elements.commandTab,elements.manageTab];
  const select=tab=>{
    const manage=tab===elements.manageTab;
    elements.commandTab.setAttribute('aria-selected',String(!manage));elements.manageTab.setAttribute('aria-selected',String(manage));
    elements.commandTab.tabIndex=manage?-1:0;elements.manageTab.tabIndex=manage?0:-1;
    elements.commandTab.dataset.variant=manage?'secondary':'primary';elements.manageTab.dataset.variant=manage?'primary':'secondary';
    elements.commandPanel.hidden=manage;elements.managePanel.hidden=!manage;tab.focus({preventScroll:true});
  };
  for(const tab of tabs){tab.addEventListener('click',()=>select(tab));tab.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    if(event.key==='Home'||event.key==='ArrowLeft')select(elements.commandTab);else select(elements.manageTab);
  });}
}

async function initialize() {
  if (!canBegin()) return;
  const operation = beginOperation('config');
  showMessage(elements.productMessageBox, 'loading', 'PlayFab 설정을 확인합니다.');
  try {
    const config = validateSteamConfig(await readJson('product-bootstrap', '/api/config', undefined, operation));
    assertCurrent(operation); state.baseConfig = config; state.csrfToken = config.csrfToken;
    const productConfig = validateProductConfig(await readJson('product-bootstrap', '/api/playfab/product-commands/config', {}, operation));
    assertCurrent(operation); state.productConfig = productConfig;
    populateEnvironmentOptions(productConfig); renderSelectedEnvironment();
    clearMessage(elements.productMessageBox);
  } catch (error) { if (isCurrent(operation)) showFailure(elements.productMessageBox, error, { actionLabel: '설정 다시 확인', onAction: initialize }); }
  finally { finishOperation(operation); updateUidValidation(); updateExecutionSummary(); }
}

function populateEnvironmentOptions(config) {
  const environments = Array.isArray(config.environments) ? config.environments : [];
  elements.environmentSelect.replaceChildren();

  for (const id of ['live', 'test']) {
    const item = environments.find((entry) => entry.id === id);
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id === 'test' ? '테스트 서버' : '라이브 서버';
    option.disabled = !item?.configured;
    elements.environmentSelect.append(option);
  }

  const preferred = environments.find((entry) => entry.id === config.defaultEnvironment && entry.configured)
    || environments.find((entry) => entry.id === 'live' && entry.configured)
    || environments.find((entry) => entry.id === 'test' && entry.configured);

  if (preferred) {
    elements.environmentSelect.value = preferred.id;
  }

  if (!preferred) {
    elements.productModeBadge.textContent = 'PLAYFAB DISABLED';
    setProductBadge(elements.productModeBadge, 'danger');
    elements.previewButton.disabled = true;
    elements.lookupButton.disabled = true;
    showMessage(elements.productMessageBox, 'error', '라이브/테스트 PlayFab 연결 설정이 없습니다. 서버 환경변수를 확인해 주세요.');
  }
}

function selectedEnvironment() {
  return elements.environmentSelect.value === 'live' ? 'live' : 'test';
}

function selectedEnvironmentConfig() {
  const id = selectedEnvironment();
  return state.productConfig?.environments?.find((item) => item.id === id) || null;
}

function handleEnvironmentChange() {
  if(state.operation || state.blocked || state.disposed)return;
  state.manageStale=true;
  invalidatePreviewAfterEdit();
  state.managePlayFabIds = [];
  state.manageEnvironment = null;
  elements.manageRows.replaceChildren();
  elements.manageResultWrap.classList.add('hidden');
  clearMessage(elements.manageMessageBox);
  renderSelectedEnvironment();
  updateExecutionSummary();
  updateControls();
}

function renderSelectedEnvironment() {
  const config = selectedEnvironmentConfig();
  const environment = selectedEnvironment();
  const label = environment === 'test' ? '테스트 서버' : '라이브 서버';

  if (!config?.configured) {
    elements.productModeBadge.textContent = `PLAYFAB ${environment.toUpperCase()} DISABLED`;
    setProductBadge(elements.productModeBadge, 'danger');
    elements.environmentTitleText.textContent = '설정 없음';
    elements.manageEnvironmentText.textContent = `${label} · 설정 없음`;
    elements.previewButton.disabled = true;
    elements.lookupButton.disabled = true;
    elements.dryRunCheck.checked = true;
    elements.dryRunCheck.disabled = true;
    showMessage(elements.environmentNotice, 'error', `${label} PlayFab Title ID 또는 Secret Key가 설정되지 않았습니다.`);
    updateExecutionSummary();
    return;
  }

  elements.previewButton.disabled = false;
  elements.lookupButton.disabled = false;
  elements.environmentTitleText.textContent = config.titleId ? `Title ID ${config.titleId}` : 'Mock 환경';
  elements.manageEnvironmentText.textContent = `${label} 기준 조회/삭제`;

  if (config.mode === 'mock') {
    elements.productModeBadge.textContent = `PLAYFAB ${environment.toUpperCase()} · MOCK`;
    setProductBadge(elements.productModeBadge, 'warning');
    showMessage(elements.environmentNotice, 'warning', `${label}가 Mock 모드입니다. 실제 PlayFab 데이터는 변경되지 않습니다.`);
  } else if (environment === 'live') {
    elements.productModeBadge.textContent = config.writeEnabled ? 'PLAYFAB LIVE · WRITE ENABLED' : 'PLAYFAB LIVE · DRY RUN ONLY';
    setProductBadge(elements.productModeBadge, config.writeEnabled ? 'danger' : 'warning');
    showMessage(
      elements.environmentNotice,
      config.writeEnabled ? 'error' : 'warning',
      config.writeEnabled
        ? `라이브 서버가 선택되어 있습니다. 실제 UserReadOnlyData 쓰기가 활성화되어 있으므로 UID와 명령을 다시 확인하세요.`
        : '라이브 서버가 선택되어 있지만 서버 설정상 쓰기는 비활성화되어 있습니다.'
    );
  } else {
    elements.productModeBadge.textContent = config.writeEnabled ? 'PLAYFAB TEST · WRITE ENABLED' : 'PLAYFAB TEST · DRY RUN ONLY';
    setProductBadge(elements.productModeBadge, config.writeEnabled ? 'success' : 'neutral');
    showMessage(
      elements.environmentNotice,
      config.writeEnabled ? 'success' : 'warning',
      config.writeEnabled
        ? '테스트 서버가 선택되어 있습니다.'
        : '테스트 서버가 선택되어 있지만 서버 설정상 쓰기는 비활성화되어 있습니다.'
    );
  }

  if (!config.writeEnabled) {
    elements.dryRunCheck.checked = true;
    elements.dryRunCheck.disabled = true;
  } else {
    elements.dryRunCheck.disabled = false;
  }
  updateExecutionSummary();
}

function setupPreviewInvalidation() {
  const inputs = [
    elements.environmentSelect,
    elements.operationSelect,
    elements.productMemo,
    elements.uidInput,
    elements.currencyGem,
    elements.currencySoul,
    elements.currencyPrayer,
    elements.currencyRift,
    elements.currencyMileage,
    elements.charactersInput,
    elements.petsInput,
    elements.skinsInput,
    elements.weaponsInput,
    elements.packagesInput
  ];
  for (const input of inputs) {
    input.addEventListener('input', invalidatePreviewAfterEdit);
    input.addEventListener('change', invalidatePreviewAfterEdit);
    input.addEventListener('input', updateExecutionSummary);
    input.addEventListener('change', updateExecutionSummary);
    input.addEventListener('input',()=>{if(input.getAttribute('aria-invalid')!=='true')return;input.removeAttribute('aria-invalid');const error=document.querySelector(`#${input.id}Error[data-product-field-error]`);error?.remove();input.removeAttribute('aria-describedby');if(!elements.productFields.querySelector('[aria-invalid="true"]'))window.CompanyToast.dismiss('product-validation');});
  }
  updateExecutionSummary();
}

function invalidatePreviewAfterEdit() {
  if (state.operation || !state.preview) return;
  state.preview = null; state.previewRequest = null;
  elements.previewCard.classList.add('hidden'); elements.mergeCheck.checked = false;
  showMessage(elements.productMessageBox, 'warning', '입력이 바뀌어 미리보기를 폐기했습니다. 이전 실행 결과는 유지합니다. 새 미리보기는 새 요청 ID를 발급합니다.');
  updateControls();
}

function updateUidValidation() {
  const parsed = parseUidText(elements.uidInput.value);
  elements.targetCountText.textContent = `${parsed.valid.length}명`;
  elements.uidValidation.classList.toggle('has-error', parsed.invalid.length > 0);

  if (!elements.uidInput.value.trim()) {
    elements.uidValidation.textContent = 'UID를 입력해 주세요.';
    return;
  }

  const parts = [`유효 ${parsed.valid.length}명`];
  if (parsed.duplicateCount) parts.push(`중복 제거 ${parsed.duplicateCount}건`);
  if (parsed.invalid.length) parts.push(`형식 오류 ${parsed.invalid.length}건: ${parsed.invalid.slice(0, 4).join(', ')}`);
  elements.uidValidation.textContent = parts.join(' · ');
}

function updateExecutionSummary() {
  const config=selectedEnvironmentConfig(),environment=selectedEnvironment(),parsed=parseUidText(elements.uidInput.value);
  const commandInputs=[elements.currencyGem,elements.currencySoul,elements.currencyPrayer,elements.currencyRift,elements.currencyMileage,elements.charactersInput,elements.petsInput,elements.skinsInput,elements.weaponsInput,elements.packagesInput];
  const commandCount=commandInputs.filter(input=>input.value.trim()).length;
  elements.executionEnvironment.textContent=environment==='live'?'라이브 서버':'테스트 서버';
  elements.executionOperation.textContent=elements.operationSelect.value==='revoke'?'회수':'지급';
  elements.executionTargets.textContent=`유효 ${parsed.valid.length}명 · 오류 ${parsed.invalid.length}명`;
  elements.executionCommands.textContent=`입력 ${commandCount}개`;
  let tone='warning',risk='선택 서버 설정을 확인하세요.';
  if(config?.mode==='mock'){tone='warning';risk='Mock 환경 · 실제 데이터 변경 없음';}
  else if(environment==='live'&&config?.writeEnabled){tone='danger';risk='라이브 실제 쓰기 활성화';}
  else if(environment==='live'){tone='warning';risk='라이브 서버 · Dry Run 전용';}
  else if(config?.writeEnabled){tone='success';risk='테스트 서버 쓰기 활성화';}
  else if(config?.configured){tone='neutral';risk='테스트 서버 · Dry Run 전용';}
  elements.executionSummary.dataset.tone=tone;elements.executionRisk.textContent=risk;
}

function clearProductFieldErrors() {
  for(const input of elements.productFields.querySelectorAll('[aria-invalid="true"]')){input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');}
  for(const error of elements.productFields.querySelectorAll('[data-product-field-error]'))error.remove();
  window.CompanyToast.dismiss('product-validation');
}
function showProductValidation(error) {
  const message=String(error?.message||'입력값을 확인해 주세요.');
  const matchers=[
    [/UID|대상/,elements.uidInput],[/처리 사유/,elements.productMemo],[/젬/,elements.currencyGem],[/영혼석/,elements.currencySoul],[/기도석/,elements.currencyPrayer],[/균열석/,elements.currencyRift],[/마일리지/,elements.currencyMileage],
    [/캐릭터/,elements.charactersInput],[/펫/,elements.petsInput],[/스킨/,elements.skinsInput],[/무기/,elements.weaponsInput],[/패키지|명령에 하나 이상의/,elements.packagesInput]
  ];
  const target=matchers.find(([pattern])=>pattern.test(message))?.[1]||null;
  clearProductFieldErrors();
  if(target){const label=target.closest('.cw-form-field'),fieldError=document.createElement('small');fieldError.id=`${target.id}Error`;fieldError.className='cw-field-error';fieldError.dataset.productFieldError='';fieldError.textContent=message;label?.append(fieldError);target.setAttribute('aria-invalid','true');target.setAttribute('aria-describedby',fieldError.id);target.focus();}
  window.CompanyToast.show({id:'product-validation',kind:'error',title:'입력 확인 필요',message,duration:0});
}

async function createPreview() {
  if (!canBegin() || state.writeUncertain) return;
  let request;
  clearProductFieldErrors();
  try { request = collectPreviewRequest(); } catch (error) { showProductValidation(error); return; }
  const signature = interactionSignature(), operation = beginOperation('preview');
  try {
    if (state.results.length && !state.lastExecutionDryRun) {
      const intent = await window.CompanyDialog.confirm({
        title:'새 명령 미리보기', message:'새 요청 ID를 발급합니다. 이전 지급·회수의 재시도가 아니므로 같은 대상을 다시 실행하면 중복 처리될 수 있습니다.',
        confirmLabel:'새 미리보기', returnFocus:elements.previewButton, signal:operation.controller.signal,
        validate:()=>validateInteraction(operation,signature)
      });
      if (!isCurrent(operation) || !intent) return;
    }
    showMessage(elements.productMessageBox,'loading','기존 명령을 읽고 최종 JSON을 준비합니다.');
    const preview = validateProductPreview(await readJson('product-preview', '/api/playfab/product-commands/preview',request,operation),request);
    assertCurrent(operation); if(interactionSignature() !== signature)throw Error('조회 중 입력이 변경되어 미리보기를 적용하지 않았습니다.');
    state.preview = preview; state.previewRequest = request; state.batchExecuted = false;
    state.results = []; state.resultPlan = null; elements.resultCard.classList.add('hidden');
    elements.mergeCheck.checked = false; renderPreview(preview);
    const summary=preview.environmentLabel + ' 미리보기: 대상 ' + preview.items.length + '명 · 기존 명령 ' + preview.existingCount + '명 · 조회 실패 ' + preview.lookupFailureCount + '명 · 병합 불가 ' + preview.mergeFailureCount + '명.';
    if(preview.lookupFailureCount||preview.mergeFailureCount)showMessage(elements.productMessageBox,'warning',summary);
    else{clearMessage(elements.productMessageBox);window.CompanyToast.show({id:'product-preview',kind:'success',title:'미리보기 준비 완료',message:summary});}
  } catch(error) { if(isCurrent(operation))showFailure(elements.productMessageBox,error); }
  finally { finishOperation(operation); }
}

function collectPreviewRequest() {
  const config = selectedEnvironmentConfig();
  if (!config?.configured) throw new Error('선택한 PlayFab 서버가 설정되지 않았습니다.');

  const parsed = parseUidText(elements.uidInput.value);
  if (parsed.invalid.length) throw new Error(`UID 형식 오류를 먼저 수정해 주세요: ${parsed.invalid.slice(0, 4).join(', ')}`);
  if (!parsed.valid.length) throw new Error('대상 UID를 한 명 이상 입력해 주세요.');
  if (parsed.valid.length > 100) throw new Error('한 번에 최대 100명까지 처리할 수 있습니다.');

  const memo = elements.productMemo.value.trim();
  if (memo.length < 3) throw new Error('처리 사유를 3자 이상 입력해 주세요.');

  return {
    environment: selectedEnvironment(),
    operation: elements.operationSelect.value,
    playFabIds: parsed.valid,
    memo,
    command: {
      currencies: {
        gem: readOptionalAmount(elements.currencyGem.value, '젬'),
        soul: readOptionalAmount(elements.currencySoul.value, '영혼석'),
        prayer: readOptionalAmount(elements.currencyPrayer.value, '기도석'),
        rift: readOptionalAmount(elements.currencyRift.value, '균열석'),
        mileage: readOptionalAmount(elements.currencyMileage.value, '마일리지')
      },
      characters: parseIntegerList(elements.charactersInput.value, '캐릭터'),
      skins: parseCompoundList(elements.skinsInput.value, '스킨'),
      weapons: parseCompoundList(elements.weaponsInput.value, '무기'),
      pets: parseIntegerList(elements.petsInput.value, '펫'),
      packages: parsePackageList(elements.packagesInput.value)
    }
  };
}

function renderPreview(preview) {
  elements.previewCard.classList.remove('hidden');
  elements.previewBadge.textContent = `${preview.environmentLabel} · ${preview.operation === 'grant' ? '지급' : '회수'}`;
  setProductBadge(elements.previewBadge, preview.environment === 'live' ? 'danger' : (preview.operation === 'grant' ? 'success' : 'warning'));
  elements.previewSummary.replaceChildren();

  addSummaryDetail('PlayFab 서버', preview.environmentLabel);
  addSummaryDetail('저장 영역', preview.dataStore || 'UserReadOnlyData');
  addSummaryDetail('작업', preview.operation === 'grant' ? '지급' : '회수');
  addSummaryDetail('대상', `${preview.summary.targetCount}명`);
  addSummaryDetail('재화 총량', formatCurrencyTotals(preview.summary.currencyTotals));
  addSummaryDetail('기존 동일 키', `${preview.existingCount}명`);
  addSummaryDetail('캐릭터', formatProductValues('characters', preview.summary.characters));
  addSummaryDetail('스킨', formatProductValues('skins', preview.summary.skins));
  addSummaryDetail('무기', formatProductValues('weapons', preview.summary.weapons));
  addSummaryDetail('펫', formatProductValues('pets', preview.summary.pets));
  addSummaryDetail('패키지', formatList(preview.summary.packages));
  addSummaryDetail('조회 실패', `${preview.lookupFailureCount}명`);

  elements.mergeCheckWrap.classList.toggle('hidden', preview.existingCount === 0);
  if(preview.existingCount)showMessage(elements.existingWarning,'empty',preview.existingCount+'명에게 기존 '+preview.key+' 명령이 있습니다. 기존 값과 병합 결과를 확인하고 병합을 승인해 주세요.');
  else clearMessage(elements.existingWarning);
  if(preview.lookupFailureCount)showMessage(elements.lookupWarning,'error',preview.lookupFailureCount+'명의 기존 명령 조회에 실패했습니다. 해당 UID는 실행하지 않습니다.');
  else clearMessage(elements.lookupWarning);
  if(preview.mergeFailureCount)showMessage(elements.mergeWarning,'error',preview.mergeFailureCount+'명의 기존 명령을 안전하게 병합할 수 없습니다. 표의 오류를 확인해 주세요.');
  else clearMessage(elements.mergeWarning);

  elements.previewRows.replaceChildren();
  for (const item of preview.items) {
    const row = document.createElement('tr');
    appendCell(row, item.playFabId);
    appendCell(row, item.dataVersion ?? '-');
    appendCommandCell(row, item.existingCommand, item.lookupError || '없음', item.existingCommand !== null);
    appendCommandCell(row, item.commandJson, item.mergeError || item.lookupError || '-', false);
    appendCommandCell(row, item.oppositeCommand, '없음', item.oppositeCommand !== null);
    appendCodeCell(row, item.requestId);
    elements.previewRows.append(row);
  }

  const expires = new Date(preview.expiresAt);
  elements.previewExpiresText.textContent = Number.isNaN(expires.getTime())
    ? ''
    : `미리보기 만료: ${new Intl.DateTimeFormat('ko-KR', { timeStyle: 'medium' }).format(expires)}`;
  elements.previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function addSummaryDetail(label, value) {
  const wrapper = document.createElement('div');
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  wrapper.append(dt, dd);
  elements.previewSummary.append(wrapper);
}

async function openConfirmDialog() { await executeCurrent(); }

async function executeCurrent(onlyPlayFabIds = null) {
  if (!canBegin() || state.writeUncertain || !state.preview || (!onlyPlayFabIds && state.batchExecuted)) return;
  const preview = state.preview, dryRun = onlyPlayFabIds ? state.lastExecutionDryRun : elements.dryRunCheck.checked;
  const request = {
    environment:preview.environment, previewToken:preview.previewToken, dryRun,
    mergePlayFabIds: elements.mergeCheck.checked ? preview.items.filter(i=>i.existingCommand !== null && !i.mergeError).map(i=>i.playFabId) : [],
    ...(onlyPlayFabIds ? {playFabIds:[...onlyPlayFabIds]} : {})
  };
  const ids = request.playFabIds || preview.items.map(i=>i.playFabId), signature = interactionSignature(), operation = beginOperation('execute');
  let submitted = false;
  try {
    ensurePreviewCurrent(preview);
    if(onlyPlayFabIds && (state.resultPlan !== preview || onlyPlayFabIds.some(id=>!retryableFailedIds().includes(id))))throw Error('재시도 대상이 변경되었습니다.');
    await recheckConfig(preview.environment, operation, !dryRun);
    assertCurrent(operation); ensurePreviewCurrent(preview);
    const details = [
      {label:'서버 / 저장소',value:preview.environmentLabel + ' / UserReadOnlyData'},
      {label:'작업 / 실행 모드',value:(preview.operation === 'grant' ? '지급':'회수') + ' / ' + (dryRun?'Dry Run (PlayFab 미변경)':selectedEnvironmentConfig().mode === 'mock'?'Mock 쓰기':'실제 쓰기')},
      {label:'처리 사유',value:preview.memo},
      {label:'대상 UID ('+ids.length+'명)',value:ids.join('\n')},
      {label:'요청 ID',value:preview.items.filter(i=>ids.includes(i.playFabId)).map(i=>i.playFabId + ': ' + i.requestId).join('\n')},
      {label:'재화 총량 (전체 미리보기)',value:formatCurrencyTotals(preview.summary.currencyTotals)},
      ...['characters','pets','skins','weapons'].map(key=>({label:PRODUCT_TYPE_LABELS[key],value:formatProductValues(key,preview.summary[key])})),
      {label:'패키지',value:formatList(preview.summary.packages)},
      {label:'기존 명령 병합',value:request.mergePlayFabIds.length ? request.mergePlayFabIds.join('\n') : '미승인 · 기존 명령은 건너뜀'},
      {label:'조회 실패 / 병합 불가',value:preview.lookupFailureCount + '명 / ' + preview.mergeFailureCount + '명'}
    ];
    const intent = await window.CompanyDialog.confirm({
      title:onlyPlayFabIds?'실패 UID 재시도':'상품 명령 실행', tone:dryRun?undefined:'danger', confirmLabel:dryRun?'Dry Run 실행':'확인 후 실행',
      message:onlyPlayFabIds?'실패한 UID만 최초 요청 ID와 이전 실행 모드로 다시 실행합니다. 이미 적용되었을 가능성은 서버의 스냅샷 검사로 확인합니다.':'미리보기의 명령을 실행합니다. 명령 등록은 게임 내 지급·회수 완료와 다릅니다.',
      details,returnFocus:onlyPlayFabIds?elements.retryFailedButton:elements.openConfirmButton,signal:operation.controller.signal,
      validate:()=>validateInteraction(operation,signature) || (Date.parse(preview.expiresAt)<=Date.now()?'미리보기가 만료되었습니다.':'')
    });
    if(!isCurrent(operation)||!intent)return;
    if(validateInteraction(operation,signature))throw Error('확인 중 입력이 변경되어 실행하지 않았습니다.');
    ensurePreviewCurrent(preview); submitted = true;
    showMessage(elements.productMessageBox,'loading','상품 명령 처리 응답을 기다립니다. 자동 재전송하지 않습니다.');
    const payload = validateProductExecution(await mutateJson('/api/playfab/product-commands/execute',request,operation),preview,request);
    assertCurrent(operation);
    state.lastExecutionDryRun=payload.dryRun; state.resultPlan=preview; if(!dryRun)state.batchExecuted=true;
    mergeAndRenderResults(payload.results,onlyPlayFabIds);
    const totals=summarizeLocalResults(state.results);
    showMessage(elements.productMessageBox,totals.failureCount||totals.skippedCount||totals.existingCount?'warning':'success',
      payload.environmentLabel+' '+(dryRun?'Dry Run':'명령 등록')+' 결과: 성공 '+totals.successCount+'명 · 재시도 성공 '+totals.retrySuccessCount+'명 · 실패 '+totals.failureCount+'명 · 미적용 '+(totals.skippedCount+totals.existingCount)+'명. 게임 내 지급·회수 완료를 의미하지 않습니다.');
  } catch(error) {
    if(!isCurrent(operation))return;
    if(submitted && !dryRun)state.writeUncertain=true;
    showFailure(elements.productMessageBox,error);
    if(state.writeUncertain && !state.blocked)showMessage(elements.productMessageBox,'error',error.message+' 처리 여부가 미확정이므로 이 화면의 추가 쓰기와 새 요청 ID 발급을 잠갔습니다. 대기 명령 조회와 감사 기록으로 확인하세요.');
  } finally { finishOperation(operation); }
}
function ensurePreviewCurrent(preview) {
  if(state.preview !== preview || Date.parse(preview.expiresAt)<=Date.now())throw Error('미리보기가 없거나 만료되었습니다. 다시 확인해 주세요.');
  if(JSON.stringify(collectPreviewRequest()) !== JSON.stringify(state.previewRequest))throw Error('현재 입력과 미리보기가 다릅니다. 새 미리보기가 필요합니다.');
}

function mergeAndRenderResults(newResults, onlyPlayFabIds) {
  if (!onlyPlayFabIds || !state.results.length) {
    state.results = [...newResults];
  } else {
    const replacements = new Map(newResults.map((item) => [item.playFabId.toLowerCase(), item]));
    state.results = state.results.map((item) => replacements.get(item.playFabId.toLowerCase()) || item);
  }

  elements.resultCard.classList.remove('hidden');
  const totals = summarizeLocalResults(state.results);
  elements.resultSummary.textContent = `${state.resultPlan?.environmentLabel || ''} · ${totals.successCount + totals.retrySuccessCount}명 성공 / ${totals.failureCount}명 실패 / ${totals.skippedCount + totals.existingCount}명 미적용`;
  elements.resultRows.replaceChildren();

  for (const item of state.results) {
    const row = document.createElement('tr');
    appendCell(row, item.playFabId);
    appendCodeCell(row, item.requestId);
    const statusCell = appendCell(row, statusLabel(item));
    const status = document.createElement('span'); status.textContent = statusCell.textContent; status.className = 'cw-state-pill';
    status.dataset.tone = ['success','retry_success'].includes(item.status) ? 'success' : item.status === 'failed' ? 'danger' : 'warning';
    statusCell.replaceChildren(status);
    appendCell(row, item.dataVersion ?? '-');
    appendCell(row, formatPlayFabError(item));
    appendCell(row, item.error || item.detail || (item.auditRecorded === false ? '적용 성공, 완료 감사 로그 기록 실패' : '-'));
    elements.resultRows.append(row);
  }

  const retryIds = retryableFailedIds();
  elements.retryFailedButton.classList.toggle('hidden', retryIds.length === 0);
  elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function retryFailed() {
  const ids=retryableFailedIds();
  if(ids.length)await executeCurrent(ids);
}

function retryableFailedIds() {
  if (!state.preview || state.resultPlan !== state.preview || state.writeUncertain) return [];
  return state.results
    .filter((item) => item.status === 'failed')
    .filter((item) => !String(item.error || '').includes('미리보기에서 기존 명령 조회에 실패'))
    .map((item) => item.playFabId);
}

function summarizeLocalResults(results) {
  const count = (status) => results.filter((item) => item.status === status).length;
  return {
    successCount: count('success'),
    retrySuccessCount: count('retry_success'),
    failureCount: count('failed'),
    skippedCount: count('skipped'),
    existingCount: count('existing')
  };
}

function statusLabel(item) {
  if (item.dryRun && ['success','retry_success'].includes(item.status)) return 'Dry Run 성공';
  return {
    success: '성공',
    retry_success: '재시도 성공',
    failed: '실패',
    skipped: '건너뜀',
    existing: '기존 명령 존재'
  }[item.status] || item.status;
}

function formatPlayFabError(item) {
  if (!item.playFabErrorCode && !item.playFabError) return '-';
  return [item.playFabError || '', item.playFabErrorCode ?? ''].filter((value) => String(value) !== '').join(' / ');
}

function downloadResultsCsv() {
  if (!state.results.length) return;
  const rows = [
    ['Environment', 'PlayFabId', 'RequestId', 'Status', 'DryRun', 'DataVersion', 'PlayFabError', 'PlayFabErrorCode', 'RetryCount', 'Detail']
  ];
  for (const item of state.results) {
    rows.push([
      state.resultPlan?.environment || '',
      item.playFabId,
      item.requestId,
      statusLabel(item),
      item.dryRun ? 'TRUE' : 'FALSE',
      item.dataVersion ?? '',
      item.playFabError || '',
      item.playFabErrorCode ?? '',
      item.retryCount ?? '',
      item.error || item.detail || ''
    ]);
  }
  const csv = '\ufeff' + rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `playfab-product-command-${state.resultPlan?.environment || 'unknown'}-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function lookupCurrentCommands() {
  if(!canBegin())return;
  const parsed=parseUidText(elements.manageUidInput.value), environment=selectedEnvironment();
  if(!selectedEnvironmentConfig()?.configured || parsed.invalid.length || !parsed.valid.length || parsed.valid.length>100){
    showMessage(elements.manageMessageBox,'error','설정된 서버와 유효한 UID 1~100개를 확인해 주세요.');return;
  }
  const request={environment,playFabIds:parsed.valid},signature=interactionSignature(),operation=beginOperation('lookup');
  state.manageStale=true;
  showMessage(elements.manageMessageBox,'loading','현재 지급·회수 명령을 조회합니다.');
  try {
    const payload=validateProductLookup(await readJson('product-lookup','/api/playfab/product-commands/lookup',request,operation),request);
    assertCurrent(operation);if(interactionSignature()!==signature)throw Error('조회 중 입력이 변경되었습니다. 다시 조회해 주세요.');
    state.managePlayFabIds=request.playFabIds;state.manageEnvironment=environment;state.manageStale=false;
    renderManageResults(payload.results);
    showMessage(elements.manageMessageBox,payload.successCount===payload.totalCount?'success':'warning',payload.environmentLabel+' 총 '+payload.totalCount+'명 중 '+payload.successCount+'명 조회 성공.'+(state.writeUncertain?' 이전 쓰기의 미확정 상태와 추가 쓰기 잠금은 해제되지 않았습니다.':''));
  } catch(error){if(isCurrent(operation))showFailure(elements.manageMessageBox,error);}
  finally{finishOperation(operation);}
}

function renderManageResults(results) {
  elements.manageRows.replaceChildren();
  elements.manageResultWrap.classList.remove('hidden');

  for (const item of results) {
    if (!item.success) {
      const row = document.createElement('tr');
      appendCell(row, item.playFabId);
      appendCell(row, '-');
      appendCell(row, '-');
      const cell = appendCell(row, item.error || '조회 실패');
      cell.colSpan = 3;
      cell.className = 'danger-text';
      elements.manageRows.append(row);
      continue;
    }
    renderManageCommandRow(item, 'grant', '지급', item.grant);
    renderManageCommandRow(item, 'revoke', '회수', item.revoke);
  }
}

function renderManageCommandRow(item, operation, label, record) {
  const row = document.createElement('tr');
  appendCell(row, item.playFabId);
  appendCell(row, label);
  appendCell(row, item.dataVersion ?? '-');
  appendCommandCell(row, record?.value ?? null, '없음', Boolean(record));
  appendCell(row, record?.lastUpdated ? formatDate(record.lastUpdated) : '-');
  const actionCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'command-actions';

  const copyTemplate = document.createElement('template');
  copyTemplate.innerHTML = '<button type="button" class="cw-button" data-size="compact"></button>';
  const copyButton = copyTemplate.content.firstElementChild;
  copyButton.textContent = 'JSON 복사';
  copyButton.disabled = !record;
  copyButton.addEventListener('click', async () => {
    if (!record || !canBegin()) return;
    const operation = beginOperation('copy');
    try {
      await window.CompanyClipboard.copyText(record.value);
      if(!isCurrent(operation))return;
      window.CompanyToast.show({id:'product-copy',kind:'success',title:'JSON 복사 완료',message:`${item.playFabId} ${label} JSON을 복사했습니다.`});
    } catch (error) {
      if(isCurrent(operation))showMessage(elements.manageMessageBox, 'error', error.message);
    } finally { finishOperation(operation); }
  });

  const deleteTemplate = document.createElement('template');
  deleteTemplate.innerHTML = '<button type="button" class="cw-button" data-variant="danger" data-size="compact"></button>';
  const deleteButton = deleteTemplate.content.firstElementChild;
  deleteButton.textContent = '대기 명령 삭제';
  const envConfig = state.productConfig?.environments?.find((entry) => entry.id === state.manageEnvironment);
  deleteButton.dataset.commandDelete = '';
  deleteButton.dataset.available = String(Boolean(record && envConfig?.writeEnabled && Number.isSafeInteger(item.dataVersion) && item.dataVersion >= 0));
  deleteButton.disabled = deleteButton.dataset.available !== 'true' || state.manageStale || state.writeUncertain;
  deleteButton.addEventListener('click', () => deleteCurrentCommand(
    item.playFabId,
    operation,
    label,
    record?.value,
    item.dataVersion
  ));

  actions.append(copyButton, deleteButton);
  actionCell.append(actions);
  row.append(actionCell);
  elements.manageRows.append(row);
}

async function deleteCurrentCommand(playFabId, commandOperation, label, expectedValue, expectedDataVersion) {
  if(!canBegin() || state.writeUncertain || state.manageStale || !expectedValue || !Number.isSafeInteger(expectedDataVersion) || expectedDataVersion < 0 || state.manageEnvironment !== selectedEnvironment())return;
  const memo=elements.manageMemo.value.trim();
  if(memo.length<3||memo.length>500)return showMessage(elements.manageMessageBox,'error','삭제 사유를 3~500자로 입력해 주세요.');
  const request={environment:state.manageEnvironment,playFabId,operation:commandOperation,expectedValue,expectedDataVersion,memo};
  const signature=interactionSignature(),returnFocus=document.activeElement,operation=beginOperation('delete');
  let submitted=false;
  try{
    await recheckConfig(request.environment,operation,true);assertCurrent(operation);
    const intent=await window.CompanyDialog.confirm({
      title:'대기 명령 삭제',tone:'danger',confirmLabel:'명령 삭제',returnFocus,signal:operation.controller.signal,
      message:'확인한 키만 삭제하며 반대쪽 키는 유지합니다. 이미 게임에서 처리한 지급·회수를 되돌리는 기능이 아닙니다.',
      details:[{label:'서버 / UID',value:request.environment+' / '+playFabId},{label:'삭제 키 / DataVersion',value:label+' / '+expectedDataVersion},{label:'현재 명령',value:formatCommandJson(expectedValue)},{label:'삭제 사유',value:memo}],
      validate:()=>validateInteraction(operation,signature)
    });
    if(!isCurrent(operation)||!intent)return;
    if(validateInteraction(operation,signature))throw Error('확인 중 입력이 변경되어 삭제하지 않았습니다.');
    submitted=true;state.manageStale=true;showMessage(elements.manageMessageBox,'loading','삭제 결과를 기다립니다.');
    const result=validateProductDeletion(await mutateJson('/api/playfab/product-commands/delete',request,operation),request);
    assertCurrent(operation);
    if(['success','retry_success'].includes(result.status)){
      const message=playFabId+' '+label+' 대기 명령 삭제 확인.'+(result.auditRecorded===false?' 완료 감사 로그 기록은 실패했습니다.':'');
      await readAfterDeletion(request,operation,message);
    }else{
      if(result.status==='failed')state.writeUncertain=true;
      showMessage(elements.manageMessageBox,'warning',(result.error||result.detail)+' 현재 명령을 재조회해 확인하세요. 실패한 쓰기는 자동 재전송하지 않습니다.'+(state.writeUncertain?' 추가 쓰기는 잠겨 있습니다.':''));
    }
  }catch(error){
    if(!isCurrent(operation))return;
    if(submitted)state.writeUncertain=true;
    showFailure(elements.manageMessageBox,error);
    if(state.writeUncertain&&!state.blocked)showMessage(elements.manageMessageBox,'error',error.message+' 삭제 처리 여부가 미확정입니다. 추가 쓰기를 잠갔으며 대기 명령 조회로 확인할 수 있습니다.');
  }finally{finishOperation(operation);}
}
async function readAfterDeletion(request,operation,message){
  try{
    const query={environment:request.environment,playFabIds:[...state.managePlayFabIds]};
    const payload=validateProductLookup(await readJson('product-lookup','/api/playfab/product-commands/lookup',query,operation),query);
    assertCurrent(operation);state.manageStale=false;renderManageResults(payload.results);
    showMessage(elements.manageMessageBox,'success',message+(payload.successCount===payload.totalCount?' 현재 명령을 다시 조회했습니다.':' 일부 UID의 재조회가 실패했습니다.'));
  }catch(error){
    if(!isCurrent(operation))return;
    if([401,403].includes(error.statusCode)){showFailure(elements.manageMessageBox,error);return;}
    showMessage(elements.manageMessageBox,'success',message+' 이후 조회에 실패했습니다. 삭제를 반복하지 않고 조회만 재시도할 수 있습니다.',{
      actionLabel:'명령 상태 재확인',onAction:async()=>{
        if(!canBegin()||state.manageEnvironment!==request.environment)return;
        const retry=beginOperation('lookup');try{await readAfterDeletion(request,retry,message);}finally{finishOperation(retry);}
      }
    });
  }
}

function parseUidText(text) {
  const source = String(text || '').trim();
  if (!source) return { valid: [], invalid: [], duplicateCount: 0 };
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  const firstColumns = lines.length ? parseCsvLine(lines[0]) : [];
  const headerIndex = firstColumns.findIndex(isUidHeader);
  const tokens = [];

  if (headerIndex >= 0 && lines.length > 1) {
    for (const line of lines.slice(1)) {
      const columns = parseCsvLine(line);
      if (columns[headerIndex] !== undefined) tokens.push(columns[headerIndex]);
    }
  } else {
    for (const line of lines) {
      for (const token of parseCsvLine(line)) tokens.push(token);
    }
  }

  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicateCount = 0;
  for (const raw of tokens) {
    const token = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (!token || isUidHeader(token)) continue;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(token)) {
      invalid.push(token);
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    valid.push(token);
  }
  return { valid, invalid, duplicateCount };
}

function parseCsvLine(line) {
  const text = String(line || '');
  const result = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (char === ',' || char === '\t' || char === ';')) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function isUidHeader(value) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll(' ', '').replaceAll('_', '');
  return ['uid', 'playfabid', 'playfabuid', 'playerid'].includes(normalized);
}

function readOptionalAmount(value, label) {
  const normalized = String(value ?? '').trim().replaceAll(',', '');
  if (!normalized) return '';
  if (!/^\d+$/.test(normalized)) throw new Error(`${label}은 0 이상의 정수로 입력해 주세요.`);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`${label}은 0 이상의 정수로 입력해 주세요.`);
  return numeric;
}

function parseIntegerList(value, label) {
  const tokens = splitList(value);
  return tokens.map((token, index) => {
    if (!/^\d+$/.test(token)) throw new Error(`${label} ${index + 1}번째 값은 숫자 ID여야 합니다: ${token}`);
    const numeric = Number(token);
    if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`${label} ${index + 1}번째 값이 올바르지 않습니다: ${token}`);
    return numeric;
  });
}

function parseCompoundList(value, label) {
  return splitList(value).map((token, index) => {
    if (!/^\d+-\d+$/.test(token)) throw new Error(`${label} ${index + 1}번째 값은 캐릭터ID-아이템ID 형식이어야 합니다: ${token}`);
    return token;
  });
}

function parsePackageList(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitList(value) {
  return String(value || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
}

function formatCurrencyTotals(value) {
  const entries = Object.entries(value || {});
  return entries.length ? entries.map(([key, amount]) => `${key} ${formatNumber(amount)}`).join(' / ') : '없음';
}

function formatList(value) {
  return Array.isArray(value) && value.length ? value.join(', ') : '없음';
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(value);
}

function appendCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = String(value ?? '-');
  row.append(cell);
  return cell;
}

function appendCodeCell(row, value) {
  const cell = document.createElement('td');
  const code = document.createElement('code');
  code.textContent = String(value ?? '-');
  cell.append(code);
  row.append(cell);
  return cell;
}

function appendCommandCell(row, value, emptyText, existing) {
  const cell = document.createElement('td');
  if (value === null || value === undefined || value === '') {
    cell.textContent = emptyText;
    if (emptyText !== '없음' && emptyText !== '-') cell.className = 'danger-text';
  } else {
    const code = document.createElement('code');
    code.textContent = formatCommandJson(value);
    code.tabIndex = 0;
    if (existing) code.classList.add('existing-command');
    cell.append(code);
  }
  row.append(cell);
  return cell;
}

function setupProductInputResults() {
  for (const input of Object.values(productInputElements())) {
    input.addEventListener('input', renderProductInputResults);
  }
  renderProductInputResults();
}

function renderProductInputResults() {
  elements.productInputResults.replaceChildren();
  for (const [type, input] of Object.entries(productInputElements())) {
    const values = splitList(input.value);
    const group = document.createElement('section');
    group.className = 'product-result-group';
    const heading = document.createElement('div');
    heading.className = 'product-result-group-heading';
    const title = document.createElement('h4');
    title.textContent = PRODUCT_TYPE_LABELS[type];
    const count = document.createElement('span');
    count.textContent = `${values.length}개`;
    heading.append(title, count);
    group.append(heading);

    const list = document.createElement('div');
    list.className = 'product-result-list';
    if (!values.length) {
      const empty = document.createElement('div');
      empty.className = 'product-result-empty';
      empty.textContent = '입력 없음';
      list.append(empty);
    }

    for (const value of values) {
      const inspection = inspectProductCatalogValue(type, value);
      const item = inspection.item;
      const result = document.createElement('div');
      result.className = `product-result-item is-${inspection.status}`;
      result.append(createProductVisual(item, 'product-result-visual'));

      const copy = document.createElement('span');
      copy.className = 'product-result-copy';
      const name = document.createElement('strong');
      name.textContent = item?.name || inspection.message;
      const detail = document.createElement('small');
      detail.textContent = item?.ownerName
        ? `${item.ownerName} · ${value}`
        : item ? `ID ${value}` : `${PRODUCT_TYPE_LABELS[type]} · 입력값 ${value}`;
      copy.append(name, detail);
      const status = document.createElement('span');
      status.className = 'product-result-status';
      status.textContent = inspection.status === 'valid'
        ? '정상'
        : inspection.status === 'invalid-format' ? '형식 오류' : '미등록 ID';
      result.append(copy, status);
      list.append(result);
    }
    group.append(list);
    elements.productInputResults.append(group);
  }
}

function createProductVisual(item, className) {
  const visual = document.createElement('span');
  visual.className = className;
  if (item?.image) {
    const image = document.createElement('img');
    image.src = item.image;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove(), { once: true });
    visual.append(image);
  } else {
    visual.textContent = '?';
  }
  return visual;
}

function productInputElements() {
  return {
    characters: elements.charactersInput,
    pets: elements.petsInput,
    skins: elements.skinsInput,
    weapons: elements.weaponsInput
  };
}

function productValueMeta(type, value) {
  return findProductCatalogItem(type, value);
}

function describeProductValue(type, value) {
  const item = productValueMeta(type, value);
  return item ? `${item.name} (${value})` : `${PRODUCT_TYPE_LABELS[type]} ${value}`;
}

function formatProductValues(type, values) {
  return Array.isArray(values) && values.length
    ? values.map((value) => describeProductValue(type, String(value))).join(', ')
    : '없음';
}

function formatCommandJson(value) {
  const text=String(value);
  try{return prettyPrintJsonLossless(text);}catch{return text;}
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function cancelProductReads(){for(const channel of PRODUCT_READ_CHANNELS)readSession.cancel(channel);}
async function readJson(channel,path,body,operation){
  assertCurrent(operation);
  if(!PRODUCT_READ_CHANNELS.includes(channel)||!PRODUCT_READ_PATHS.has(path))throw Error('허용되지 않은 상품 명령 조회 요청입니다.');
  const result=await readSession.run(channel,async signal=>{
    const payload=await transportJson(path,body,signal);signal.throwIfAborted();assertCurrent(operation);return payload;
  },45_000);
  if(result.status==='cancelled'||!isCurrent(operation)||!result.isCurrent?.()){
    assertCurrent(operation);throw new DOMException('이전 상품 명령 조회 응답','AbortError');
  }
  if(result.status==='error'){
    if(result.error?.message==='조회 시간이 초과되었습니다. 다시 시도해 주세요.')throw Error('응답 확인 시간이 초과되었습니다. 서버 처리 취소를 의미하지 않습니다.');
    throw result.error;
  }
  return result.value;
}
async function mutateJson(path,body,operation) {
  assertCurrent(operation);
  if(!PRODUCT_MUTATION_PATHS.has(path)||body===undefined)throw Error('허용되지 않은 상품 명령 변경 요청입니다.');
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,45_000);
  operation.controller.signal.addEventListener('abort',abort,{once:true});
  try{
    const payload=await transportJson(path,body,controller.signal);assertCurrent(operation);
    if(controller.signal.aborted)throw Error('관찰 시간이 초과되었습니다. 서버 처리 취소를 의미하지 않습니다.');
    return payload;
  }catch(error){if(isCurrent(operation)&&controller.signal.aborted)throw Error('관찰 시간이 초과되었습니다. 서버 처리 취소를 의미하지 않습니다.');throw error;}
  finally{clearTimeout(timer);operation.controller.signal.removeEventListener('abort',abort);}
}
async function transportJson(path,body,signal){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',redirect:'error',credentials:'same-origin',signal,
    headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrfToken,'X-CS-Return-Url':location.pathname+location.search},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  signal.throwIfAborted();let payload;
  try{payload=await response.json();}catch{const error=Error('응답을 확인하지 못했습니다. HTTP '+response.status);if(!response.ok)error.statusCode=response.status;throw error;}
  signal.throwIfAborted();
  if(!response.ok){const error=Error(typeof payload?.error==='string'?payload.error:'요청 거부 HTTP '+response.status);error.statusCode=response.status;throw error;}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('응답 형식을 확인할 수 없습니다.');
  return payload;
}
function showMessage(element,type,message,action) {
  element.hidden=false;
  element.classList.remove('notice','hidden');
  window.CompanyState.render(element,{kind:type==='warning'?(element===elements.environmentNotice?'empty':'error'):type,title:({loading:'처리 중',success:'처리 결과',error:'확인 필요',warning:'일부 처리 또는 확인 필요',empty:'안내',denied:'계정 확인 필요'})[type]||'안내',message,...action});
}
function clearMessage(element){element.hidden=true;}
function showFailure(element,error,action){
  if([401,403].includes(error.statusCode)){blockScope(false);showMessage(element,'denied','계정 또는 실행 권한이 변경되었습니다. 거래 표시를 제거했고 현재 문서의 작업을 잠갔습니다. 요청이 전송되었다면 실제 반영 여부를 별도로 확인해야 합니다.');}
  else showMessage(element,'error',error.message,action);
}
function isCurrent(operation){return state.operation===operation&&!operation.controller.signal.aborted&&!state.blocked&&!state.disposed;}
function assertCurrent(operation){if(!isCurrent(operation))throw new DOMException('이전 요청 응답','AbortError');}
function canBegin(){return !state.operation&&!state.blocked&&!state.disposed;}
function beginOperation(kind){cancelProductReads();const operation={kind,controller:new AbortController()};state.operation=operation;updateControls();return operation;}
function finishOperation(operation){if(state.operation!==operation)return;cancelProductReads();state.operation=null;operation.controller.abort();if(!state.disposed)updateControls();}
function interactionSignature(){return JSON.stringify([...elements.productFields.querySelectorAll('input,select,textarea')].map(input=>[input.id,input.value,input.checked]));}
function validateInteraction(operation,signature){return !isCurrent(operation)||interactionSignature()!==signature?'입력 또는 계정 범위가 변경되었습니다. 취소 후 다시 확인해 주세요.':'';}
function updateControls(){
  elements.productFields.disabled=Boolean(state.operation)||state.blocked||state.disposed;
  elements.productFields.setAttribute('aria-busy',String(Boolean(state.operation)));
  const configured=selectedEnvironmentConfig()?.configured;
  elements.previewButton.disabled=!configured||state.writeUncertain;
  elements.lookupButton.disabled=!configured;
  elements.openConfirmButton.disabled=!state.preview||state.batchExecuted||state.writeUncertain;
  elements.retryFailedButton.disabled=!retryableFailedIds().length||state.writeUncertain;
  elements.downloadCsvButton.disabled=!state.results.length;
  for(const button of elements.manageRows.querySelectorAll('[data-command-delete]'))button.disabled=button.dataset.available!=='true'||state.manageStale||state.writeUncertain;
}
async function recheckConfig(environment,operation,write){
  const base=validateSteamConfig(await readJson('product-bootstrap','/api/config',undefined,operation));assertCurrent(operation);
  if(base.currentUser.id!==state.baseConfig.currentUser.id){blockScope(true);throw Error('계정 변경');}
  state.csrfToken=base.csrfToken;
  const config=validateProductConfig(await readJson('product-bootstrap','/api/playfab/product-commands/config',{},operation));assertCurrent(operation);
  const before=state.productConfig.environments.find(e=>e.id===environment),after=config.environments.find(e=>e.id===environment);
  if(!after.configured||after.titleId!==before.titleId||after.mode!==before.mode||(write&&!after.writeEnabled))throw Error('PlayFab 환경 또는 실행 설정이 변경되었습니다. 새 화면에서 확인해 주세요.');
}
function blockScope(clearInputs){
  state.blocked=true;cancelProductReads();state.operation?.controller.abort();state.operation=null;
  state.preview=null;state.results=[];state.resultPlan=null;state.managePlayFabIds=[];state.manageEnvironment=null;state.csrfToken='';
  for(const node of [elements.previewRows,elements.previewSummary,elements.resultRows,elements.manageRows])node.replaceChildren();
  for(const node of [elements.previewCard,elements.resultCard,elements.manageResultWrap])node.classList.add('hidden');
  if(clearInputs){for(const input of elements.productFields.querySelectorAll('input,textarea')){input.value='';input.checked=false;}renderProductInputResults();updateUidValidation();}
  showMessage(elements.productMessageBox,'denied','계정 범위가 변경되어 이전 결과를 제거했습니다. 전송한 요청의 서버 반영 여부는 별도로 확인해야 합니다.');
  clearMessage(elements.manageMessageBox);updateControls();
}
const scopeChanged=()=>{if(!state.disposed)blockScope(true);};
document.addEventListener('workspace-entity-scope-change',scopeChanged);
const dispose=event=>{if(event?.persisted||state.disposed)return;state.disposed=true;readSession.dispose();state.operation?.controller.abort();state.operation=null;document.removeEventListener('workspace-entity-scope-change',scopeChanged);window.removeEventListener('pagehide',dispose);pageRoot.removeEventListener('input',noteEdit);pageRoot.removeEventListener('change',noteEdit);};
window.addEventListener('pagehide',dispose);


function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}
function setProductBadge(element,tone){element.className='cw-state-pill';element.dataset.tone=tone;}
const lifetime={
  dispose,
  async beforeLeave(){
    if(['execute','delete'].includes(state.operation?.kind))return false;
    if(!dirty&&!state.writeUncertain)return true;
    const approved=await window.CompanyDialog.confirm({title:'상품 작업 초안',message:'입력 중인 상품 작업 또는 확인이 필요한 실행 결과가 있습니다. 현재 화면을 닫고 이동하시겠습니까?',confirmLabel:'이동',returnFocus:elements.previewButton});
    return approved&&!['execute','delete'].includes(state.operation?.kind);
  }
};
activeLifecycle=lifetime;
return lifetime;
}
mount();
