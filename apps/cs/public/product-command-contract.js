// Browser acknowledgement checks; PlayFab authorization and snapshot comparison remain server-owned.
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const text = v => typeof v === 'string';
const nullableText = v => v === null || text(v);
const version = v => v === null || integer(v);
const keys = { grant: '지급', revoke: '회수' };
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function requireValue(value) { if (!value) throw new Error('상품 명령 응답이 불완전하거나 확인한 대상과 다릅니다. 이 응답만으로 처리 여부를 판단할 수 없습니다.'); }
function envelope(value, environment) {
  requireValue(record(value) && value.environment === environment && value.dataStore === 'UserReadOnlyData' && text(value.environmentLabel));
}
function targets(rows, ids) {
  requireValue(Array.isArray(rows) && rows.length === ids.length && rows.every(record));
  const actual = rows.map(r=>r.playFabId);
  requireValue(actual.every(text) && new Set(actual.map(id=>id.toLowerCase())).size === ids.length);
  requireValue(equal([...actual].sort(), [...ids].sort()));
}
export function validateProductConfig(value) {
  requireValue(record(value) && value.dataStore === 'UserReadOnlyData' && typeof value.configured === 'boolean' && ['live','test'].includes(value.defaultEnvironment));
  requireValue(Array.isArray(value.environments) && value.environments.length === 2 && new Set(value.environments.map(v=>v?.id)).size === 2);
  for (const env of value.environments) {
    requireValue(record(env) && ['live','test'].includes(env.id) && text(env.titleId) && text(env.label) && env.dataStore === value.dataStore);
    requireValue(['configured','writeEnabled','liveEnabled'].every(key=>typeof env[key] === 'boolean') && ['live','mock','disabled'].includes(env.mode));
    requireValue(env.configured === (env.mode !== 'disabled') && env.writeEnabled === (env.configured && (env.mode === 'mock' || env.liveEnabled)));
  }
  requireValue(value.configured === value.environments.some(e=>e.configured));
  return value;
}
export function validateProductPreview(value, request) {
  envelope(value,request.environment); requireValue(value.operation === request.operation && value.key === keys[request.operation] && value.memo === request.memo);
  requireValue(text(value.previewToken) && /^[0-9a-f-]{36}$/i.test(value.previewToken) && Number.isFinite(Date.parse(value.createdAt)) && Date.parse(value.expiresAt) > Date.parse(value.createdAt));
  targets(value.items,request.playFabIds);
  const summary = value.summary; requireValue(record(summary) && summary.targetCount === request.playFabIds.length && record(summary.currencyTotals));
  const currencyTotals = {};
  for (const [source,key] of [['gem','젬'],['soul','영혼석'],['prayer','기도석'],['rift','균열석'],['mileage','마일리지']]) {
    const amount = request.command.currencies[source]; if (amount > 0) currencyTotals[key] = amount * request.playFabIds.length;
  }
  requireValue(Object.values(summary.currencyTotals).every(integer) && equal(summary.currencyTotals,currencyTotals));
  for (const key of ['characters','pets','skins','weapons','packages']) {
    const expected = ['skins','weapons'].includes(key) ? [...new Set(request.command[key])] : request.command[key];
    requireValue(equal(summary[key],expected));
  }
  for (const item of value.items) {
    requireValue(text(item.requestId) && item.requestId.startsWith(`${request.operation}-`) && item.requestId.length <= 120 && version(item.dataVersion));
    requireValue(['existingCommand','oppositeCommand','commandJson','mergeError','lookupError'].every(key=>nullableText(item[key])));
    requireValue(text(item.existingLastUpdated) && text(item.oppositeLastUpdated));
    if (item.commandJson !== null) {
      let command; try { command = JSON.parse(item.commandJson); } catch { requireValue(false); }
      requireValue(record(command) && command['요청ID'] === item.requestId);
    } else requireValue(Boolean(item.mergeError || item.lookupError));
  }
  requireValue(new Set(value.items.map(i=>i.requestId)).size === value.items.length);
  requireValue(value.existingCount === value.items.filter(i=>i.existingCommand !== null).length);
  requireValue(value.lookupFailureCount === value.items.filter(i=>i.lookupError).length && value.mergeFailureCount === value.items.filter(i=>i.mergeError).length);
  return value;
}
export function validateProductExecution(value, preview, request) {
  envelope(value,preview.environment);
  requireValue(value.previewToken === preview.previewToken && value.operation === preview.operation && value.key === preview.key && value.dryRun === request.dryRun);
  targets(value.results,request.playFabIds || preview.items.map(i=>i.playFabId));
  for (const item of value.results) {
    requireValue(item.requestId === preview.items.find(i=>i.playFabId === item.playFabId)?.requestId);
    requireValue(['success','retry_success','failed','skipped','existing'].includes(item.status) && typeof item.dryRun === 'boolean' && integer(item.retryCount));
    if (!request.dryRun) requireValue(item.dryRun === false);
    if (item.dataVersion !== undefined) requireValue(version(item.dataVersion));
    if (item.auditRecorded !== undefined) requireValue(typeof item.auditRecorded === 'boolean');
    for (const key of ['error','detail']) if (item[key] !== undefined) requireValue(text(item[key]));
  }
  requireValue(value.totalCount === value.results.length);
  for (const [key,status] of [['successCount','success'],['retrySuccessCount','retry_success'],['failureCount','failed'],['skippedCount','skipped'],['existingCount','existing']]) requireValue(value[key] === value.results.filter(i=>i.status === status).length);
  return value;
}
export function validateProductLookup(value, request) {
  envelope(value,request.environment); targets(value.results,request.playFabIds);
  requireValue(value.totalCount === value.results.length && value.successCount === value.results.filter(i=>i.success === true).length);
  for (const item of value.results) {
    requireValue(item.environment === request.environment && item.dataStore === value.dataStore && typeof item.success === 'boolean');
    if (item.success) {
      requireValue(version(item.dataVersion));
      for (const key of ['grant','revoke']) requireValue(item[key] === null || (record(item[key]) && text(item[key].value) && text(item[key].lastUpdated)));
    } else requireValue(text(item.error));
  }
  return value;
}
export function validateProductDeletion(value, request) {
  requireValue(record(value) && value.environment === request.environment && value.playFabId === request.playFabId && value.key === keys[request.operation]);
  requireValue(['success','retry_success','skipped','failed'].includes(value.status));
  if (['success','retry_success'].includes(value.status)) requireValue(text(value.requestId) && version(value.dataVersion) && typeof value.auditRecorded === 'boolean' && integer(value.retryCount));
  else requireValue(text(value.error) || text(value.detail));
  return value;
}
