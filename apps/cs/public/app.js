import { steamIdentifier, validateSteamConfig, validateSteamQuery, validateSteamHistory, validateSteamRefund, steamTransactionSignature } from './steam-transaction-contract.js';

let activeLifecycle;
export function currentLifecycle() { return activeLifecycle; }
export function mount() {
const state = { config: null, csrfToken: '', lookup: null, history: null, operation: null, blocked: false, disposed: false, revealLookupResult: false, receipts: new Map() };
const readSession = window.CompanyReadSession.create();
const STEAM_READ_CHANNELS = Object.freeze(['steam-config', 'steam-query', 'steam-history']);
const STEAM_READ_PATHS = new Set(['/api/config', '/api/transactions/query', '/api/transactions/history']);
const STEAM_MUTATION_PATHS = new Set(['/api/transactions/refund']);
const elements = Object.fromEntries(['environmentBadge', 'appIdText', 'queryForm', 'queryFields', 'queryButton', 'orderId', 'steamId', 'queryError', 'steamMessageBox', 'historyCard', 'historyCount', 'historyMeta', 'historyBody', 'historyRowTemplate', 'resultCard', 'refundCard', 'refundForm', 'refundFields', 'refundButton', 'reason', 'reasonError', 'confirmationOrderId', 'confirmationOrderIdError', 'statusBadge', 'resultOrderId', 'resultTransactionId', 'resultSteamId', 'steamIdMatch', 'resultTime', 'resultLocale', 'itemsBody'].map(id => [id, document.getElementById(id)]));
const historyDisclosures = window.CompanyDisclosure.attach(elements.historyBody, { single: false });

elements.queryForm.addEventListener('submit', handleQuery);
elements.refundForm.addEventListener('submit', handleRefund);
elements.queryForm.addEventListener('input', event => { clearQueryValidation(event.target); updateControls(); });
elements.refundForm.addEventListener('input', event => clearRefundValidation(event.target));
const scopeChanged = () => {
  if (state.disposed) return;
  cancelSteamReads();
  state.blocked = true; state.operation?.controller.abort(); state.operation = null;
  state.receipts.clear(); state.csrfToken = ''; clearTransaction(); clearHistory();
  for (const input of [elements.orderId, elements.steamId, elements.reason, elements.confirmationOrderId]) input.value = '';
  showState('denied', '계정 확인 필요', '로그인 또는 접근 권한이 변경되었습니다. 이전 거래와 사유를 제거했습니다. 요청 중이었다면 서버 반영 여부는 별도로 확인해야 합니다.');
  updateControls();
};
document.addEventListener('workspace-entity-scope-change', scopeChanged);
const dispose = event => {
  if (event?.persisted || state.disposed) return;
  state.disposed = true; readSession.dispose(); historyDisclosures.destroy(); state.operation?.controller.abort(); state.operation = null;
  document.removeEventListener('workspace-entity-scope-change', scopeChanged);
  window.removeEventListener('pagehide', dispose);
};
window.addEventListener('pagehide', dispose);
initialize();

async function initialize() {
  if (!canBegin()) return;
  const operation = begin('config');
  showState('loading', '설정 확인 중', 'Steam 연결 및 실행 허용 설정을 확인합니다.');
  try {
    const config = validateSteamConfig(await readJson('steam-config', '/api/config', undefined, operation));
    assertCurrent(operation); state.config = config;
    state.csrfToken = state.config.csrfToken;
    elements.appIdText.textContent = `App ID ${state.config.appId}`;
    elements.environmentBadge.textContent = state.config.sandbox ? 'STEAM SANDBOX' : 'STEAM PRODUCTION';
    elements.environmentBadge.className = 'cw-state-pill';
    elements.environmentBadge.dataset.tone = state.config.sandbox ? 'warning' : 'danger';
    if (!state.config.apiConfigured) showState('error', 'Steam 연결 설정 없음', '서버의 Steam Publisher Key 설정을 확인해 주세요.');
    else if (!state.config.refundEnabled) showState('empty', '거래 조회 전용', '서버에서 실제 환불 기능이 비활성화되어 있습니다. 거래 조회는 가능합니다.');
    else elements.steamMessageBox.hidden = true;
  } catch (error) { if (isCurrent(operation)) showFailure(error, { actionLabel: '설정 다시 확인', onAction: initialize }); }
  finally { finish(operation); }
}
async function handleQuery(event) {
  event.preventDefault();
  if (!canBegin() || !state.config?.apiConfigured) return;
  const revealLookupResult = state.revealLookupResult; state.revealLookupResult = false;
  let request;
  try {
    clearQueryValidation();
    request = queryInput();
    if (!request.orderId && !request.steamId) return showQueryValidation('Order ID/Transaction ID 또는 Steam ID 중 하나를 입력해 주세요.', elements.orderId, true);
    if (request.orderId) try { steamIdentifier(request.orderId); } catch(error) { return showQueryValidation(error.message, elements.orderId); }
    if (request.steamId) try { steamIdentifier(request.steamId); } catch(error) { return showQueryValidation(error.message, elements.steamId); }
  }
  catch (error) { showFailure(error); return; }
  if (!request.orderId) return handleHistoryQuery(request);
  const operation = begin('query');
  const previous = state.lookup, signature = inputSignature();
  showState('loading', '거래 조회 중', '입력한 주문 또는 거래 번호를 확인합니다.');
  clearHistory();
  if (state.lookup) state.lookup.stale = true;
  try {
    const result = validateSteamQuery(await readJson('steam-query', '/api/transactions/query', request, operation), request);
    assertCurrent(operation);
    if (JSON.stringify(queryInput()) !== JSON.stringify(request)) throw new Error('조회 중 대상이 변경되었습니다. 현재 입력으로 다시 조회해 주세요.');
    if (previous && BigInt(previous.transaction.orderId) !== BigInt(result.transaction.orderId) && (elements.reason.value || elements.confirmationOrderId.value)) {
      const intent = await window.CompanyDialog.confirm({
        title: '다른 주문으로 이동', confirmLabel: '초안 지우고 이동', returnFocus: elements.queryButton, signal: operation.controller.signal,
        message: '기존 주문에 입력한 환불 사유와 확인 번호를 지우고 새 거래를 표시합니다. 환불은 실행하지 않습니다.',
        details: [{ label: '기존 주문', value: previous.transaction.orderId }, { label: '새 주문', value: result.transaction.orderId }],
        validate: () => !isCurrent(operation) || inputSignature() !== signature ? '대상 또는 초안이 변경되었습니다. 취소 후 다시 조회해 주세요.' : ''
      });
      if (!isCurrent(operation)) return;
      if (!intent) { showState('empty', '주문 이동 취소', '기존 거래와 환불 초안을 유지했습니다. 환불하려면 해당 주문을 다시 조회해 주세요.'); return; }
      if (inputSignature() !== signature) throw new Error('조회 중 초안이 변경되어 기존 거래와 입력을 유지했습니다.');
      elements.reason.value = ''; elements.confirmationOrderId.value = '';
    }
    state.lookup = { ...result, request, stale: false };
    renderTransaction(); reportLookup();
    if (revealLookupResult) elements.resultCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (error) { if (isCurrent(operation)) showFailure(error); }
  finally { finish(operation); }
}
async function handleHistoryQuery(request) {
  const operation = begin('history');
  try {
    if (state.lookup && (elements.reason.value.trim() || elements.confirmationOrderId.value.trim())) {
      const signature = inputSignature();
      const intent = await window.CompanyDialog.confirm({
        title: '결제 내역으로 이동', confirmLabel: '초안 지우고 조회', returnFocus: elements.queryButton, signal: operation.controller.signal,
        message: '현재 주문에 입력한 환불 사유와 확인 번호를 지우고 Steam 계정의 결제 내역을 조회합니다. 환불은 실행하지 않습니다.',
        details: [{ label: '현재 주문', value: state.lookup.transaction.orderId }, { label: '조회할 Steam ID', value: request.steamId }],
        validate: () => !isCurrent(operation) || inputSignature() !== signature ? '대상 또는 초안이 변경되었습니다. 취소 후 다시 조회해 주세요.' : ''
      });
      if (!isCurrent(operation)) return;
      if (!intent) { showState('empty', '결제 내역 이동 취소', '현재 거래와 환불 초안을 유지했습니다.'); return; }
      if (inputSignature() !== signature) throw new Error('확인 중 대상 또는 초안이 변경되어 기존 거래와 입력을 유지했습니다.');
      elements.reason.value = ''; elements.confirmationOrderId.value = '';
    }
    showState('loading', '결제 내역 조회 중', 'Steam 거래 보고서를 갱신하고 해당 계정의 결제 내역을 찾습니다. 최초 조회는 시간이 걸릴 수 있습니다.');
    clearTransaction(); clearHistory();
    const result = validateSteamHistory(await readJson('steam-history', '/api/transactions/history', request, operation), request);
    assertCurrent(operation); state.history = result; renderHistory();
    if (result.transactions.length) showTransient('steam-history','결제 내역 조회 완료',`${result.transactions.length}건을 찾았습니다. 상품 정보와 상세 보기는 추가 검색 없이 이 화면에서 확인할 수 있습니다.`);
    else showState('empty', '결제 내역 없음', '이 Steam ID로 확인되는 결제 내역이 없습니다. Steam ID와 App ID를 확인해 주세요.');
  } catch (error) { if (isCurrent(operation)) showFailure(error); }
  finally { finish(operation); }
}
async function handleRefund(event) {
  event.preventDefault();
  if (!canBegin() || !refundable()) return;
  const lookup = state.lookup, reason = elements.reason.value.trim(), confirmationOrderId = elements.confirmationOrderId.value.trim();
  clearRefundValidation();
  if (reason.length < 5 || reason.length > 500) return showRefundValidation(elements.reason,elements.reasonError,'환불 사유를 5~500자로 입력해 주세요.');
  if (confirmationOrderId !== lookup.transaction.orderId) return showRefundValidation(elements.confirmationOrderId,elements.confirmationOrderIdError,'재입력한 Order ID가 조회한 실제 주문과 일치하지 않습니다.');
  const signature = inputSignature(), request = { orderId: lookup.transaction.orderId, steamId: lookup.transaction.steamId, confirmationOrderId, reason };
  const key = receiptKey(request.orderId), returnFocus = elements.refundButton, operation = begin('confirm');
  let submitted = false;
  try {
    showState('loading', '실행 조건 재확인', '현재 설정과 거래를 다시 읽습니다. 아직 환불 요청은 보내지 않았습니다.');
    const config = validateSteamConfig(await readJson('steam-config', '/api/config', undefined, operation));
    assertCurrent(operation);
    if (config.currentUser.id !== state.config.currentUser.id) { document.dispatchEvent(new Event('workspace-entity-scope-change')); return; }
    if (config.appId !== state.config.appId || config.sandbox !== state.config.sandbox || !config.refundEnabled || !config.apiConfigured) {
      lookup.stale = true;
      throw new Error('Steam 환경 또는 실행 설정이 변경되었습니다. 새 화면에서 설정과 거래를 확인해 주세요.');
    }
    state.csrfToken = config.csrfToken;
    const current = validateSteamQuery(await readJson('steam-query', '/api/transactions/query', request, operation), request);
    assertCurrent(operation);
    if (steamTransactionSignature(current.transaction) !== steamTransactionSignature(lookup.transaction) || !current.verification.steamIdMatches || !current.verification.refundableStatus) {
      lookup.stale = true;
      throw new Error('조회 이후 거래 정보가 변경되었습니다. 환불을 실행하지 않았습니다. 거래를 다시 조회해 주세요.');
    }
    if (inputSignature() !== signature) throw new Error('확인 중 대상 또는 사유가 변경되었습니다. 내용을 다시 확인해 주세요.');
    const intent = await window.CompanyDialog.confirm({
      title: '주문 전체 환불', tone: 'danger', confirmLabel: '전체 환불', returnFocus, signal: operation.controller.signal,
      message: '이 주문의 원결제 금액 전체를 환불합니다. 대상과 사유를 확인해 주세요. 확인 버튼은 서버의 환불 성공을 의미하지 않습니다.',
      details: [
        { label: '환경 / App ID', value: `${config.sandbox ? 'SANDBOX' : 'PRODUCTION'} / ${config.appId}` },
        { label: 'Order ID', value: request.orderId }, { label: 'Steam ID', value: request.steamId },
        { label: 'Transaction ID', value: lookup.transaction.transactionId || '-' },
        { label: '통화 / 항목 수', value: `${lookup.transaction.currency || '-'} / ${lookup.transaction.items.length}개` },
        { label: '환불 사유', value: reason }
      ],
      validate: () => !isCurrent(operation) || inputSignature() !== signature ? '대상 또는 입력이 변경되었습니다. 취소 후 다시 확인해 주세요.' : ''
    });
    if (!isCurrent(operation)) return;
    if (!intent) { showState('empty', '실행 취소', '환불 요청을 보내지 않았습니다. 입력한 사유는 유지됩니다.'); return; }
    if (inputSignature() !== signature) throw new Error('확인 후 입력이 변경되어 환불을 실행하지 않았습니다.');
    submitted = true; operation.kind = 'refund'; updateControls();
    const receipt = { kind: 'unknown', request, message: '환불 요청의 처리 여부를 확인하지 못했습니다.' };
    state.receipts.set(key, receipt);
    showState('loading', '환불 처리 중', '서버 응답을 기다리고 있습니다. 중복 요청은 보내지 않습니다.');
    const payload = validateSteamRefund(await mutateJson('/api/transactions/refund', request, operation), request.orderId);
    assertCurrent(operation);
    receipt.kind = 'success'; receipt.message = payload.message; receipt.auditRecorded = payload.auditRecorded; receipt.transactionId = payload.refund.transactionId;
    if (inputSignature() === signature) { elements.reason.value = ''; elements.confirmationOrderId.value = ''; }
    showReceipt(receipt, '거래 상태를 다시 확인하고 있습니다.');
    await readAfterRefund(receipt, operation);
  } catch (error) {
    if (!isCurrent(operation)) return;
    if (submitted) {
      const receipt = state.receipts.get(key); receipt.message = `환불 처리 여부를 확정하지 못했습니다. ${error.message}`;
      if ([401, 403].includes(error.statusCode)) showFailure(error);
      else showReceipt(receipt, '입력한 사유를 유지했습니다. 상태 재조회는 읽기만 수행하며, 이 화면에서 같은 주문을 다시 환불하지 않습니다.');
    } else showFailure(error);
  } finally { finish(operation); }
}
async function readAfterRefund(receipt, operation) {
  try {
    const request = { orderId: receipt.request.orderId, steamId: receipt.request.steamId };
    const result = validateSteamQuery(await readJson('steam-query', '/api/transactions/query', request, operation), request);
    assertCurrent(operation);
    if (state.lookup?.transaction.orderId !== request.orderId) throw new Error('표시 중인 주문이 변경되었습니다.');
    state.lookup = { ...state.lookup, ...result, stale: false };
    renderTransaction();
    showReceipt(receipt, `현재 거래 상태: ${result.transaction.status || 'Unknown'}. ${receipt.kind === 'unknown' ? '이 조회만으로 앞선 요청의 처리 여부를 확정할 수 없습니다. Steam과 감사 기록을 확인해 주세요.' : '같은 주문의 환불을 반복하지 않습니다.'}`);
  } catch (error) {
    if (!isCurrent(operation)) return;
    if ([401, 403].includes(error.statusCode)) { showFailure(error); return; }
    showReceipt(receipt, `거래 상태 재조회에 실패했습니다. 환불을 다시 요청하지 않고 상태만 재확인할 수 있습니다. ${error.message}`);
  }
}
async function retryRead(receipt) {
  if (!canBegin() || state.lookup?.transaction.orderId !== receipt.request.orderId) return;
  const operation = begin('query'); showReceipt(receipt, '거래 상태를 다시 확인하고 있습니다.');
  try { await readAfterRefund(receipt, operation); } finally { finish(operation); }
}
function showReceipt(receipt, suffix = '') { showState(receipt.kind === 'success' ? 'success' : 'error', receipt.kind === 'success' ? '환불 처리 확인' : '환불 처리 여부 확인 필요', `${receipt.message} ${suffix}`, { actionLabel: '거래 상태 재확인', onAction: () => retryRead(receipt) }); }
function reportLookup() {
  const { transaction, verification } = state.lookup, receipt = state.receipts.get(receiptKey(transaction.orderId));
  if (receipt) return showReceipt(receipt, `현재 거래 상태: ${transaction.status}. 같은 주문의 반복 환불은 잠겨 있습니다.`);
  if (!verification.steamIdMatches) showState('error', 'Steam ID 불일치', '입력한 Steam ID가 조회된 주문과 일치하지 않아 환불할 수 없습니다.');
  else if (!verification.refundableStatus) showState('empty', '환불할 수 없는 거래 상태', `현재 상태: ${transaction.status || 'Unknown'}.`);
  else if (!state.config.refundEnabled) showState('empty', '거래 조회 전용', '거래를 확인했지만 서버에서 환불 기능이 비활성화되어 있습니다.');
  else showTransient('steam-query','거래 조회 완료',verification.steamIdProvided ? 'Steam ID와 거래 상태를 확인했습니다. 환불 사유와 실제 Order ID를 입력해 주세요.' : '주문에서 Steam ID와 거래 상태를 확인했습니다. 환불 사유와 실제 Order ID를 입력해 주세요.');
}
function renderTransaction() {
  const { transaction, verification } = state.lookup;
  elements.resultCard.classList.remove('hidden');
  elements.refundCard.classList.toggle('hidden', !verification.steamIdMatches || !verification.refundableStatus || !state.config.refundEnabled);
  elements.statusBadge.textContent = transaction.status || 'Unknown'; elements.statusBadge.className = 'cw-state-pill';
  elements.statusBadge.dataset.tone = transaction.status === 'Succeeded' ? 'success' : 'warning';
  for (const [id, value] of Object.entries({ resultOrderId: transaction.orderId, resultTransactionId: transaction.transactionId, resultSteamId: transaction.steamId, resultTime: formatDate(transaction.time), resultLocale: [transaction.country, transaction.currency].filter(Boolean).join(' / ') })) elements[id].textContent = value || '-';
  elements.steamIdMatch.textContent = verification.steamIdProvided ? (verification.steamIdMatches ? '일치' : '불일치') : '주문에서 확인'; elements.steamIdMatch.className = 'cw-state-pill'; elements.steamIdMatch.dataset.tone = verification.steamIdProvided ? (verification.steamIdMatches ? 'success' : 'danger') : 'neutral';
  elements.itemsBody.replaceChildren();
  if (!transaction.items.length) {
    const row = document.createElement('tr'), cell = document.createElement('td'), message = document.createElement('div'); cell.colSpan = 8;
    window.CompanyState.render(message, { kind: 'empty', title: '아이템 상세 정보 없음', message: 'Steam 응답에 아이템 상세 정보가 없습니다.' });
    cell.append(message); row.append(cell); elements.itemsBody.append(row);
  }
  for (const item of transaction.items) {
    const row = document.createElement('tr');
    appendItemCells(row, item, transaction.currency);
    elements.itemsBody.append(row);
  }
}
function renderHistory() {
  const { transactions, indexedFrom, updatedAt, productCatalog } = state.history;
  elements.historyCard.classList.remove('hidden');
  elements.historyCount.textContent = `${transactions.length}건`;
  elements.historyMeta.textContent = `${formatDate(indexedFrom)} 이후 Steam 거래 보고서 · 마지막 확인 ${formatDate(updatedAt)} · ${productCatalog.message}`;
  elements.historyBody.replaceChildren();
  if (!transactions.length) {
    const row = document.createElement('tr'), cell = document.createElement('td'), message = document.createElement('div'); cell.colSpan = 6;
    window.CompanyState.render(message, { kind: 'empty', title: '결제 내역 없음', message: '이 Steam ID로 확인되는 거래가 없습니다.' });
    cell.append(message); row.append(cell); elements.historyBody.append(row); historyDisclosures.refresh(); return;
  }
  for (const [index, transaction] of transactions.entries()) {
    const fragment = elements.historyRowTemplate.content.cloneNode(true), row = fragment.querySelector('[data-history-row]'), panel = fragment.querySelector('[data-history-panel]');
    const disclosureKey = `steam-history-${index}`;
    row.querySelector('[data-history-detail]').dataset.cwDisclosure = disclosureKey;
    panel.dataset.cwDisclosurePanel = disclosureKey;
    const total = itemTotal(transaction.items);
    for (const [selector, value] of Object.entries({ '[data-history-time]': formatDate(transaction.time), '[data-history-order]': transaction.orderId || '-', '[data-history-status]': transaction.status || '-', '[data-history-amount]': formatSteamAmount(transaction.currency, total) })) row.querySelector(selector).textContent = value;
    renderProductSummary(row.querySelector('[data-history-products]'), transaction.items);
    for (const [selector, value] of Object.entries({ '[data-history-detail-order]': transaction.orderId || '-', '[data-history-detail-transaction]': transaction.transactionId || '-', '[data-history-detail-steam]': transaction.steamId || '-', '[data-history-detail-time]': formatDate(transaction.time), '[data-history-detail-locale]': [transaction.country, transaction.currency].filter(Boolean).join(' / ') || '-', '[data-history-detail-status]': transaction.status || '-' })) panel.querySelector(selector).textContent = value;
    const body = panel.querySelector('[data-history-items]');
    if (!transaction.items.length) appendEmptyItems(body);
    for (const item of transaction.items) { const itemRow = document.createElement('tr'); appendItemCells(itemRow, item, transaction.currency); body.append(itemRow); }
    panel.querySelector('[data-history-open-refund]').addEventListener('click', () => {
      if (!canBegin()) return;
      const identifier = transaction.orderId && transaction.orderId !== '0' ? transaction.orderId : transaction.transactionId;
      state.revealLookupResult = true; elements.orderId.value = identifier; elements.steamId.value = transaction.steamId;
      elements.queryForm.requestSubmit();
    });
    elements.historyBody.append(fragment);
  }
  historyDisclosures.refresh();
}
function clearTransaction() {
  state.lookup = null; elements.resultCard.classList.add('hidden'); elements.refundCard.classList.add('hidden'); elements.itemsBody.replaceChildren();
  for (const id of ['statusBadge', 'resultOrderId', 'resultTransactionId', 'resultSteamId', 'steamIdMatch', 'resultTime', 'resultLocale']) elements[id].textContent = '';
}
function clearHistory() {
  state.history = null; elements.historyCard.classList.add('hidden'); elements.historyBody.replaceChildren(); historyDisclosures.refresh(); elements.historyCount.textContent = '0건'; elements.historyMeta.textContent = '';
}
function renderProductSummary(cell, items) {
  const list = document.createElement('div'); list.className = 'history-products';
  if (!items.length) { list.textContent = '상품 상세 없음'; cell.append(list); return; }
  for (const item of items) {
    const line = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('small');
    name.textContent = productName(item); if (!item.productKnown) name.className = 'product-unknown';
    meta.textContent = `Item ${item.itemId || '-'} · ${item.quantity || '-'}개`;
    line.append(name, document.createElement('br'), meta); list.append(line);
  }
  cell.append(list);
}
function appendItemCells(row, item, currency) {
  const total = itemTotal([item]);
  const values = [productName(item), item.productId || '-', item.itemId || '-', item.quantity || '-', formatSteamAmount(currency, item.amount), formatSteamAmount(currency, item.vat), formatSteamAmount(currency, total), item.status || '-'];
  for (const [index, value] of values.entries()) {
    const cell = document.createElement('td'); cell.textContent = value;
    if (index === 0 && !item.productKnown) cell.className = 'product-unknown';
    if ([4, 5, 6].includes(index) && String(value).startsWith('잘못된 값')) cell.className = 'invalid-value';
    if (index === 0 && item.productDescription) cell.title = item.productDescription;
    row.append(cell);
  }
}
function appendEmptyItems(body) {
  const row = document.createElement('tr'), cell = document.createElement('td'), message = document.createElement('div'); cell.colSpan = 8;
  window.CompanyState.render(message, { kind: 'empty', title: '상품 상세 정보 없음', message: 'Steam 거래 보고서에 상품 항목이 없습니다.' });
  cell.append(message); row.append(cell); body.append(row);
}
function productName(item) { return item.productKnown ? (item.productName || item.productId || `Item ${item.itemId}`) : '미등록 상품'; }
function itemTotal(items) {
  let total = 0n;
  for (const item of items) {
    if (!/^\d+$/.test(item.amount) || !/^\d+$/.test(item.vat)) return '';
    total += BigInt(item.amount) + BigInt(item.vat);
  }
  return total.toString();
}
function formatSteamAmount(currency, raw) {
  if (!/^\d+$/.test(String(raw))) return `잘못된 값 (${raw || '없음'})`;
  const value = BigInt(raw), code = currency || '-';
  if (code === 'KRW') return `${groupDigits(value.toString())} ${code}`;
  const whole = value / 100n, fraction = String(value % 100n).padStart(2, '0');
  return `${groupDigits(whole.toString())}.${fraction} ${code}`;
}
function groupDigits(value) { return value.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function queryInput() { return { orderId: elements.orderId.value.trim(), steamId: elements.steamId.value.trim() }; }
function inputSignature() { return JSON.stringify([queryInput(), elements.reason.value, elements.confirmationOrderId.value, state.lookup?.transaction, state.lookup?.verification, state.config?.appId, state.config?.sandbox]); }
function receiptKey(orderId) { return `${state.config.appId}/${state.config.sandbox}/${BigInt(orderId)}`; }
function refundable() { return Boolean(!state.blocked && state.config?.refundEnabled && state.lookup && !state.lookup.stale && state.lookup.verification.steamIdMatches && state.lookup.verification.refundableStatus && JSON.stringify(queryInput()) === JSON.stringify(state.lookup.request) && !state.receipts.has(receiptKey(state.lookup.transaction.orderId))); }
function canBegin() { return !state.operation && !state.blocked && !state.disposed; }
function isCurrent(operation) { return state.operation === operation && !operation.controller.signal.aborted && !state.blocked && !state.disposed; }
function assertCurrent(operation) { if (!isCurrent(operation)) throw new DOMException('이전 계정 또는 화면의 응답', 'AbortError'); }
function begin(kind) { cancelSteamReads(); const operation = { kind, controller: new AbortController() }; state.operation = operation; updateControls(); return operation; }
function finish(operation) { if (state.operation !== operation) return; cancelSteamReads(); state.operation = null; operation.controller.abort(); if (!state.disposed) updateControls(); }
function updateControls() {
  const busy = Boolean(state.operation), unavailable = state.blocked || state.disposed;
  elements.queryFields.disabled = busy || unavailable || !state.config?.apiConfigured; elements.refundFields.disabled = busy || unavailable;
  elements.queryForm.setAttribute('aria-busy', String(busy)); elements.refundForm.setAttribute('aria-busy', String(busy));
  elements.refundButton.disabled = busy || unavailable || !refundable();
  elements.queryButton.textContent = ['query', 'history'].includes(state.operation?.kind) ? '조회 중...' : '거래 조회';
  elements.refundButton.textContent = state.operation?.kind === 'refund' ? '환불 처리 중...' : state.operation?.kind === 'confirm' ? '실행 확인 중...' : '전체 환불 실행';
}
function showState(kind, title, message, action) {
  elements.steamMessageBox.hidden = false; window.CompanyState.render(elements.steamMessageBox, { kind, title, message, ...action });
  if (kind !== 'loading') elements.steamMessageBox.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
function showTransient(id,title,message){elements.steamMessageBox.hidden=true;window.CompanyToast.show({id,kind:'success',title,message});}
function showQueryValidation(message,target,both=false){
  elements.queryError.hidden=false;elements.queryError.textContent=message;
  for(const input of both?[elements.orderId,elements.steamId]:[target])input.setAttribute('aria-invalid','true');
  window.CompanyToast.show({id:'steam-validation',kind:'error',title:'입력 확인 필요',message,duration:0});target.focus();
}
function clearQueryValidation(target=null){
  const inputs=target instanceof HTMLInputElement?[target]:[elements.orderId,elements.steamId];for(const input of inputs)input?.removeAttribute('aria-invalid');
  if(!target||!elements.orderId.hasAttribute('aria-invalid')&&!elements.steamId.hasAttribute('aria-invalid')){elements.queryError.hidden=true;elements.queryError.textContent='';window.CompanyToast.dismiss('steam-validation');}
}
function showRefundValidation(target,errorNode,message){errorNode.hidden=false;errorNode.textContent=message;target.setAttribute('aria-invalid','true');window.CompanyToast.show({id:'steam-refund-validation',kind:'error',title:'입력 확인 필요',message,duration:0});target.focus();}
function clearRefundValidation(target=null){
  const pairs=[[elements.reason,elements.reasonError],[elements.confirmationOrderId,elements.confirmationOrderIdError]];
  for(const [input,error] of pairs)if(!target||input===target){input.removeAttribute('aria-invalid');error.hidden=true;error.textContent='';}
  if(!target||pairs.every(([input])=>!input.hasAttribute('aria-invalid')))window.CompanyToast.dismiss('steam-refund-validation');
}
function showFailure(error, action) {
  if ([401, 403].includes(error.statusCode)) {
    state.blocked = true; cancelSteamReads(); state.operation?.controller.abort(); clearTransaction(); clearHistory();
    showState('denied', '계정 또는 실행 권한 확인 필요', '요청이 거부되었습니다. 이전 요청이 있었다면 실제 반영 여부를 별도로 확인해 주세요. 입력한 사유는 유지하고 새 화면에서 계정을 확인하세요.', { actionLabel: '새 화면에서 확인', onAction: () => location.reload() }); updateControls();
  } else showState('error', '거래 확인 필요', error.message, action);
}
function cancelSteamReads() { for (const channel of STEAM_READ_CHANNELS) readSession.cancel(channel); }
async function readJson(channel, path, body, operation) {
  assertCurrent(operation);
  if (!STEAM_READ_CHANNELS.includes(channel) || !STEAM_READ_PATHS.has(path)) throw new Error('허용되지 않은 Steam 조회 요청입니다.');
  const result = await readSession.run(channel, async signal => {
    const payload = await transportJson(path, body, signal); signal.throwIfAborted(); assertCurrent(operation); return payload;
  }, channel === 'steam-history' ? 120_000 : 45_000);
  if (result.status === 'cancelled' || !isCurrent(operation) || !result.isCurrent?.()) {
    assertCurrent(operation); throw new DOMException('이전 Steam 조회 응답', 'AbortError');
  }
  if (result.status === 'error') {
    if (result.error?.message === '조회 시간이 초과되었습니다. 다시 시도해 주세요.') throw new Error('응답 확인 시간이 초과되었습니다. 서버 처리 취소를 의미하지 않습니다.');
    throw result.error;
  }
  return result.value;
}
async function mutateJson(path, body, operation) {
  assertCurrent(operation);
  if (!STEAM_MUTATION_PATHS.has(path) || body === undefined) throw new Error('허용되지 않은 Steam 변경 요청입니다.');
  const controller = new AbortController(), abort = () => controller.abort(); operation.controller.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 45_000);
  try {
    const payload = await transportJson(path, body, controller.signal);
    assertCurrent(operation);
    if (controller.signal.aborted) throw new Error('응답 확인 시간이 초과되었습니다. 서버 처리 취소를 의미하지 않습니다.'); return payload;
  } catch (error) {
    if (isCurrent(operation) && controller.signal.aborted) throw new Error('응답 확인 시간이 초과되었습니다. 서버 처리 취소를 의미하지 않습니다.'); throw error;
  } finally { clearTimeout(timer); operation.controller.signal.removeEventListener('abort', abort); }
}
async function transportJson(path, body, signal) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken, 'X-CS-Return-Url': `${location.pathname}${location.search}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  signal.throwIfAborted(); let payload;
  try { payload = await response.json(); }
  catch { const error = new Error(`서버 응답을 확인하지 못했습니다. (HTTP ${response.status})`); if (!response.ok) error.statusCode = response.status; throw error; }
  signal.throwIfAborted();
  if (!response.ok) { const error = new Error(typeof payload?.error === 'string' ? payload.error : `요청이 거부되었습니다. (HTTP ${response.status})`); error.statusCode = response.status; throw error; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('서버 응답 형식이 올바르지 않습니다.');
  return payload;
}
function formatDate(value) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' }).format(date); }
const lifetime = {
  dispose,
  async beforeLeave() {
    if (state.operation?.kind === 'refund') return false;
    const draft = [elements.reason.value, elements.confirmationOrderId.value].some(value => value.trim());
    if (!draft) return true;
    const snapshot = elements.reason.value + '\n' + elements.confirmationOrderId.value;
    const approved = await window.CompanyDialog.confirm({title:'환불 초안',message:'입력 중인 환불 사유와 확인 번호가 있습니다. 버리고 이동하시겠습니까?',confirmLabel:'버리고 이동',returnFocus:elements.refundButton});
    return approved && snapshot === elements.reason.value + '\n' + elements.confirmationOrderId.value && state.operation?.kind !== 'refund';
  }
};
activeLifecycle = lifetime;
return lifetime;
}
mount();
