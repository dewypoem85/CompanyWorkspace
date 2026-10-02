import crypto from 'node:crypto';

export { REFRESH_PROTOCOL, isRefreshId, isPublicationRevision, validRefreshReceipt } from '../public/refresh-contract.js';

// Progress counters and the next automatic schedule are not a new publication.
// The process-local run ID distinguishes starts even when timestamps are equal.
export function publicationRevision(publication) {
  return crypto.createHash('sha256').update(JSON.stringify([
    publication.runId || null, publication.status || 'idle',
    publication.startedAt || null, publication.completedAt || null,
    publication.dataThrough || null
  ])).digest('hex');
}
