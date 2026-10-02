export const REFRESH_PROTOCOL = 'statistics-refresh-v1';
export const REFRESH_MEDIA_TYPE = 'application/vnd.company.statistics-refresh+json';
export const isRefreshId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const isPublicationRevision = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const userValid = user => user && typeof user.id === 'string' && user.id.length > 0 && user.id.length <= 128 && ['employee','admin','master'].includes(user.role);
export function validPublication(value) {
  return Boolean(value && ['idle','running','ready','error'].includes(value.status)
    && (value.runId === null || isRefreshId(value.runId))
    && value.inProgress === (value.status === 'running')
    && [value.startedAt,value.completedAt,value.dataThrough,value.refreshAllowedAt,value.nextAt].every(item => item === null || date(item))
    && (value.status !== 'running' || (isRefreshId(value.runId) && date(value.startedAt)))
    && (value.status !== 'ready' || (date(value.completedAt) && date(value.dataThrough)))
    && Number.isSafeInteger(value.totalProfiles) && value.totalProfiles >= 0
    && Number.isSafeInteger(value.publishedProfiles) && value.publishedProfiles >= 0
    && typeof value.currentProfile === 'string' && typeof value.error === 'string');
}
export function validRefreshReceipt(publication, requestId) {
  return validPublication(publication) && isRefreshId(requestId) && publication.runId === requestId
    && ['running','ready','error'].includes(publication.status) && date(publication.startedAt);
}
export function readRefreshContext(value, expectedUser) {
  if (userValid(value?.user) && userValid(expectedUser) && (value.user.id !== expectedUser.id || value.user.role !== expectedUser.role)) {
    throw Object.assign(Error('회사 계정이나 권한이 변경되었습니다.'), { status: 403 });
  }
  if (!value || value.protocol !== REFRESH_PROTOCOL || !userValid(expectedUser) || !userValid(value.user)
      || value.user.id !== expectedUser.id || value.user.role !== expectedUser.role
      || !['live','demo'].includes(value.mode) || typeof value.titleId !== 'string' || (value.mode === 'live' && !value.titleId)
      || !isPublicationRevision(value.revision) || !date(value.serverTime) || typeof value.available !== 'boolean'
      || typeof value.pending !== 'boolean' || !validPublication(value.publication)) throw Error('집계 상태와 현재 계정을 확인하지 못했습니다.');
  return value;
}
export function readRefreshReceipt(value, intent) {
  if (!value || value.protocol !== REFRESH_PROTOCOL || value.acceptance !== 'accepted'
      || value.requestId !== intent.requestId || value.user?.id !== intent.expectedUserId || value.user?.role !== intent.expectedRole
      || value.mode !== intent.mode || value.titleId !== intent.titleId || value.expectedRevision !== intent.expectedRevision
      || value.force !== intent.force || !validRefreshReceipt(value.publication, intent.requestId)) throw Error('갱신 접수 응답이 요청 내용과 일치하지 않습니다.');
  return value.publication;
}
