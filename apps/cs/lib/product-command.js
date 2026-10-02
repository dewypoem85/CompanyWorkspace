import crypto from 'node:crypto';

export const PRODUCT_COMMAND_KEYS = Object.freeze({
  grant: '지급',
  revoke: '회수'
});

export const MAX_PRODUCT_COMMAND_TARGETS = 100;
const MAX_LIST_ITEMS = 500;
const MAX_PACKAGE_NAME_LENGTH = 200;
const MAX_MEMO_LENGTH = 500;
const MAX_COMMAND_JSON_BYTES = 32 * 1024;
const PRODUCT_LIST_KEYS = Object.freeze(['캐릭터', '스킨', '무기', '펫']);

export function validateProductCommandPreviewRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('요청 형식이 올바르지 않습니다.');
  }

  const operation = validateOperation(body.operation);
  const playFabIds = validatePlayFabIds(body.playFabIds);
  const memo = validateProductCommandMemo(body.memo);
  const command = normalizeProductCommand(body.command);

  return { operation, playFabIds, memo, command };
}

export function validateProductCommandLookupRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('요청 형식이 올바르지 않습니다.');
  }
  return { playFabIds: validatePlayFabIds(body.playFabIds) };
}

export function validateOperation(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized !== 'grant' && normalized !== 'revoke') {
    throw validationError('작업 종류는 지급 또는 회수여야 합니다.');
  }
  return normalized;
}

export function validatePlayFabIds(value) {
  if (!Array.isArray(value) || value.length < 1) {
    throw validationError('대상 UID를 한 명 이상 입력해 주세요.');
  }
  if (value.length > MAX_PRODUCT_COMMAND_TARGETS) {
    throw validationError(`한 번에 최대 ${MAX_PRODUCT_COMMAND_TARGETS}명까지 처리할 수 있습니다.`);
  }

  const seen = new Set();
  return value.map((item, index) => {
    const playFabId = validatePlayFabId(item, index);
    const key = playFabId.toLowerCase();
    if (seen.has(key)) throw validationError(`중복 UID가 있습니다: ${playFabId}`);
    seen.add(key);
    return playFabId;
  });
}

export function validatePlayFabId(value, index = 0) {
  const normalized = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalized)) {
    throw validationError(`${index + 1}번째 UID 형식이 올바르지 않습니다.`);
  }
  return normalized;
}

export function validateProductCommandMemo(value) {
  const normalized = String(value ?? '').trim();
  if (normalized.length < 3) throw validationError('처리 사유를 3자 이상 입력해 주세요.');
  if (normalized.length > MAX_MEMO_LENGTH) throw validationError(`처리 사유는 ${MAX_MEMO_LENGTH}자 이하로 입력해 주세요.`);
  return normalized;
}

export function normalizeProductCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('상품 명령 형식이 올바르지 않습니다.');
  }

  const command = {};
  const currencies = normalizeCurrencies(value.currencies);
  if (Object.keys(currencies).length) command['재화'] = currencies;

  const characters = normalizeIntegerArray(value.characters, '캐릭터');
  if (characters.length) command['캐릭터'] = characters;

  const skins = normalizeCompoundIdArray(value.skins, '스킨');
  if (skins.length) command['스킨'] = skins;

  const weapons = normalizeCompoundIdArray(value.weapons, '무기');
  if (weapons.length) command['무기'] = weapons;

  const pets = normalizeIntegerArray(value.pets, '펫');
  if (pets.length) command['펫'] = pets;

  const packages = normalizeStringArray(value.packages, '패키지', { preserveDuplicates: true });
  if (packages.length) command['패키지'] = packages;

  if (!Object.keys(command).length) {
    throw validationError('지급 또는 회수할 항목을 한 개 이상 입력해 주세요.');
  }

  const probe = JSON.stringify({ '요청ID': 'probe-00000000-0000-4000-8000-000000000000', ...command });
  if (Buffer.byteLength(probe, 'utf8') > MAX_COMMAND_JSON_BYTES) {
    throw validationError('생성되는 명령 JSON이 너무 큽니다. 항목 수를 줄여 여러 번 나누어 처리해 주세요.');
  }

  return command;
}

export function createProductRequestId(operation) {
  const prefix = validateOperation(operation) === 'grant' ? 'grant' : 'revoke';
  return `${prefix}-${crypto.randomUUID()}`;
}

export function buildProductCommandValue(command, requestId) {
  const normalizedRequestId = String(requestId ?? '').trim();
  if (!normalizedRequestId || normalizedRequestId.length > 120) {
    throw validationError('요청 ID가 올바르지 않습니다.');
  }
  return stringifyProductCommand({ '요청ID': normalizedRequestId, ...command });
}

export function mergeProductCommandValue(existingValue, command, requestId) {
  const existing = parseStoredProductCommand(existingValue);
  const merged = { ...existing, '요청ID': validateProductRequestId(requestId) };

  const existingCurrencies = validateStoredCurrencies(existing['재화']);
  const addedCurrencies = command['재화'] || {};
  const currencies = { ...existingCurrencies };
  for (const [currency, amount] of Object.entries(addedCurrencies)) {
    const total = (currencies[currency] || 0) + amount;
    if (!Number.isSafeInteger(total)) {
      throw validationError(`${currency} 병합 수량이 안전한 정수 범위를 초과합니다.`);
    }
    currencies[currency] = total;
  }
  if (Object.keys(currencies).length) merged['재화'] = currencies;

  for (const key of PRODUCT_LIST_KEYS) {
    const existingItems = validateStoredList(existing[key], key);
    const addedItems = command[key] || [];
    const items = [...new Set([...existingItems, ...addedItems])];
    if (items.length) merged[key] = items;
  }

  const packages = [
    ...validateStoredList(existing['패키지'], '패키지'),
    ...(command['패키지'] || [])
  ];
  if (packages.length) merged['패키지'] = packages;

  return stringifyProductCommand(merged);
}

export function summarizeProductCommand(command, targetCount) {
  const count = Number.isInteger(targetCount) && targetCount > 0 ? targetCount : 0;
  const currencies = command['재화'] || {};
  const currencyTotals = Object.fromEntries(
    Object.entries(currencies).map(([key, amount]) => [key, amount * count])
  );

  return {
    targetCount: count,
    currencyTotals,
    characters: [...(command['캐릭터'] || [])],
    skins: [...(command['스킨'] || [])],
    weapons: [...(command['무기'] || [])],
    pets: [...(command['펫'] || [])],
    packages: [...(command['패키지'] || [])]
  };
}

function normalizeCurrencies(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw validationError('재화 형식이 올바르지 않습니다.');

  const mapping = [
    ['gem', '젬'],
    ['soul', '영혼석'],
    ['prayer', '기도석'],
    ['rift', '균열석'],
    ['mileage', '마일리지']
  ];
  const result = {};
  for (const [sourceKey, outputKey] of mapping) {
    const normalized = normalizeNonNegativeInteger(value[sourceKey], outputKey, { allowEmpty: true });
    if (normalized > 0) result[outputKey] = normalized;
  }
  return result;
}

function normalizeIntegerArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validationError(`${label} 목록 형식이 올바르지 않습니다.`);
  if (value.length > MAX_LIST_ITEMS) throw validationError(`${label}는 한 번에 최대 ${MAX_LIST_ITEMS}개까지 입력할 수 있습니다.`);
  return value.map((item, index) => normalizeNonNegativeInteger(item, `${label} ${index + 1}번째 항목`));
}

function normalizeCompoundIdArray(value, label) {
  const items = normalizeStringArray(value, label);
  return items.map((item, index) => {
    if (!/^\d+-\d+$/.test(item)) {
      throw validationError(`${label} ${index + 1}번째 항목은 캐릭터ID-아이템ID 형식이어야 합니다. (${item})`);
    }
    return item;
  });
}

function normalizeStringArray(value, label, { preserveDuplicates = false } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validationError(`${label} 목록 형식이 올바르지 않습니다.`);
  if (value.length > MAX_LIST_ITEMS) throw validationError(`${label}는 한 번에 최대 ${MAX_LIST_ITEMS}개까지 입력할 수 있습니다.`);

  const result = [];
  const seen = new Set();
  for (const [index, raw] of value.entries()) {
    const item = String(raw ?? '').trim();
    if (!item) throw validationError(`${label} ${index + 1}번째 항목이 비어 있습니다.`);
    if (item.length > MAX_PACKAGE_NAME_LENGTH) throw validationError(`${label} 항목은 ${MAX_PACKAGE_NAME_LENGTH}자 이하로 입력해 주세요.`);
    if (!preserveDuplicates) {
      if (seen.has(item)) continue;
      seen.add(item);
    }
    result.push(item);
  }
  return result;
}

function normalizeNonNegativeInteger(value, label, { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === null || String(value).trim() === '')) return 0;
  const normalized = typeof value === 'string' ? value.trim().replaceAll(',', '') : value;
  if ((typeof normalized === 'string' && !/^\d+$/.test(normalized)) ||
      (typeof normalized !== 'string' && typeof normalized !== 'number')) {
    throw validationError(`${label}은(는) 0 이상의 정수여야 합니다.`);
  }
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw validationError(`${label}은(는) 0 이상의 정수여야 합니다.`);
  }
  return numeric;
}

function parseStoredProductCommand(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? ''));
  } catch {
    throw validationError('기존 명령 JSON 형식이 올바르지 않아 병합할 수 없습니다.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validationError('기존 명령 JSON이 객체 형식이 아니어서 병합할 수 없습니다.');
  }
  return parsed;
}

function validateStoredCurrencies(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('기존 명령의 재화 형식이 올바르지 않아 병합할 수 없습니다.');
  }
  const result = {};
  for (const [currency, amount] of Object.entries(value)) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw validationError(`기존 명령의 ${currency} 수량이 올바르지 않아 병합할 수 없습니다.`);
    }
    result[currency] = amount;
  }
  return result;
}

function validateStoredList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw validationError(`기존 명령의 ${label} 목록 형식이 올바르지 않아 병합할 수 없습니다.`);
  }
  for (const item of value) {
    if ((label === '캐릭터' || label === '펫') && (!Number.isSafeInteger(item) || item < 0)) {
      throw validationError(`기존 명령의 ${label} 항목이 올바르지 않아 병합할 수 없습니다.`);
    }
    if (label !== '캐릭터' && label !== '펫' && (typeof item !== 'string' || !item)) {
      throw validationError(`기존 명령의 ${label} 항목이 올바르지 않아 병합할 수 없습니다.`);
    }
  }
  return value;
}

function validateProductRequestId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 120) throw validationError('요청 ID가 올바르지 않습니다.');
  return normalized;
}

function stringifyProductCommand(command) {
  const json = JSON.stringify(command);
  if (Buffer.byteLength(json, 'utf8') > MAX_COMMAND_JSON_BYTES) {
    throw validationError('생성되는 명령 JSON이 너무 큽니다. 항목 수를 줄여 여러 번 나누어 처리해 주세요.');
  }
  return json;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.statusCode = 400;
  return error;
}
