import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBoolean,
  validateAppId,
  validateOrderId,
  validateReason,
  validateSteamId
} from '../lib/validation.js';
import { createSteamClient, normalizeTransaction } from '../lib/steam.js';

test('64비트 식별자는 문자열 정밀도를 유지한다', () => {
  const max = '18446744073709551615';
  assert.equal(validateOrderId(max), max);
  assert.equal(validateSteamId('76561198000000000'), '76561198000000000');
});

test('숫자가 아닌 식별자를 거부한다', () => {
  assert.throws(() => validateOrderId('12-34'));
  assert.throws(() => validateSteamId('abc'));
});

test('App ID는 uint32 범위로 제한한다', () => {
  assert.equal(validateAppId('2712460'), '2712460');
  assert.throws(() => validateAppId('4294967296'));
});

test('환불 사유 길이를 검증한다', () => {
  assert.equal(validateReason('CS 요청에 따른 환불'), 'CS 요청에 따른 환불');
  assert.throws(() => validateReason('짧음'));
});

test('환경변수 boolean 값을 파싱한다', () => {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('ON'), true);
  assert.equal(parseBoolean('false', true), false);
  assert.equal(parseBoolean(undefined, true), true);
});

test('Steam 거래 응답을 안전한 UI 모델로 정규화한다', () => {
  const result = normalizeTransaction({
    orderid: '100',
    transid: '200',
    steamid: '76561198000000000',
    status: 'Succeeded',
    currency: 'KRW',
    items: { itemid: 'gold', qty: 1, amount: 1000, vat: 100, itemstatus: 'Succeeded' }
  });
  assert.equal(result.orderId, '100');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].amount, '1000');
});

test('Order ID 조회가 400이면 Steam Transaction ID로 자동 재조회한다', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (requestedUrls.length === 1) {
      return new Response('<html>Bad Request</html>', {
        status: 400,
        headers: { 'content-type': 'text/html; charset=UTF-8' }
      });
    }
    return new Response(JSON.stringify({
      response: {
        result: 'OK',
        params: {
          orderid: '1774000000000123',
          transid: '277683884535313760',
          steamid: '76561198014357473',
          status: 'Succeeded',
          currency: 'KRW',
          items: []
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const client = createSteamClient({
      publisherKey: '0123456789abcdef0123456789abcdef',
      appId: '2712460',
      useSandbox: false
    });
    const transaction = await client.queryTransaction('277683884535313760');
    assert.equal(transaction.lookupType, 'transid');
    assert.equal(transaction.orderId, '1774000000000123');
    assert.equal(transaction.transactionId, '277683884535313760');
    assert.match(requestedUrls[0], /orderid=277683884535313760/);
    assert.match(requestedUrls[1], /transid=277683884535313760/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Steam 거래 보고서는 시작 시각부터 여러 주문을 문자열 정밀도로 정규화한다', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ response: { result: 'OK', params: { orders: [
      { orderid: '1774000000000123', transid: '277683884535313760', steamid: '76561198014357473', status: 'Succeeded', currency: 'KRW', time: '2026-09-21T00:00:00Z', items: [] }
    ] } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createSteamClient({ publisherKey: '0123456789abcdef0123456789abcdef', appId: '2712460', useSandbox: false });
    const report = await client.getTransactionReport('2010-01-01T00:00:00Z', 10_000);
    assert.equal(report[0].transactionId, '277683884535313760');
    assert.match(requestedUrl, /GetReport\/v5/);
    assert.match(requestedUrl, /time=2010-01-01T00%3A00%3A00Z/);
    assert.match(requestedUrl, /maxresults=10000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
