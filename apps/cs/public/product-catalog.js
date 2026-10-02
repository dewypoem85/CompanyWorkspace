const CHARACTER_NAMES = [
  '기사', '무투가', '학살자', '총잡이', '마도사', '방랑 용병', '사냥꾼', '낭인',
  '늑대인간', '소환술사', '암살자', '수호자', '약탈자', '주술사', '용인', '소울이터',
  '흡혈귀', '얀델', '도플갱어', '승부사', '이단심판관', '광전사'
];

const PET_NAMES = [
  '플라스크', '웃는 선인장', '갈매기 친구', '솜몽치', '살랑이', '서리 정령', '레프의 전령', '쁘띠 골렘',
  '보뮬상자', '데빌펌킨', '구조대', '요미', '사격 드론', '성장 버섯', '붉은 도깨비', '쁘띠 늑대',
  '보안관', '알타르', '샤크 스핀', '스퀴로', '앰버 드래곤', '솜민트', '럭셔리 눈사람', '포이즌 펌킨',
  '루치펠', '해파링', '부두인형', '아이리스', '리퍼', '초록 달팽이', '시스투스', '캐롯 래빗',
  '슝슝이', '람 코브라', '용암 달팽이', '어비시우스', '악마의 오른팔', '쨱쨱이'
];

const SKIN_GROUPS = [
  ['기본 스킨', '제국의 별', '휴양지 2022', '여기사 (한정)', '할로윈 2022', '이상한 던전', '수도승 기사', '벤토의 기사', '케렐의 기사', '에이펙스 스트라이커', '크로노스의 기사'],
  ['기본 스킨', '바니걸', '양', '휴양지 2022', '할로윈 2022', '어린이날 2023', '이상한 던전', '민트 초콜릿 메이드', '단유화'],
  ['기본 스킨', '화이트 쇼콜라', '휴양지 2022', '할로윈 2022', '설날 2023', '이상한 던전', '달토끼', '푸른 파도의 소녀'],
  ['기본 스킨', '범죄 도시', '어린 양의 인도자', '휴양지 2022', '할로윈 2022', '빨강 망토', '이상한 던전', '가시 메이드', '새벽의 눈꽃', '사이버네틱'],
  ['기본 스킨', '이상한 던전의 마도사', '휴양지 2022', '할로윈 2023', '어린이날 2023', '설날 2024', '레이디 스칼렛', '한여름 밤의 마도사'],
  ['기본 스킨', '할로윈 2022', '크리스마스 2022', '어린이날 2023', '휴양지 2023', '이상한 던전', '라스', '취기 어린 홍랑'],
  ['기본 스킨', '할로윈 2022', '크리스마스 2022', '설날 2023', '휴양지 2023', '이상한 던전', '폴라리스', '에르웬 포르나치', '런웨이 디바'],
  ['기본 스킨', '혈월 (한정)', '휴양지 2023', '이상한 던전', '크리스마스 2023'],
  ['기본 스킨', '뒷골목 송곳니 (한정)', '2023 크리스마스', '설날 2024', '경찰견', '여름 2024', '미샤 칼스타인'],
  ['기본 스킨', '괴도 코발트(한정)', '이상한 나라의 소환술사', '여름 2024', '탐욕', '아루아 레이븐', '소꿉친구 소환술사'],
  ['기본 스킨', '혈족의 상징(한정)', '설날 2024', '여름 2024', '괴도 세실리아', '아멜리아 레인웨일즈'],
  ['기본 스킨', '불멸자', '수도승 수호자'],
  ['기본 스킨', '산호초 해적', '샤크 데 빌런'],
  ['기본 스킨', '스트리트 라이더', '산타복'],
  ['기본 스킨', '세이크리드 래디언스', '프로미넌스 로제'],
  ['기본 스킨', '트릭시 데빌', '길고양이 마왕'],
  ['기본 스킨', '환몽의 꽃잎', '블랑 로즈'],
  ['기본 스킨', '하프 아머 바바리안'],
  ['기본 스킨', '백야의 환영', '방과 후 선도부'],
  ['기본 스킨', '레드 래빗'],
  ['기본 스킨', '나흐트리히터'],
  ['기본 스킨', '하이퍼★스트리머']
];

const WEAPON_GROUPS = [
  [['철검', 0], ['엑시온', 1], ['슬레인', 2], ['오베론', 3], ['타벤투스', 4], ['이그니스', 5], ['임펄스 블레이드', 6]],
  [['손목보호대', 0], ['야그루쉬', 1], ['도철', 2], ['아야무르', 3], ['드라우프니르', 4], ['바람의 서곡', 5]],
  [['피의 낫', 0], ['영혼수확자', 1], ['폭뢰', 2], ['살점 분쇄기', 3], ['불카누스', 4], ['디아블로', 5]],
  [['권총', 0], ['센트리건-미니건', 1], ['센트리건-화염', 2], ['샷건', 3], ['황금총', 5]],
  [['작열의 마도서', 0], ['빙결의 마도서', 1], ['섬광의 마도서', 2], ['피의 구체', 3], ['어둠의 보석', 4], ['태양의 노래', 5]],
  [['붉은 대검', 0], ['용암검 카일', 1], ['사슬검 샤프탈', 2], ['마검 아란', 3], ['처형인의 잿빛클리버', 4], ['독주통 바커스', 5]],
  [['멀티 샷', 0], ['추적자', 1], ['블래스트', 2], ['홀리라이트', 3], ['데몬핸즈', 4], ['서리여왕', 5], ['폴라리스의 활', 6]],
  [['혈검', 0], ['마검', 1], ['공명도', 2], ['만독아', 3], ['도검', 900]],
  [['과다 출혈 (인간)', 0], ['상처 새기기 (인간)', 1], ['빙하마수 스카디아', 2], ['파고드는 발톱', 3]],
  [['대지정령', 0], ['마술토끼', 1], ['길잃은 붉은 정령', 2]],
  [['단검', 0], ['혈족의 상징', 1]],
  [['무쇠창', 0], ['괴물 사냥꾼', 1], ['불멸', 2], ['미스틸테인', 3], ['핏빛 도끼창', 4], ['금고봉', 5]],
  [['무쇠창', 0], ['괴물 사냥꾼', 1], ['불멸', 2], ['미스틸테인', 3], ['핏빛 도끼창', 4], ['금고봉', 5]],
  [['멸혼부', 0], ['피카부', 1], ['염주', 2], ['거목', 3]],
  [['용의 엄니', 0], ['조그노트의 신성검', 1], ['인페르노 레조네이터', 2]],
  [['소울이터', 0], ['오컬트 매니아', 1]],
  [['피의 권능', 0], ['롱기누스', 1]],
  [['방패', 0], ['시체골렘의 정수', 1], ['오크히어로의 정수', 2], ['오우거의 정수', 3]],
  [['흑검', 0], ['환영도', 1]],
  [['플러시', 0], ['짝패', 1]],
  [['심판의 망치', 0], ['아마데우스', 1]],
  [['썬더콜러', 0], ['블루 오버드라이브', 1]]
];

export const CHARACTERS = freezeItems(CHARACTER_NAMES.map((name, id) => ({
  type: 'characters', id, value: String(id), name,
  image: `/assets/product-catalog/characters/${id}.png`
})));

export const PETS = freezeItems(PET_NAMES.map((name, id) => ({
  type: 'pets', id, value: String(id), name,
  image: `/assets/product-catalog/pets/${id}.png`
})));

export const SKINS = freezeItems(SKIN_GROUPS.flatMap((names, characterId) => names.map((name, id) => ({
  type: 'skins', characterId, id, value: `${characterId}-${id}`, name,
  ownerName: CHARACTER_NAMES[characterId],
  image: `/assets/product-catalog/skins/${characterId}/${id}.png`
}))));

export const WEAPONS = freezeItems(WEAPON_GROUPS.flatMap((items, characterId) => items.map(([name, id]) => ({
  type: 'weapons', characterId, id, value: `${characterId}-${id}`, name,
  ownerName: CHARACTER_NAMES[characterId],
  image: `/assets/product-catalog/weapons/${characterId}/${id}.png`
}))));

export const PRODUCT_CATALOG = Object.freeze({
  characters: CHARACTERS,
  pets: PETS,
  skins: SKINS,
  weapons: WEAPONS
});

export function findProductCatalogItem(type, value) {
  return PRODUCT_CATALOG[type]?.find((item) => item.value === String(value)) || null;
}

export function inspectProductCatalogValue(type, value) {
  const normalized = String(value ?? '').trim();
  const label = { characters: '캐릭터', pets: '펫', skins: '스킨', weapons: '무기' }[type];
  const compound = type === 'skins' || type === 'weapons';
  if (!label) {
    return Object.freeze({ status: 'invalid-type', value: normalized, item: null, message: '알 수 없는 상품 종류입니다.' });
  }

  const validFormat = compound
    ? /^\d+-\d+$/.test(normalized)
    : /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized));
  if (!validFormat) {
    const format = compound ? '캐릭터ID-아이템ID' : '숫자 ID';
    return Object.freeze({
      status: 'invalid-format', value: normalized, item: null,
      message: `${label} 값 형식이 이상합니다. ${format} 형식으로 입력해 주세요.`
    });
  }

  const item = findProductCatalogItem(type, normalized);
  if (!item) {
    return Object.freeze({
      status: 'not-found', value: normalized, item: null,
      message: `카탈로그에 등록되지 않은 ${label} ID입니다.`
    });
  }
  return Object.freeze({ status: 'valid', value: normalized, item, message: '정상' });
}

export function makeSkinGuideItem(value) {
  const known = findProductCatalogItem('skins', value);
  if (known) return known;
  const match = String(value || '').match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  const characterId = Number(match[1]);
  const skinId = Number(match[2]);
  const character = CHARACTERS.find((item) => item.id === characterId) || null;
  return Object.freeze({
    type: 'skins', characterId, id: skinId, value: `${characterId}-${skinId}`,
    name: character ? `${character.name} 스킨 ${skinId}` : `캐릭터 ${characterId} 스킨 ${skinId}`,
    ownerName: character?.name || '',
    image: character?.image || ''
  });
}

function freezeItems(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}
