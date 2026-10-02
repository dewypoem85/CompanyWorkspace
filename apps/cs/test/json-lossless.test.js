import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidJson, prettyPrintJsonLossless } from '../public/json-lossless.js';

test('lossless JSON 정리는 64비트 숫자와 문자열 이스케이프 원문을 보존한다', () => {
  const source = '{"id":9223372036854775807,"nested":{"empty":{},"items":[1,2]},"escaped":"a\\\\b\\\"c"}';
  const formatted = prettyPrintJsonLossless(source);
  assert.match(formatted, /9223372036854775807/);
  assert.match(formatted, /"escaped": "a\\\\b\\\"c"/);
  assert.equal(formatted, [
    '{',
    '  "id": 9223372036854775807,',
    '  "nested": {',
    '    "empty": {},',
    '    "items": [',
    '      1,',
    '      2',
    '    ]',
    '  },',
    '  "escaped": "a\\\\b\\\"c"',
    '}'
  ].join('\n'));
});

test('lossless JSON 정리는 잘못된 JSON을 거부하고 검증 결과를 제공한다', () => {
  assert.equal(isValidJson('{"ok":true}'), true);
  assert.equal(isValidJson('{invalid'), false);
  assert.throws(() => prettyPrintJsonLossless('{invalid'), SyntaxError);
});
