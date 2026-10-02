import crypto from 'node:crypto';
import { REFRESH_PROTOCOL, publicationRevision, validRefreshReceipt, isRefreshId, isPublicationRevision } from './publication-contract.js';

export function createRefreshBridge({ getWorker, getPublication, timeoutMs = 15_000 }) {
  let active = null;
  const error = (statusCode, message, extra = {}) => Object.assign(new Error(message), { statusCode, ...extra });
  function rejectUnknown(entry, status, message) {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    entry.reject(error(status, message, { outcome: 'unknown' }));
    // Keep the attempted worker/request locked until its exact receipt arrives
    // or the worker is replaced. Timeout does not mean the queue was rolled back.
  }
  return {
    get pending() { return active !== null && active.worker === getWorker(); },
    request({ force = false, enforceCooldown = false, requestId = crypto.randomUUID(), expectedRevision = publicationRevision(getPublication()) } = {}) {
      if (!isRefreshId(requestId) || !isPublicationRevision(expectedRevision)) return Promise.reject(error(422, '갱신 요청 기준값이 올바르지 않습니다.'));
      const worker = getWorker();
      if (!worker?.connected) return Promise.reject(error(503, '통계 집계 워커가 준비되지 않았습니다.'));
      if (active?.worker === worker) return Promise.reject(error(409, active.settled
        ? '이전 갱신 요청의 접수 여부를 확인 중입니다. 집계 상태를 확인해 주세요.'
        : '갱신 요청을 접수 중입니다. 집계 상태를 확인해 주세요.'));
      if (active) rejectUnknown(active, 503, '집계 워커 연결이 변경되어 접수 여부를 확인하지 못했습니다.');
      return new Promise((resolve, reject) => {
        const entry = { requestId, worker, resolve, reject, settled: false, timer: null };
        active = entry;
        entry.timer = setTimeout(() => rejectUnknown(entry, 504, '갱신 요청의 접수 확인 시간이 초과되었습니다. 집계 상태를 확인해 주세요.'), timeoutMs);
        try {
          worker.send({ type: 'refresh', protocol: REFRESH_PROTOCOL, requestId,
            force, enforceCooldown, expectedRevision }, sendError => {
            if (sendError && active === entry) rejectUnknown(entry, 503, '집계 워커 전송 결과를 확인하지 못했습니다.');
          });
        } catch { rejectUnknown(entry, 503, '집계 워커 전송 결과를 확인하지 못했습니다.'); }
      });
    },
    receive(worker, message) {
      const entry = active;
      if (!entry || worker !== entry.worker || message?.type !== 'refresh-result' || message.requestId !== entry.requestId) return false;
      const validError = message.ok === false && [409, 422, 429].includes(message.status)
        && typeof message.message === 'string' && message.message.length > 0
        && (message.status !== 429 || (typeof message.retryAt === 'string' && Number.isFinite(Date.parse(message.retryAt))));
      const validSuccess = message.ok === true && validRefreshReceipt(message.publication, entry.requestId);
      if (message.protocol !== REFRESH_PROTOCOL || (!validSuccess && !validError)) {
        rejectUnknown(entry, 502, '집계 워커의 접수 응답을 확인하지 못했습니다.');
        return true;
      }
      active = null;
      clearTimeout(entry.timer);
      if (!entry.settled) {
        entry.settled = true;
        if (message.ok) entry.resolve(message.publication);
        else entry.reject(error(message.status, message.message, { retryAt: message.retryAt }));
      }
      return true;
    },
    disconnect(worker) {
      if (active?.worker === worker) rejectUnknown(active, 503, '집계 워커 연결이 끊겨 접수 여부를 확인하지 못했습니다.');
    }
  };
}
