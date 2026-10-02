import { REFRESH_PROTOCOL, isRefreshId, isPublicationRevision } from './publication-contract.js';

// Acceptance is acknowledged by the process that owns the publication queue,
// after disk initialization, cooldown, and competing-run checks have finished.
export async function handleRefreshMessage(message, { analytics, send, log = console.error }) {
  if (message?.type !== 'refresh' || !isRefreshId(message.requestId)) return false;
  const reply = { type: 'refresh-result', protocol: REFRESH_PROTOCOL, requestId: message.requestId };
  if (message.protocol !== REFRESH_PROTOCOL || typeof message.force !== 'boolean'
      || typeof message.enforceCooldown !== 'boolean' || !isPublicationRevision(message.expectedRevision)) {
    send({ ...reply, ok: false, status: 422, message: '갱신 요청 형식이 올바르지 않습니다.' });
    return true;
  }
  try {
    const publication = await analytics.requestPublishedRefresh({
      force: message.force, enforceCooldown: message.enforceCooldown,
      requestId: message.requestId, expectedRevision: message.expectedRevision, rejectIfRunning: true
    });
    send({ ...reply, ok: true, publication });
  } catch (error) {
    const known = [409, 422, 429].includes(error?.statusCode);
    if (!known) log(`[analytics-worker] refresh_acceptance_failed ${error?.stack || error}`);
    send({ ...reply, ok: false, status: known ? error.statusCode : 500,
      message: known ? error.message : '갱신 요청의 접수 여부를 확인하지 못했습니다.',
      ...(error?.statusCode === 429 ? { retryAt: error.retryAt } : {}) });
  }
  return true;
}
