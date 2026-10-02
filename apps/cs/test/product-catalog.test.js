import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHARACTERS,
  PETS,
  SKINS,
  WEAPONS,
  findProductCatalogItem,
  inspectProductCatalogValue,
  makeSkinGuideItem
} from '../public/product-catalog.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

test('상품 결과 카탈로그는 캐릭터·펫·스킨·무기 ID와 이름을 제공한다', () => {
  assert.equal(CHARACTERS.length, 22);
  assert.equal(PETS.length, 38);
  assert.equal(SKINS.length, 117);
  assert.equal(WEAPONS.length, 92);
  assert.equal(new Set(CHARACTERS.map((item) => item.value)).size, CHARACTERS.length);
  assert.equal(new Set(PETS.map((item) => item.value)).size, PETS.length);
  assert.equal(new Set(SKINS.map((item) => item.value)).size, SKINS.length);
  assert.equal(new Set(WEAPONS.map((item) => item.value)).size, WEAPONS.length);
  assert.equal(findProductCatalogItem('characters', '21').name, '광전사');
  assert.equal(findProductCatalogItem('pets', '5').name, '서리 정령');
  assert.equal(findProductCatalogItem('skins', '21-1').name, '하이퍼★스트리머');
  assert.equal(findProductCatalogItem('weapons', '21-1').name, '블루 오버드라이브');
});

test('스킨 가이드는 알려진 스킨 메타데이터와 미등록 조합 ID 폴백을 제공한다', () => {
  assert.equal(makeSkinGuideItem('0-1').name, '제국의 별');
  assert.deepEqual(makeSkinGuideItem('21-3'), {
    type: 'skins', characterId: 21, id: 3, value: '21-3',
    name: '광전사 스킨 3', ownerName: '광전사',
    image: '/assets/product-catalog/characters/21.png'
  });
  assert.equal(makeSkinGuideItem('broken'), null);
});

test('숫자 입력 결과는 정상·형식 오류·미등록 ID를 구분한다', () => {
  assert.equal(inspectProductCatalogValue('characters', '21').status, 'valid');
  assert.equal(inspectProductCatalogValue('pets', '5').item.name, '서리 정령');
  assert.equal(inspectProductCatalogValue('skins', '21-1').item.name, '하이퍼★스트리머');
  assert.equal(inspectProductCatalogValue('weapons', '21-1').item.name, '블루 오버드라이브');
  assert.equal(inspectProductCatalogValue('characters', 'abc').status, 'invalid-format');
  assert.equal(inspectProductCatalogValue('skins', '21').status, 'invalid-format');
  assert.equal(inspectProductCatalogValue('pets', '999').status, 'not-found');
  assert.equal(inspectProductCatalogValue('weapons', '21-999').status, 'not-found');
});

test('카탈로그에서 참조하는 모든 이미지가 CS 정적 자산에 존재한다', async () => {
  for (const item of [...CHARACTERS, ...PETS, ...SKINS, ...WEAPONS]) {
    await access(path.join(publicDir, item.image.replace(/^\//, '').replaceAll('/', path.sep)));
  }
});
