const NORMAL_RUNE_OPTIONS = [
  { id: 101, optionKey: 'WeaponSkillDamage', name: '무기스킬 데미지증가', category: '무기스킬 데미지', color: 1 },
  { id: 102, optionKey: 'WeaponSkillDamageCooldownPenalty', name: '무기스킬 데미지증가/쿨타임증가', category: '무기스킬 데미지', color: 1 },
  { id: 103, optionKey: 'WeaponSkillDamageRange', name: '무기스킬 데미지증가/범위증가', category: '무기스킬 데미지', color: 1 },
  { id: 104, optionKey: 'WeaponSkillRange', name: '무기스킬 범위증가', category: '무기스킬 범위', color: 1 },
  { id: 105, optionKey: 'KillBuffWeaponSkillRange', name: '적 처치 시 일정 시간 무기스킬 범위증가', category: '무기스킬 범위', color: 1 },
  { id: 201, optionKey: 'WeaponSkillCooldown', name: '무기스킬 쿨타임감소', category: '무기스킬 쿨타임', color: 2 },
  { id: 202, optionKey: 'WeaponSkillCooldownRangePenalty', name: '무기스킬 쿨타임감소/범위감소', category: '무기스킬 쿨타임', color: 2 },
  { id: 203, optionKey: 'KillReduceWeaponSkillCooldown', name: '적 처치 시 무기스킬 쿨타임감소', category: '무기스킬 쿨타임', color: 2 },
  { id: 204, optionKey: 'WeaponSkillDamagePenaltyUseCountPlus', name: '무기스킬 데미지감소/사용가능횟수+1', category: '무기스킬 사용 횟수', color: 2 },
  { id: 205, optionKey: 'IgnoreWeaponSkillCooldownChance', name: '일정 확률로 무기스킬 쿨타임 미적용', category: '무기스킬 쿨타임', color: 2 },
  { id: 301, optionKey: 'WeaponSkillCountPercent', name: '무기스킬 개수 증가', category: '무기스킬 개수', color: 3 },
  { id: 302, optionKey: 'WeaponSkillCountPlusChance', name: '일정 확률로 무기스킬 개수 증가', category: '무기스킬 개수', color: 3 },
  { id: 303, optionKey: 'WeaponSkillHitInterval', name: '무기스킬 다단히트 간격 감소', category: '무기스킬 시전 속도', color: 3 },
  { id: 304, optionKey: 'WeaponSkillCastMoveSpeedBuff', name: '무기스킬 시전 시 이동속도 증가', category: '무기스킬 이동속도', color: 3 }
];

const UNIQUE_RUNE_OPTIONS = [
  { id: 900003, uniqueKey: 'Knight_00_03', characterId: 0, weaponId: 0, uniqueIndex: 3, name: '철검 고유룬', effectKey: 'Unique_Knight_00_03', effectDescription: '기본 공격 적중 시 50%의 확률로 무기스킬 공격 추가발동' },
  { id: 900061, uniqueKey: 'Knight_06_01', characterId: 0, weaponId: 6, uniqueIndex: 1, name: '임펄스 블레이드 고유룬', effectKey: 'Unique_Knight_06_01', effectDescription: '레벨 당 범위 +15%' },
  { id: 900062, uniqueKey: 'Knight_06_02', characterId: 0, weaponId: 6, uniqueIndex: 2, name: '임펄스 블레이드 고유룬', effectKey: 'Unique_Knight_06_02', effectDescription: '경험치 획득량 +100%' },
  { id: 910032, uniqueKey: 'Fighter_03_02', characterId: 1, weaponId: 3, uniqueIndex: 2, name: '아야무르 고유룬', effectKey: 'Unique_Fighter_03_02', effectDescription: '적 처치 시 무기스킬 쿨타임 20% 감소' },
  { id: 920011, uniqueKey: 'Slayer_01_01', characterId: 2, weaponId: 1, uniqueIndex: 1, name: '영혼수확자 고유룬', effectKey: 'Unique_Slayer_01_01', effectDescription: '스택 최대치 +200. 일반 공격 시 무기스킬 쿨타임이 완료되었다면 무기스킬 자동 발동. 수확 이펙트의 크기 감소.' },
  { id: 930011, uniqueKey: 'Gunslinger_01_01', characterId: 3, weaponId: 1, uniqueIndex: 1, name: '센트리건 고유룬', effectKey: 'Unique_Gunslinger_01_01', effectDescription: '장탄수 +100%' },
  { id: 940031, uniqueKey: 'Wizard_03_01', characterId: 4, weaponId: 3, uniqueIndex: 1, name: '피의 구체 고유룬', effectKey: 'Unique_Wizard_03_01', effectDescription: '출혈 자상 발동 시 마나 1 회복' },
  { id: 950031, uniqueKey: 'Mercenary_03_01', characterId: 5, weaponId: 3, uniqueIndex: 1, name: '마검 아란 고유룬', effectKey: 'Unique_Mercenary_03_01', effectDescription: '무기스킬 시전 시 3초간 공격력 +50% 증폭' },
  { id: 960032, uniqueKey: 'Hunter_03_02', characterId: 6, weaponId: 3, uniqueIndex: 2, name: '홀리라이트 고유룬', effectKey: 'Unique_Hunter_03_02', effectDescription: '강화 화살 발사 시 3초간 공격속도 +20% (최대 100%)' },
  { id: 970001, uniqueKey: 'Ronin_00_01', characterId: 7, weaponId: 0, uniqueIndex: 1, name: '혈검 고유룬', effectKey: 'Unique_Ronin_00_01', effectDescription: '대쉬의 도 게이지 소모량 -30%' },
  { id: 1030032, uniqueKey: 'Shaman_03_02', characterId: 13, weaponId: 3, uniqueIndex: 2, name: '거목 고유룬', effectKey: 'Unique_Shaman_03_02', effectDescription: '강령술 상태에서 무기스킬 시전 시 강화부적 1개 소모하고 무기스킬 쿨타임 초기화, 무기스킬 발사속도가 공격속도에 영향을 받음' },
  { id: 1050011, uniqueKey: 'SoulEater_01_01', characterId: 15, weaponId: 1, uniqueIndex: 1, name: '오컬트매니아 고유룬', effectKey: 'Unique_SoulEater_01_01', effectDescription: '승천 횟수 5당 무기스킬의 범위 +5%, 다단히트 횟수 +1 (최대 5중첩)' }
];

const NORMAL_BY_ID = new Map(NORMAL_RUNE_OPTIONS.map(item => [item.id, Object.freeze(item)]));
const UNIQUE_BY_ID = new Map(UNIQUE_RUNE_OPTIONS.map(item => [item.id, Object.freeze(item)]));
const RUNE_COLORS = new Map([
  [1, Object.freeze({ id: 1, name: '빨간 룬', key: 'red' })],
  [2, Object.freeze({ id: 2, name: '파란 룬', key: 'blue' })],
  [3, Object.freeze({ id: 3, name: '노란 룬', key: 'yellow' })]
]);

export const RUNE_MASTER_COUNTS = Object.freeze({ normalOptions: NORMAL_RUNE_OPTIONS.length, uniqueOptions: UNIQUE_RUNE_OPTIONS.length });

export function getNormalRuneOptionMeta(id) {
  return NORMAL_BY_ID.get(Number(id)) || null;
}

export function getUniqueRuneMeta(id) {
  return UNIQUE_BY_ID.get(Number(id)) || null;
}

export function getRuneColorMeta(id) {
  return RUNE_COLORS.get(Number(id)) || Object.freeze({ id: Number(id) || 0, name: '색상 미기록', key: 'unknown' });
}
