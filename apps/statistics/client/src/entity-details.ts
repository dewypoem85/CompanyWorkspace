import type { EntityDetail } from './entity-details.generated';

type EntityItem = Record<string, unknown>;

export type TooltipSection = { label: string; text: string };
export type ResolvedEntityDetail = { name: string; category: string; sections: TooltipSection[] };

type DetailGroups = Record<string, Record<string, EntityDetail>>;
let detailGroupsPromise: Promise<DetailGroups> | null = null;
const detailCache = new Map<string, ResolvedEntityDetail | null>();

function loadDetailGroups() {
  detailGroupsPromise ??= fetch('/api/entity-details', {
    credentials: 'same-origin',
    redirect: 'manual',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  }).then(async response => {
    if (!response.ok || !String(response.headers.get('content-type') || '').includes('application/json')) throw Error('runtime details unavailable');
    const payload = await response.json() as { details?: DetailGroups };
    if (!payload.details || typeof payload.details !== 'object') throw Error('runtime details invalid');
    return payload.details;
  }).catch(() => import('./entity-details.generated').then(module => module.ENTITY_DETAILS));
  return detailGroupsPromise;
}

function numberKey(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : '';
}

function artifactKey(item: EntityItem) {
  const raw = String(item.sourceKey || item.logKey || item.key || '');
  const match = raw.match(/(?:^|:)(\d+)$/);
  if (!match) return '';
  const cursed = Boolean(item.cursed) || /(?:^|:)1:\d+$/.test(raw);
  return `${cursed ? 'curse' : 'normal'}:${Number(match[1])}`;
}

function detailKey(type: string, item: EntityItem) {
  if (type === 'characters' || type === 'pets' || type === 'skills') return numberKey(item.id);
  if (type === 'skins' || type === 'weapons' || type === 'nodes') {
    const characterId = numberKey(item.characterId), id = numberKey(item.id);
    return characterId && id ? `${characterId}:${id}` : '';
  }
  if (type === 'artifacts') return artifactKey(item);
  if (type === 'sinPoints') return String(item.sinCode || '').toLowerCase();
  return '';
}

function compactText(value: unknown) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function pushSection(sections: TooltipSection[], label: string, text: unknown, seen: Set<string>) {
  const normalized = compactText(text);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  sections.push({ label, text: normalized });
}

export async function resolveEntityDetail(type: string, item: EntityItem): Promise<ResolvedEntityDetail | null> {
  const key = detailKey(type, item);
  const cacheKey = `${type}:${key}`;
  if (key && detailCache.has(cacheKey)) return detailCache.get(cacheKey) ?? null;
  const groups = await loadDetailGroups();
  const detail = (key ? groups[type]?.[key] : undefined) as EntityDetail | undefined;
  const name = String(detail?.name || item.name || '').trim();
  const category = String(detail?.category || ({
    characters: '캐릭터', skins: '스킨', weapons: '무기', pets: '펫', skills: '스킬',
    artifacts: '유물', nodes: '노드', sinPoints: '죄악'
  } as Record<string, string>)[type] || '').trim();
  const sections: TooltipSection[] = [];
  const seen = new Set<string>();
  const hasSplitWeaponDescription = type === 'weapons' && Boolean(detail?.active || detail?.passive);
  pushSection(
    sections,
    '효과',
    hasSplitWeaponDescription ? item.effectDescription : detail?.description || item.effectDescription,
    seen
  );
  pushSection(sections, '세부 정보', detail?.summary, seen);
  pushSection(sections, '액티브', detail?.active, seen);
  pushSection(sections, '패시브', detail?.passive, seen);
  pushSection(sections, '10레벨', detail?.level10 || item.level10Info, seen);
  pushSection(sections, '20레벨', detail?.level20 || item.level20Info, seen);

  const runes = Array.isArray(item.uniqueRunes) ? item.uniqueRunes as EntityItem[] : [];
  for (const rune of runes) {
    const runeName = String(rune.name || '고유룬').trim();
    pushSection(sections, runeName, rune.effectDescription, seen);
  }
  pushSection(sections, '설정', detail?.flavor, seen);
  const resolved = name ? { name, category, sections } : null;
  if (key) detailCache.set(cacheKey, resolved);
  return resolved;
}
