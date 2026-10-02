import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolvePublicAsset } from '../lib/public-assets.js';

const publicDir = path.resolve('public');

test('상품 결과 모듈과 카탈로그 이미지를 정적 파일로 제공한다', () => {
  assert.deepEqual(resolvePublicAsset(publicDir, '/.well-known/assetlinks.json'), {
    filePath: path.join(publicDir, '.well-known', 'assetlinks.json'),
    contentType: 'application/json; charset=utf-8'
  });
  assert.deepEqual(resolvePublicAsset(publicDir, '/product-catalog.js'), {
    filePath: path.join(publicDir, 'product-catalog.js'),
    contentType: 'text/javascript; charset=utf-8'
  });
  assert.deepEqual(resolvePublicAsset(publicDir, '/assets/product-catalog/characters/21.png'), {
    filePath: path.join(publicDir, 'assets', 'product-catalog', 'characters', '21.png'),
    contentType: 'image/png'
  });
  assert.deepEqual(resolvePublicAsset(publicDir, '/assets/product-catalog/skins/21/1.png'), {
    filePath: path.join(publicDir, 'assets', 'product-catalog', 'skins', '21', '1.png'),
    contentType: 'image/png'
  });
});

test('카탈로그 외 임의 경로와 디렉터리 탈출은 허용하지 않는다', () => {
  assert.equal(resolvePublicAsset(publicDir, '/assets/product-catalog/characters/not-a-number.png'), null);
  assert.equal(resolvePublicAsset(publicDir, '/assets/product-catalog/../product-catalog.js'), null);
  assert.equal(resolvePublicAsset(publicDir, '/assets/secret.png'), null);
});
