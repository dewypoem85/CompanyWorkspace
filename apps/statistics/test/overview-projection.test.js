import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD_TYPES,
  parseOverviewProjection,
  projectOverview,
  projectionCacheKey,
  standardOverviewProjections
} from '../lib/overview-projection.js';

const build = (name, extra = {}) => ({
  key: name, name, runs: 10, clears: 5, uniquePlayers: 4,
  selectionRate: 50, clearRate: 50,
  playTime: { sampleSize: 1, averageMs: 1, medianMs: 1, p90Ms: 1 },
  versions: [],
  ...extra
});

function fixture() {
  const payload = {
    mode: 'live', summary: {}, trend: [], outcomes: [], versions: [], dimensions: {}, schema: {}, stats: {},
    bosses: [{ key: 'boss-1', name: '보스', buildStats: { characters: [build('기사')], combinations: [build('조합', { matchedKills: 1 })] } }],
    builds: { sourceRuns: {}, masterData: {} }
  };
  for (const type of BUILD_TYPES) payload.builds[type] = [];
  payload.builds.characters = [build('기사', {
    components: {
      weapons: Array.from({ length: 12 }, (_, index) => build(`무기-${index}`, { runes: [{ key: 'large' }], runeConfigurations: [{ key: 'large' }] })),
      sinPoints: Array.from({ length: 147 }, (_, index) => build(`죄악-${index}`))
    },
    topCombinations: Array.from({ length: 12 }, (_, index) => build(`조합-${index}`)),
    topNodeCombinations: Array.from({ length: 12 }, (_, index) => build(`노드-${index}`))
  })];
  payload.builds.weapons = [build('철검', { runes: [{ key: 'large' }], runeConfigurations: [{ key: 'large' }], uniqueRunes: [{ key: 'unique', name: '고유룬' }] })];
  return payload;
}

test('화면별 목록 응답은 다른 화면과 상세 전용 필드를 제거한다', () => {
  const payload = fixture();
  const dashboard = projectOverview(payload, { view: 'dashboard', buildType: 'characters', key: '' });
  assert.equal(dashboard.builds.characters.length, 1);
  assert.equal(Object.hasOwn(dashboard.builds.characters[0], 'components'), false);
  assert.equal(Object.hasOwn(dashboard.bosses[0], 'buildStats'), false);
  assert.equal(dashboard.builds.weapons.length, 0);
  assert.equal(dashboard.stats.projectionRevision, 2);

  const weapons = projectOverview(payload, { view: 'builds', buildType: 'weapons', key: '' });
  assert.equal(weapons.builds.characters.length, 0);
  assert.equal(weapons.builds.weapons.length, 1);
  assert.equal(Object.hasOwn(weapons.builds.weapons[0], 'runes'), false);
  assert.equal(weapons.builds.weapons[0].uniqueRunes.length, 1);
});

test('상세 응답은 화면에서 표시하는 상위 항목만 유지한다', () => {
  const payload = fixture();
  const detail = projectOverview(payload, { view: 'buildDetail', buildType: 'characters', key: '기사' });
  const character = detail.builds.characters[0];
  assert.equal(character.components.weapons.length, 8);
  assert.equal(character.components.sinPoints.length, 147);
  assert.equal(character.topCombinations.length, 10);
  assert.equal(character.topNodeCombinations.length, 10);
  assert.equal(Object.hasOwn(character.components.weapons[0], 'runes'), false);

  const boss = projectOverview(payload, { view: 'bossDetail', buildType: 'characters', key: 'boss-1' }).bosses[0];
  assert.equal(boss.buildStats.characters.length, 1);
  assert.equal(boss.buildStats.combinations.length, 1);
});

test('화면 파라미터와 경량 캐시 키를 제한한다', () => {
  const parsed = parseOverviewProjection(new URLSearchParams({ view: 'builds', buildType: 'pets' }));
  assert.deepEqual(parsed, { view: 'builds', buildType: 'pets', key: '' });
  assert.match(projectionCacheKey(parsed), /^builds-pets-[a-f0-9]{16}$/);
  assert.equal(standardOverviewProjections().length, BUILD_TYPES.length + 3);
  assert.throws(() => parseOverviewProjection(new URLSearchParams({ view: 'unknown' })), /화면 구분/);
  assert.throws(() => parseOverviewProjection(new URLSearchParams({ view: 'builds', buildType: 'unknown' })), /분석 대상/);
});
