import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aggregateEvents,
  buildDayPartitions,
  capOverviewInputToDataThrough,
  createPlayFabAnalytics,
  describeAnalyticsBuild,
  hasCompleteNodeBuild,
  isVersionAtLeast,
  normalizeAnalyticsEvent,
  validateOverviewRequest
} from '../lib/playfab-analytics.js';
import { getArtifactMeta, getArtifactMetaByName, getBossMeta, getCharacterMeta, getPetMeta, getSkillMeta, getSkillMetaByName, getWeaponMeta, MASTER_DATA_COUNTS } from '../lib/game-master-data.js';
import { getCollectionMeta } from '../lib/collection-data.js';
import { getNodeMeta, NODES } from '../lib/node-data.js';
import { readStatisticsOverview } from '../public/overview-contract.js';

const base = { Timestamp: '2026-08-18T01:00:00Z', EntityLineage_master_player_account: 'P1' };
const range = { from: new Date('2026-08-18T00:00:00Z'), to: new Date('2026-08-19T00:00:00Z') };

test('계정 UID 여부와 챕터를 정규화한 이벤트에 보존한다', () => {
  const linked = normalizeAnalyticsEvent({ ...base, FullName_Name: 'battle_result', EventData: JSON.stringify({ Chapter: 3, IsClear: false }) });
  const fallback = normalizeAnalyticsEvent({ Timestamp: base.Timestamp, Entity_Id: 'entity-only', FullName_Name: 'battle_result', EventData: JSON.stringify({ Chapter: 2, IsClear: false }) });
  assert.equal(linked.accountLinked, true);
  assert.equal(linked.chapter, 3);
  assert.equal(fallback.accountLinked, false);
  assert.equal(fallback.chapter, 2);
});

test('Run의 죄악 포인트 7칸 배열을 캐릭터 종속 빌드로 보존한다', () => {
  const event = normalizeAnalyticsEvent({
    ...base,
    EventId: 'sin-points-run',
    FullName_Name: 'battle_result',
    EventData: JSON.stringify({
      LogSchemaVersion: 6, RunId: 'sin-points-run', Version: '0.774.4',
      CharacterId: 0, Character: '기사', SinPoints: [20, 0, 5, 10, 0, 0, 3], IsClear: true
    })
  });
  const build = describeAnalyticsBuild(event);

  assert.equal(event.hasSinPoints, true);
  assert.deepEqual(event.sinPoints, [20, 0, 5, 10, 0, 0, 3]);
  assert.equal(build.sinPoints.length, 7);
  assert.deepEqual(build.sinPoints.map(item => item.sinName), ['분노', '색욕', '나태', '탐욕', '폭식', '교만', '질투']);
  assert.equal(build.sinPoints[0].name, '분노 20포인트');
  assert.equal(build.sinPoints[0].characterId, 0);
});

test('죄악 포인트는 7칸·0~20 정수 계약을 어기면 집계하지 않는다', () => {
  const malformed = normalizeAnalyticsEvent({
    ...base,
    EventId: 'invalid-sin-points-run',
    FullName_Name: 'battle_result',
    EventData: JSON.stringify({ CharacterId: 0, SinPoints: [20, 0, 5], IsClear: false })
  });
  assert.equal(malformed.hasSinPoints, true);
  assert.deepEqual(malformed.sinPoints, []);
  assert.deepEqual(describeAnalyticsBuild(malformed).sinPoints, []);
});

test('노드·특성 지표는 110번대 최종 노드를 장착한 완성 트리만 만든다', () => {
  const partial = { characterId: 0, characterLevel: 30, hasNodeIds: true, nodeIds: [0, 10, 20, 30, 40, 50, 60], nodeNames: [] };
  const malformedFinalOnly = { ...partial, nodeIds: [0, 110] };
  const complete = { ...partial, nodeIds: [...partial.nodeIds, 70, 80, 90, 100, 110] };
  assert.equal(hasCompleteNodeBuild(partial), false);
  assert.equal(hasCompleteNodeBuild(malformedFinalOnly), false);
  assert.equal(hasCompleteNodeBuild(complete), true);
  assert.deepEqual(describeAnalyticsBuild(partial).nodes, []);
  assert.deepEqual(describeAnalyticsBuild(malformedFinalOnly).nodeCombinations, []);
  assert.equal(describeAnalyticsBuild(partial).nodeCombinations.length, 0);
  assert.equal(describeAnalyticsBuild(partial).combinationsWithNodes.length, 0);
  assert.equal(describeAnalyticsBuild(complete).nodes.some(node => node.id === 110), true);
  assert.equal(describeAnalyticsBuild(complete).nodeCombinations.length, 1);
});

test('구버전 Lv30Node의 숫자 문자열은 노드 이름이 아니라 ID로 복구한다', () => {
  const event = normalizeAnalyticsEvent({
    ...base,
    EventId: 'legacy-numeric-node-field',
    FullName_Name: 'battle_result',
    EventData: JSON.stringify({
      Version: '0.771.0', CharacterId: 16, Character: '흡혈귀', CharacterLevel: 30,
      Lv30Node: ['0', '20', '40', '60', '80', '100', '110'], IsClear: false
    })
  });
  const build = describeAnalyticsBuild(event);

  assert.equal(event.hasNodeIds, true);
  assert.deepEqual(event.nodeIds, [0, 20, 40, 60, 80, 100, 110]);
  assert.deepEqual(event.nodeNames, []);
  assert.deepEqual(build.nodes, []);
  assert.deepEqual(build.nodeCombinations, []);
});

test('조회 종료 시각은 마지막 완료 집계의 데이터 시각을 넘지 않는다', () => {
  const input = validateOverviewRequest(new URLSearchParams({
    from: '2026-08-27T15:00:00Z',
    to: '2026-09-03T02:23:00Z'
  }), Date.parse('2026-09-03T02:23:00Z'));
  const capped = capOverviewInputToDataThrough(input, '2026-09-02T20:59:57.883Z');

  assert.equal(capped.from.toISOString(), '2026-08-27T15:00:00.000Z');
  assert.equal(capped.to.toISOString(), '2026-09-02T20:59:57.883Z');
  assert.notEqual(capped, input);
  assert.equal(capOverviewInputToDataThrough(input, '2026-09-03T03:00:00Z'), input);
});

test('재시작 후에도 마지막 완료 시각을 읽어 수동 갱신 1시간 제한을 적용한다', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-refresh-cooldown-'));
  const currentTime = Date.parse('2026-08-21T06:30:00Z');
  try {
    await fs.writeFile(path.join(dataDir, 'statistics-publication-state.json'), JSON.stringify({
      completedAt: new Date(currentTime - 30 * 60_000).toISOString()
    }));
    const analytics = createPlayFabAnalytics({ dataDir, now: () => currentTime });
    analytics.startPublisher({ hourKst: 6 });
    await assert.rejects(
      analytics.requestPublishedRefresh({ enforceCooldown: true }),
      error => error?.statusCode === 429 && error?.retryAt === new Date(currentTime + 30 * 60_000).toISOString()
    );
    assert.equal(analytics.getPublicationState().nextAt, '2026-08-21T21:00:00.000Z');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('0.772.0 스키마 v2 Run 결과와 보스 처치를 연결해 집계한다', () => {
  const rows = [
    {
      ...base, EventId: 'battle-1', FullName_Name: 'battle_result',
      EventData: JSON.stringify({
        LogSchemaVersion: 2, RunId: 'abc123', Version: '0.772.0', Platform: 'WindowsPlayer',
        Mode: 'Normal', ModeLevel: 3, IsClear: true, IsDead: false, ResultType: 'Clear',
        PlayTime: 90.1, PlayTimeMs: 90123, CharacterId: 0, Character: '기사', SkinId: 2, Skin: '휴양지 2022', WeaponId: 'Knight00', Weapon: '철검', PetId: 3, Pet: '테스트 펫',
        Lv30Node: '강인함, 복수', Lv30NodeIds: [2, 7], Collections: [140],
        EquipSkillIds: [40, 65, -1, 40], EquipArtifactKeys: ['0:33', '1:14', '0:-1']
      })
    },
    {
      ...base, EventId: 'boss-1', FullName_Name: 'boss_kill',
      EventData: JSON.stringify({
        LogSchemaVersion: 2, RunId: 'abc123', Version: '0.772.0', Platform: 'WindowsPlayer',
        Mode: 'Normal', ModeLevel: 3, Chapter: 2, BossId: 301, BossRank: 'Elite',
        Boss: '철의 군주', FightDuration: 12.3, FightDurationMs: 12345
      })
    }
  ];
  const events = rows.map(row => normalizeAnalyticsEvent(row));
  const result = aggregateEvents(events, range);
  assert.equal(readStatisticsOverview(result), result);

  assert.equal(events[0].schemaEra, 'v2');
  assert.equal(result.summary.activePlayers, 1);
  assert.equal(result.summary.totalRuns, 1);
  assert.equal(result.summary.gameCompletions, 1);
  assert.equal(result.summary.completionRate, 100);
  assert.equal(result.summary.deathRate, 0);
  assert.deepEqual(result.summary.playTime, { sampleSize: 1, averageMs: 90123, medianMs: 90123, p90Ms: 90123 });
  assert.equal(result.summary.bossKills, 1);
  assert.equal(result.bosses[0].id, '301');
  assert.equal(result.bosses[0].killCount, 1);
  assert.equal(result.bosses[0].linkedRuns, 1);
  assert.equal(result.bosses[0].linkedClearRate, 100);
  assert.deepEqual(result.bosses[0].fightDuration, { sampleSize: 1, averageMs: 12345, medianMs: 12345, p90Ms: 12345 });
  assert.equal(result.schema.structuredRate, 100);
  assert.equal(result.schema.bossLinkRate, 100);
  assert.equal(result.builds.characters[0].name, '기사');
  assert.equal(events[0].skinId, 2);
  assert.equal(events[0].skinName, '휴양지 2022');
  assert.equal(result.builds.skins[0].name, '휴양지 2022');
  assert.equal(result.builds.skins[0].characterId, 0);
  assert.equal(events[0].weaponId, 'Knight00');
  assert.equal(result.builds.weapons[0].characterId, 0);
  assert.equal(result.builds.weapons[0].id, 0);
  assert.equal(result.builds.pets[0].id, 3);
  assert.deepEqual(result.builds.nodes.map(item => item.id), [2, 7]);
  assert.equal(result.builds.nodes[0].characterId, 0);
  assert.equal(result.builds.nodes[0].characterName, '기사');
  assert.match(result.builds.nodes[0].key, /^id:0\|node:id:/);
  assert.equal(result.builds.characters[0].selectionRate, 100);
  assert.equal(result.builds.skills.length, 2);
  assert.equal(result.builds.skills.find(item => item.id === 40).name, '공간 균열');
  assert.equal(result.builds.skills.find(item => item.id === 40).runs, 1);
  assert.equal(result.builds.artifacts.find(item => item.key === '0:33').name, '성배');
  assert.equal(result.builds.artifacts.find(item => item.key === '1:14').name, '탐욕의 문장');
  assert.equal(result.builds.combinations[0].character.id, 0);
  assert.equal(result.builds.combinations[0].skin.id, 2);
  assert.equal(result.builds.combinations[0].weapons[0].id, 0);
  assert.equal(result.builds.combinations[0].pet.id, 3);
  assert.equal(result.builds.combinations[0].skills.length, 3);
  assert.equal(result.builds.combinations[0].artifacts.length, 2);
  assert.equal(result.builds.combinations[0].nodes.length, 0);
  assert.equal(result.builds.combinations[0].collections[0].name, '엘리멘탈 마스터');
  assert.equal(result.builds.combinations[0].synergies[0].id, 140);
  assert.equal(result.builds.characters[0].collections, undefined);
  assert.deepEqual(result.builds.characters[0].components.weapons.map(item => item.id), [0]);
  assert.deepEqual(result.builds.characters[0].components.skins.map(item => item.id), [2]);
  assert.deepEqual(result.builds.characters[0].components.pets.map(item => item.id), [3]);
  assert.deepEqual(result.builds.characters[0].components.nodes.map(item => item.id), [2, 7]);
  assert.deepEqual(result.builds.characters[0].components.skills.map(item => item.id), [40, 65]);
  assert.deepEqual(result.builds.characters[0].components.artifacts.map(item => item.key), ['0:33', '1:14']);
  assert.equal(result.builds.characters[0].topCombinations[0].characterAdoptionRate, 100);
  assert.deepEqual(result.builds.characters[0].versions, [{ version: '0.772.0', runs: 1, clears: 1, clearRate: 100 }]);
  const withNodes = aggregateEvents(events, { ...range, includeNodes: true });
  assert.deepEqual(withNodes.builds.combinations[0].nodes.map(item => item.id), [2, 7]);
});

test('보스 조우를 분모로 캐릭터·무기·펫·스킬·유물 조합의 처치율을 집계한다', () => {
  const build = {
    CharacterId: 0, Character: '기사', SkinId: 1, Skin: '제국의 별', WeaponId: 0, Weapon: '철검', SubWeaponId: -1, SubWeapon: '', PetId: 3, Pet: '테스트 펫',
    EquippedSkills: [{ SkillId: 40, Name: '공간 균열' }, { SkillId: 65, Name: '죽음의 낙인' }],
    EquippedArtifacts: [{ ArtifactKey: '0:33', Name: '성배' }, { ArtifactKey: '1:14', Name: '탐욕의 문장' }]
  };
  const rows = [
    { ...base, EventId: 'encounter-1', FullName_Name: 'boss_encounter', EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'run-1', ClientEventId: 'run-1:boss_encounter:e1', EncounterId: 'e1', Version: '0.773.0', BossId: 101, Boss: 'Mr. 탐', BossRank: 'MiddleBoss', BuildSnapshot: build }) },
    { ...base, EventId: 'kill-1', FullName_Name: 'boss_kill', EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'run-1', ClientEventId: 'run-1:boss_kill:e1', EncounterId: 'e1', Version: '0.773.0', BossId: 101, Boss: 'Mr. 탐', BossRank: 'MiddleBoss', FightDurationMs: 12000, BuildSnapshot: build }) },
    { ...base, EntityLineage_master_player_account: 'P2', EventId: 'encounter-2', FullName_Name: 'boss_encounter', EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'run-2', ClientEventId: 'run-2:boss_encounter:e2', EncounterId: 'e2', Version: '0.773.0', BossId: 101, Boss: 'Mr. 탐', BossRank: 'MiddleBoss', BuildSnapshot: { CharacterId: 1, Character: '무투가', WeaponId: 0, Weapon: '손목보호대', EquippedSkills: [], EquippedArtifacts: [] } }) }
  ];
  const events = rows.map(row => normalizeAnalyticsEvent(row));
  const result = aggregateEvents(events, range);
  const boss = result.bosses[0];

  assert.deepEqual(events.map(event => event.type), ['bossEncounter', 'bossKill', 'bossEncounter']);
  assert.equal(result.summary.bossEncounters, 2);
  assert.equal(result.summary.bossKills, 1);
  assert.equal(boss.encounterCount, 2);
  assert.equal(boss.killCount, 1);
  assert.equal(boss.matchedKills, 1);
  assert.equal(boss.encounterKillCount, 1);
  assert.equal(boss.encounterClearRate, 50);
  assert.equal(boss.buildStats.characters.find(item => item.name === '기사').encounterAdoptionRate, 50);
  assert.equal(boss.buildStats.characters.find(item => item.name === '기사').clearRate, 100);
  assert.equal(boss.buildStats.characters.find(item => item.name === '무투가').clearRate, 0);
  assert.equal(boss.buildStats.skins[0].name, '제국의 별');
  assert.equal(boss.buildStats.skins[0].characterId, 0);
  const clearBuild = boss.buildStats.combinations.find(item => item.kills === 1);
  assert.equal(clearBuild.character.name, '기사');
  assert.equal(clearBuild.skin.name, '제국의 별');
  assert.equal(clearBuild.weapons[0].name, '철검');
  assert.equal(clearBuild.pet.name, '솜몽치');
  assert.deepEqual(clearBuild.skills.map(item => item.id), [40, 65]);
  assert.deepEqual(clearBuild.artifacts.map(item => item.sourceKey), ['0:33', '1:14']);
});

test('보스 처치가 조우보다 먼저 들어와도 플레이어별 조우→처치율을 동일하게 계산한다', () => {
  const bossEvent = (playerId, eventId, type, encounterId) => ({
    ...base,
    EntityLineage_master_player_account: playerId,
    EventId: eventId,
    FullName_Name: type,
    EventData: JSON.stringify({
      LogSchemaVersion: 6,
      RunId: `run-${playerId}`,
      ClientEventId: `${eventId}:client`,
      EncounterId: encounterId,
      Version: '0.773.0',
      BossId: 101,
      Boss: 'Mr. 탐',
      BossRank: 'MiddleBoss',
      BuildSnapshot: { CharacterId: 0, Character: '기사', WeaponId: 0, Weapon: '철검' }
    })
  });
  const rows = [
    bossEvent('P1', 'kill-before-encounter', 'boss_kill', 'shared-id'),
    bossEvent('P1', 'encounter-after-kill', 'boss_encounter', 'shared-id'),
    bossEvent('P2', 'kill-other-player', 'boss_kill', 'shared-id')
  ];
  const result = aggregateEvents(rows.map(row => normalizeAnalyticsEvent(row)), range);
  const boss = result.bosses[0];

  assert.equal(boss.encounterCount, 1);
  assert.equal(boss.killCount, 2);
  assert.equal(boss.encounterKillCount, 1);
  assert.equal(boss.encounterClearRate, 100);
  assert.equal(boss.buildStats.characters[0].matchedKills, 1);
  assert.equal(boss.buildStats.characters[0].clearRate, 100);
});

test('신규 유물 타입 1·2를 일반 0·저주 1 마스터 키로 정규화한다', () => {
  const event = normalizeAnalyticsEvent({
    ...base, EventId: 'one-based-artifacts', FullName_Name: 'battle_result',
    EventData: JSON.stringify({
      LogSchemaVersion: 6, RunId: 'one-based-artifacts', Version: '0.772.1', CharacterId: 0, IsClear: true,
      EquippedArtifacts: [
        { ArtifactKey: '1:33', Name: '성배' },
        { ArtifactKey: '2:14', Name: '탐욕의 문장' },
        { ArtifactKey: '1:115', Name: '로그 제공 이름' },
        { ArtifactKey: '1:-1', Name: '' }
      ]
    })
  });
  const result = aggregateEvents([event], range);

  assert.deepEqual(event.equipArtifactKeys, ['1:33', '2:14', '1:115']);
  assert.deepEqual(result.builds.artifacts.map(item => [item.sourceKey, item.name]).sort((left, right) => left[0].localeCompare(right[0])), [
    ['0:115', '로그 제공 이름'],
    ['0:33', '성배'],
    ['1:14', '탐욕의 문장']
  ]);
  assert.equal(result.builds.artifacts.every(item => !item.name.startsWith('이름 미정 유물')), true);
});

test('낭인만 주무기와 보조무기를 하나의 무기 구성으로 집계한다', () => {
  const rows = [
    {
      ...base, EventId: 'knight-sub-placeholder', FullName_Name: 'battle_result',
      EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'knight-run', Version: '0.773.0', CharacterId: 0, Character: '기사', WeaponId: 0, Weapon: '철검', SubWeaponId: 900, SubWeapon: '', IsClear: true })
    },
    {
      ...base, EventId: 'ronin-loadout', FullName_Name: 'battle_result',
      EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'ronin-run', Version: '0.773.0', CharacterId: 7, Character: '낭인', WeaponId: 0, Weapon: '혈검', SubWeaponId: 900, SubWeapon: '마검', IsClear: false })
    },
    {
      ...base, EventId: 'ronin-encounter', FullName_Name: 'boss_encounter',
      EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'ronin-run', ClientEventId: 'ronin-run:boss_encounter:e1', EncounterId: 'e1', Version: '0.773.0', BossId: 101, Boss: 'Mr. 탐', BossRank: 'MiddleBoss', BuildSnapshot: { CharacterId: 7, Character: '낭인', WeaponId: 0, Weapon: '혈검', SubWeaponId: 900, SubWeapon: '마검' } })
    }
  ];
  const result = aggregateEvents(rows.map(row => normalizeAnalyticsEvent(row)), range);
  const knight = result.builds.weapons.find(item => item.characterId === 0);
  const ronin = result.builds.weapons.find(item => item.characterId === 7);

  assert.equal(result.builds.sourceRuns.weapons, 2);
  assert.equal(knight.name, '철검');
  assert.deepEqual(knight.parts.map(item => item.id), [0]);
  assert.equal(ronin.name, '혈검 / 마검');
  assert.deepEqual(ronin.parts.map(item => item.id), [0, 1]);
  assert.deepEqual(result.builds.characters.find(item => item.id === 7).components.weapons[0].parts.map(item => item.id), [0, 1]);
  assert.deepEqual(result.builds.combinations.find(item => item.character.id === 7).weapons.map(item => item.id), [0, 1]);
  assert.equal(result.builds.weapons.some(item => item.characterId === 0 && item.id === 900), false);
  assert.equal(result.bosses[0].buildStats.weapons[0].name, '혈검 / 마검');
  assert.deepEqual(result.bosses[0].buildStats.weapons[0].parts.map(item => item.id), [0, 1]);
});

test('낭인 보조무기 이름이 비어 있으면 도검으로 보정한다', () => {
  const event = normalizeAnalyticsEvent({
    ...base, EventId: 'ronin-blank-sub', FullName_Name: 'battle_result',
    EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'ronin-blank-run', Version: '0.773.0', CharacterId: 7, Character: '낭인', WeaponId: 2, Weapon: '공명도', SubWeaponId: 900, SubWeapon: '', IsClear: true })
  });
  const result = aggregateEvents([event], range);
  assert.equal(result.builds.weapons[0].name, '공명도 / 도검');
  assert.deepEqual(result.builds.weapons[0].parts.map(item => item.id), [2, 900]);
});

test('같은 무기를 고유룬 미장착과 고유룬 ID별 독립 항목으로 집계한다', () => {
  const normalRune = {
    WeaponId: 0, WeaponSlot: 'MainWeapon', RuneSlot: 'Normal',
    Rune: {
      type: 'normal', rank: 4, color: 1, uniqueOptionID: 0,
      main: { optionID: 101, step: 4 }, sub1: { optionID: 201, step: 2 }, sub2: { optionID: 0, step: 0 }
    }
  };
  const uniqueRune = {
    WeaponId: 0, WeaponSlot: 'MainWeapon', RuneSlot: 'Unique',
    Rune: {
      type: 'unique', rank: 1, color: 0, uniqueOptionID: 900003,
      unique: { optionID: 900003, uniqueKey: 'Knight_00_03', characterID: 0, weaponID: 0, uniqueIndex: 3, effectKey: 'Unique_Knight_00_03' }
    }
  };
  const secondUniqueRune = {
    WeaponId: 0, WeaponSlot: 'MainWeapon', RuneSlot: 'Unique',
    Rune: {
      type: 'unique', rank: 1, color: 0, uniqueOptionID: 900004,
      unique: { optionID: 900004, uniqueKey: 'Knight_00_04', characterID: 0, weaponID: 0, uniqueIndex: 4, effectKey: 'Unique_Knight_00_04' }
    }
  };
  const row = (playerId, eventId, isClear, equippedRunes) => ({
    ...base,
    EntityLineage_master_player_account: playerId,
    EventId: eventId,
    FullName_Name: 'run_end',
    EventData: JSON.stringify({
      LogSchemaVersion: 7, RunId: eventId, Version: '0.773.0', CharacterId: 0, Character: '기사',
      WeaponId: 0, Weapon: '철검', EquippedRunes: equippedRunes, IsClear: isClear
    })
  });
  const events = [
    normalizeAnalyticsEvent(row('P1', 'rune-clear', true, [normalRune, uniqueRune])),
    normalizeAnalyticsEvent(row('P2', 'rune-fail', false, [normalRune])),
    normalizeAnalyticsEvent(row('P3', 'second-rune-clear', true, [normalRune, secondUniqueRune]))
  ];
  const result = aggregateEvents(events, range);
  const equippedWeapon = result.builds.weapons.find(item => item.uniqueRunes?.some(rune => rune.id === 900003));
  const secondRuneWeapon = result.builds.weapons.find(item => item.uniqueRunes?.some(rune => rune.id === 900004));
  const emptyWeapon = result.builds.weapons.find(item => item.uniqueRuneState === 'none');
  const normal = equippedWeapon.runes.find(item => item.type === 'normal');
  const unique = equippedWeapon.runes.find(item => item.type === 'unique');

  assert.equal(events[0].hasEquippedRunes, true);
  assert.equal(events[0].equippedRunes.length, 2);
  assert.equal(result.builds.sourceRuns.weapons, 3);
  assert.equal(result.builds.weapons.length, 3);
  assert.equal(equippedWeapon.runs, 1);
  assert.equal(equippedWeapon.clears, 1);
  assert.equal(equippedWeapon.selectionRate, 33.3);
  assert.equal(equippedWeapon.clearRate, 100);
  assert.equal(equippedWeapon.runeLoggedRuns, 1);
  assert.deepEqual(equippedWeapon.uniqueRunes.map(item => item.id), [900003]);
  assert.match(equippedWeapon.key, /unique:900003/);
  assert.equal(secondRuneWeapon.runs, 1);
  assert.equal(secondRuneWeapon.clearRate, 100);
  assert.equal(secondRuneWeapon.selectionRate, 33.3);
  assert.deepEqual(secondRuneWeapon.uniqueRunes.map(item => item.id), [900004]);
  assert.match(secondRuneWeapon.key, /unique:900004/);
  assert.equal(emptyWeapon.runs, 1);
  assert.equal(emptyWeapon.clears, 0);
  assert.equal(emptyWeapon.selectionRate, 33.3);
  assert.equal(emptyWeapon.clearRate, 0);
  assert.equal(emptyWeapon.runeLoggedRuns, 1);
  assert.deepEqual(emptyWeapon.uniqueRunes, []);
  assert.match(emptyWeapon.key, /unique-runes:none$/);
  assert.equal(normal.name, '빨간 룬 4등급 · 무기스킬 데미지증가');
  assert.deepEqual(normal.options.map(item => item.name), ['무기스킬 데미지증가', '무기스킬 쿨타임감소']);
  assert.equal(normal.runs, 1);
  assert.equal(normal.adoptionRate, 100);
  assert.equal(normal.clearRate, 100);
  assert.equal(unique.name, '철검 고유룬');
  assert.equal(unique.effectDescription, '기본 공격 적중 시 50%의 확률로 무기스킬 공격 추가발동');
  assert.equal(unique.adoptionRate, 100);
  assert.deepEqual(equippedWeapon.runeConfigurations.map(item => item.runes.length), [2]);
  const characterWeapons = result.builds.characters[0].components.weapons;
  assert.equal(characterWeapons.length, 3);
  assert.deepEqual(characterWeapons.map(item => item.uniqueRuneState).sort(), ['equipped', 'equipped', 'none']);
  assert.deepEqual(characterWeapons.find(item => item.uniqueRuneState === 'equipped').uniqueRunes.map(item => item.id), [900003]);
});

test('현재 장착 무기의 슬롯과 ID가 다른 고유룬은 무기 조합에서 제외한다', () => {
  const event = normalizeAnalyticsEvent({
    ...base,
    EntityLineage_master_player_account: 'mismatched-rune-player',
    EventId: 'mismatched-rune-run',
    FullName_Name: 'run_end',
    EventData: JSON.stringify({
      LogSchemaVersion: 7, RunId: 'mismatched-rune-run', Version: '0.773.0',
      CharacterId: 0, Character: '기사', WeaponId: 3, Weapon: '오베론', IsClear: true,
      EquippedRunes: [{
        WeaponId: 0, WeaponSlot: 'MainWeapon', RuneSlot: 'Unique',
        Rune: {
          type: 'unique', rank: 1, color: 0, uniqueOptionID: 900003,
          unique: { optionID: 900003, uniqueKey: 'Knight_00_03', characterID: 0, weaponID: 0, uniqueIndex: 3, effectKey: 'Unique_Knight_00_03' }
        }
      }]
    })
  });

  const result = aggregateEvents([event], range);
  assert.equal(result.builds.weapons.length, 1);
  assert.equal(result.builds.weapons[0].name, '오베론');
  assert.equal(result.builds.weapons[0].uniqueRuneState, 'none');
  assert.deepEqual(result.builds.weapons[0].uniqueRunes, []);
  assert.deepEqual(result.builds.weapons[0].runes, []);
  assert.doesNotMatch(result.builds.weapons[0].key, /unique:900003/);
});

test('신규 run_end와 기존 battle_result를 같은 Run 결과로 분류한다', () => {
  const legacy = normalizeAnalyticsEvent({
    ...base,
    EventId: 'legacy-result',
    FullName_Name: 'battle_result',
    EventData: JSON.stringify({ LogSchemaVersion: 4, RunId: 'legacy-run', Version: '0.771.3', IsClear: true })
  });
  const current = normalizeAnalyticsEvent({
    ...base,
    EventId: 'current-result',
    FullName_Name: 'run_end',
    EventData: JSON.stringify({ LogSchemaVersion: 5, RunId: 'current-run', Version: '0.772.0', IsClear: false, IsDead: true, StageSnapshot: { ReachedFirstMiddleBoss: true } })
  });

  assert.equal(legacy.type, 'battleResult');
  assert.equal(current.type, 'battleResult');
  assert.equal(current.reachedFirstMiddleBoss, true);
  const result = aggregateEvents([legacy, current], range);
  assert.equal(result.summary.totalRuns, 2);
  assert.equal(result.summary.gameCompletions, 1);
  assert.equal(aggregateEvents([current], { ...range, afterFirstMiddleBoss: true }).summary.totalRuns, 1);
});

test('재시도된 신규 이벤트는 ClientEventId 기준으로 한 번만 집계한다', () => {
  const payload = JSON.stringify({
    LogSchemaVersion: 5,
    RunId: 'retry-run',
    ClientEventId: 'retry-run:run_end',
    Version: '0.772.0',
    IsClear: true
  });
  const first = normalizeAnalyticsEvent({ ...base, EventId: 'server-event-1', FullName_Name: 'run_end', EventData: payload });
  const retry = normalizeAnalyticsEvent({ ...base, EventId: 'server-event-2', FullName_Name: 'run_end', EventData: payload });
  const result = aggregateEvents([first, retry], range);

  assert.equal(first.id, 'retry-run:run_end');
  assert.equal(result.summary.totalRuns, 1);
});

test('제공된 스킬·유물·보스 마스터를 ID와 이름으로 조회한다', () => {
  assert.equal(getSkillMeta(0).name, '연속타격');
  assert.equal(getSkillMeta(105).name, '킬러비');
  assert.equal(getArtifactMeta('0:0').name, '문자가 새겨진 돌');
  assert.equal(getArtifactMeta('0:381').name, '어전의 열쇠');
  assert.equal(getArtifactMeta('1:20').name, '유리검');
  assert.equal(getArtifactMeta('0:115').name, '');
  assert.equal(getArtifactMeta('1:21').name, '');
  assert.equal(getSkillMetaByName('공간 균열').id, 40);
  assert.equal(getArtifactMetaByName('성배').key, '0:33');
  assert.equal(getCharacterMeta(null, '비요른 얀델').id, 17);
  assert.equal(getWeaponMeta(0, null, '철검').id, 0);
  assert.equal(getWeaponMeta(7, null, '도검').id, 900);
  assert.equal(getWeaponMeta(14, null, 'Dragon Fang').id, 0);
  assert.equal(getWeaponMeta(11, null, '괴물 사냥꾼').id, 1);
  assert.equal(getWeaponMeta(13, null, '피카부').id, 1);
  assert.equal(getWeaponMeta(16, null, '피의 권능').id, 0);
  assert.equal(getWeaponMeta(17, null, '오크히어로의 정수').id, 2);
  assert.equal(getWeaponMeta(21, 'Berserker00', '썬더콜러').id, 0);
  assert.equal(getPetMeta(0).name, '플라스크');
  assert.equal(getPetMeta(37).name, '쨱쨱이');
  assert.equal(getBossMeta(null, '탐욕', null).code, 'B001');
  assert.equal(getBossMeta(null, '사악한 군집체', null).code, 'E003');
  assert.equal(getBossMeta(301, '', 'Boss').name, '유성의 창 템펠');
  assert.equal(getBossMeta('E10002', '', '').imageCode, 'E10002');
  assert.equal(getCollectionMeta(140).name, '엘리멘탈 마스터');
  assert.deepEqual(MASTER_DATA_COUNTS, { skills: 106, skillVariants: 24, artifacts: 382, cursedArtifacts: 22, unnamedArtifacts: 2, characters: 22, pets: 38, nodes: 482 });
});

test('같은 노드 ID라도 캐릭터별로 분리해 집계한다', () => {
  const events = [
    { ...base, EventId: 'knight-node', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 2, RunId: 'knight-run', Version: '0.772.0', CharacterId: 0, Character: '기사', Lv30NodeIds: [2], Lv30Node: '강인함', IsClear: true }) },
    { ...base, EventId: 'fighter-node', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 2, RunId: 'fighter-run', Version: '0.772.0', CharacterId: 1, Character: '무투가', Lv30NodeIds: [2], Lv30Node: '강인함', IsClear: false }) }
  ].map(row => normalizeAnalyticsEvent(row));
  const result = aggregateEvents(events, range);

  assert.equal(result.builds.nodes.length, 2);
  assert.deepEqual(result.builds.nodes.map(item => item.characterId).sort(), [0, 1]);
  assert.equal(new Set(result.builds.nodes.map(item => item.key)).size, 2);
  assert.ok(result.builds.nodes.every(item => item.runs === 1));
});

test('노드 ID를 캐릭터별 한국어 마스터 이름으로 변환한다', () => {
  const rows = [
    {
      ...base, EventId: 'knight-nodes', FullName_Name: 'battle_result',
      EventData: JSON.stringify({
        LogSchemaVersion: 6, RunId: 'knight-nodes', Version: '0.772.1', CharacterId: 0, Character: '기사', IsClear: true,
        Lv30NodeIds: [0, 10, 32, 110], Lv30Node: ['0', '10', '32', '110']
      })
    },
    {
      ...base, EntityLineage_master_player_account: 'P2', EventId: 'fighter-nodes', FullName_Name: 'battle_result',
      EventData: JSON.stringify({
        LogSchemaVersion: 6, RunId: 'fighter-nodes', Version: '0.772.1', CharacterId: 1, Character: '무투가', IsClear: true,
        Lv30NodeIds: [0, 10, 32, 110], Lv30Node: ['0', '10', '32', '110']
      })
    }
  ];
  const result = aggregateEvents(rows.map(row => normalizeAnalyticsEvent(row)), range);
  const names = new Map(result.builds.nodes.map(item => [`${item.characterId}:${item.id}`, item.name]));

  assert.equal(getNodeMeta(0, 10)?.name, '완벽한 공격');
  assert.equal(getNodeMeta(1, 10)?.name, '내공 향상');
  assert.equal(getNodeMeta(21, 999)?.name, '강신');
  assert.equal(getNodeMeta(0, 0)?.name, '완벽', '마스터 데이터의 000 노드 이름은 유지한다');
  assert.equal(getNodeMeta(0, 1), null, '이름이 비어 있는 코드는 마스터에 등록하지 않는다');
  assert.ok(NODES.length > 400);
  assert.equal(names.get('0:0'), '완벽', '기존 로그의 첫 슬롯 0은 실제 000 노드로 집계한다');
  assert.equal(names.get('0:32'), '주문의 축복');
  assert.equal(names.get('1:0'), '기 축적');
  assert.equal(names.get('1:32'), '침착함');
});

test('30레벨 미만은 노드 미장착으로 처리하고 신규 -1 빈 슬롯을 제외한다', () => {
  const rows = [
    {
      ...base, EventId: 'level-29-nodes', FullName_Name: 'battle_result',
      EventData: JSON.stringify({
        LogSchemaVersion: 6, RunId: 'level-29-nodes', Version: '0.772.1', CharacterId: 0, CharacterLevel: 29,
        Lv30NodeIds: [0, 10, 20], IsClear: false
      })
    },
    {
      ...base, EntityLineage_master_player_account: 'P2', EventId: 'level-30-nodes', FullName_Name: 'battle_result',
      EventData: JSON.stringify({
        LogSchemaVersion: 7, RunId: 'level-30-nodes', Version: '0.772.1', CharacterId: 0, CharacterLevel: 30,
        Lv30NodeIds: [0, -1, 20, -1], IsClear: true
      })
    }
  ];
  const result = aggregateEvents(rows.map(row => normalizeAnalyticsEvent(row)), range);

  assert.deepEqual(result.builds.nodes.map(item => item.id), [0, 20]);
  assert.ok(result.builds.nodes.every(item => item.runs === 1));
  assert.deepEqual(result.builds.nodeCombinations[0].nodes.map(item => item.id), [0, 20]);
});

test('같은 캐릭터의 노드 세트를 순서와 무관하게 조합으로 집계한다', () => {
  const row = (playerId, eventId, characterId, nodeIds, isClear) => ({
    ...base,
    EntityLineage_master_player_account: playerId,
    EventId: eventId,
    FullName_Name: 'battle_result',
    EventData: JSON.stringify({
      LogSchemaVersion: 6,
      RunId: eventId,
      Version: '0.772.1',
      CharacterId: characterId,
      Lv30NodeIds: nodeIds,
      IsClear: isClear
    })
  });
  const result = aggregateEvents([
    row('P1', 'knight-set-a-1', 0, [0, 10, 20, 0, 0], true),
    row('P2', 'knight-set-a-2', 0, [0, 20, 10, 0, 0], false),
    row('P3', 'knight-set-b', 0, [0, 10, 0, 0, 0], true),
    row('P4', 'fighter-set-a', 1, [0, 10, 20, 0, 0], true)
  ].map(value => normalizeAnalyticsEvent(value)), range);

  assert.equal(result.builds.sourceRuns.nodeCombinations, 4);
  assert.equal(result.builds.nodeCombinations.length, 3);
  const knightPopular = result.builds.nodeCombinations.find(item => item.character.id === 0 && item.nodes.some(node => node.id === 10));
  const fighter = result.builds.nodeCombinations.find(item => item.character.id === 1);
  assert.deepEqual(knightPopular.nodes.map(node => node.id), [0, 10, 20]);
  assert.equal(knightPopular.runs, 2);
  assert.equal(knightPopular.clearRate, 50);
  assert.equal(knightPopular.selectionRate, 66.7);
  assert.equal(knightPopular.characterSelectionRate, 66.7);
  assert.equal(knightPopular.globalSelectionRate, 50);
  assert.equal(fighter.selectionRate, 100);
  assert.deepEqual(fighter.nodes.map(node => node.name), ['기 축적', '내공 향상', '날카로운 기운']);
  const knightDetail = result.builds.characters.find(item => item.id === 0);
  assert.deepEqual(knightDetail.topNodeCombinations.map(item => item.runs), [2, 1]);
  assert.equal(knightDetail.topNodeCombinations[0].selectionRate, 66.7);
  assert.deepEqual(knightDetail.topNodeCombinations[0].nodes.map(node => node.name), ['완벽', '완벽한 공격', '축복']);
  assert.equal(result.builds.nodes.find(item => item.characterId === 0 && item.id === 0).runs, 3, '첫 슬롯 0만 실제 000 노드로 집계한다');
});

test('펫 ID는 클라이언트 언어와 무관하게 한국어 마스터 이름으로 집계한다', () => {
  const rows = [
    { ...base, EventId: 'pet-en', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'pet-en', Version: '0.773.0', CharacterId: 0, PetId: 1, Pet: 'Smiling Cactus', IsClear: true }) },
    { ...base, EntityLineage_master_player_account: 'P2', EventId: 'pet-jp', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'pet-jp', Version: '0.773.0', CharacterId: 0, PetId: 1, Pet: '笑うサボテン', IsClear: false }) },
    { ...base, EntityLineage_master_player_account: 'P3', EventId: 'pet-37', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'pet-37', Version: '0.773.0', CharacterId: 0, PetId: 37, Pet: 'Chirpy', IsClear: true }) },
    { ...base, EntityLineage_master_player_account: 'P4', EventId: 'pet-empty', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 6, RunId: 'pet-empty', Version: '0.773.0', CharacterId: 0, PetId: -1, Pet: '', IsClear: true }) }
  ];
  const events = rows.map(row => normalizeAnalyticsEvent(row));
  const normalizedEmptyPetId = events[3].petId;
  // 이전 일별 팩트에는 sentinel이 문자열로 저장되어 있으므로 재집계 경로도 검증한다.
  events[3].petId = '-1';
  const result = aggregateEvents(events, range);

  assert.equal(normalizedEmptyPetId, null);
  assert.deepEqual(result.builds.pets.map(item => [item.id, item.name, item.runs]), [
    [1, '웃는 선인장', 2],
    [37, '쨱쨱이', 1]
  ]);
});

test('0.772.0 이전 로그는 legacy로 분리하고 Run을 추정 연결하지 않는다', () => {
  const rows = [
    { ...base, EventId: 'legacy-battle', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.3', IsClear: false, IsDead: true, PlayTime: 61.5, Character: '기사', Weapon: '철검', EquipSkill: ['공간 균열', '화염구', '빈칸'], EquipArtifact: ['성배', '검은 재'] }) },
    { ...base, EventId: 'legacy-boss', FullName_Name: 'boss_kill', EventData: JSON.stringify({ Version: '0.771.3', Boss: '탐욕', FightDuration: 7.2 }) }
  ];
  const events = rows.map(row => normalizeAnalyticsEvent(row));
  const result = aggregateEvents(events, range);

  assert.ok(events.every(event => event.schemaEra === 'legacy'));
  assert.ok(events.every(event => event.runId === ''));
  assert.equal(result.outcomes.find(item => item.key === 'Dead').count, 1);
  assert.equal(result.summary.playTime.averageMs, 61500);
  assert.equal(result.bosses[0].legacy, true);
  assert.equal(result.bosses[0].code, 'B001');
  assert.equal(result.bosses[0].imageCode, 'B001');
  assert.equal(result.bosses[0].rank, 'Boss');
  assert.equal(result.bosses[0].linkedRuns, 0);
  assert.equal(result.bosses[0].linkedClearRate, 0);
  assert.equal(result.bosses[0].fightDuration.sampleSize, 0);
  assert.equal(result.bosses[0].legacyFightDuration.medianMs, 7200);
  assert.equal(result.bosses[0].durationQuality, 'legacy_unreliable');
  assert.equal(result.schema.legacyEvents, 2);
  assert.equal(result.schema.missingRunId, 2);
  assert.equal(result.builds.characters[0].name, '기사');
  assert.equal(result.builds.skills.find(item => item.id === 40).name, '공간 균열');
  assert.equal(result.builds.skills.find(item => item.id === 40).source, 'name');
  assert.equal(result.builds.artifacts.find(item => item.key === '0:33').name, '성배');
  assert.equal(result.builds.weapons[0].name, '철검');
});

test('신규 버전인데 스키마 또는 RunId가 빠지면 v2_incomplete로 표시한다', () => {
  const noSchema = normalizeAnalyticsEvent({ ...base, EventId: 'i1', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.0', RunId: 'r1', IsClear: false, IsDead: false }) });
  const noRun = normalizeAnalyticsEvent({ ...base, EventId: 'i2', FullName_Name: 'boss_kill', EventData: JSON.stringify({ Version: '0.773.0', LogSchemaVersion: 2, BossId: 10 }) });
  assert.equal(noSchema.schemaEra, 'v2_incomplete');
  assert.equal(noRun.schemaEra, 'v2_incomplete');
});

test('결과 우선순위, 밀리초 우선, -1 sentinel 제외 규칙을 적용한다', () => {
  const clear = normalizeAnalyticsEvent({ ...base, EventId: 'r1', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 2, RunId: 'r1', Version: '0.772.0', IsClear: true, IsDead: true, ResultType: 'Dead', PlayTime: 50, PlayTimeMs: 45000 }) });
  const dead = normalizeAnalyticsEvent({ ...base, EventId: 'r2', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 2, RunId: 'r2', Version: '0.772.0', IsClear: false, IsDead: true }) });
  const fail = normalizeAnalyticsEvent({ ...base, EventId: 'r3', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 2, RunId: 'r3', Version: '0.772.0', IsClear: false, IsDead: false }) });
  const boss = normalizeAnalyticsEvent({ ...base, EventId: 'b1', FullName_Name: 'boss_kill', EventData: JSON.stringify({ LogSchemaVersion: 2, RunId: 'r3', Version: '0.772.0', BossId: 7, FightDuration: -1, FightDurationMs: -1 }) });
  const result = aggregateEvents([clear, dead, fail, boss], range);

  assert.equal(clear.resultType, 'Clear');
  assert.equal(dead.resultType, 'Dead');
  assert.equal(fail.resultType, 'Fail');
  assert.equal(result.summary.playTime.averageMs, 45000);
  assert.equal(result.bosses[0].fightDuration.sampleSize, 0);
});

test('같은 PlayFab EventId는 한 번만 집계한다', () => {
  const row = { ...base, EventId: 'same', FullName_Name: 'battle_result', EventData: JSON.stringify({ LogSchemaVersion: 2, RunId: 'r1', Version: '0.772.0', ResultType: 'Clear' }) };
  const event = normalizeAnalyticsEvent(row);
  const result = aggregateEvents([event, event], range);
  assert.equal(result.summary.totalRuns, 1);
});

test('게임 모드와 최소 단계 조건을 함께 적용한다', () => {
  const low = normalizeAnalyticsEvent({ ...base, EventId: 'low', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Mode: 'Challenge', ModeLevel: 4, IsClear: true }) });
  const high = normalizeAnalyticsEvent({ ...base, EventId: 'high', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Mode: 'Challenge', ModeLevel: 5, IsClear: true }) });
  const normal = normalizeAnalyticsEvent({ ...base, EventId: 'normal', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Mode: 'Normal', ModeLevel: 9, IsClear: true }) });
  const result = aggregateEvents([low, high, normal], { ...range, mode: 'Challenge', minModeLevel: 5 });
  assert.equal(result.summary.totalRuns, 1);
});

test('1챕터 중간보스 이전 종료 Run을 선택적으로 제외한다', () => {
  const rows = [
    { ...base, EventId: 'early-1', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Stage: '지하 감옥1-1', IsClear: false }) },
    { ...base, EventId: 'early-2', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Stage: '1-2', IsClear: false }) },
    { ...base, EventId: 'middle', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Stage: '지하 감옥1-Middle Boss', IsClear: false, IsDead: true }) },
    { ...base, EventId: 'later', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Stage: '독성 늪지1-1', IsClear: true }) },
    { ...base, EventId: 'boss', FullName_Name: 'boss_kill', EventData: JSON.stringify({ Version: '0.771.0', Boss: '징벌자', BossRank: 'MiddleBoss' }) }
  ];
  const events = rows.map(row => normalizeAnalyticsEvent(row));
  const all = aggregateEvents(events, range);
  const filtered = aggregateEvents(events, { ...range, afterFirstMiddleBoss: true });

  assert.equal(all.summary.totalRuns, 4);
  assert.equal(filtered.summary.totalRuns, 2);
  assert.equal(filtered.summary.gameCompletions, 1);
  assert.equal(filtered.summary.bossKills, 1);
});

test('0.772.0 버전 경계를 비교한다', () => {
  assert.equal(isVersionAtLeast('0.771.99', '0.772.0'), false);
  assert.equal(isVersionAtLeast('0.772.0', '0.772.0'), true);
  assert.equal(isVersionAtLeast('0.773.0', '0.772.0'), true);
  assert.equal(isVersionAtLeast('', '0.772.0'), false);
});

test('세 숫자 구간 뒤에 값이 붙은 테스트 버전은 통계에서 제외한다', () => {
  const rows = [
    { ...base, EventId: 'live-version', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.0', IsClear: true }) },
    { ...base, EventId: 'test-fourth', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.0.1', IsClear: true }) },
    { ...base, EventId: 'test-suffix', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.0-test', IsClear: true }) },
    { ...base, EventId: 'legacy-no-version', FullName_Name: 'battle_result', EventData: JSON.stringify({ IsClear: false }) }
  ];
  const result = aggregateEvents(rows.map(row => normalizeAnalyticsEvent(row)), range);
  assert.equal(result.summary.totalRuns, 2);
  assert.deepEqual(new Set(result.versions.map(item => item.version)), new Set(['0.772.0', '버전 미기록']));
  assert.throws(() => validateOverviewRequest(new URLSearchParams({ from: '2026-08-18T00:00:00Z', to: '2026-08-19T00:00:00Z', version: '0.772.0-test' }), Date.parse('2026-08-19T01:00:00Z')), /테스트 빌드 버전/);
});

test('x 버전 필터로 같은 메이저·마이너 버전의 운영 패치를 함께 집계한다', () => {
  const rows = [
    { ...base, EventId: 'patch-0', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.0', IsClear: true }) },
    { ...base, EventId: 'patch-1', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.1', IsClear: false }) },
    { ...base, EventId: 'patch-2', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.2', IsClear: true }) },
    { ...base, EventId: 'other-minor', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.773.0', IsClear: true }) },
    { ...base, EventId: 'test-build', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.2.1', IsClear: true }) }
  ];
  const result = aggregateEvents(rows.map(row => normalizeAnalyticsEvent(row)), { ...range, version: '0.772.x' });
  const input = validateOverviewRequest(new URLSearchParams({ from: '2026-08-18T00:00:00Z', to: '2026-08-19T00:00:00Z', version: '0.772.X' }), Date.parse('2026-08-19T01:00:00Z'));

  assert.equal(input.version, '0.772.x');
  assert.equal(result.summary.totalRuns, 3);
  assert.equal(result.summary.gameCompletions, 2);
  assert.deepEqual(result.versions.map(item => item.version), ['0.772.2', '0.772.1', '0.772.0']);
});

test('조회 기간과 버전 필터를 검증하고 항상 라이브 서버를 사용한다', () => {
  const params = new URLSearchParams({ from: '2026-08-01T00:00:00Z', to: '2026-08-18T00:00:00Z', environment: 'test', version: '0.772.0', minModeLevel: '5', includeNodes: 'true', afterFirstMiddleBoss: 'true' });
  const input = validateOverviewRequest(params, Date.parse('2026-08-18T01:00:00Z'));
  assert.equal(input.environment, 'live');
  assert.equal(input.version, '0.772.0');
  assert.equal(input.minModeLevel, 5);
  assert.equal(input.includeNodes, true);
  assert.equal(input.afterFirstMiddleBoss, true);
  assert.throws(() => validateOverviewRequest(new URLSearchParams({ from: '2026-08-01T00:00:00Z', to: '2026-08-18T00:00:00Z', minModeLevel: '-1' }), Date.parse('2026-08-18T01:00:00Z')), /최소 단계/);
  assert.throws(() => validateOverviewRequest(new URLSearchParams({ from: '2026-01-01T00:00:00Z', to: '2026-08-18T00:00:00Z' }), Date.parse('2026-08-18T01:00:00Z')), /최대 90일/);
});

test('UTC 날짜 단위 Azure 파티션을 만든다', () => {
  const partitions = buildDayPartitions(new Date('2026-08-17T23:00:00Z'), new Date('2026-08-19T01:00:00Z'), 'data', 'ABC');
  assert.deepEqual(partitions, ['data/title=ABC/date=20260817/', 'data/title=ABC/date=20260818/', 'data/title=ABC/date=20260819/']);
});

test('Azure Parquet를 한 번만 읽고 날짜별 증분 이벤트 캐시를 재사용한다', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-cache-'));
  let parquetReads = 0;
  const blobName = 'data/title=LIVE/date=20260818/hour=01/part-1.parquet';
  const listXml = `<?xml version="1.0"?><EnumerationResults><Blobs><Blob><Name>${blobName}</Name><Properties><Content-Length>1234</Content-Length></Properties></Blob></Blobs><NextMarker /></EnumerationResults>`;
  const analytics = createPlayFabAnalytics({
    dataDir,
    storageAccount: 'storage123',
    container: 'logs',
    sasToken: 'sp=rl&sig=test',
    liveTitleId: 'LIVE',
    concurrency: 2,
    cacheMinutes: 10,
    now: () => Date.parse('2026-08-18T02:00:00Z'),
    fetchImpl: async () => new Response(listXml, { status: 200, headers: { 'Content-Type': 'application/xml' } }),
    parquetReader: async () => {
      parquetReads += 1;
      return [
        { ...base, EventId: 'cached-run', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', Mode: 'Normal', ModeLevel: 3, Character: '기사', Weapon: '철검', IsClear: true, PlayTime: 10 }) },
        { ...base, EventId: 'cached-run-2', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.772.1', Mode: 'Challenge', ModeLevel: 5, Character: '무투가', Weapon: '손목보호대', IsClear: false, IsDead: true, PlayTime: 20 }) }
      ];
    }
  });
  const params = new URLSearchParams({ from: '2026-08-18T00:00:00Z', to: '2026-08-18T02:00:00Z' });

  try {
    await assert.rejects(() => analytics.overview(params), error => error.statusCode === 425);
    assert.equal(parquetReads, 0, '완료본이 없어도 화면 조회가 원본 집계를 시작하면 안 된다');
    await analytics.syncNow(params);
    const first = await analytics.overview(params);
    assert.equal(first.summary.totalRuns, 2);
    assert.equal(first.sync.status, 'ready');
    assert.equal(first.stats.snapshot, true);
    assert.equal(first.stats.indexedStore, true);
    assert.equal(parquetReads, 1);

    const normalParams = new URLSearchParams({
      from: '2026-08-18T00:00:00Z', to: '2026-08-18T02:00:00Z', mode: 'Normal'
    });
    const normal = await analytics.overview(normalParams);
    assert.equal(normal.stats.filterFallback, false);
    assert.equal(normal.stats.snapshotPending, false);
    assert.equal(normal.stats.indexedStore, true);
    assert.equal(normal.summary.totalRuns, 1);
    assert.equal(parquetReads, 1, '필터 집계는 이미 저장된 일별 팩트만 사용해야 한다');
    assert.equal(normal.dimensions.modes[0].key, 'Normal');
    assert.equal(normal.stats.snapshot, true);
    assert.equal(normal.builds.weapons[0].characterId, 0);
    assert.equal(normal.builds.weapons[0].id, 0);
    assert.equal(parquetReads, 1);

    assert.equal(normal.stats.factStore, true);
    const minLevelParams = new URLSearchParams({
      from: '2026-08-18T00:00:00Z', to: '2026-08-18T02:00:00Z', mode: 'Normal', minModeLevel: '4'
    });
    const minLevel = await analytics.overview(minLevelParams);
    assert.equal(minLevel.stats.snapshotPending, false);
    assert.equal(minLevel.stats.indexedStore, true);
    assert.equal(minLevel.stats.factStore, true);
    assert.equal(minLevel.summary.totalRuns, 0);

    const family = await analytics.overview(new URLSearchParams({
      from: '2026-08-18T00:00:00Z', to: '2026-08-18T02:00:00Z', version: '0.772.x', mode: 'Challenge', minModeLevel: '5'
    }));
    assert.equal(family.summary.totalRuns, 1);
    assert.equal(family.outcomes.find(item => item.key === 'Dead')?.count, 1);
    assert.equal(parquetReads, 1, '버전군·모드·단계 필터도 단일 로컬 저장소에서 처리해야 한다');

    await fs.access(path.join(dataDir, 'analytics-events-v6', 'snapshots'));
    await fs.access(path.join(dataDir, 'analytics-query-v1', '20260818.facts.ndjson.gz'));

    await analytics.syncNow(params);
    const second = await analytics.overview(params);
    assert.equal(second.summary.totalRuns, 2);
    assert.equal(parquetReads, 1);
  } finally {
    analytics.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('이전 규격 캐시는 원본 Parquet에서 다시 추출해 누락 필드를 복구한다', async () => {
  const firstDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-durable-first-'));
  const secondDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-durable-second-'));
  const processedStore = createMemoryProcessedStore();
  const blobName = 'data/title=LIVE/date=20260817/hour=01/part-1.parquet';
  const listXml = `<?xml version="1.0"?><EnumerationResults><Blobs><Blob><Name>${blobName}</Name><Properties><Content-Length>1234</Content-Length></Properties></Blob></Blobs><NextMarker /></EnumerationResults>`;
  let firstReads = 0;
  let recoveryReads = 0;
  const common = {
    storageAccount: 'storage123', container: 'logs', sasToken: 'sp=rl&sig=test', liveTitleId: 'LIVE',
    concurrency: 2, cacheMinutes: 10, now: () => Date.parse('2026-08-17T02:00:00Z'), processedStore,
    fetchImpl: async () => new Response(listXml, { status: 200, headers: { 'Content-Type': 'application/xml' } })
  };
  const params = new URLSearchParams({ from: '2026-08-17T00:00:00Z', to: '2026-08-17T02:00:00Z' });
  let first;
  let recovered;

  try {
    first = createPlayFabAnalytics({
      ...common, dataDir: firstDataDir,
      parquetReader: async () => {
        firstReads += 1;
        return [{ ...base, Timestamp: '2026-08-17T01:00:00Z', EventId: 'durable-run', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', IsClear: true, PlayTime: 10 }) }];
      }
    });
    await first.syncNow(params);
    assert.equal((await first.overview(params)).summary.totalRuns, 1);
    assert.equal(firstReads, 1);
    assert.equal(first.getSyncState().persistence, 'azure');
    await processedStore.setDayRevision('20260817', 4);
    recovered = createPlayFabAnalytics({
      ...common, dataDir: secondDataDir,
      parquetReader: async () => {
        recoveryReads += 1;
        return [{ ...base, Timestamp: '2026-08-17T01:00:00Z', EventId: 'durable-run', FullName_Name: 'battle_result', EventData: JSON.stringify({ Version: '0.771.0', IsClear: true, PlayTime: 10 }) }];
      }
    });
    await recovered.syncNow(params);
    const overview = await recovered.overview(params);
    assert.equal(overview.summary.totalRuns, 1);
    assert.equal(recoveryReads, 1, '이전 추출 규격의 누락 필드는 원본을 다시 읽어 복구해야 한다');
    assert.equal(recovered.processedStorageConfigured, true);
  } finally {
    recovered?.close();
    first?.close();
    await fs.rm(firstDataDir, { recursive: true, force: true });
    await fs.rm(secondDataDir, { recursive: true, force: true });
  }
});

function createMemoryProcessedStore() {
  const manifests = new Map();
  const chunks = new Map();
  const snapshots = new Map();
  return {
    configured: true,
    async readDayManifest(dateKey) { return structuredClone(manifests.get(dateKey) || null); },
    async setDayRevision(dateKey, revision) {
      const manifest = manifests.get(dateKey);
      if (manifest) manifests.set(dateKey, { ...manifest, revision });
    },
    async writeDayManifest(dateKey, value) { manifests.set(dateKey, structuredClone(value)); },
    async readDayChunk(dateKey, name) { return chunks.get(`${dateKey}/${name}`) ?? null; },
    async writeDayChunk(dateKey, name, body) {
      const key = `${dateKey}/${name}`;
      const created = !chunks.has(key);
      if (created) chunks.set(key, body);
      return { created };
    },
    async readSnapshot(key) { return structuredClone(snapshots.get(key) || null); },
    async writeSnapshot(key, value) { snapshots.set(key, structuredClone(value)); }
  };
}
