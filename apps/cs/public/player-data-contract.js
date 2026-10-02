// Validate existing API acknowledgements before changing any editor value or token.
export function mutationKey(request, action) {
  return action !== 'delete' && request.dataStore === 'user'
    && ['SaveData', 'SaveData-Compression'].includes(request.key) ? 'SaveData-Compression' : request.key;
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const bytes = value => new TextEncoder().encode(value).byteLength;
function requireValid(valid) { if (!valid) throw new Error('서버 확인 응답이 요청한 대상·내용과 일치하지 않습니다.'); }

export function validatePlayerBaseConfig(value) {
  requireValid(object(value) && typeof value.csrfToken === 'string' && value.csrfToken.length > 0
    && object(value.currentUser)
    && (typeof value.currentUser.id === 'string' ? value.currentUser.id.trim().length > 0
      : Number.isSafeInteger(value.currentUser.id) && value.currentUser.id > 0));
  return value;
}

export function validatePlayerConfig(value) {
  requireValid(object(value) && value.dataStore === 'UserData' && value.defaultDataStore === 'user'
    && value.dynamicKeys === true && value.saveDataCompression === 'gzip-v1'
    && count(value.maxValueBytes) && value.maxValueBytes > 0 && count(value.editTokenTtlSeconds) && value.editTokenTtlSeconds > 0
    && ['live','test'].includes(value.defaultEnvironment) && object(value.environments));
  requireValid(Array.isArray(value.dataStores) && value.dataStores.length === 3);
  for (const [id,name] of [['user','UserData'],['readonly','UserReadOnlyData'],['internal','UserInternalData']]) {
    const stores = value.dataStores.filter(store => object(store) && store.id === id);
    requireValid(stores.length === 1 && stores[0].playFabName === name && typeof stores[0].label === 'string'
      && stores[0].saveCompression === (id === 'user'));
  }
  for (const id of ['live','test']) {
    const env = value.environments[id];
    requireValid(object(env) && env.id === id && typeof env.label === 'string' && typeof env.titleId === 'string'
      && typeof env.configured === 'boolean' && typeof env.writeEnabled === 'boolean'
      && ['disabled','mock','live'].includes(env.mode) && env.configured === (env.mode !== 'disabled')
      && (!env.writeEnabled || env.configured) && Array.isArray(env.dataStores)
      && [...env.dataStores].sort().join(',') === 'internal,readonly,user');
  }
  return value;
}

export function validateMutationResult(action, request, result) {
  requireValid(['save','add','delete'].includes(action) && object(result));
  requireValid(result.environment === request.environment && result.dataStore === request.dataStore
    && result.playFabId === request.playFabId && result.key === mutationKey(request, action)
    && count(result.dataVersion) && typeof result.message === 'string');
  if (action === 'delete') return result;
  const compressed = result.key === 'SaveData-Compression' && request.dataStore === 'user';
  requireValid(count(result.bytes) && result.decodedBytes === bytes(request.value)
    && result.compression === (compressed ? 'gzip-v1' : 'plain'));
  if (!compressed) requireValid(result.bytes === result.decodedBytes);
  if (action === 'add') return result;
  requireValid(token(result.editToken) && result.editToken !== request.editToken && date(result.editTokenExpiresAt));
  requireValid(Array.isArray(result.removedKeys) && new Set(result.removedKeys).size === result.removedKeys.length
    && result.removedKeys.every(key => compressed && key === 'SaveData')
    && (request.key !== 'SaveData' || !compressed || result.removedKeys.includes('SaveData')));
  const record = result.record;
  requireValid(object(record) && record.exists === true && record.value === request.value
    && typeof record.jsonValid === 'boolean' && record.valueType === (record.jsonValid ? 'json' : 'text')
    && record.bytes === result.bytes && record.decodedBytes === result.decodedBytes
    && record.compression === result.compression && record.fallbackUsed === false
    && record.compressionError === '' && typeof record.compressionLabel === 'string'
    && typeof record.permission === 'string' && typeof record.lastUpdated === 'string');
  return result;
}

export function validatePlayerLookup(result, target) {
  requireValid(object(result) && result.environment === target.environment && result.playFabId === target.playFabId
    && typeof result.environmentLabel === 'string' && Array.isArray(result.stores) && result.stores.length === 3);
  const stores = new Set(); let total = 0;
  for (const store of result.stores) {
    requireValid(object(store) && ['user','readonly','internal'].includes(store.dataStore) && !stores.has(store.dataStore));
    stores.add(store.dataStore);
    requireValid(store.environment === target.environment && store.playFabId === target.playFabId
      && count(store.dataVersion) && token(store.editToken) && date(store.editTokenExpiresAt)
      && typeof store.writeEnabled === 'boolean' && typeof store.dataStoreLabel === 'string'
      && typeof store.dataStorePlayFabName === 'string' && Array.isArray(store.keys) && object(store.records)
      && store.keys.every(key => typeof key === 'string' && Object.hasOwn(store.records, key))
      && new Set(store.keys).size === store.keys.length && Object.keys(store.records).length === store.keys.length);
    for (const key of store.keys) {
      const record = store.records[key];
      requireValid(object(record) && typeof record.value === 'string' && typeof record.jsonValid === 'boolean'
        && count(record.bytes) && count(record.decodedBytes) && typeof record.compression === 'string'
        && typeof record.lastUpdated === 'string' && typeof record.permission === 'string');
    }
    total += store.keys.length;
  }
  requireValid(result.totalKeys === total);
  return result;
}
