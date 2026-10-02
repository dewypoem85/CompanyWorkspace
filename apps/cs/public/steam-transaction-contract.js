// UI acknowledgement contract. Server authorization and Steam revalidation remain authoritative.
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function steamIdentifier(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) < 1n || BigInt(value) > 18446744073709551615n) throw new Error('주문/Steam 식별자는 64비트 범위의 숫자 문자열이어야 합니다.');
  return value;
}
const optionalId = value => value === '' || Boolean(steamIdentifier(value));
function requireValue(condition) { if (!condition) throw new Error('Steam 응답이 불완전하거나 확인한 거래와 일치하지 않습니다. 이 응답만으로 처리 여부를 판단할 수 없습니다.'); }
function validateTransaction(transaction, { report = false } = {}) {
  requireValue(record(transaction));
  if (report && transaction.orderId === '0') requireValue(true);
  else steamIdentifier(transaction.orderId);
  steamIdentifier(transaction.steamId); optionalId(transaction.transactionId);
  requireValue(['status', 'currency', 'country', 'time'].every(key => typeof transaction[key] === 'string'));
  requireValue(Array.isArray(transaction.items) && transaction.items.every(item => record(item)
    && ['itemId', 'quantity', 'amount', 'vat', 'status', 'productName', 'productId', 'productDescription'].every(key => typeof item[key] === 'string')
    && typeof item.productKnown === 'boolean'));
  return transaction;
}
function validateProductCatalog(value, transactions) {
  requireValue(record(value) && typeof value.available === 'boolean' && Number.isInteger(value.unknownCount) && value.unknownCount >= 0 && typeof value.message === 'string');
  requireValue(value.unknownCount === transactions.flatMap(transaction => transaction.items).filter(item => !item.productKnown).length);
}
export function validateSteamConfig(value) {
  requireValue(record(value) && typeof value.appId === 'string' && /^\d+$/.test(value.appId));
  requireValue(BigInt(value.appId) > 0n && BigInt(value.appId) <= 4294967295n);
  requireValue(['sandbox', 'refundEnabled', 'apiConfigured'].every(key => typeof value[key] === 'boolean'));
  requireValue(typeof value.csrfToken === 'string' && value.csrfToken.length > 0 && record(value.currentUser) && typeof value.currentUser.id === 'string' && /^\d+$/.test(value.currentUser.id));
  return value;
}
export function validateSteamQuery(value, request) {
  requireValue(record(value) && record(value.transaction) && record(value.verification));
  const { transaction: transaction, verification } = value;
  validateTransaction(transaction);
  validateProductCatalog(value.productCatalog, [transaction]);
  requireValue(['orderid', 'transid'].includes(transaction.lookupType));
  const foundId = transaction.lookupType === 'transid' ? transaction.transactionId : transaction.orderId;
  requireValue(foundId !== '' && BigInt(foundId) === BigInt(steamIdentifier(request.orderId)));
  const steamIdProvided = request.steamId !== '';
  if (steamIdProvided) steamIdentifier(request.steamId);
  requireValue(verification.steamIdProvided === steamIdProvided
    && verification.steamIdMatches === (!steamIdProvided || transaction.steamId === request.steamId)
    && verification.refundableStatus === (transaction.status === 'Succeeded'));
  return value;
}
export function validateSteamHistory(value, request) {
  requireValue(record(value) && request.orderId === '' && value.steamId === steamIdentifier(request.steamId));
  requireValue(Array.isArray(value.transactions) && typeof value.indexedFrom === 'string' && typeof value.updatedAt === 'string');
  for (const transaction of value.transactions) {
    validateTransaction(transaction, { report: true });
    requireValue(transaction.steamId === request.steamId);
  }
  validateProductCatalog(value.productCatalog, value.transactions);
  return value;
}
export function validateSteamRefund(value, orderId) {
  requireValue(record(value) && record(value.refund) && value.refund.orderId === orderId && typeof value.auditRecorded === 'boolean' && typeof value.message === 'string' && value.message.length > 0);
  optionalId(value.refund.transactionId);
  return value;
}
export function steamTransactionSignature(transaction) {
  // lookupType may change when a Transaction ID is subsequently rechecked by its real Order ID.
  const items = transaction.items.map(({ itemId, quantity, amount, vat, status }) => ({ itemId, quantity, amount, vat, status }));
  return JSON.stringify([transaction.orderId, transaction.transactionId, transaction.steamId, transaction.status, transaction.currency, transaction.country, transaction.time, items]);
}
