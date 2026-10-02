const CATALOG_KEY = 'SteamMicroTxnProductsJson';
const DEFAULT_CACHE_MS = 5 * 60_000;

export function createSteamProductCatalog({ playFabClient, cacheMs = DEFAULT_CACHE_MS, now = () => Date.now() } = {}) {
  let cached = null;
  let expiresAt = 0;
  let loading = null;

  async function load() {
    if (!playFabClient?.getTitleInternalData) throw new Error('PlayFab 라이브 상품 카탈로그 연결이 없습니다.');
    if (cached && expiresAt > now()) return cached;
    if (!loading) loading = readCatalog(playFabClient).then(value => {
      cached = value; expiresAt = now() + cacheMs; return value;
    }).finally(() => { loading = null; });
    return loading;
  }

  return {
    async enrich(transactions) {
      const source = structuredClone(transactions);
      try {
        const products = await load();
        let unknownCount = 0;
        for (const transaction of source) for (const item of transaction.items) {
          const product = products.get(item.itemId);
          item.productKnown = Boolean(product);
          item.productName = product?.name || '';
          item.productId = product?.productId || '';
          item.productDescription = product?.description || '';
          if (!product) unknownCount += 1;
        }
        return {
          transactions: source,
          productCatalog: {
            available: true,
            unknownCount,
            message: unknownCount ? `${unknownCount}개 항목은 현재 상품 카탈로그에서 찾지 못했습니다.` : 'PlayFab 라이브 상품 카탈로그와 연결했습니다.'
          }
        };
      } catch {
        for (const transaction of source) for (const item of transaction.items) {
          item.productKnown = false; item.productName = ''; item.productId = ''; item.productDescription = '';
        }
        return {
          transactions: source,
          productCatalog: { available: false, unknownCount: source.reduce((sum, transaction) => sum + transaction.items.length, 0), message: '상품명 카탈로그를 확인하지 못해 Steam Item ID로 표시합니다.' }
        };
      }
    }
  };
}

async function readCatalog(playFabClient) {
  const response = await playFabClient.getTitleInternalData({ keys: [CATALOG_KEY] });
  const raw = response?.data?.[CATALOG_KEY];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Steam 상품 카탈로그가 비어 있습니다.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Steam 상품 카탈로그 JSON이 올바르지 않습니다.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Steam 상품 카탈로그 구조가 올바르지 않습니다.');
  const source = parsed.products ?? parsed;
  const entries = Array.isArray(source) ? source.map((value, index) => [String(index), value]) : Object.entries(source);
  const products = new Map();
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const itemId = String(value.itemId ?? value.steamItemDefId ?? key).trim();
    if (!/^\d+$/.test(itemId) || BigInt(itemId) > 4294967295n) continue;
    if (products.has(itemId)) throw new Error('Steam 상품 카탈로그에 중복 Item ID가 있습니다.');
    products.set(itemId, {
      name: cleanText(value.name, 200),
      productId: cleanText(value.productId, 200),
      description: cleanText(value.description, 1000)
    });
  }
  if (!products.size) throw new Error('Steam 상품 카탈로그에 식별 가능한 상품이 없습니다.');
  return products;
}

function cleanText(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

export const STEAM_PRODUCT_CATALOG_KEY = CATALOG_KEY;
