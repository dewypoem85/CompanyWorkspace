// 서버 세션 식별자와 Apple 업로드용 서명 URL은 브라우저에 전달하지 않는다.
const privateKeys = new Set(['sid', 'uploadoperations', 'requestheaders', 'authorization', 'x-secretkey']);
export function publicData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKeys.has(key.toLowerCase()))
      .map(([key, item]) => [key, publicData(item)]));
  }
  return value;
}
