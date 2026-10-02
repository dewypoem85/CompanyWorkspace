const UINT64_MAX = 18446744073709551615n;
const UINT32_MAX = 4294967295n;

export function validateUintString(value, label, max = UINT64_MAX) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) throw new ValidationError(`${label}는 숫자만 입력해야 합니다.`);
  const numeric = BigInt(normalized);
  if (numeric < 1n || numeric > max) throw new ValidationError(`${label} 범위가 올바르지 않습니다.`);
  return normalized;
}

export function validateOrderId(value) {
  return validateUintString(value, 'Order ID');
}

export function validateSteamId(value) {
  return validateUintString(value, 'Steam ID');
}

export function validateAppId(value) {
  return validateUintString(value, 'App ID', UINT32_MAX);
}

export function validateReason(value) {
  const normalized = String(value ?? '').trim();
  if (normalized.length < 5) throw new ValidationError('환불 사유를 5자 이상 입력해 주세요.');
  if (normalized.length > 500) throw new ValidationError('환불 사유는 500자 이하로 입력해 주세요.');
  return normalized;
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}
