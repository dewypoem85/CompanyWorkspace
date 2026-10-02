const base = {
  summary: {
    activePlayers: 18426,
    totalRuns: 22154,
    gameCompletions: 7218,
    completionRate: 32.6,
    deathRate: 41.8,
    bossKills: 26904,
    playTime: { sampleSize: 22154, averageMs: 1_248_000, medianMs: 1_106_000, p90Ms: 2_042_000 },
    deltas: { activePlayers: 8.4, totalRuns: 6.8, completionRate: 1.7, bossKills: -2.3 }
  },
  trend: [
    { date: '08.12', players: 2140, runs: 2810, clears: 760 },
    { date: '08.13', players: 2470, runs: 3120, clears: 890 },
    { date: '08.14', players: 2330, runs: 2980, clears: 820 },
    { date: '08.15', players: 2710, runs: 3410, clears: 1030 },
    { date: '08.16', players: 2620, runs: 3260, clears: 980 },
    { date: '08.17', players: 2980, runs: 3620, clears: 1270 },
    { date: '08.18', players: 2800, runs: 2954, clears: 1468 }
  ],
  outcomes: [
    { key: 'Clear', label: '클리어', count: 7218, rate: 32.6 },
    { key: 'Dead', label: '사망', count: 9259, rate: 41.8 },
    { key: 'Fail', label: '실패·중단', count: 5677, rate: 25.6 },
    { key: 'Unknown', label: '레거시 미분류', count: 0, rate: 0 }
  ],
  bosses: [
    { id: null, masterId: 1, code: 'B001', imageCode: 'B001', key: 'legacy-master:B001', name: '탐욕', rank: 'Boss', killCount: 5288, uniquePlayers: 4214, fightDuration: { sampleSize: 0, averageMs: null, medianMs: null, p90Ms: null }, legacyFightDuration: { sampleSize: 5110, averageMs: 82300, medianMs: 76400, p90Ms: 131200 }, durationQuality: 'legacy_unreliable', linkedRuns: 0, linkedClearRate: 0, legacy: true },
    { id: null, masterId: 101, code: 'B101', imageCode: 'B101', key: 'legacy-master:B101', name: '늪지 마녀 켈시', rank: 'Boss', killCount: 8071, uniquePlayers: 6320, fightDuration: { sampleSize: 0, averageMs: null, medianMs: null, p90Ms: null }, legacyFightDuration: { sampleSize: 7904, averageMs: 64700, medianMs: 59800, p90Ms: 103500 }, durationQuality: 'legacy_unreliable', linkedRuns: 0, linkedClearRate: 0, legacy: true },
    { id: null, masterId: 3, code: 'E003', imageCode: 'E003', key: 'legacy-master:E003', name: '사악한 군집체', rank: 'MiddleBoss', killCount: 11533, uniquePlayers: 9382, fightDuration: { sampleSize: 0, averageMs: null, medianMs: null, p90Ms: null }, legacyFightDuration: { sampleSize: 11241, averageMs: 42800, medianMs: 39100, p90Ms: 70400 }, durationQuality: 'legacy_unreliable', linkedRuns: 0, linkedClearRate: 0, legacy: true }
  ],
  versions: [
    { version: '0.772.0', players: 6210, runs: 7362, clears: 2631, deaths: 2915, fails: 1816, clearRate: 35.7, deathRate: 39.6, playTime: { sampleSize: 7362, averageMs: 1190000, medianMs: 1060000, p90Ms: 1940000 } },
    { version: '0.771.3', players: 12216, runs: 14792, clears: 4587, deaths: 6344, fails: 3861, clearRate: 31, deathRate: 42.9, playTime: { sampleSize: 14792, averageMs: 1277000, medianMs: 1132000, p90Ms: 2091000 } }
  ],
  dimensions: {
    platforms: [{ key: 'WindowsPlayer', players: 14210, runs: 17204, clears: 5874, deaths: 7011, fails: 4319, clearRate: 34.1, deathRate: 40.8 }, { key: 'Android', players: 4216, runs: 4950, clears: 1344, deaths: 2248, fails: 1358, clearRate: 27.2, deathRate: 45.4 }],
    modes: [{ key: 'Normal', players: 15320, runs: 18340, clears: 6419, deaths: 7336, fails: 4585, clearRate: 35, deathRate: 40 }, { key: 'Challenge', players: 3106, runs: 3814, clears: 799, deaths: 1923, fails: 1092, clearRate: 20.9, deathRate: 50.4 }]
  },
  builds: {
    sourceRuns: { characters: 22154, weapons: 22010, pets: 7362, nodes: 6210, skills: 22154, artifacts: 22154, combinations: 22010 },
    masterData: { skills: 106, skillVariants: 24, artifacts: 382, cursedArtifacts: 22, unnamedArtifacts: 2, characters: 22 },
    characters: [
      { id: 0, name: '기사', source: 'mixed', idRuns: 1380, nameRuns: 2802, runs: 4182, clears: 1489, uniquePlayers: 3520, selectionRate: 18.9, clearRate: 35.6, playTime: { sampleSize: 4182, averageMs: 1184000, medianMs: 1071000, p90Ms: 1912000 } },
      { id: 3, name: '총잡이', source: 'mixed', idRuns: 1204, nameRuns: 2410, runs: 3614, clears: 1243, uniquePlayers: 3088, selectionRate: 16.3, clearRate: 34.4, playTime: { sampleSize: 3614, averageMs: 1217000, medianMs: 1098000, p90Ms: 1984000 } },
      { id: 7, name: '낭인', source: 'name', idRuns: 0, nameRuns: 2948, runs: 2948, clears: 1038, uniquePlayers: 2504, selectionRate: 13.3, clearRate: 35.2, playTime: { sampleSize: 2948, averageMs: 1169000, medianMs: 1042000, p90Ms: 1877000 } }
    ],
    weapons: [{ id: 0, characterId: 0, key: 'character:0|id:0', name: '철검', source: 'mixed', idRuns: 920, nameRuns: 1680, runs: 2600, clears: 988, uniquePlayers: 2280, selectionRate: 11.8, clearRate: 38, playTime: { sampleSize: 2600, medianMs: 1040000, p90Ms: 1880000 } }, { id: 0, characterId: 7, key: 'character:7|id:0', name: '혈검', source: 'name', idRuns: 0, nameRuns: 2110, runs: 2110, clears: 726, uniquePlayers: 1840, selectionRate: 9.6, clearRate: 34.4, playTime: { sampleSize: 2110, medianMs: 1110000, p90Ms: 2010000 } }],
    pets: [{ id: 1, key: 'id:1', name: '테스트 펫', source: 'id', idRuns: 2820, nameRuns: 0, runs: 2820, clears: 1104, uniquePlayers: 2408, selectionRate: 38.3, clearRate: 39.1, playTime: { sampleSize: 2820, medianMs: 1020000, p90Ms: 1840000 } }],
    nodes: [{ id: 2, key: 'id:0|node:id:2', nodeKey: 'id:2', characterId: 0, characterName: '기사', name: '강인함', source: 'id', idRuns: 1940, nameRuns: 0, runs: 1940, clears: 782, uniquePlayers: 1681, selectionRate: 31.2, clearRate: 40.3, playTime: { sampleSize: 1940, medianMs: 1004000, p90Ms: 1810000 } }, { id: 7, key: 'id:0|node:id:7', nodeKey: 'id:7', characterId: 0, characterName: '기사', name: '복수', source: 'id', idRuns: 1510, nameRuns: 0, runs: 1510, clears: 570, uniquePlayers: 1310, selectionRate: 24.3, clearRate: 37.7, playTime: { sampleSize: 1510, medianMs: 1080000, p90Ms: 1910000 } }],
    skills: [
      { id: 40, name: '공간 균열', source: 'mixed', idRuns: 1060, nameRuns: 1791, known: true, runs: 2851, clears: 1083, uniquePlayers: 2470, selectionRate: 38.7, clearRate: 38, playTime: { sampleSize: 2851, averageMs: 1191000, medianMs: 1064000, p90Ms: 1936000 } },
      { id: 65, name: '죽음의 낙인', source: 'name', idRuns: 0, nameRuns: 2622, known: true, runs: 2622, clears: 953, uniquePlayers: 2298, selectionRate: 35.6, clearRate: 36.3, playTime: { sampleSize: 2622, averageMs: 1218000, medianMs: 1099000, p90Ms: 1981000 } },
      { id: 101, name: '항성 궤도', source: 'id', idRuns: 2417, nameRuns: 0, known: true, runs: 2417, clears: 936, uniquePlayers: 2104, selectionRate: 32.8, clearRate: 38.7, playTime: { sampleSize: 2417, averageMs: 1172000, medianMs: 1048000, p90Ms: 1897000 } }
    ],
    artifacts: [
      { key: '0:33', name: '성배', source: 'mixed', idRuns: 710, nameRuns: 1258, rank: '상급', cursed: false, known: true, runs: 1968, clears: 791, uniquePlayers: 1710, selectionRate: 26.7, clearRate: 40.2, playTime: { sampleSize: 1968, averageMs: 1168000, medianMs: 1035000, p90Ms: 1888000 } },
      { key: '0:70', name: '요술봉', source: 'name', idRuns: 0, nameRuns: 1833, rank: '상급', cursed: false, known: true, runs: 1833, clears: 703, uniquePlayers: 1598, selectionRate: 24.9, clearRate: 38.4, playTime: { sampleSize: 1833, averageMs: 1199000, medianMs: 1074000, p90Ms: 1940000 } },
      { key: '1:14', name: '탐욕의 문장', source: 'id', idRuns: 1421, nameRuns: 0, rank: '저주 특급', cursed: true, known: true, runs: 1421, clears: 477, uniquePlayers: 1240, selectionRate: 19.3, clearRate: 33.6, playTime: { sampleSize: 1421, averageMs: 1263000, medianMs: 1145000, p90Ms: 2074000 } }
    ],
    combinations: [{
      key: '기사|철검|테스트펫|공간균열|죽음의낙인|항성궤도|성배|요술봉|탐욕의문장',
      name: '기사 · 철검 · 테스트 펫 · 공간 균열 · 죽음의 낙인 · 항성 궤도 · 성배 · 요술봉 · 탐욕의 문장',
      character: { id: 0, key: 'id:0', name: '기사' },
      weapons: [{ id: 0, characterId: 0, key: 'character:0|id:0', name: '철검', slot: '주무기' }],
      pet: { id: 1, key: 'id:1', name: '테스트 펫' },
      skills: [{ id: 40, key: 'id:40', name: '공간 균열' }, { id: 65, key: 'id:65', name: '죽음의 낙인' }, { id: 101, key: 'id:101', name: '항성 궤도' }],
      artifacts: [{ key: '0:33', sourceKey: '0:33', name: '성배', cursed: false }, { key: '0:70', sourceKey: '0:70', name: '요술봉', cursed: false }, { key: '1:14', sourceKey: '1:14', name: '탐욕의 문장', cursed: true }],
      nodes: [], includesNodes: false,
      collections: [{ id: 140, name: '엘리멘탈 마스터', effect: '출혈, 냉기, 번개, 신성 시너지 + 3', requirements: ['유물 5, 27, 68, 73, 262, 113, 193'], activations: 451, activationRate: 41 }],
      synergies: [{ id: 140, name: '엘리멘탈 마스터', effect: '출혈, 냉기, 번개, 신성 시너지 + 3', requirements: ['유물 5, 27, 68, 73, 262, 113, 193'], activations: 451, activationRate: 41 }],
      source: 'mixed', idRuns: 480, nameRuns: 620, runs: 1100, clears: 451, uniquePlayers: 982, selectionRate: 5, clearRate: 41,
      playTime: { sampleSize: 1100, medianMs: 1010000, p90Ms: 1810000 }
    }]
  },
  schema: { totalEvents: 49058, v2Events: 16380, legacyEvents: 32678, incompleteV2Events: 0, missingRunId: 32678, linkedBossKills: 13841, structuredRate: 33.4, bossLinkRate: 51.4 }
};

base.builds.characters[0].components = {
  weapons: [{ id: 0, characterId: 0, key: 'character:0|id:0', name: '철검', runs: 2600, clears: 988, uniquePlayers: 2280, adoptionRate: 62.2, clearRate: 38 }],
  pets: [{ id: 1, key: 'id:1', name: '테스트 펫', runs: 1800, clears: 738, uniquePlayers: 1580, adoptionRate: 43, clearRate: 41 }],
  nodes: [{ id: 2, key: 'id:0|node:id:2', nodeKey: 'id:2', characterId: 0, characterName: '기사', name: '강인함', runs: 1240, clears: 521, uniquePlayers: 1090, adoptionRate: 29.7, clearRate: 42 }, { id: 7, key: 'id:0|node:id:7', nodeKey: 'id:7', characterId: 0, characterName: '기사', name: '복수', runs: 840, clears: 319, uniquePlayers: 730, adoptionRate: 20.1, clearRate: 38 }],
  skills: base.builds.skills.map(item => ({ id: item.id, key: `id:${item.id}`, name: item.name, runs: Math.round(item.runs * .45), clears: Math.round(item.clears * .45), uniquePlayers: Math.round(item.uniquePlayers * .45), adoptionRate: Math.round(item.selectionRate * 1.4 * 10) / 10, clearRate: item.clearRate })),
  artifacts: base.builds.artifacts.map(item => ({ key: item.key, sourceKey: item.key, name: item.name, rank: item.rank, cursed: item.cursed, runs: Math.round(item.runs * .5), clears: Math.round(item.clears * .5), uniquePlayers: Math.round(item.uniquePlayers * .5), adoptionRate: Math.round(item.selectionRate * 1.6 * 10) / 10, clearRate: item.clearRate }))
};
base.builds.characters[0].topCombinations = base.builds.combinations.map(item => ({ ...item, characterAdoptionRate: 26.3 }));
for (const character of base.builds.characters.slice(1)) {
  character.components = { weapons: [], pets: [], nodes: [], skills: [], artifacts: [] };
  character.topCombinations = [];
}

export function createDemoOverview({ from, to } = {}) {
  const fromDate = new Date(from || Date.now() - 7 * 86_400_000);
  const toDate = new Date(to || Date.now());
  const days = Math.max(1, Math.round((toDate - fromDate) / 86_400_000));
  const scale = days <= 7 ? 1 : days <= 30 ? 2.95 : 6.9;
  const factor = scale;
  const scaled = value => Math.round(value * factor);
  const detail = item => ({ ...item, versions: [{ version: '0.772.0', runs: Math.round(item.runs * .42), clears: Math.round(item.clears * .46), clearRate: Math.min(100, Math.round(item.clearRate * 1.08 * 10) / 10) }, { version: '0.771.3', runs: Math.round(item.runs * .58), clears: Math.round(item.clears * .54), clearRate: Math.max(0, Math.round(item.clearRate * .94 * 10) / 10) }], collections: item.collections || [], synergies: item.synergies || [] });
  return {
    mode: 'demo', environment: 'live', generatedAt: new Date().toISOString(),
    from: fromDate.toISOString(), to: toDate.toISOString(), schemaCutoverVersion: '0.772.0',
    summary: { ...base.summary, activePlayers: scaled(base.summary.activePlayers), totalRuns: scaled(base.summary.totalRuns), gameCompletions: scaled(base.summary.gameCompletions), bossKills: scaled(base.summary.bossKills), playTime: { ...base.summary.playTime, sampleSize: scaled(base.summary.playTime.sampleSize) } },
    trend: base.trend.map(item => ({ ...item, players: scaled(item.players), runs: scaled(item.runs), clears: scaled(item.clears) })),
    outcomes: base.outcomes.map(item => ({ ...item, count: scaled(item.count) })),
    bosses: base.bosses.map(item => ({ ...item, killCount: scaled(item.killCount), uniquePlayers: scaled(item.uniquePlayers), linkedRuns: scaled(item.linkedRuns), fightDuration: { ...item.fightDuration, sampleSize: scaled(item.fightDuration.sampleSize) } })),
    versions: base.versions.map(item => ({ ...item, players: scaled(item.players), runs: scaled(item.runs), clears: scaled(item.clears), deaths: scaled(item.deaths), fails: scaled(item.fails), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } })),
    dimensions: Object.fromEntries(Object.entries(base.dimensions).map(([key, items]) => [key, items.map(item => ({ ...item, players: scaled(item.players), runs: scaled(item.runs), clears: scaled(item.clears), deaths: scaled(item.deaths), fails: scaled(item.fails) }))])),
    builds: {
      ...base.builds,
      sourceRuns: Object.fromEntries(Object.entries(base.builds.sourceRuns).map(([key, value]) => [key, scaled(value)])),
      characters: base.builds.characters.map(item => detail({ ...item, runs: scaled(item.runs), clears: scaled(item.clears), uniquePlayers: scaled(item.uniquePlayers), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } })),
      weapons: base.builds.weapons.map(item => detail({ ...item, runs: scaled(item.runs), clears: scaled(item.clears), uniquePlayers: scaled(item.uniquePlayers), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } })),
      pets: base.builds.pets.map(item => detail({ ...item, runs: scaled(item.runs), clears: scaled(item.clears), uniquePlayers: scaled(item.uniquePlayers), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } })),
      nodes: base.builds.nodes.map(item => detail({ ...item, runs: scaled(item.runs), clears: scaled(item.clears), uniquePlayers: scaled(item.uniquePlayers), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } })),
      skills: base.builds.skills.map(item => detail({ ...item, runs: scaled(item.runs), clears: scaled(item.clears), uniquePlayers: scaled(item.uniquePlayers), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } })),
      artifacts: base.builds.artifacts.map(item => detail({ ...item, runs: scaled(item.runs), clears: scaled(item.clears), uniquePlayers: scaled(item.uniquePlayers), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } })),
      combinations: base.builds.combinations.map(item => detail({ ...item, runs: scaled(item.runs), clears: scaled(item.clears), uniquePlayers: scaled(item.uniquePlayers), playTime: { ...item.playTime, sampleSize: scaled(item.playTime.sampleSize) } }))
    },
    schema: Object.fromEntries(Object.entries(base.schema).map(([key, value]) => [key, key.endsWith('Rate') ? value : scaled(value)])),
    stats: { partitions: 0, blobsScanned: 0, rowsScanned: 0, invalidEvents: 0 }
  };
}
