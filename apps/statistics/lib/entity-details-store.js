import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const CACHE_VERSION = 1;

export const ENTITY_DETAIL_SOURCES = Object.freeze({
  skills: { spreadsheetId: '1mIew5_ss0Yt3dJ_EvWOASGBlhv_s0QrhZvZJ42ORhlE', range: 'Skill!A:B' },
  artifacts: { spreadsheetId: '1yR3vUhLKnYWno-rSqWLzrCvjDTS3teKndUMdRwQ_A9Y', range: 'Artifact!A:B' },
  characters: { spreadsheetId: '1lNtUTH899DPSzQWVNMHlW5PIy-2JZqnk85MzTNnnQm8', range: 'Character!A:B' },
  pets: { spreadsheetId: '1c1LyP3OUej2acQ5KGWuYQRoY5AhEM4p8rw7ZmLPckHA', range: 'Default!A:B' },
  sinPoints: { spreadsheetId: '1c1LyP3OUej2acQ5KGWuYQRoY5AhEM4p8rw7ZmLPckHA', range: 'SinStat!A:B' }
});

const CHARACTERS = Object.freeze([
  'Knight', 'Fighter', 'Slayer', 'Gunslinger', 'Wizard', 'Mercenary', 'Hunter', 'Ronin',
  'Werewolf', 'Summoner', 'Assassin', 'Guardian', 'Predator', 'Shaman', 'Dragonian',
  'SoulEater', 'Vampire', 'Yandel', 'Doppel', 'HighRoller', 'Inquisitor', 'Berserker', 'Slime'
]);

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function validateCredentials(value) {
  if (!value || typeof value !== 'object' || typeof value.client_email !== 'string' || typeof value.private_key !== 'string') {
    throw httpError(503, 'Google Sheets 서비스 계정 설정을 확인해 주세요.');
  }
  return value;
}

async function loadCredentials({ credentialsJson, credentialsFile }) {
  if (String(credentialsJson || '').trim()) return validateCredentials(JSON.parse(credentialsJson));
  if (!String(credentialsFile || '').trim()) throw httpError(503, 'Google Sheets 서비스 계정이 설정되지 않았습니다.');
  return validateCredentials(JSON.parse(await fs.readFile(credentialsFile, 'utf8')));
}

async function accessToken(options) {
  const credentials = await loadCredentials(options);
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600
  }))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url');
  const response = await options.fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') throw httpError(502, 'Google 인증에 실패했습니다.');
  return payload.access_token;
}

async function readSource(source, token, fetchImpl) {
  const query = new URLSearchParams({ ranges: source.range, majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' });
  const response = await fetchImpl(`${SHEETS_API}/${encodeURIComponent(source.spreadsheetId)}/values:batchGet?${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(502, 'Google Sheets 내용을 읽지 못했습니다. 시트 공유 권한을 확인해 주세요.');
  return payload.valueRanges?.[0]?.values || [];
}

function rowsToMap(rows) {
  return new Map(rows.slice(1).map(row => [String(row?.[0] || '').trim(), cleanText(row?.[1])]).filter(([key]) => key));
}

export function cleanText(value) {
  return String(value || '')
    .replace(/<\/?color(?:=[^>]*)?>/gi, '')
    .replace(/<\/?(?:b|i|u|size)(?:=[^>]*)?>/gi, '')
    .replace(/\[\*[^\]]+\]/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function assign(target, field, value) {
  const text = cleanText(value);
  if (text) target[field] = text;
}

function ensure(group, key, name, category) {
  group[key] ||= { name, category };
  if (name) group[key].name = name;
  return group[key];
}

function parseCharacters(rows, details) {
  const values = rowsToMap(rows);
  for (const [characterId, prefix] of CHARACTERS.entries()) {
    const name = values.get(prefix);
    if (name) {
      const character = ensure(details.characters, String(characterId), name, '캐릭터');
      assign(character, 'description', values.get(`${prefix} Info`));
    }
  }
  for (const [key, value] of values) {
    let match = key.match(/^(\w+) Weapon Name (\d+)$/);
    if (match) {
      const characterId = CHARACTERS.indexOf(match[1]);
      if (characterId >= 0 && value) ensure(details.weapons, `${characterId}:${Number(match[2])}`, value, '무기');
      continue;
    }
    match = key.match(/^(\w+) Weapon Info(?: (Active|Passive))? (\d+)$/);
    if (match) {
      const characterId = CHARACTERS.indexOf(match[1]);
      if (characterId < 0) continue;
      const record = details.weapons[`${characterId}:${Number(match[3])}`];
      if (record) assign(record, match[2] === 'Active' ? 'active' : match[2] === 'Passive' ? 'passive' : 'description', value);
      continue;
    }
    match = key.match(/^(\w+) Skin Name (\d+)$/);
    if (match) {
      const characterId = CHARACTERS.indexOf(match[1]);
      if (characterId >= 0 && value) ensure(details.skins, `${characterId}:${Number(match[2])}`, value, '스킨');
      continue;
    }
    match = key.match(/^(\w+) Skin Info (\d+)$/);
    if (match) {
      const characterId = CHARACTERS.indexOf(match[1]);
      const record = details.skins[`${characterId}:${Number(match[2])}`];
      if (record) assign(record, 'description', value);
      continue;
    }
    match = key.match(/^(\w+) Node (\d+) Name$/);
    if (match) {
      const characterId = CHARACTERS.indexOf(match[1]);
      if (characterId >= 0 && value) ensure(details.nodes, `${characterId}:${Number(match[2])}`, value, '노드');
      continue;
    }
    match = key.match(/^(\w+) Node (\d+) Info$/);
    if (match) {
      const characterId = CHARACTERS.indexOf(match[1]);
      const record = details.nodes[`${characterId}:${Number(match[2])}`];
      if (record) assign(record, 'description', value);
    }
  }
}

function parseSkills(rows, details) {
  const values = rowsToMap(rows);
  for (const [key, value] of values) {
    const match = key.match(/^Skill(\d+)\.(name|CardInfo|EasyInfo)$/);
    if (!match) continue;
    const id = String(Number(match[1]));
    if (match[2] === 'name') {
      if (value) ensure(details.skills, id, value, '스킬');
      continue;
    }
    const record = details.skills[id];
    if (record) assign(record, match[2] === 'CardInfo' ? 'description' : 'summary', value);
  }
}

function parseArtifacts(rows, details) {
  const values = rowsToMap(rows);
  for (const [key, value] of values) {
    const match = key.match(/^(Cursed)?Arti(\d+)\.(Name|PowerText|Tooltip)$/);
    if (!match) continue;
    const id = `${match[1] ? 'curse' : 'normal'}:${Number(match[2])}`;
    if (match[3] === 'Name') {
      if (value) ensure(details.artifacts, id, value, '유물');
      continue;
    }
    const record = details.artifacts[id];
    if (record) assign(record, match[3] === 'PowerText' ? 'description' : 'flavor', value);
  }
}

function parsePets(rows, details) {
  const values = rowsToMap(rows);
  for (const [key, value] of values) {
    const match = key.match(/^Pet(Name|Info)(\d+)$/);
    if (!match) continue;
    const id = String(Number(match[2]));
    if (match[1] === 'Name') {
      if (value) ensure(details.pets, id, value, '펫');
      continue;
    }
    const record = details.pets[id];
    if (record) assign(record, 'description', value);
  }
}

function parseSinPoints(rows, details) {
  const values = rowsToMap(rows);
  for (const code of ['Wrath', 'Lust', 'Sloth', 'Greed', 'Gluttony', 'Pride', 'Envy']) {
    const name = values.get(`Sin_${code}_Name`);
    if (!name) continue;
    const record = ensure(details.sinPoints, code.toLowerCase(), name, '죄악');
    assign(record, 'description', values.get(`Sin_${code}_DefaultInfo`));
    assign(record, 'level10', values.get(`Sin_${code}_Lv10Info`));
    assign(record, 'level20', values.get(`Sin_${code}_Lv20Info`));
  }
}

export function parseEntityDetails(sources) {
  const details = Object.fromEntries(['characters', 'skins', 'weapons', 'pets', 'skills', 'artifacts', 'nodes', 'sinPoints'].map(key => [key, {}]));
  parseCharacters(sources.characters || [], details);
  parseSkills(sources.skills || [], details);
  parseArtifacts(sources.artifacts || [], details);
  parsePets(sources.pets || [], details);
  parseSinPoints(sources.sinPoints || [], details);
  return details;
}

function counts(details) {
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [key, Object.keys(value).length]));
}

function validSnapshot(value) {
  return value?.version === CACHE_VERSION && typeof value.updatedAt === 'string' && value.details && typeof value.details === 'object';
}

export function createEntityDetailsStore({
  dataDir,
  credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS,
  fetchImpl = fetch,
  now = () => new Date().toISOString()
}) {
  const cacheFile = path.join(dataDir, 'entity-details-v1.json');
  let snapshot = null;
  let loading = null;
  let refreshing = null;

  async function load() {
    if (snapshot) return snapshot;
    loading ??= fs.readFile(cacheFile, 'utf8').then(JSON.parse).then(value => {
      if (!validSnapshot(value)) throw Error('invalid');
      snapshot = value;
      return snapshot;
    }).catch(error => {
      if (error?.code !== 'ENOENT' && error?.message !== 'invalid') console.warn('[statistics] entity_details_cache_read_failed');
      return null;
    });
    return loading;
  }

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const token = await accessToken({ credentialsJson, credentialsFile, fetchImpl });
      const entries = await Promise.all(Object.entries(ENTITY_DETAIL_SOURCES).map(async ([key, source]) => [key, await readSource(source, token, fetchImpl)]));
      const details = parseEntityDetails(Object.fromEntries(entries));
      const next = { version: CACHE_VERSION, updatedAt: now(), counts: counts(details), details };
      await fs.mkdir(dataDir, { recursive: true });
      const temporary = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, cacheFile);
      snapshot = next;
      loading = Promise.resolve(next);
      return next;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  return {
    load,
    refresh,
    status: async () => {
      const current = await load();
      return {
        configured: Boolean(String(credentialsJson || '').trim() || String(credentialsFile || '').trim()),
        refreshing: Boolean(refreshing),
        updatedAt: current?.updatedAt || null,
        counts: current?.counts || null
      };
    }
  };
}
