import crypto from 'node:crypto';

export const BUILD_TYPES = Object.freeze([
  'characters', 'skins', 'weapons', 'pets', 'nodes',
  'nodeCombinations', 'skills', 'artifacts', 'sinPoints', 'combinations'
]);
export const OVERVIEW_PROJECTION_REVISION = 2;

const VIEWS = new Set(['full', 'dashboard', 'results', 'builds', 'buildDetail', 'bosses', 'bossDetail']);
const BUILD_TYPE_SET = new Set(BUILD_TYPES);

export function parseOverviewProjection(searchParams) {
  const rawView = String(searchParams?.get?.('view') || 'full');
  if (!VIEWS.has(rawView)) throw httpError(400, '통계 화면 구분이 올바르지 않습니다.');
  const rawBuildType = String(searchParams?.get?.('buildType') || 'characters');
  if (!BUILD_TYPE_SET.has(rawBuildType)) throw httpError(400, '빌드 분석 대상이 올바르지 않습니다.');
  const key = String(searchParams?.get?.('detailKey') || '');
  if (key.length > 1024) throw httpError(400, '상세 항목 키가 너무 깁니다.');
  return { view: rawView, buildType: rawBuildType, key };
}

export function projectionCacheKey(projection) {
  if (!projection || projection.view === 'full') return '';
  const readable = projection.view === 'builds' || projection.view === 'buildDetail'
    ? `${projection.view}-${projection.buildType}`
    : projection.view;
  const digest = crypto.createHash('sha256').update(JSON.stringify({ revision: OVERVIEW_PROJECTION_REVISION, ...projection })).digest('hex').slice(0, 16);
  return `${readable}-${digest}`;
}

export function projectOverview(payload, projection = { view: 'full' }) {
  if (!projection || projection.view === 'full') return payload;

  const result = {
    ...payload,
    stats: { ...(payload.stats || {}), projectionRevision: OVERVIEW_PROJECTION_REVISION },
    bosses: [],
    builds: emptyBuilds(payload.builds)
  };

  switch (projection.view) {
    case 'dashboard':
      result.builds.characters = (payload.builds?.characters || []).slice(0, 5).map(compactBuildListItem);
      result.bosses = (payload.bosses || []).slice(0, 5).map(compactBossListItem);
      break;
    case 'results':
      break;
    case 'builds':
      result.builds[projection.buildType] = (payload.builds?.[projection.buildType] || []).map(compactBuildListItem);
      break;
    case 'buildDetail': {
      const item = findBuild(payload, projection.buildType, projection.key);
      result.builds[projection.buildType] = item ? [compactBuildDetailItem(item, projection.buildType)] : [];
      break;
    }
    case 'bosses':
      result.bosses = (payload.bosses || []).map(compactBossListItem);
      break;
    case 'bossDetail': {
      const boss = findBoss(payload, projection.key);
      result.bosses = boss ? [compactBossDetailItem(boss)] : [];
      break;
    }
  }
  return result;
}

export function standardOverviewProjections() {
  return [
    { view: 'dashboard', buildType: 'characters', key: '' },
    { view: 'results', buildType: 'characters', key: '' },
    { view: 'bosses', buildType: 'characters', key: '' },
    ...BUILD_TYPES.map(buildType => ({ view: 'builds', buildType, key: '' }))
  ];
}

function emptyBuilds(builds = {}) {
  const result = {
    sourceRuns: { ...(builds.sourceRuns || {}) },
    masterData: { ...(builds.masterData || {}) }
  };
  for (const type of BUILD_TYPES) result[type] = [];
  return result;
}

function compactBuildListItem(item) {
  const {
    components, topCombinations, topNodeCombinations,
    runes, runeConfigurations, collections, synergies,
    ...summary
  } = item;
  return summary;
}

function compactBuildDetailItem(item, type) {
  const summary = compactBuildListItem(item);
  if (type === 'characters') {
    summary.components = Object.fromEntries(Object.entries(item.components || {}).map(([key, values]) => [
      key,
      (values || []).slice(0, key === 'sinPoints' ? 147 : 8).map(compactBuildListItem)
    ]));
    summary.topCombinations = (item.topCombinations || []).slice(0, 10).map(compactBuildListItem);
    summary.topNodeCombinations = (item.topNodeCombinations || []).slice(0, 10).map(compactBuildListItem);
  }
  if (type === 'combinations') {
    summary.collections = item.collections || [];
    summary.synergies = item.synergies || [];
  }
  return summary;
}

function compactBossListItem(boss) {
  const { buildStats, ...summary } = boss;
  return summary;
}

function compactBossDetailItem(boss) {
  const summary = compactBossListItem(boss);
  summary.buildStats = Object.fromEntries(Object.entries(boss.buildStats || {}).map(([key, values]) => {
    const limit = key === 'combinations' ? 20 : (key === 'sinPoints' ? 147 : 8);
    const filtered = key === 'combinations'
      ? (values || []).filter(value => Number(value.matchedKills || 0) > 0)
      : (values || []);
    return [key, filtered.slice(0, limit).map(compactBuildListItem)];
  }));
  return summary;
}

function findBuild(payload, type, key) {
  return (payload.builds?.[type] || []).find(item => String(item.key || item.name || '') === String(key || '')) || null;
}

function findBoss(payload, key) {
  return (payload.bosses || []).find(item => String(item.key || item.id || item.name || '') === String(key || '')) || null;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
