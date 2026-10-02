import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteamProductCatalog, STEAM_PRODUCT_CATALOG_KEY } from '../lib/steam-product-catalog.js';
import { createProductPlayFabClient } from '../lib/product-playfab.js';

const transactions = [{ items: [
  { itemId: '1001', quantity: '1', amount: '5500', vat: '550', status: 'Succeeded' },
  { itemId: '9999', quantity: '2', amount: '100', vat: '0', status: 'Succeeded' }
] }];

test('Steam 상품 카탈로그가 거래 항목에 상품명과 내부 상품 키를 연결하고 캐시한다', async () => {
  let calls = 0;
  const catalog = createSteamProductCatalog({ playFabClient: { getTitleInternalData: async () => {
    calls += 1;
    return { data: { [STEAM_PRODUCT_CATALOG_KEY]: JSON.stringify({ products: [{ itemId: '1001', productId: 'starter_pack', name: '스타터 패키지', description: '보석과 스킨 묶음' }] }) } };
  } } });
  const first = await catalog.enrich(transactions), second = await catalog.enrich(transactions);
  assert.equal(first.transactions[0].items[0].productName, '스타터 패키지');
  assert.equal(first.transactions[0].items[0].productId, 'starter_pack');
  assert.equal(first.transactions[0].items[0].productKnown, true);
  assert.equal(first.transactions[0].items[1].productKnown, false);
  assert.deepEqual(first.productCatalog, { available: true, unknownCount: 1, message: '1개 항목은 현재 상품 카탈로그에서 찾지 못했습니다.' });
  assert.equal(calls, 1); assert.notEqual(first.transactions, transactions); assert.equal(second.productCatalog.available, true);
});

test('상품 카탈로그 조회나 JSON이 잘못되어도 거래 조회는 Item ID로 계속된다', async () => {
  const catalog = createSteamProductCatalog({ playFabClient: { getTitleInternalData: async () => ({ data: { [STEAM_PRODUCT_CATALOG_KEY]: '{bad' } }) } });
  const result = await catalog.enrich(transactions);
  assert.equal(result.productCatalog.available, false);
  assert.equal(result.productCatalog.unknownCount, 2);
  assert.ok(result.transactions[0].items.every(item => item.productKnown === false));
});

test('PlayFab 상품 클라이언트가 Title Internal Data 문자열만 정규화한다', async () => {
  let request;
  const client = createProductPlayFabClient({ titleId: 'EF17D', secretKey: 'synthetic', maxRetries: 0, fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ code: 200, status: 'OK', data: { Data: { [STEAM_PRODUCT_CATALOG_KEY]: '{"products":[]}', Ignored: 7 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const result = await client.getTitleInternalData({ keys: [STEAM_PRODUCT_CATALOG_KEY] });
  assert.deepEqual(result.data, { [STEAM_PRODUCT_CATALOG_KEY]: '{"products":[]}' });
  assert.equal(request.url, 'https://EF17D.playfabapi.com/Admin/GetTitleInternalData');
  assert.deepEqual(JSON.parse(request.options.body), { Keys: [STEAM_PRODUCT_CATALOG_KEY] });
});
