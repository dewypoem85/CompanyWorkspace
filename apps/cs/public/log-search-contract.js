// Validate the existing live-search response before rendering or replacing a saved job.
const counts = ['partitions', 'partitionsScanned', 'blobsListed', 'blobsScanned', 'blobsSkippedByUid', 'rowsScanned', 'blobErrors'];
const statuses = ['queued', 'running', 'completed', 'failed', 'cancelled'];
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
export const isLogJobId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
function requireValue(condition) {
  if (!condition) throw new Error('검색 응답이 불완전하거나 현재 작업과 일치하지 않습니다. 상태를 다시 확인해 주세요.');
}
export function validateLogConfig(value) {
  requireValue(record(value) && ['configured', 'storageConfigured', 'titleConfigured'].every(key => typeof value[key] === 'boolean'));
  requireValue(typeof value.titleId === 'string' && value.source === 'live');
  requireValue(value.configured === (value.storageConfigured && value.titleConfigured));
  if (value.configured) requireValue(value.titleId.length > 0 && value.asynchronous === true && count(value.pollIntervalMs) && value.pollIntervalMs > 0);
  return value;
}
export function validateLogJob(job, { jobId, titleId, request } = {}) {
  requireValue(record(job) && isLogJobId(job.id) && (!jobId || job.id === jobId) && statuses.includes(job.status));
  requireValue(typeof job.cancelRequested === 'boolean' && count(job.durationMs) && record(job.progress));
  requireValue(typeof job.progress.stage === 'string' && counts.every(key => count(job.progress[key])) && count(job.progress.resultCount));
  requireValue(job.progress.partitionsScanned <= job.progress.partitions);
  if (job.status === 'failed') requireValue(typeof job.error === 'string');
  if (job.status !== 'completed') return job;
  const value = job.result;
  requireValue(record(value) && value.source === 'live' && value.titleId === titleId && count(value.durationMs));
  requireValue(record(value.stats) && counts.every(key => count(value.stats[key])));
  requireValue(['asc', 'desc'].includes(value.sort) && ['all', 'any', 'exact'].includes(value.mode));
  requireValue(['from', 'to', 'query', 'playFabId', 'eventName'].every(key => typeof value[key] === 'string'));
  requireValue(Number.isFinite(Date.parse(value.from)) && Date.parse(value.to) > Date.parse(value.from));
  requireValue(count(value.limit) && value.limit > 0 && value.limit <= 500 && Array.isArray(value.results) && value.results.length <= value.limit);
  if (request) requireValue(['from', 'to', 'query', 'mode', 'sort', 'limit', 'eventName'].every(key => value[key] === request[key]) && value.playFabId.toLowerCase() === request.playFabId.toLowerCase());
  for (const item of value.results) {
    requireValue(record(item) && item.titleId === titleId && typeof item.eventDataTruncated === 'boolean');
    requireValue(['timestamp', 'playFabId', 'eventName', 'namespace', 'eventId', 'entityId', 'entityType', 'snippet', 'eventData', 'sourceBlob'].every(key => typeof item[key] === 'string'));
    requireValue(Number.isFinite(Date.parse(item.timestamp)));
  }
  return job;
}
