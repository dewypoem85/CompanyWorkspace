export const SIN_STATS = [
  ['Wrath', '분노', '공격력 +{0}%', '적 처치 시 8초간 공격력·이동 속도 증가', '보스 처치 시 공격력 +1'],
  ['Lust', '색욕', '피격 시 {0}% 확률로 피해 무효화', '최대 하트 +1칸', '기본 하트 회복 효율 100%'],
  ['Sloth', '나태', '스킬 데미지 +{0}%', '던전 입장 시 특수 개조 스킬 1개 획득', '10레벨 효과가 매 챕터 입장 시 발동'],
  ['Greed', '탐욕', '골드 획득량 +{0}%', '상자에서 무료 리롤 1회', '상점 판매 물품 +1'],
  ['Gluttony', '폭식', '상자 소모품 등장 확률 +{0}%', '던전 입장 시 마법의 배낭 획득', '소모품 획득 시 이동 속도 -0.5%, 스킬 데미지 +5%'],
  ['Pride', '교만', '행운 +{0}%', '상자 오픈 시 10% 행운 추가 적용', '게임 시작 시 교만의 반지-진 획득'],
  ['Envy', '질투', '저주방 등장 확률 +{0}%', '저주 유물 구매 하트 -1칸', '보유·소모·사용한 저주 유물당 공격력 +10%']
].map(([code, name, defaultInfo, level10Info, level20Info], index) => ({ index, code, name, defaultInfo, level10Info, level20Info }));

export function describeSinPoints(points, character = {}) {
  if (!Array.isArray(points) || points.length !== SIN_STATS.length) return [];
  return SIN_STATS.map((sin, index) => {
    const value = Number(points[index]);
    if (!Number.isInteger(value) || value < 0 || value > 20) return null;
    const key = `${character.key || 'character:unknown'}|sin:${sin.code.toLowerCase()}:points:${value}`;
    return {
      id: sin.index, key, aggregateKey: key,
      name: `${sin.name} ${value}포인트`,
      characterId: character.id ?? null, characterName: character.name || '',
      sinCode: sin.code, sinName: sin.name, sinIndex: sin.index, points: value,
      defaultInfo: sin.defaultInfo, level10Info: sin.level10Info, level20Info: sin.level20Info
    };
  }).filter(Boolean);
}
