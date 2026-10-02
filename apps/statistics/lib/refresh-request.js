import { REFRESH_PROTOCOL, REFRESH_MEDIA_TYPE, isRefreshId, isPublicationRevision } from '../public/refresh-contract.js';
import { publicationRevision } from './publication-contract.js';

export function refreshContext({ user, mode, titleId, publication, available, pending }) {
  return { protocol: REFRESH_PROTOCOL, user: { id: user.id, role: user.role }, mode, titleId,
    publication, revision: publicationRevision(publication), serverTime: new Date().toISOString(), available, pending };
}
export async function respondToRefreshIntent({ req, user, mode, titleId, requestRefresh, respond }) {
  const reply = (status, outcome, message) => respond(status, { protocol: REFRESH_PROTOCOL, outcome, message }, REFRESH_MEDIA_TYPE);
  // No CORS is granted. Requiring a custom header + JSON prevents cross-origin
  // simple form submissions; existing legacy endpoints remain a separate boundary.
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest' || req.headers['sec-fetch-site'] === 'cross-site'
      || !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reply(403, 'denied', '요청 출처를 확인하지 못했습니다.');
  let input;
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 8192) throw Error('large'); chunks.push(chunk); }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return reply(422, 'invalid', '갱신 요청 형식이 올바르지 않습니다.'); }
  if (!input || input.protocol !== REFRESH_PROTOCOL || typeof input.force !== 'boolean'
      || !isRefreshId(input.requestId) || !isPublicationRevision(input.expectedRevision)) return reply(422, 'invalid', '갱신 요청 기준값이 올바르지 않습니다.');
  if (!user.id || input.expectedUserId !== user.id || input.expectedRole !== user.role) return reply(403, 'denied', '회사 계정이나 권한이 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
  if (input.mode !== mode || input.titleId !== titleId) return reply(409, 'conflict', '집계 대상이 변경되었습니다. 최신 상태를 확인해 주세요.');
  if (input.force && !user.isAdmin) return reply(403, 'denied', '관리자만 강제 갱신할 수 있습니다.');
  try {
    const publication = await requestRefresh({ force: input.force, enforceCooldown: true,
      requestId: input.requestId, expectedRevision: input.expectedRevision, rejectIfRunning: true });
    return respond(202, { protocol: REFRESH_PROTOCOL, acceptance: 'accepted', requestId: input.requestId,
      user: { id: user.id, role: user.role }, mode, titleId, expectedRevision: input.expectedRevision, force: input.force, publication }, REFRESH_MEDIA_TYPE);
  } catch (error) {
    if ([409,422,429].includes(error?.statusCode) && error.outcome !== 'unknown') return reply(error.statusCode, error.statusCode === 409 ? 'conflict' : 'invalid', error.message);
    return reply(502, 'unknown', '갱신 요청의 접수 여부를 확인하지 못했습니다. 자동으로 다시 요청하지 않으며 집계 상태를 확인해 주세요.');
  }
}
