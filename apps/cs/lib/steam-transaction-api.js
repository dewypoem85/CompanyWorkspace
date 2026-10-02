import { validateOrderId, validateSteamId, validateReason, ValidationError } from './validation.js';
import { SteamApiError } from './steam.js';

// Domain handler extracted from app-server without changing authentication/CSRF/rate limiting there.
export function createSteamTransactionApi({ steamClient, steamReportIndex, steamProductCatalog, refundEnabled, appendRefundAudit, appendRefundAuditSafe }) {
  const refundLocks = new Map();
  const response = (statusCode, payload) => ({ statusCode, payload });
  function configured() {
    if (!steamClient) { const error = new Error('STEAM_PUBLISHER_KEY가 설정되지 않았습니다.'); error.statusCode = 503; throw error; }
  }
  async function query(body) {
    configured();
    const orderId = validateOrderId(body.orderId);
    const rawSteamId = String(body.steamId ?? '').trim();
    const expectedSteamId = rawSteamId ? validateSteamId(rawSteamId) : '';
    const transaction = await steamClient.queryTransaction(orderId);
    const enriched = steamProductCatalog ? await steamProductCatalog.enrich([transaction]) : fallbackCatalog([transaction]);
    return response(200, { transaction: enriched.transactions[0], productCatalog: enriched.productCatalog, verification: { steamIdProvided: Boolean(expectedSteamId), steamIdMatches: !expectedSteamId || transaction.steamId === expectedSteamId, refundableStatus: transaction.status === 'Succeeded' } });
  }
  async function history(body) {
    configured();
    if (!steamReportIndex) { const error = new Error('Steam 거래 내역 색인이 설정되지 않았습니다.'); error.statusCode = 503; throw error; }
    const steamId = validateSteamId(body.steamId);
    const result = await steamReportIndex.findBySteamId(steamId);
    const enriched = steamProductCatalog ? await steamProductCatalog.enrich(result.transactions) : fallbackCatalog(result.transactions);
    return response(200, { steamId, ...result, transactions: enriched.transactions, productCatalog: enriched.productCatalog });
  }
  async function refund(body, { authenticatedUser, requestId, ip }) {
    configured();
    if (!refundEnabled) return response(403, { error: '서버에서 실제 환불 기능이 비활성화되어 있습니다.' });
    const orderId = validateOrderId(body.orderId), expectedSteamId = validateSteamId(body.steamId);
    const confirmationOrderId = validateOrderId(body.confirmationOrderId), reason = validateReason(body.reason);
    if (orderId !== confirmationOrderId) throw new ValidationError('확인용 Order ID가 일치하지 않습니다.');
    if (refundLocks.has(orderId)) return response(409, { error: '같은 주문의 환불 요청이 이미 처리 중입니다.' });
    refundLocks.set(orderId, true);
    try {
      const transaction = await steamClient.queryTransaction(orderId), transactionId = transaction.transactionId || '';
      const audit = { requestId, user: authenticatedUser, ip, orderId, transactionId, steamId: expectedSteamId, reason };
      if (transaction.steamId !== expectedSteamId) {
        await appendRefundAuditSafe({ ...audit, result: 'rejected', detail: 'steam_id_mismatch' });
        return response(409, { error: '입력한 Steam ID가 주문의 Steam ID와 일치하지 않습니다.' });
      }
      if (transaction.status !== 'Succeeded') {
        await appendRefundAuditSafe({ ...audit, result: 'rejected', detail: `status_${transaction.status || 'unknown'}` });
        return response(409, { error: `현재 거래 상태(${transaction.status || 'Unknown'})에서는 환불할 수 없습니다.` });
      }
      await appendRefundAudit({ ...audit, result: 'attempted' });
      let refund;
      try { refund = await steamClient.refundTransaction(orderId); }
      catch (error) {
        await appendRefundAuditSafe({ ...audit, result: 'failed', detail: error instanceof SteamApiError ? `steam_error_${error.errorCode ?? 'unknown'}` : 'server_error' });
        throw error;
      }
      const auditRecorded = await appendRefundAuditSafe({ ...audit, transactionId: refund.transactionId || transactionId, result: 'success' });
      return response(200, {
        message: auditRecorded ? 'Steam 환불 요청이 정상 처리되었습니다.' : 'Steam 환불은 처리됐지만 완료 감사 로그 기록에 실패했습니다. attempted 기록과 서버 로그를 확인하세요.',
        refund, auditRecorded
      });
    } finally { refundLocks.delete(orderId); }
  }
  return { query, history, refund };
}

function fallbackCatalog(transactions) {
  const cloned = structuredClone(transactions);
  for (const transaction of cloned) for (const item of transaction.items) {
    item.productKnown = false; item.productName = ''; item.productId = ''; item.productDescription = '';
  }
  return { transactions: cloned, productCatalog: { available: false, unknownCount: cloned.reduce((sum, transaction) => sum + transaction.items.length, 0), message: '상품명 카탈로그를 확인하지 못해 Steam Item ID로 표시합니다.' } };
}
