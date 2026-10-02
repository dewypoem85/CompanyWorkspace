import { NODES } from './node-data.js';

// 제공된 게임 데이터 마스터. 숫자 CharacterId는 시트에 명시되지 않아 로그 payload의 값을 사용한다.
export const SKILLS = Object.freeze([
  {
    "id": 0,
    "subId": 0,
    "code": 0,
    "name": "연속타격"
  },
  {
    "id": 1,
    "subId": 0,
    "code": 10,
    "name": "증오의 가시"
  },
  {
    "id": 2,
    "subId": 0,
    "code": 20,
    "name": "표창 기동"
  },
  {
    "id": 3,
    "subId": 0,
    "code": 30,
    "name": "절단검"
  },
  {
    "id": 3,
    "subId": 1,
    "code": 31,
    "name": "절단검 그림자"
  },
  {
    "id": 4,
    "subId": 0,
    "code": 40,
    "name": "연쇄 번개"
  },
  {
    "id": 5,
    "subId": 0,
    "code": 50,
    "name": "번개 부름"
  },
  {
    "id": 6,
    "subId": 0,
    "code": 60,
    "name": "보호막"
  },
  {
    "id": 6,
    "subId": 1,
    "code": 61,
    "name": "보호막 방출"
  },
  {
    "id": 7,
    "subId": 0,
    "code": 70,
    "name": "유체화"
  },
  {
    "id": 8,
    "subId": 0,
    "code": 80,
    "name": "메디테이션"
  },
  {
    "id": 9,
    "subId": 0,
    "code": 90,
    "name": "마법 부여"
  },
  {
    "id": 10,
    "subId": 0,
    "code": 100,
    "name": "오버드라이브"
  },
  {
    "id": 11,
    "subId": 0,
    "code": 110,
    "name": "램페이지"
  },
  {
    "id": 12,
    "subId": 0,
    "code": 120,
    "name": "맹독 확산"
  },
  {
    "id": 12,
    "subId": 1,
    "code": 121,
    "name": "맹독 확산 폭발"
  },
  {
    "id": 13,
    "subId": 0,
    "code": 130,
    "name": "충격 강타"
  },
  {
    "id": 14,
    "subId": 0,
    "code": 140,
    "name": "화염 지대"
  },
  {
    "id": 15,
    "subId": 0,
    "code": 150,
    "name": "신경독"
  },
  {
    "id": 15,
    "subId": 1,
    "code": 151,
    "name": "신경독 피격"
  },
  {
    "id": 16,
    "subId": 0,
    "code": 160,
    "name": "전기의 낙인"
  },
  {
    "id": 17,
    "subId": 0,
    "code": 170,
    "name": "화염의 낙인"
  },
  {
    "id": 18,
    "subId": 0,
    "code": 180,
    "name": "얼음의 낙인"
  },
  {
    "id": 19,
    "subId": 0,
    "code": 190,
    "name": "맹독 구름"
  },
  {
    "id": 20,
    "subId": 0,
    "code": 200,
    "name": "냉기 폭탄 투척"
  },
  {
    "id": 20,
    "subId": 1,
    "code": 201,
    "name": "냉기 폭탄 폭발"
  },
  {
    "id": 21,
    "subId": 0,
    "code": 210,
    "name": "화염 폭탄 투척"
  },
  {
    "id": 21,
    "subId": 1,
    "code": 211,
    "name": "화염 폭탄 폭발"
  },
  {
    "id": 22,
    "subId": 0,
    "code": 220,
    "name": "플라즈마"
  },
  {
    "id": 22,
    "subId": 1,
    "code": 221,
    "name": "플라즈마 공격"
  },
  {
    "id": 23,
    "subId": 0,
    "code": 230,
    "name": "죽음의 광선"
  },
  {
    "id": 24,
    "subId": 0,
    "code": 240,
    "name": "얼음창"
  },
  {
    "id": 25,
    "subId": 0,
    "code": 250,
    "name": "화염구"
  },
  {
    "id": 25,
    "subId": 1,
    "code": 251,
    "name": "화염구 폭발"
  },
  {
    "id": 26,
    "subId": 0,
    "code": 260,
    "name": "단검 투척"
  },
  {
    "id": 27,
    "subId": 0,
    "code": 270,
    "name": "독가스 폭발"
  },
  {
    "id": 28,
    "subId": 0,
    "code": 280,
    "name": "독 바르기"
  },
  {
    "id": 29,
    "subId": 0,
    "code": 290,
    "name": "독의 칼날"
  },
  {
    "id": 30,
    "subId": 0,
    "code": 300,
    "name": "서리 가시"
  },
  {
    "id": 30,
    "subId": 1,
    "code": 301,
    "name": "서리 가시 피격"
  },
  {
    "id": 31,
    "subId": 0,
    "code": 310,
    "name": "암석 사격"
  },
  {
    "id": 31,
    "subId": 1,
    "code": 311,
    "name": "암석 사격 피격"
  },
  {
    "id": 32,
    "subId": 0,
    "code": 320,
    "name": "정의의 검"
  },
  {
    "id": 33,
    "subId": 0,
    "code": 330,
    "name": "암흑 구체"
  },
  {
    "id": 34,
    "subId": 0,
    "code": 340,
    "name": "빙결 강타"
  },
  {
    "id": 35,
    "subId": 0,
    "code": 350,
    "name": "화염 소용돌이"
  },
  {
    "id": 36,
    "subId": 0,
    "code": 360,
    "name": "얼음의 사역마"
  },
  {
    "id": 36,
    "subId": 1,
    "code": 361,
    "name": "얼음의 사역마 폭발"
  },
  {
    "id": 37,
    "subId": 0,
    "code": 370,
    "name": "플라즈마 보호막"
  },
  {
    "id": 38,
    "subId": 0,
    "code": 380,
    "name": "니플헤임 검술"
  },
  {
    "id": 39,
    "subId": 0,
    "code": 390,
    "name": "얼음의 정령"
  },
  {
    "id": 40,
    "subId": 0,
    "code": 400,
    "name": "공간 균열"
  },
  {
    "id": 41,
    "subId": 0,
    "code": 410,
    "name": "피 방출"
  },
  {
    "id": 41,
    "subId": 1,
    "code": 411,
    "name": "피 방출"
  },
  {
    "id": 42,
    "subId": 0,
    "code": 420,
    "name": "얼음 화살"
  },
  {
    "id": 42,
    "subId": 1,
    "code": 421,
    "name": "얼음 화살 폭발"
  },
  {
    "id": 43,
    "subId": 0,
    "code": 430,
    "name": "폭발 구슬"
  },
  {
    "id": 43,
    "subId": 1,
    "code": 431,
    "name": "폭발 구슬 폭발"
  },
  {
    "id": 44,
    "subId": 0,
    "code": 440,
    "name": "아이스 브라이트 소드"
  },
  {
    "id": 45,
    "subId": 0,
    "code": 450,
    "name": "작열검"
  },
  {
    "id": 46,
    "subId": 0,
    "code": 460,
    "name": "스핀 소드"
  },
  {
    "id": 47,
    "subId": 0,
    "code": 470,
    "name": "용의 오의"
  },
  {
    "id": 48,
    "subId": 0,
    "code": 480,
    "name": "피의 검격"
  },
  {
    "id": 49,
    "subId": 0,
    "code": 490,
    "name": "점화"
  },
  {
    "id": 49,
    "subId": 1,
    "code": 491,
    "name": "점화 피격"
  },
  {
    "id": 50,
    "subId": 0,
    "code": 500,
    "name": "사격 드론"
  },
  {
    "id": 51,
    "subId": 0,
    "code": 510,
    "name": "초 강타"
  },
  {
    "id": 52,
    "subId": 0,
    "code": 520,
    "name": "회오리 화살"
  },
  {
    "id": 52,
    "subId": 1,
    "code": 521,
    "name": "회오리 화살 분리"
  },
  {
    "id": 53,
    "subId": 0,
    "code": 530,
    "name": "번개 찌르기"
  },
  {
    "id": 54,
    "subId": 0,
    "code": 540,
    "name": "섬광"
  },
  {
    "id": 54,
    "subId": 1,
    "code": 541,
    "name": "섬광 추가 폭발"
  },
  {
    "id": 55,
    "subId": 0,
    "code": 550,
    "name": "펄스 폭탄"
  },
  {
    "id": 55,
    "subId": 1,
    "code": 551,
    "name": "펄스 폭탄 폭발"
  },
  {
    "id": 56,
    "subId": 0,
    "code": 560,
    "name": "심연의 악마"
  },
  {
    "id": 56,
    "subId": 1,
    "code": 561,
    "name": "심연의 악마 투사체"
  },
  {
    "id": 57,
    "subId": 0,
    "code": 570,
    "name": "정화의 천사"
  },
  {
    "id": 57,
    "subId": 1,
    "code": 571,
    "name": "정화의 천사 빔"
  },
  {
    "id": 58,
    "subId": 0,
    "code": 580,
    "name": "바늘 투척"
  },
  {
    "id": 59,
    "subId": 0,
    "code": 590,
    "name": "화염창"
  },
  {
    "id": 60,
    "subId": 0,
    "code": 600,
    "name": "독두꺼비 소환"
  },
  {
    "id": 60,
    "subId": 1,
    "code": 601,
    "name": "독두꺼비 투사체"
  },
  {
    "id": 61,
    "subId": 0,
    "code": 610,
    "name": "일섬"
  },
  {
    "id": 62,
    "subId": 0,
    "code": 620,
    "name": "붉은 손길"
  },
  {
    "id": 63,
    "subId": 0,
    "code": 630,
    "name": "플레임 헤이즈"
  },
  {
    "id": 63,
    "subId": 1,
    "code": 631,
    "name": "플레임 헤이즈 폭발"
  },
  {
    "id": 64,
    "subId": 0,
    "code": 640,
    "name": "불 비 화살"
  },
  {
    "id": 65,
    "subId": 0,
    "code": 650,
    "name": "죽음의 낙인"
  },
  {
    "id": 66,
    "subId": 0,
    "code": 660,
    "name": "광휘의 낙인"
  },
  {
    "id": 67,
    "subId": 0,
    "code": 670,
    "name": "출혈의 낙인"
  },
  {
    "id": 68,
    "subId": 0,
    "code": 680,
    "name": "빙하의 보호막"
  },
  {
    "id": 69,
    "subId": 0,
    "code": 690,
    "name": "태양의 보주"
  },
  {
    "id": 69,
    "subId": 1,
    "code": 691,
    "name": "태양의 보주 폭발"
  },
  {
    "id": 70,
    "subId": 0,
    "code": 700,
    "name": "선인장 폭탄"
  },
  {
    "id": 71,
    "subId": 0,
    "code": 710,
    "name": "깨물어 부수기"
  },
  {
    "id": 72,
    "subId": 0,
    "code": 720,
    "name": "핏빛 비"
  },
  {
    "id": 73,
    "subId": 0,
    "code": 730,
    "name": "피의 창"
  },
  {
    "id": 74,
    "subId": 0,
    "code": 740,
    "name": "암살"
  },
  {
    "id": 75,
    "subId": 0,
    "code": 750,
    "name": "수호의 방패"
  },
  {
    "id": 76,
    "subId": 0,
    "code": 760,
    "name": "심해 처형"
  },
  {
    "id": 77,
    "subId": 0,
    "code": 770,
    "name": "쏟아지는 부적"
  },
  {
    "id": 78,
    "subId": 0,
    "code": 780,
    "name": "불의 용찬"
  },
  {
    "id": 79,
    "subId": 0,
    "code": 790,
    "name": "대지 정령"
  },
  {
    "id": 80,
    "subId": 0,
    "code": 800,
    "name": "영혼의 그릇"
  },
  {
    "id": 81,
    "subId": 0,
    "code": 810,
    "name": "모래 가시"
  },
  {
    "id": 82,
    "subId": 0,
    "code": 820,
    "name": "마력 광선"
  },
  {
    "id": 83,
    "subId": 0,
    "code": 830,
    "name": "모래 보호막"
  },
  {
    "id": 84,
    "subId": 0,
    "code": 840,
    "name": "사막의 소용돌이"
  },
  {
    "id": 85,
    "subId": 0,
    "code": 850,
    "name": "죽음의 연쇄"
  },
  {
    "id": 86,
    "subId": 0,
    "code": 860,
    "name": "희생의 말뚝"
  },
  {
    "id": 87,
    "subId": 0,
    "code": 870,
    "name": "불사의 계약"
  },
  {
    "id": 88,
    "subId": 0,
    "code": 880,
    "name": "모래 화살"
  },
  {
    "id": 89,
    "subId": 0,
    "code": 890,
    "name": "모래 병사"
  },
  {
    "id": 90,
    "subId": 0,
    "code": 900,
    "name": "계약 선인장"
  },
  {
    "id": 91,
    "subId": 0,
    "code": 910,
    "name": "맹독의 낙인"
  },
  {
    "id": 92,
    "subId": 0,
    "code": 920,
    "name": "출혈 강타"
  },
  {
    "id": 93,
    "subId": 0,
    "code": 930,
    "name": "냉기 강타"
  },
  {
    "id": 94,
    "subId": 0,
    "code": 940,
    "name": "암흑 강타"
  },
  {
    "id": 95,
    "subId": 0,
    "code": 950,
    "name": "독 강타"
  },
  {
    "id": 96,
    "subId": 0,
    "code": 960,
    "name": "화염 강타"
  },
  {
    "id": 97,
    "subId": 0,
    "code": 970,
    "name": "신성 강타"
  },
  {
    "id": 98,
    "subId": 0,
    "code": 980,
    "name": "번개 강타"
  },
  {
    "id": 99,
    "subId": 0,
    "code": 990,
    "name": "명계의 족쇄"
  },
  {
    "id": 100,
    "subId": 0,
    "code": 1000,
    "name": "서리 비늘 방패"
  },
  {
    "id": 101,
    "subId": 0,
    "code": 1010,
    "name": "항성 궤도"
  },
  {
    "id": 102,
    "subId": 0,
    "code": 1020,
    "name": "중력 폭탄"
  },
  {
    "id": 102,
    "subId": 1,
    "code": 1021,
    "name": "중력 폭탄 폭발"
  },
  {
    "id": 103,
    "subId": 0,
    "code": 1030,
    "name": "케미아의 조독술"
  },
  {
    "id": 104,
    "subId": 0,
    "code": 1040,
    "name": "끓는 불길"
  },
  {
    "id": 105,
    "subId": 0,
    "code": 1050,
    "name": "킬러비"
  }
]);

export const ARTIFACTS = Object.freeze([
  {
    "id": 0,
    "rank": "하급",
    "name": "문자가 새겨진 돌",
    "type": 0,
    "key": "0:0",
    "cursed": false
  },
  {
    "id": 1,
    "rank": "중급",
    "name": "별의 파편",
    "type": 0,
    "key": "0:1",
    "cursed": false
  },
  {
    "id": 2,
    "rank": "보스",
    "name": "횃대",
    "type": 0,
    "key": "0:2",
    "cursed": false
  },
  {
    "id": 3,
    "rank": "하급",
    "name": "부서진 뿔",
    "type": 0,
    "key": "0:3",
    "cursed": false
  },
  {
    "id": 4,
    "rank": "중급",
    "name": "마족의 뿔",
    "type": 0,
    "key": "0:4",
    "cursed": false
  },
  {
    "id": 5,
    "rank": "하급",
    "name": "피의 정수",
    "type": 0,
    "key": "0:5",
    "cursed": false
  },
  {
    "id": 6,
    "rank": "하급",
    "name": "깃털",
    "type": 0,
    "key": "0:6",
    "cursed": false
  },
  {
    "id": 7,
    "rank": "하급",
    "name": "혈액 플라스크",
    "type": 0,
    "key": "0:7",
    "cursed": false
  },
  {
    "id": 8,
    "rank": "중급",
    "name": "금빛 플라스크",
    "type": 0,
    "key": "0:8",
    "cursed": false
  },
  {
    "id": 9,
    "rank": "상급",
    "name": "검은빛 플라스크",
    "type": 0,
    "key": "0:9",
    "cursed": false
  },
  {
    "id": 10,
    "rank": "보스",
    "name": "카드키",
    "type": 0,
    "key": "0:10",
    "cursed": false
  },
  {
    "id": 11,
    "rank": "특급",
    "name": "데드맨 지휘관의 뿔피리",
    "type": 0,
    "key": "0:11",
    "cursed": false
  },
  {
    "id": 12,
    "rank": "보스",
    "name": "여신의 눈물",
    "type": 0,
    "key": "0:12",
    "cursed": false
  },
  {
    "id": 13,
    "rank": "보스",
    "name": "용사의 의지",
    "type": 0,
    "key": "0:13",
    "cursed": false
  },
  {
    "id": 14,
    "rank": "하급",
    "name": "하얀 가면",
    "type": 0,
    "key": "0:14",
    "cursed": false
  },
  {
    "id": 15,
    "rank": "하급",
    "name": "해골 머리",
    "type": 0,
    "key": "0:15",
    "cursed": false
  },
  {
    "id": 16,
    "rank": "중급",
    "name": "파워건틀렛",
    "type": 0,
    "key": "0:16",
    "cursed": false
  },
  {
    "id": 17,
    "rank": "하급",
    "name": "찢어진 일지 I",
    "type": 0,
    "key": "0:17",
    "cursed": false
  },
  {
    "id": 18,
    "rank": "하급",
    "name": "찢어진 일지 II",
    "type": 0,
    "key": "0:18",
    "cursed": false
  },
  {
    "id": 19,
    "rank": "중급",
    "name": "찢어진 일지 III",
    "type": 0,
    "key": "0:19",
    "cursed": false
  },
  {
    "id": 20,
    "rank": "상급",
    "name": "찢어진 일지 IV",
    "type": 0,
    "key": "0:20",
    "cursed": false
  },
  {
    "id": 21,
    "rank": "특급",
    "name": "찢어진 일지 V",
    "type": 0,
    "key": "0:21",
    "cursed": false
  },
  {
    "id": 22,
    "rank": "상급",
    "name": "부유석",
    "type": 0,
    "key": "0:22",
    "cursed": false
  },
  {
    "id": 23,
    "rank": "하급",
    "name": "붕대",
    "type": 0,
    "key": "0:23",
    "cursed": false
  },
  {
    "id": 24,
    "rank": "특급",
    "name": "신비로운 나뭇가지",
    "type": 0,
    "key": "0:24",
    "cursed": false
  },
  {
    "id": 25,
    "rank": "하급",
    "name": "은화",
    "type": 0,
    "key": "0:25",
    "cursed": false
  },
  {
    "id": 26,
    "rank": "중급",
    "name": "기계팔",
    "type": 0,
    "key": "0:26",
    "cursed": false
  },
  {
    "id": 27,
    "rank": "하급",
    "name": "용의 인장",
    "type": 0,
    "key": "0:27",
    "cursed": false
  },
  {
    "id": 28,
    "rank": "중급",
    "name": "용의 눈",
    "type": 0,
    "key": "0:28",
    "cursed": false
  },
  {
    "id": 29,
    "rank": "중급",
    "name": "주사위",
    "type": 0,
    "key": "0:29",
    "cursed": false
  },
  {
    "id": 30,
    "rank": "상급",
    "name": "신의 주사위",
    "type": 0,
    "key": "0:30",
    "cursed": false
  },
  {
    "id": 31,
    "rank": "중급",
    "name": "마법의 양피지",
    "type": 0,
    "key": "0:31",
    "cursed": false
  },
  {
    "id": 32,
    "rank": "하급",
    "name": "부숴진 견갑",
    "type": 0,
    "key": "0:32",
    "cursed": false
  },
  {
    "id": 33,
    "rank": "상급",
    "name": "성배",
    "type": 0,
    "key": "0:33",
    "cursed": false
  },
  {
    "id": 34,
    "rank": "특급",
    "name": "금지된 성배",
    "type": 0,
    "key": "0:34",
    "cursed": false
  },
  {
    "id": 35,
    "rank": "상급",
    "name": "네크로노미콘",
    "type": 0,
    "key": "0:35",
    "cursed": false
  },
  {
    "id": 36,
    "rank": "하급",
    "name": "유리 조각",
    "type": 0,
    "key": "0:36",
    "cursed": false
  },
  {
    "id": 37,
    "rank": "하급",
    "name": "오염된 영혼석",
    "type": 0,
    "key": "0:37",
    "cursed": false
  },
  {
    "id": 38,
    "rank": "상급",
    "name": "마법의 배낭",
    "type": 0,
    "key": "0:38",
    "cursed": false
  },
  {
    "id": 39,
    "rank": "중급",
    "name": "수상한 얼음 조각",
    "type": 0,
    "key": "0:39",
    "cursed": false
  },
  {
    "id": 40,
    "rank": "하급",
    "name": "석탄",
    "type": 0,
    "key": "0:40",
    "cursed": false
  },
  {
    "id": 41,
    "rank": "중급",
    "name": "견고한 갑옷",
    "type": 0,
    "key": "0:41",
    "cursed": false
  },
  {
    "id": 42,
    "rank": "상급",
    "name": "신비로운 푸른 약물",
    "type": 0,
    "key": "0:42",
    "cursed": false
  },
  {
    "id": 43,
    "rank": "하급",
    "name": "얼어붙은 건틀렛",
    "type": 0,
    "key": "0:43",
    "cursed": false
  },
  {
    "id": 44,
    "rank": "상급",
    "name": "고행자의 금화",
    "type": 0,
    "key": "0:44",
    "cursed": false
  },
  {
    "id": 45,
    "rank": "하급",
    "name": "곰팡이 버섯",
    "type": 0,
    "key": "0:45",
    "cursed": false
  },
  {
    "id": 46,
    "rank": "하급",
    "name": "독버섯",
    "type": 0,
    "key": "0:46",
    "cursed": false
  },
  {
    "id": 47,
    "rank": "하급",
    "name": "세포 핵",
    "type": 0,
    "key": "0:47",
    "cursed": false
  },
  {
    "id": 48,
    "rank": "하급",
    "name": "해진 머플러",
    "type": 0,
    "key": "0:48",
    "cursed": false
  },
  {
    "id": 49,
    "rank": "상급",
    "name": "몰락한 왕가의 휘장",
    "type": 0,
    "key": "0:49",
    "cursed": false
  },
  {
    "id": 50,
    "rank": "보스",
    "name": "양초",
    "type": 0,
    "key": "0:50",
    "cursed": false
  },
  {
    "id": 51,
    "rank": "보스",
    "name": "저주받은 인장",
    "type": 0,
    "key": "0:51",
    "cursed": false
  },
  {
    "id": 52,
    "rank": "보스",
    "name": "피로 얼룩진 십자가",
    "type": 0,
    "key": "0:52",
    "cursed": false
  },
  {
    "id": 53,
    "rank": "보스",
    "name": "사형집행인의 일지",
    "type": 0,
    "key": "0:53",
    "cursed": false
  },
  {
    "id": 54,
    "rank": "중급",
    "name": "피뢰침",
    "type": 0,
    "key": "0:54",
    "cursed": false
  },
  {
    "id": 55,
    "rank": "상급",
    "name": "네 망치 클로버",
    "type": 0,
    "key": "0:55",
    "cursed": false
  },
  {
    "id": 56,
    "rank": "하급",
    "name": "뱀술",
    "type": 0,
    "key": "0:56",
    "cursed": false
  },
  {
    "id": 57,
    "rank": "중급",
    "name": "히드라의 이빨",
    "type": 0,
    "key": "0:57",
    "cursed": false
  },
  {
    "id": 58,
    "rank": "하급",
    "name": "숟가락",
    "type": 0,
    "key": "0:58",
    "cursed": false
  },
  {
    "id": 59,
    "rank": "상급",
    "name": "반응장갑",
    "type": 0,
    "key": "0:59",
    "cursed": false
  },
  {
    "id": 60,
    "rank": "하급",
    "name": "룬문자 'F'",
    "type": 0,
    "key": "0:60",
    "cursed": false
  },
  {
    "id": 61,
    "rank": "하급",
    "name": "장작",
    "type": 0,
    "key": "0:61",
    "cursed": false
  },
  {
    "id": 62,
    "rank": "하급",
    "name": "나무 썰매",
    "type": 0,
    "key": "0:62",
    "cursed": false
  },
  {
    "id": 63,
    "rank": "하급",
    "name": "행복한 눈사람",
    "type": 0,
    "key": "0:63",
    "cursed": false
  },
  {
    "id": 64,
    "rank": "하급",
    "name": "광기의 물약",
    "type": 0,
    "key": "0:64",
    "cursed": false
  },
  {
    "id": 65,
    "rank": "하급",
    "name": "마녀의 교본",
    "type": 0,
    "key": "0:65",
    "cursed": false
  },
  {
    "id": 66,
    "rank": "특급",
    "name": "녹아내린 두개골",
    "type": 0,
    "key": "0:66",
    "cursed": false
  },
  {
    "id": 67,
    "rank": "중급",
    "name": "도마뱀 꼬치",
    "type": 0,
    "key": "0:67",
    "cursed": false
  },
  {
    "id": 68,
    "rank": "중급",
    "name": "얼음 결정",
    "type": 0,
    "key": "0:68",
    "cursed": false
  },
  {
    "id": 69,
    "rank": "하급",
    "name": "각얼음",
    "type": 0,
    "key": "0:69",
    "cursed": false
  },
  {
    "id": 70,
    "rank": "상급",
    "name": "요술봉",
    "type": 0,
    "key": "0:70",
    "cursed": false
  },
  {
    "id": 71,
    "rank": "중급",
    "name": "용암 한 컵",
    "type": 0,
    "key": "0:71",
    "cursed": false
  },
  {
    "id": 72,
    "rank": "중급",
    "name": "코일",
    "type": 0,
    "key": "0:72",
    "cursed": false
  },
  {
    "id": 73,
    "rank": "상급",
    "name": "소형 태양",
    "type": 0,
    "key": "0:73",
    "cursed": false
  },
  {
    "id": 74,
    "rank": "상급",
    "name": "소환 주문서",
    "type": 0,
    "key": "0:74",
    "cursed": false
  },
  {
    "id": 75,
    "rank": "특급",
    "name": "금술 : 소환 두루마리",
    "type": 0,
    "key": "0:75",
    "cursed": false
  },
  {
    "id": 76,
    "rank": "하급",
    "name": "독주머니",
    "type": 0,
    "key": "0:76",
    "cursed": false
  },
  {
    "id": 77,
    "rank": "상급",
    "name": "조준경",
    "type": 0,
    "key": "0:77",
    "cursed": false
  },
  {
    "id": 78,
    "rank": "하급",
    "name": "독침",
    "type": 0,
    "key": "0:78",
    "cursed": false
  },
  {
    "id": 79,
    "rank": "하급",
    "name": "포자",
    "type": 0,
    "key": "0:79",
    "cursed": false
  },
  {
    "id": 80,
    "rank": "중급",
    "name": "식물의 씨앗",
    "type": 0,
    "key": "0:80",
    "cursed": false
  },
  {
    "id": 81,
    "rank": "보스",
    "name": "마녀의 뿔",
    "type": 0,
    "key": "0:81",
    "cursed": false
  },
  {
    "id": 82,
    "rank": "상급",
    "name": "갈망하는 덩굴",
    "type": 0,
    "key": "0:82",
    "cursed": false
  },
  {
    "id": 83,
    "rank": "하급",
    "name": "정체모를 지팡이",
    "type": 0,
    "key": "0:83",
    "cursed": false
  },
  {
    "id": 84,
    "rank": "특급",
    "name": "펠런의 문양",
    "type": 0,
    "key": "0:84",
    "cursed": false
  },
  {
    "id": 85,
    "rank": "하급",
    "name": "병사의 인장",
    "type": 0,
    "key": "0:85",
    "cursed": false
  },
  {
    "id": 86,
    "rank": "중급",
    "name": "니플헤임의 상징",
    "type": 0,
    "key": "0:86",
    "cursed": false
  },
  {
    "id": 87,
    "rank": "하급",
    "name": "불길한 파편",
    "type": 0,
    "key": "0:87",
    "cursed": false
  },
  {
    "id": 88,
    "rank": "특급",
    "name": "푸른 성해포",
    "type": 0,
    "key": "0:88",
    "cursed": false
  },
  {
    "id": 89,
    "rank": "하급",
    "name": "쿠폰",
    "type": 0,
    "key": "0:89",
    "cursed": false
  },
  {
    "id": 90,
    "rank": "상급",
    "name": "신비한 알",
    "type": 0,
    "key": "0:90",
    "cursed": false
  },
  {
    "id": 91,
    "rank": "특급",
    "name": "초대 용사의 일지",
    "type": 0,
    "key": "0:91",
    "cursed": false
  },
  {
    "id": 92,
    "rank": "하급",
    "name": "해진 판쵸",
    "type": 0,
    "key": "0:92",
    "cursed": false
  },
  {
    "id": 93,
    "rank": "중급",
    "name": "붉은색 판쵸",
    "type": 0,
    "key": "0:93",
    "cursed": false
  },
  {
    "id": 94,
    "rank": "하급",
    "name": "수리검",
    "type": 0,
    "key": "0:94",
    "cursed": false
  },
  {
    "id": 95,
    "rank": "하급",
    "name": "식칼",
    "type": 0,
    "key": "0:95",
    "cursed": false
  },
  {
    "id": 96,
    "rank": "중급",
    "name": "신비로운 카드",
    "type": 0,
    "key": "0:96",
    "cursed": false
  },
  {
    "id": 97,
    "rank": "하급",
    "name": "악마의 눈",
    "type": 0,
    "key": "0:97",
    "cursed": false
  },
  {
    "id": 98,
    "rank": "하급",
    "name": "불완전한 보호막",
    "type": 0,
    "key": "0:98",
    "cursed": false
  },
  {
    "id": 99,
    "rank": "중급",
    "name": "휴대용 스테이크",
    "type": 0,
    "key": "0:99",
    "cursed": false
  },
  {
    "id": 100,
    "rank": "상급",
    "name": "의료상자",
    "type": 0,
    "key": "0:100",
    "cursed": false
  },
  {
    "id": 101,
    "rank": "하급",
    "name": "금괴",
    "type": 0,
    "key": "0:101",
    "cursed": false
  },
  {
    "id": 102,
    "rank": "하급",
    "name": "강철 장화",
    "type": 0,
    "key": "0:102",
    "cursed": false
  },
  {
    "id": 103,
    "rank": "하급",
    "name": "행운의 동전",
    "type": 0,
    "key": "0:103",
    "cursed": false
  },
  {
    "id": 104,
    "rank": "상급",
    "name": "이상한 신의 가면",
    "type": 0,
    "key": "0:104",
    "cursed": false
  },
  {
    "id": 105,
    "rank": "중급",
    "name": "보호막 충전소",
    "type": 0,
    "key": "0:105",
    "cursed": false
  },
  {
    "id": 106,
    "rank": "하급",
    "name": "찢어진 깃발",
    "type": 0,
    "key": "0:106",
    "cursed": false
  },
  {
    "id": 107,
    "rank": "하급",
    "name": "썩은 알",
    "type": 0,
    "key": "0:107",
    "cursed": false
  },
  {
    "id": 108,
    "rank": "중급",
    "name": "성스러운 석판",
    "type": 0,
    "key": "0:108",
    "cursed": false
  },
  {
    "id": 109,
    "rank": "중급",
    "name": "헤르메스의 장화",
    "type": 0,
    "key": "0:109",
    "cursed": false
  },
  {
    "id": 110,
    "rank": "상급",
    "name": "숨겨진 칼날",
    "type": 0,
    "key": "0:110",
    "cursed": false
  },
  {
    "id": 111,
    "rank": "하급",
    "name": "아기 두꺼비",
    "type": 0,
    "key": "0:111",
    "cursed": false
  },
  {
    "id": 112,
    "rank": "하급",
    "name": "두꺼비 액체",
    "type": 0,
    "key": "0:112",
    "cursed": false
  },
  {
    "id": 113,
    "rank": "하급",
    "name": "붉은 보석 파편",
    "type": 0,
    "key": "0:113",
    "cursed": false
  },
  {
    "id": 114,
    "rank": "하급",
    "name": "수통",
    "type": 0,
    "key": "0:114",
    "cursed": false
  },
  {
    "id": 115,
    "rank": "중급",
    "name": "",
    "type": 0,
    "key": "0:115",
    "cursed": false
  },
  {
    "id": 116,
    "rank": "상급",
    "name": "교단의 암살자 표식",
    "type": 0,
    "key": "0:116",
    "cursed": false
  },
  {
    "id": 117,
    "rank": "특급",
    "name": "날개의 증표",
    "type": 0,
    "key": "0:117",
    "cursed": false
  },
  {
    "id": 118,
    "rank": "하급",
    "name": "들짐승의 이빨",
    "type": 0,
    "key": "0:118",
    "cursed": false
  },
  {
    "id": 119,
    "rank": "하급",
    "name": "부족의 표식",
    "type": 0,
    "key": "0:119",
    "cursed": false
  },
  {
    "id": 120,
    "rank": "중급",
    "name": "저주의 낙인",
    "type": 0,
    "key": "0:120",
    "cursed": false
  },
  {
    "id": 121,
    "rank": "특급",
    "name": "저주받은 손톱",
    "type": 0,
    "key": "0:121",
    "cursed": false
  },
  {
    "id": 122,
    "rank": "하급",
    "name": "눈덩이",
    "type": 0,
    "key": "0:122",
    "cursed": false
  },
  {
    "id": 123,
    "rank": "중급",
    "name": "붉은 악마의 계약",
    "type": 0,
    "key": "0:123",
    "cursed": false
  },
  {
    "id": 124,
    "rank": "중급",
    "name": "영혼 부적",
    "type": 0,
    "key": "0:124",
    "cursed": false
  },
  {
    "id": 125,
    "rank": "중급",
    "name": "영혼 호루라기",
    "type": 0,
    "key": "0:125",
    "cursed": false
  },
  {
    "id": 126,
    "rank": "하급",
    "name": "돌",
    "type": 0,
    "key": "0:126",
    "cursed": false
  },
  {
    "id": 127,
    "rank": "하급",
    "name": "숫돌",
    "type": 0,
    "key": "0:127",
    "cursed": false
  },
  {
    "id": 128,
    "rank": "하급",
    "name": "나막신",
    "type": 0,
    "key": "0:128",
    "cursed": false
  },
  {
    "id": 129,
    "rank": "특급",
    "name": "얼어붙은 가지",
    "type": 0,
    "key": "0:129",
    "cursed": false
  },
  {
    "id": 130,
    "rank": "중급",
    "name": "얼음 조각",
    "type": 0,
    "key": "0:130",
    "cursed": false
  },
  {
    "id": 131,
    "rank": "상급",
    "name": "세리나의 깃털",
    "type": 0,
    "key": "0:131",
    "cursed": false
  },
  {
    "id": 132,
    "rank": "하급",
    "name": "부패한 고기",
    "type": 0,
    "key": "0:132",
    "cursed": false
  },
  {
    "id": 133,
    "rank": "중급",
    "name": "부활절 달걀",
    "type": 0,
    "key": "0:133",
    "cursed": false
  },
  {
    "id": 134,
    "rank": "상급",
    "name": "폭탄마의 가방",
    "type": 0,
    "key": "0:134",
    "cursed": false
  },
  {
    "id": 135,
    "rank": "중급",
    "name": "지뢰",
    "type": 0,
    "key": "0:135",
    "cursed": false
  },
  {
    "id": 136,
    "rank": "하급",
    "name": "칼날 부채",
    "type": 0,
    "key": "0:136",
    "cursed": false
  },
  {
    "id": 137,
    "rank": "하급",
    "name": "땅콩",
    "type": 0,
    "key": "0:137",
    "cursed": false
  },
  {
    "id": 138,
    "rank": "하급",
    "name": "깃털펜",
    "type": 0,
    "key": "0:138",
    "cursed": false
  },
  {
    "id": 139,
    "rank": "하급",
    "name": "깃털 부채",
    "type": 0,
    "key": "0:139",
    "cursed": false
  },
  {
    "id": 140,
    "rank": "중급",
    "name": "칼날 망토",
    "type": 0,
    "key": "0:140",
    "cursed": false
  },
  {
    "id": 141,
    "rank": "중급",
    "name": "두꺼운 망토",
    "type": 0,
    "key": "0:141",
    "cursed": false
  },
  {
    "id": 142,
    "rank": "하급",
    "name": "부숴진 완갑",
    "type": 0,
    "key": "0:142",
    "cursed": false
  },
  {
    "id": 143,
    "rank": "특급",
    "name": "붉은 강철의 완갑",
    "type": 0,
    "key": "0:143",
    "cursed": false
  },
  {
    "id": 144,
    "rank": "하급",
    "name": "프라이팬",
    "type": 0,
    "key": "0:144",
    "cursed": false
  },
  {
    "id": 145,
    "rank": "중급",
    "name": "전쟁 깃발",
    "type": 0,
    "key": "0:145",
    "cursed": false
  },
  {
    "id": 146,
    "rank": "하급",
    "name": "서리부족의 징표",
    "type": 0,
    "key": "0:146",
    "cursed": false
  },
  {
    "id": 147,
    "rank": "중급",
    "name": "가시 장갑",
    "type": 0,
    "key": "0:147",
    "cursed": false
  },
  {
    "id": 148,
    "rank": "하급",
    "name": "고대의 석판",
    "type": 0,
    "key": "0:148",
    "cursed": false
  },
  {
    "id": 149,
    "rank": "하급",
    "name": "용사의 석상",
    "type": 0,
    "key": "0:149",
    "cursed": false
  },
  {
    "id": 150,
    "rank": "하급",
    "name": "말굽 자석",
    "type": 0,
    "key": "0:150",
    "cursed": false
  },
  {
    "id": 151,
    "rank": "중급",
    "name": "얼어붙은 과일",
    "type": 0,
    "key": "0:151",
    "cursed": false
  },
  {
    "id": 152,
    "rank": "하급",
    "name": "독 묻은 화살",
    "type": 0,
    "key": "0:152",
    "cursed": false
  },
  {
    "id": 153,
    "rank": "하급",
    "name": "불타버린 휘장",
    "type": 0,
    "key": "0:153",
    "cursed": false
  },
  {
    "id": 154,
    "rank": "상급",
    "name": "저격수의 망토",
    "type": 0,
    "key": "0:154",
    "cursed": false
  },
  {
    "id": 155,
    "rank": "상급",
    "name": "재의 검",
    "type": 0,
    "key": "0:155",
    "cursed": false
  },
  {
    "id": 156,
    "rank": "하급",
    "name": "피의 계약자",
    "type": 0,
    "key": "0:156",
    "cursed": false
  },
  {
    "id": 157,
    "rank": "하급",
    "name": "간단한 열쇠",
    "type": 0,
    "key": "0:157",
    "cursed": false
  },
  {
    "id": 158,
    "rank": "상급",
    "name": "얼음의 창",
    "type": 0,
    "key": "0:158",
    "cursed": false
  },
  {
    "id": 159,
    "rank": "하급",
    "name": "니플헤임의 동전",
    "type": 0,
    "key": "0:159",
    "cursed": false
  },
  {
    "id": 160,
    "rank": "중급",
    "name": "니플헤임의 은화",
    "type": 0,
    "key": "0:160",
    "cursed": false
  },
  {
    "id": 161,
    "rank": "상급",
    "name": "니플헤임의 금화",
    "type": 0,
    "key": "0:161",
    "cursed": false
  },
  {
    "id": 162,
    "rank": "중급",
    "name": "충의의 상징",
    "type": 0,
    "key": "0:162",
    "cursed": false
  },
  {
    "id": 163,
    "rank": "중급",
    "name": "새벽의 이슬",
    "type": 0,
    "key": "0:163",
    "cursed": false
  },
  {
    "id": 164,
    "rank": "하급",
    "name": "운석 파편",
    "type": 0,
    "key": "0:164",
    "cursed": false
  },
  {
    "id": 165,
    "rank": "특급",
    "name": "불사의 영약",
    "type": 0,
    "key": "0:165",
    "cursed": false
  },
  {
    "id": 166,
    "rank": "특급",
    "name": "저주받은 구슬",
    "type": 0,
    "key": "0:166",
    "cursed": false
  },
  {
    "id": 167,
    "rank": "하급",
    "name": "뼛 조각",
    "type": 0,
    "key": "0:167",
    "cursed": false
  },
  {
    "id": 168,
    "rank": "중급",
    "name": "얼음꽃",
    "type": 0,
    "key": "0:168",
    "cursed": false
  },
  {
    "id": 169,
    "rank": "상급",
    "name": "영원의 꽃",
    "type": 0,
    "key": "0:169",
    "cursed": false
  },
  {
    "id": 170,
    "rank": "특급",
    "name": "저주받은 불사의 검",
    "type": 0,
    "key": "0:170",
    "cursed": false
  },
  {
    "id": 171,
    "rank": "중급",
    "name": "수호의 쇠사슬",
    "type": 0,
    "key": "0:171",
    "cursed": false
  },
  {
    "id": 172,
    "rank": "중급",
    "name": "결계석",
    "type": 0,
    "key": "0:172",
    "cursed": false
  },
  {
    "id": 173,
    "rank": "하급",
    "name": "부품",
    "type": 0,
    "key": "0:173",
    "cursed": false
  },
  {
    "id": 174,
    "rank": "하급",
    "name": "A-0507 Mk.1",
    "type": 0,
    "key": "0:174",
    "cursed": false
  },
  {
    "id": 175,
    "rank": "중급",
    "name": "A-0507 Mk.2",
    "type": 0,
    "key": "0:175",
    "cursed": false
  },
  {
    "id": 176,
    "rank": "상급",
    "name": "A-0507 Mk.3",
    "type": 0,
    "key": "0:176",
    "cursed": false
  },
  {
    "id": 177,
    "rank": "특급",
    "name": "A-0507 Mk.4",
    "type": 0,
    "key": "0:177",
    "cursed": false
  },
  {
    "id": 178,
    "rank": "특급",
    "name": "A-0507 Mk.5",
    "type": 0,
    "key": "0:178",
    "cursed": false
  },
  {
    "id": 179,
    "rank": "특급",
    "name": "불타는 검",
    "type": 0,
    "key": "0:179",
    "cursed": false
  },
  {
    "id": 180,
    "rank": "상급",
    "name": "왕의 그릇",
    "type": 0,
    "key": "0:180",
    "cursed": false
  },
  {
    "id": 181,
    "rank": "상급",
    "name": "지하감옥 열쇠",
    "type": 0,
    "key": "0:181",
    "cursed": false
  },
  {
    "id": 182,
    "rank": "하급",
    "name": "동경의 빛",
    "type": 0,
    "key": "0:182",
    "cursed": false
  },
  {
    "id": 183,
    "rank": "보스",
    "name": "유성창의 파편",
    "type": 0,
    "key": "0:183",
    "cursed": false
  },
  {
    "id": 184,
    "rank": "하급",
    "name": "복수의 불꽃",
    "type": 0,
    "key": "0:184",
    "cursed": false
  },
  {
    "id": 185,
    "rank": "중급",
    "name": "욕망의 항아리",
    "type": 0,
    "key": "0:185",
    "cursed": false
  },
  {
    "id": 186,
    "rank": "특급",
    "name": "망자의 불꽃",
    "type": 0,
    "key": "0:186",
    "cursed": false
  },
  {
    "id": 187,
    "rank": "상급",
    "name": "판도라의 상자",
    "type": 0,
    "key": "0:187",
    "cursed": false
  },
  {
    "id": 188,
    "rank": "중급",
    "name": "영구 장치",
    "type": 0,
    "key": "0:188",
    "cursed": false
  },
  {
    "id": 189,
    "rank": "상급",
    "name": "타락한자의 왕관",
    "type": 0,
    "key": "0:189",
    "cursed": false
  },
  {
    "id": 190,
    "rank": "하급",
    "name": "푸른 불꽃이 담긴 병",
    "type": 0,
    "key": "0:190",
    "cursed": false
  },
  {
    "id": 191,
    "rank": "하급",
    "name": "망고",
    "type": 0,
    "key": "0:191",
    "cursed": false
  },
  {
    "id": 192,
    "rank": "하급",
    "name": "감시자의 눈",
    "type": 0,
    "key": "0:192",
    "cursed": false
  },
  {
    "id": 193,
    "rank": "상급",
    "name": "시간의 파편",
    "type": 0,
    "key": "0:193",
    "cursed": false
  },
  {
    "id": 194,
    "rank": "특급",
    "name": "영웅의 주사위",
    "type": 0,
    "key": "0:194",
    "cursed": false
  },
  {
    "id": 195,
    "rank": "상급",
    "name": "영웅의 별",
    "type": 0,
    "key": "0:195",
    "cursed": false
  },
  {
    "id": 196,
    "rank": "중급",
    "name": "귤",
    "type": 0,
    "key": "0:196",
    "cursed": false
  },
  {
    "id": 197,
    "rank": "하급",
    "name": "용인의 뿔",
    "type": 0,
    "key": "0:197",
    "cursed": false
  },
  {
    "id": 198,
    "rank": "중급",
    "name": "잔불",
    "type": 0,
    "key": "0:198",
    "cursed": false
  },
  {
    "id": 199,
    "rank": "하급",
    "name": "녹이 슨 금화",
    "type": 0,
    "key": "0:199",
    "cursed": false
  },
  {
    "id": 200,
    "rank": "상급",
    "name": "암살자의 사망선고",
    "type": 0,
    "key": "0:200",
    "cursed": false
  },
  {
    "id": 201,
    "rank": "중급",
    "name": "양자리",
    "type": 0,
    "key": "0:201",
    "cursed": false
  },
  {
    "id": 202,
    "rank": "중급",
    "name": "황금 송진",
    "type": 0,
    "key": "0:202",
    "cursed": false
  },
  {
    "id": 203,
    "rank": "중급",
    "name": "목탄 송진",
    "type": 0,
    "key": "0:203",
    "cursed": false
  },
  {
    "id": 204,
    "rank": "중급",
    "name": "청백 송진",
    "type": 0,
    "key": "0:204",
    "cursed": false
  },
  {
    "id": 205,
    "rank": "중급",
    "name": "썩은 송진",
    "type": 0,
    "key": "0:205",
    "cursed": false
  },
  {
    "id": 206,
    "rank": "중급",
    "name": "붉은 송진",
    "type": 0,
    "key": "0:206",
    "cursed": false
  },
  {
    "id": 207,
    "rank": "중급",
    "name": "투척용 독 수리검",
    "type": 0,
    "key": "0:207",
    "cursed": false
  },
  {
    "id": 208,
    "rank": "상급",
    "name": "가시 갑옷",
    "type": 0,
    "key": "0:208",
    "cursed": false
  },
  {
    "id": 209,
    "rank": "하급",
    "name": "이끼 덩어리",
    "type": 0,
    "key": "0:209",
    "cursed": false
  },
  {
    "id": 210,
    "rank": "중급",
    "name": "해주석",
    "type": 0,
    "key": "0:210",
    "cursed": false
  },
  {
    "id": 211,
    "rank": "하급",
    "name": "찌릿 가루",
    "type": 0,
    "key": "0:211",
    "cursed": false
  },
  {
    "id": 212,
    "rank": "하급",
    "name": "목탄 가루",
    "type": 0,
    "key": "0:212",
    "cursed": false
  },
  {
    "id": 213,
    "rank": "하급",
    "name": "하얀 가루",
    "type": 0,
    "key": "0:213",
    "cursed": false
  },
  {
    "id": 214,
    "rank": "하급",
    "name": "녹색 가루",
    "type": 0,
    "key": "0:214",
    "cursed": false
  },
  {
    "id": 215,
    "rank": "하급",
    "name": "고깃덩이",
    "type": 0,
    "key": "0:215",
    "cursed": false
  },
  {
    "id": 216,
    "rank": "상급",
    "name": "검은 안대",
    "type": 0,
    "key": "0:216",
    "cursed": false
  },
  {
    "id": 217,
    "rank": "하급",
    "name": "루비 반지",
    "type": 0,
    "key": "0:217",
    "cursed": false
  },
  {
    "id": 218,
    "rank": "하급",
    "name": "등 푸른 목걸이",
    "type": 0,
    "key": "0:218",
    "cursed": false
  },
  {
    "id": 219,
    "rank": "상급",
    "name": "두번째 상자",
    "type": 0,
    "key": "0:219",
    "cursed": false
  },
  {
    "id": 220,
    "rank": "중급",
    "name": "일곱번째 편지",
    "type": 0,
    "key": "0:220",
    "cursed": false
  },
  {
    "id": 221,
    "rank": "하급",
    "name": "부러진 칼날",
    "type": 0,
    "key": "0:221",
    "cursed": false
  },
  {
    "id": 222,
    "rank": "중급",
    "name": "왕의 인장",
    "type": 0,
    "key": "0:222",
    "cursed": false
  },
  {
    "id": 223,
    "rank": "특급",
    "name": "보물 열쇠",
    "type": 0,
    "key": "0:223",
    "cursed": false
  },
  {
    "id": 224,
    "rank": "하급",
    "name": "별의 목걸이",
    "type": 0,
    "key": "0:224",
    "cursed": false
  },
  {
    "id": 225,
    "rank": "상급",
    "name": "불타는 화염의 망토",
    "type": 0,
    "key": "0:225",
    "cursed": false
  },
  {
    "id": 226,
    "rank": "하급",
    "name": "해골 병사의 은로켓",
    "type": 0,
    "key": "0:226",
    "cursed": false
  },
  {
    "id": 227,
    "rank": "상급",
    "name": "악마의 왼쪽 손",
    "type": 0,
    "key": "0:227",
    "cursed": false
  },
  {
    "id": 228,
    "rank": "하급",
    "name": "빛나는 안구",
    "type": 0,
    "key": "0:228",
    "cursed": false
  },
  {
    "id": 229,
    "rank": "중급",
    "name": "거대한 척추",
    "type": 0,
    "key": "0:229",
    "cursed": false
  },
  {
    "id": 230,
    "rank": "하급",
    "name": "미라 손",
    "type": 0,
    "key": "0:230",
    "cursed": false
  },
  {
    "id": 231,
    "rank": "하급",
    "name": "뼈각반",
    "type": 0,
    "key": "0:231",
    "cursed": false
  },
  {
    "id": 232,
    "rank": "하급",
    "name": "고성의 문짝",
    "type": 0,
    "key": "0:232",
    "cursed": false
  },
  {
    "id": 233,
    "rank": "하급",
    "name": "은 열쇠",
    "type": 0,
    "key": "0:233",
    "cursed": false
  },
  {
    "id": 234,
    "rank": "하급",
    "name": "오래된 열쇠",
    "type": 0,
    "key": "0:234",
    "cursed": false
  },
  {
    "id": 235,
    "rank": "중급",
    "name": "공허 물질",
    "type": 0,
    "key": "0:235",
    "cursed": false
  },
  {
    "id": 236,
    "rank": "하급",
    "name": "칼날의 목걸이",
    "type": 0,
    "key": "0:236",
    "cursed": false
  },
  {
    "id": 237,
    "rank": "상급",
    "name": "기계 부품",
    "type": 0,
    "key": "0:237",
    "cursed": false
  },
  {
    "id": 238,
    "rank": "하급",
    "name": "아름다운 만년필",
    "type": 0,
    "key": "0:238",
    "cursed": false
  },
  {
    "id": 239,
    "rank": "중급",
    "name": "호수의 보물",
    "type": 0,
    "key": "0:239",
    "cursed": false
  },
  {
    "id": 240,
    "rank": "하급",
    "name": "커피콩",
    "type": 0,
    "key": "0:240",
    "cursed": false
  },
  {
    "id": 241,
    "rank": "하급",
    "name": "체스 룩",
    "type": 0,
    "key": "0:241",
    "cursed": false
  },
  {
    "id": 242,
    "rank": "특급",
    "name": "왕국의 비전",
    "type": 0,
    "key": "0:242",
    "cursed": false
  },
  {
    "id": 243,
    "rank": "상급",
    "name": "가르강튀아",
    "type": 0,
    "key": "0:243",
    "cursed": false
  },
  {
    "id": 244,
    "rank": "중급",
    "name": "결정석",
    "type": 0,
    "key": "0:244",
    "cursed": false
  },
  {
    "id": 245,
    "rank": "하급",
    "name": "골렘의 중추석",
    "type": 0,
    "key": "0:245",
    "cursed": false
  },
  {
    "id": 246,
    "rank": "특급",
    "name": "검은 별",
    "type": 0,
    "key": "0:246",
    "cursed": false
  },
  {
    "id": 247,
    "rank": "특급",
    "name": "빛나는 별의 보석",
    "type": 0,
    "key": "0:247",
    "cursed": false
  },
  {
    "id": 248,
    "rank": "상급",
    "name": "굶주림의 주머니",
    "type": 0,
    "key": "0:248",
    "cursed": false
  },
  {
    "id": 249,
    "rank": "하급",
    "name": "각인된 가면",
    "type": 0,
    "key": "0:249",
    "cursed": false
  },
  {
    "id": 250,
    "rank": "중급",
    "name": "날카로운 등 가시",
    "type": 0,
    "key": "0:250",
    "cursed": false
  },
  {
    "id": 251,
    "rank": "하급",
    "name": "가시 덩굴",
    "type": 0,
    "key": "0:251",
    "cursed": false
  },
  {
    "id": 252,
    "rank": "중급",
    "name": "간수의 열쇠",
    "type": 0,
    "key": "0:252",
    "cursed": false
  },
  {
    "id": 253,
    "rank": "하급",
    "name": "불의 장막",
    "type": 0,
    "key": "0:253",
    "cursed": false
  },
  {
    "id": 254,
    "rank": "상급",
    "name": "무형검",
    "type": 0,
    "key": "0:254",
    "cursed": false
  },
  {
    "id": 255,
    "rank": "상급",
    "name": "복슬복슬한 털뭉치",
    "type": 0,
    "key": "0:255",
    "cursed": false
  },
  {
    "id": 256,
    "rank": "중급",
    "name": "개껌",
    "type": 0,
    "key": "0:256",
    "cursed": false
  },
  {
    "id": 257,
    "rank": "중급",
    "name": "눈 썰매 강아지",
    "type": 0,
    "key": "0:257",
    "cursed": false
  },
  {
    "id": 258,
    "rank": "특급",
    "name": "전리품",
    "type": 0,
    "key": "0:258",
    "cursed": false
  },
  {
    "id": 259,
    "rank": "상급",
    "name": "검은 안대",
    "type": 0,
    "key": "0:259",
    "cursed": false
  },
  {
    "id": 260,
    "rank": "중급",
    "name": "고행자의 은화",
    "type": 0,
    "key": "0:260",
    "cursed": false
  },
  {
    "id": 261,
    "rank": "중급",
    "name": "치유의 탄피",
    "type": 0,
    "key": "0:261",
    "cursed": false
  },
  {
    "id": 262,
    "rank": "하급",
    "name": "수녀단의 표식",
    "type": 0,
    "key": "0:262",
    "cursed": false
  },
  {
    "id": 263,
    "rank": "중급",
    "name": "하얀 송편",
    "type": 0,
    "key": "0:263",
    "cursed": false
  },
  {
    "id": 264,
    "rank": "상급",
    "name": "분홍 송편",
    "type": 0,
    "key": "0:264",
    "cursed": false
  },
  {
    "id": 265,
    "rank": "특급",
    "name": "황금 송편",
    "type": 0,
    "key": "0:265",
    "cursed": false
  },
  {
    "id": 266,
    "rank": "상급",
    "name": "절구",
    "type": 0,
    "key": "0:266",
    "cursed": false
  },
  {
    "id": 267,
    "rank": "특급",
    "name": "풍등",
    "type": 0,
    "key": "0:267",
    "cursed": false
  },
  {
    "id": 268,
    "rank": "특급",
    "name": "망자의 불꽃",
    "type": 0,
    "key": "0:268",
    "cursed": false
  },
  {
    "id": 269,
    "rank": "상급",
    "name": "타락한 자의 왕관",
    "type": 0,
    "key": "0:269",
    "cursed": false
  },
  {
    "id": 270,
    "rank": "중급",
    "name": "소환의 돌",
    "type": 0,
    "key": "0:270",
    "cursed": false
  },
  {
    "id": 271,
    "rank": "중급",
    "name": "눈 담긴 양동이",
    "type": 0,
    "key": "0:271",
    "cursed": false
  },
  {
    "id": 272,
    "rank": "상급",
    "name": "반짝이는 트리",
    "type": 0,
    "key": "0:272",
    "cursed": false
  },
  {
    "id": 273,
    "rank": "특급",
    "name": "빛나는 황금별",
    "type": 0,
    "key": "0:273",
    "cursed": false
  },
  {
    "id": 274,
    "rank": "하급",
    "name": "8비트 선글라스",
    "type": 0,
    "key": "0:274",
    "cursed": false
  },
  {
    "id": 275,
    "rank": "중급",
    "name": "별모양 파티 안경",
    "type": 0,
    "key": "0:275",
    "cursed": false
  },
  {
    "id": 276,
    "rank": "상급",
    "name": "스트로베리 생크림 케이크",
    "type": 0,
    "key": "0:276",
    "cursed": false
  },
  {
    "id": 277,
    "rank": "특급",
    "name": "비밀의 가면 ^q^",
    "type": 0,
    "key": "0:277",
    "cursed": false
  },
  {
    "id": 278,
    "rank": "특급",
    "name": "망자의 불꽃",
    "type": 0,
    "key": "0:278",
    "cursed": false
  },
  {
    "id": 279,
    "rank": "상급",
    "name": "불타는 화염의 망토",
    "type": 0,
    "key": "0:279",
    "cursed": false
  },
  {
    "id": 280,
    "rank": "중급",
    "name": "만상의 황금 침",
    "type": 0,
    "key": "0:280",
    "cursed": false
  },
  {
    "id": 281,
    "rank": "하급",
    "name": "붉어진 모래 화석",
    "type": 0,
    "key": "0:281",
    "cursed": false
  },
  {
    "id": 282,
    "rank": "하급",
    "name": "봉제 인형",
    "type": 0,
    "key": "0:282",
    "cursed": false
  },
  {
    "id": 283,
    "rank": "중급",
    "name": "종말의 달력",
    "type": 0,
    "key": "0:283",
    "cursed": false
  },
  {
    "id": 284,
    "rank": "상급",
    "name": "황금의 큐브",
    "type": 0,
    "key": "0:284",
    "cursed": false
  },
  {
    "id": 285,
    "rank": "특급",
    "name": "고대의 큐브",
    "type": 0,
    "key": "0:285",
    "cursed": false
  },
  {
    "id": 286,
    "rank": "특급",
    "name": "황금 우상",
    "type": 0,
    "key": "0:286",
    "cursed": false
  },
  {
    "id": 287,
    "rank": "중급",
    "name": "저주받은 쇠말뚝",
    "type": 0,
    "key": "0:287",
    "cursed": false
  },
  {
    "id": 288,
    "rank": "상급",
    "name": "영원의 앙크",
    "type": 0,
    "key": "0:288",
    "cursed": false
  },
  {
    "id": 289,
    "rank": "하급",
    "name": "황금의 붕대",
    "type": 0,
    "key": "0:289",
    "cursed": false
  },
  {
    "id": 290,
    "rank": "중급",
    "name": "고릴라 손",
    "type": 0,
    "key": "0:290",
    "cursed": false
  },
  {
    "id": 291,
    "rank": "중급",
    "name": "강철 코피스",
    "type": 0,
    "key": "0:291",
    "cursed": false
  },
  {
    "id": 292,
    "rank": "중급",
    "name": "모래 석재",
    "type": 0,
    "key": "0:292",
    "cursed": false
  },
  {
    "id": 293,
    "rank": "하급",
    "name": "물 주머니",
    "type": 0,
    "key": "0:293",
    "cursed": false
  },
  {
    "id": 294,
    "rank": "중급",
    "name": "오아시스의 눈물",
    "type": 0,
    "key": "0:294",
    "cursed": false
  },
  {
    "id": 295,
    "rank": "하급",
    "name": "알로에베라",
    "type": 0,
    "key": "0:295",
    "cursed": false
  },
  {
    "id": 296,
    "rank": "하급",
    "name": "전갈의 독침",
    "type": 0,
    "key": "0:296",
    "cursed": false
  },
  {
    "id": 297,
    "rank": "하급",
    "name": "단단한 갑각",
    "type": 0,
    "key": "0:297",
    "cursed": false
  },
  {
    "id": 298,
    "rank": "하급",
    "name": "불타는 꽃송이",
    "type": 0,
    "key": "0:298",
    "cursed": false
  },
  {
    "id": 299,
    "rank": "하급",
    "name": "금덩이",
    "type": 0,
    "key": "0:299",
    "cursed": false
  },
  {
    "id": 300,
    "rank": "상급",
    "name": "믿음의 종",
    "type": 0,
    "key": "0:300",
    "cursed": false
  },
  {
    "id": 301,
    "rank": "특급",
    "name": "거짓의 종",
    "type": 0,
    "key": "0:301",
    "cursed": false
  },
  {
    "id": 302,
    "rank": "특급",
    "name": "진실의 종",
    "type": 0,
    "key": "0:302",
    "cursed": false
  },
  {
    "id": 303,
    "rank": "하급",
    "name": "거대한 짐승의 뼈",
    "type": 0,
    "key": "0:303",
    "cursed": false
  },
  {
    "id": 304,
    "rank": "상급",
    "name": "희생의 칼날",
    "type": 0,
    "key": "0:304",
    "cursed": false
  },
  {
    "id": 305,
    "rank": "특급",
    "name": "의식",
    "type": 0,
    "key": "0:305",
    "cursed": false
  },
  {
    "id": 306,
    "rank": "하급",
    "name": "불꽃의 문장",
    "type": 0,
    "key": "0:306",
    "cursed": false
  },
  {
    "id": 307,
    "rank": "하급",
    "name": "오아시스 주머니",
    "type": 0,
    "key": "0:307",
    "cursed": false
  },
  {
    "id": 308,
    "rank": "하급",
    "name": "레드 다이아몬드",
    "type": 0,
    "key": "0:308",
    "cursed": false
  },
  {
    "id": 309,
    "rank": "하급",
    "name": "선인장 과육",
    "type": 0,
    "key": "0:309",
    "cursed": false
  },
  {
    "id": 310,
    "rank": "상급",
    "name": "떠난 이에게 보내는 시",
    "type": 0,
    "key": "0:310",
    "cursed": false
  },
  {
    "id": 311,
    "rank": "상급",
    "name": "매의 깃털",
    "type": 0,
    "key": "0:311",
    "cursed": false
  },
  {
    "id": 312,
    "rank": "중급",
    "name": "태풍이 담긴 병",
    "type": 0,
    "key": "0:312",
    "cursed": false
  },
  {
    "id": 313,
    "rank": "중급",
    "name": "황금빛 보석",
    "type": 0,
    "key": "0:313",
    "cursed": false
  },
  {
    "id": 314,
    "rank": "하급",
    "name": "환란의 꽃",
    "type": 0,
    "key": "0:314",
    "cursed": false
  },
  {
    "id": 315,
    "rank": "중급",
    "name": "불안정한 코어",
    "type": 0,
    "key": "0:315",
    "cursed": false
  },
  {
    "id": 316,
    "rank": "특급",
    "name": "에너지 코어",
    "type": 0,
    "key": "0:316",
    "cursed": false
  },
  {
    "id": 317,
    "rank": "상급",
    "name": "감자 코어",
    "type": 0,
    "key": "0:317",
    "cursed": false
  },
  {
    "id": 318,
    "rank": "중급",
    "name": "마력이 담긴 석재",
    "type": 0,
    "key": "0:318",
    "cursed": false
  },
  {
    "id": 319,
    "rank": "특급",
    "name": "흘러내리는 모래",
    "type": 0,
    "key": "0:319",
    "cursed": false
  },
  {
    "id": 320,
    "rank": "중급",
    "name": "피 묻은 가시",
    "type": 0,
    "key": "0:320",
    "cursed": false
  },
  {
    "id": 321,
    "rank": "중급",
    "name": "죄악의 파편",
    "type": 0,
    "key": "0:321",
    "cursed": false
  },
  {
    "id": 322,
    "rank": "하급",
    "name": "히비스커스",
    "type": 0,
    "key": "0:322",
    "cursed": false
  },
  {
    "id": 323,
    "rank": "하급",
    "name": "파피루스",
    "type": 0,
    "key": "0:323",
    "cursed": false
  },
  {
    "id": 324,
    "rank": "하급",
    "name": "휴대용 화로",
    "type": 0,
    "key": "0:324",
    "cursed": false
  },
  {
    "id": 325,
    "rank": "중급",
    "name": "태양의 석판",
    "type": 0,
    "key": "0:325",
    "cursed": false
  },
  {
    "id": 326,
    "rank": "하급",
    "name": "생존자의 천막",
    "type": 0,
    "key": "0:326",
    "cursed": false
  },
  {
    "id": 327,
    "rank": "중급",
    "name": "룬 지팡이",
    "type": 0,
    "key": "0:327",
    "cursed": false
  },
  {
    "id": 328,
    "rank": "하급",
    "name": "생존자의 일지",
    "type": 0,
    "key": "0:328",
    "cursed": false
  },
  {
    "id": 329,
    "rank": "하급",
    "name": "부서진 돌 인형",
    "type": 0,
    "key": "0:329",
    "cursed": false
  },
  {
    "id": 330,
    "rank": "상급",
    "name": "황금빛 나침반",
    "type": 0,
    "key": "0:330",
    "cursed": false
  },
  {
    "id": 331,
    "rank": "특급",
    "name": "무덤지기의 등불",
    "type": 0,
    "key": "0:331",
    "cursed": false
  },
  {
    "id": 332,
    "rank": "특급",
    "name": "기적의 큐브 I",
    "type": 0,
    "key": "0:332",
    "cursed": false
  },
  {
    "id": 333,
    "rank": "특급",
    "name": "기적의 큐브 II",
    "type": 0,
    "key": "0:333",
    "cursed": false
  },
  {
    "id": 334,
    "rank": "특급",
    "name": "원 밀리언 펜던트",
    "type": 0,
    "key": "0:334",
    "cursed": false
  },
  {
    "id": 335,
    "rank": "상급",
    "name": "수호자의 팔목 보호대",
    "type": 0,
    "key": "0:335",
    "cursed": false
  },
  {
    "id": 336,
    "rank": "특급",
    "name": "여신의 눈물",
    "type": 0,
    "key": "0:336",
    "cursed": false
  },
  {
    "id": 337,
    "rank": "상급",
    "name": "상급 영혼 파편",
    "type": 0,
    "key": "0:337",
    "cursed": false
  },
  {
    "id": 338,
    "rank": "특급",
    "name": "의문의 손거울",
    "type": 0,
    "key": "0:338",
    "cursed": false
  },
  {
    "id": 339,
    "rank": "특급",
    "name": "의문의 대낫",
    "type": 0,
    "key": "0:339",
    "cursed": false
  },
  {
    "id": 340,
    "rank": "특급",
    "name": "경험의 서",
    "type": 0,
    "key": "0:340",
    "cursed": false
  },
  {
    "id": 341,
    "rank": "특급",
    "name": "마계산 다섯잎클로버",
    "type": 0,
    "key": "0:341",
    "cursed": false
  },
  {
    "id": 342,
    "rank": "특급",
    "name": "하얀 안대",
    "type": 0,
    "key": "0:342",
    "cursed": false
  },
  {
    "id": 343,
    "rank": "특급",
    "name": "저주받은 계약서",
    "type": 0,
    "key": "0:343",
    "cursed": false
  },
  {
    "id": 344,
    "rank": "특급",
    "name": "역날검",
    "type": 0,
    "key": "0:344",
    "cursed": false
  },
  {
    "id": 345,
    "rank": "특급",
    "name": "마도공학 추진체",
    "type": 0,
    "key": "0:345",
    "cursed": false
  },
  {
    "id": 346,
    "rank": "특급",
    "name": "선택과 집중",
    "type": 0,
    "key": "0:346",
    "cursed": false
  },
  {
    "id": 347,
    "rank": "특급",
    "name": "집중과 선택",
    "type": 0,
    "key": "0:347",
    "cursed": false
  },
  {
    "id": 348,
    "rank": "특급",
    "name": "마트료시카",
    "type": 0,
    "key": "0:348",
    "cursed": false
  },
  {
    "id": 349,
    "rank": "보스",
    "name": "교만의 반지-진",
    "type": 0,
    "key": "0:349",
    "cursed": false
  },
  {
    "id": 350,
    "rank": "보스",
    "name": "교만의 반지-위",
    "type": 0,
    "key": "0:350",
    "cursed": false
  },
  {
    "id": 351,
    "rank": "특급",
    "name": "승부사의 주사위",
    "type": 0,
    "key": "0:351",
    "cursed": false
  },
  {
    "id": 352,
    "rank": "특급",
    "name": "핏빛 포츈코인",
    "type": 0,
    "key": "0:352",
    "cursed": false
  },
  {
    "id": 353,
    "rank": "하급",
    "name": "돈주머니",
    "type": 0,
    "key": "0:353",
    "cursed": false
  },
  {
    "id": 354,
    "rank": "특급",
    "name": "행운의 네잎클로버",
    "type": 0,
    "key": "0:354",
    "cursed": false
  },
  {
    "id": 355,
    "rank": "보스",
    "name": "핏빛 토끼 머리띠",
    "type": 0,
    "key": "0:355",
    "cursed": false
  },
  {
    "id": 356,
    "rank": "하급",
    "name": "글자가 새겨진 조각",
    "type": 0,
    "key": "0:356",
    "cursed": false
  },
  {
    "id": 357,
    "rank": "하급",
    "name": "불발 다이너마이트",
    "type": 0,
    "key": "0:357",
    "cursed": false
  },
  {
    "id": 358,
    "rank": "중급",
    "name": "도굴꾼의 채찍",
    "type": 0,
    "key": "0:358",
    "cursed": false
  },
  {
    "id": 359,
    "rank": "하급",
    "name": "도굴꾼의 브러시",
    "type": 0,
    "key": "0:359",
    "cursed": false
  },
  {
    "id": 360,
    "rank": "중급",
    "name": "성스러운 채화경",
    "type": 0,
    "key": "0:360",
    "cursed": false
  },
  {
    "id": 361,
    "rank": "중급",
    "name": "황금 스카라베",
    "type": 0,
    "key": "0:361",
    "cursed": false
  },
  {
    "id": 362,
    "rank": "하급",
    "name": "도굴꾼의 수첩",
    "type": 0,
    "key": "0:362",
    "cursed": false
  },
  {
    "id": 363,
    "rank": "상급",
    "name": "파인더",
    "type": 0,
    "key": "0:363",
    "cursed": false
  },
  {
    "id": 364,
    "rank": "하급",
    "name": "피투성이 락픽",
    "type": 0,
    "key": "0:364",
    "cursed": false
  },
  {
    "id": 365,
    "rank": "중급",
    "name": "카노푸스의 단지",
    "type": 0,
    "key": "0:365",
    "cursed": false
  },
  {
    "id": 366,
    "rank": "상급",
    "name": "코브라 석상",
    "type": 0,
    "key": "0:366",
    "cursed": false
  },
  {
    "id": 367,
    "rank": "하급",
    "name": "스카라베",
    "type": 0,
    "key": "0:367",
    "cursed": false
  },
  {
    "id": 368,
    "rank": "특급",
    "name": "이끼 낀 두개골",
    "type": 0,
    "key": "0:368",
    "cursed": false
  },
  {
    "id": 369,
    "rank": "하급",
    "name": "설피",
    "type": 0,
    "key": "0:369",
    "cursed": false
  },
  {
    "id": 370,
    "rank": "중급",
    "name": "녹슨 카라비너",
    "type": 0,
    "key": "0:370",
    "cursed": false
  },
  {
    "id": 371,
    "rank": "하급",
    "name": "신기루 망토",
    "type": 0,
    "key": "0:371",
    "cursed": false
  },
  {
    "id": 372,
    "rank": "특급",
    "name": "축복받은 채야경",
    "type": 0,
    "key": "0:372",
    "cursed": false
  },
  {
    "id": 373,
    "rank": "상급",
    "name": "서기관의 천문도",
    "type": 0,
    "key": "0:373",
    "cursed": false
  },
  {
    "id": 374,
    "rank": "하급",
    "name": "체스 나이트",
    "type": 0,
    "key": "0:374",
    "cursed": false
  },
  {
    "id": 375,
    "rank": "중급",
    "name": "보온석",
    "type": 0,
    "key": "0:375",
    "cursed": false
  },
  {
    "id": 376,
    "rank": "상급",
    "name": "뜨거운 보온석",
    "type": 0,
    "key": "0:376",
    "cursed": false
  },
  {
    "id": 377,
    "rank": "상급",
    "name": "차가운 보온석",
    "type": 0,
    "key": "0:377",
    "cursed": false
  },
  {
    "id": 378,
    "rank": "상급",
    "name": "체스 퀸",
    "type": 0,
    "key": "0:378",
    "cursed": false
  },
  {
    "id": 379,
    "rank": "특급",
    "name": "땅의 열쇠",
    "type": 0,
    "key": "0:379",
    "cursed": false
  },
  {
    "id": 380,
    "rank": "특급",
    "name": "하늘의 열쇠",
    "type": 0,
    "key": "0:380",
    "cursed": false
  },
  {
    "id": 381,
    "rank": "특급",
    "name": "어전의 열쇠",
    "type": 0,
    "key": "0:381",
    "cursed": false
  },
  {
    "id": 0,
    "rank": "저주 하급",
    "name": "검은 재",
    "type": 1,
    "key": "1:0",
    "cursed": true
  },
  {
    "id": 1,
    "rank": "저주 하급",
    "name": "핏빛 문양",
    "type": 1,
    "key": "1:1",
    "cursed": true
  },
  {
    "id": 2,
    "rank": "저주 하급",
    "name": "타락한 성수",
    "type": 1,
    "key": "1:2",
    "cursed": true
  },
  {
    "id": 3,
    "rank": "저주 하급",
    "name": "박쥐 날개",
    "type": 1,
    "key": "1:3",
    "cursed": true
  },
  {
    "id": 4,
    "rank": "저주 하급",
    "name": "작은 심장",
    "type": 1,
    "key": "1:4",
    "cursed": true
  },
  {
    "id": 5,
    "rank": "저주 하급",
    "name": "타락한 조각상",
    "type": 1,
    "key": "1:5",
    "cursed": true
  },
  {
    "id": 6,
    "rank": "저주 중급",
    "name": "피묻은 시계",
    "type": 1,
    "key": "1:6",
    "cursed": true
  },
  {
    "id": 7,
    "rank": "저주 중급",
    "name": "징벌의 문양",
    "type": 1,
    "key": "1:7",
    "cursed": true
  },
  {
    "id": 8,
    "rank": "저주 중급",
    "name": "혼의 열쇠",
    "type": 1,
    "key": "1:8",
    "cursed": true
  },
  {
    "id": 9,
    "rank": "저주 하급",
    "name": "사악한 왼 눈동자",
    "type": 1,
    "key": "1:9",
    "cursed": true
  },
  {
    "id": 10,
    "rank": "저주 중급",
    "name": "주시자의 눈",
    "type": 1,
    "key": "1:10",
    "cursed": true
  },
  {
    "id": 11,
    "rank": "저주 중급",
    "name": "하얀 감시자의 가면",
    "type": 1,
    "key": "1:11",
    "cursed": true
  },
  {
    "id": 12,
    "rank": "저주 상급",
    "name": "끔찍한 불꽃의 잔재",
    "type": 1,
    "key": "1:12",
    "cursed": true
  },
  {
    "id": 13,
    "rank": "저주 상급",
    "name": "검은 피의 서약",
    "type": 1,
    "key": "1:13",
    "cursed": true
  },
  {
    "id": 14,
    "rank": "저주 특급",
    "name": "탐욕의 문장",
    "type": 1,
    "key": "1:14",
    "cursed": true
  },
  {
    "id": 15,
    "rank": "저주 중급",
    "name": "녹슨 천칭",
    "type": 1,
    "key": "1:15",
    "cursed": true
  },
  {
    "id": 16,
    "rank": "저주 상급",
    "name": "끝없는 혹한의 조각",
    "type": 1,
    "key": "1:16",
    "cursed": true
  },
  {
    "id": 17,
    "rank": "저주 하급",
    "name": "보랏빛 사슬",
    "type": 1,
    "key": "1:17",
    "cursed": true
  },
  {
    "id": 18,
    "rank": "저주 상급",
    "name": "방아쇠 없는 자동권총",
    "type": 1,
    "key": "1:18",
    "cursed": true
  },
  {
    "id": 19,
    "rank": "저주 중급",
    "name": "스칸다의 깃",
    "type": 1,
    "key": "1:19",
    "cursed": true
  },
  {
    "id": 20,
    "rank": "저주 특급",
    "name": "유리검",
    "type": 1,
    "key": "1:20",
    "cursed": true
  },
  {
    "id": 21,
    "rank": "",
    "name": "",
    "type": 1,
    "key": "1:21",
    "cursed": true
  }
]);

export const BOSSES = Object.freeze([
  { type: 'E', id: 1, code: 'E001', imageCode: 'E001', rank: 'MiddleBoss', name: '징벌자' },
  { type: 'E', id: 2, code: 'E002', imageCode: 'E002', rank: 'MiddleBoss', name: '예언자' },
  { type: 'E', id: 3, code: 'E003', imageCode: 'E003', rank: 'MiddleBoss', name: '사악한 군집체' },
  { type: 'E', id: 99, code: 'E099', imageCode: 'E099', rank: 'MiddleBoss', name: '사악한 군집체' },
  { type: 'E', id: 4, code: 'E004', imageCode: 'E004', rank: 'MiddleBoss', name: '미노타우로스' },
  { type: 'E', id: 5, code: 'E005', imageCode: '', rank: 'MiddleBoss', name: '묘지기' },
  { type: 'E', id: 101, code: 'E101', imageCode: 'E101', rank: 'MiddleBoss', name: 'Mr. 탐' },
  { type: 'E', id: 102, code: 'E102', imageCode: 'E102', rank: 'MiddleBoss', name: '식인식물 클라우드' },
  { type: 'E', id: 103, code: 'E103', imageCode: '', rank: 'MiddleBoss', name: '늪지 골렘' },
  { type: 'E', id: 201, code: 'E201', imageCode: 'E201', rank: 'MiddleBoss', name: '봉인된 엘드리치' },
  { type: 'E', id: 202, code: 'E202', imageCode: 'E202', rank: 'MiddleBoss', name: '서리웜' },
  { type: 'E', id: 301, code: 'E301', imageCode: 'E301', rank: 'MiddleBoss', name: '꿰뚫는 눈 폴라리스' },
  { type: 'E', id: 302, code: 'E302', imageCode: 'E302', rank: 'MiddleBoss', name: '영웅 이그니스' },
  { type: 'E', id: 401, code: 'E401', imageCode: 'E401', rank: 'MiddleBoss', name: '사하라 황소 벌레' },
  { type: 'E', id: 402, code: 'E402', imageCode: 'E402', rank: 'MiddleBoss', name: '지룡 카라쿰' },
  { type: 'E', id: 501, code: 'E501', imageCode: 'E501', rank: 'MiddleBoss', name: '움직이는 벽 우제트' },
  { type: 'E', id: 502, code: 'E502', imageCode: 'E502', rank: 'MiddleBoss', name: '대서기관 호테프' },
  { type: 'E', id: 10001, code: 'E10001', imageCode: 'E10001', rank: 'MiddleBoss', name: '스 노우맨' },
  { type: 'E', id: 10002, code: 'E10002', imageCode: 'E10002', rank: 'MiddleBoss', name: '스 노우맨' },
  { type: 'E', id: 10003, code: 'E10003', imageCode: 'E10003', rank: 'MiddleBoss', name: '스 노우맨' },
  { type: 'B', id: 1, code: 'B001', imageCode: 'B001', rank: 'Boss', name: '탐욕' },
  { type: 'B', id: 2, code: 'B002', imageCode: 'B002', rank: 'Boss', name: '라스' },
  { type: 'B', id: 101, code: 'B101', imageCode: 'B101', rank: 'Boss', name: '늪지 마녀 켈시' },
  { type: 'B', id: 102, code: 'B102', imageCode: 'B102', rank: 'Boss', name: '폭탄마' },
  { type: 'B', id: 201, code: 'B201', imageCode: 'B201', rank: 'Boss', name: '거짓말쟁이 울' },
  { type: 'B', id: 202, code: 'B202', imageCode: '', rank: 'Boss', name: '저주받은 울' },
  { type: 'B', id: 301, code: 'B301', imageCode: 'B301', rank: 'Boss', name: '유성의 창 템펠' },
  { type: 'B', id: 302, code: 'B302', imageCode: 'B302', rank: 'Boss', name: '베네딕트' },
  { type: 'B', id: 401, code: 'B401', imageCode: 'B401', rank: 'Boss', name: '고대병기 아크론' },
  { type: 'B', id: 501, code: 'B501', imageCode: 'B501', rank: 'Boss', name: '오팔' },
  { type: 'B', id: 502, code: 'B502', imageCode: 'B502', rank: 'Boss', name: '오닉스' },
  { type: 'B', id: 503, code: 'B503', imageCode: '', rank: 'Boss', name: '게브' },
  { type: 'B', id: 504, code: 'B504', imageCode: '', rank: 'Boss', name: '누트' },
  { type: 'B', id: 661, code: 'B661', imageCode: '', rank: 'Boss', name: '봉인된 니켈라' },
  { type: 'B', id: 662, code: 'B662', imageCode: '', rank: 'Boss', name: '봉인된 니켈라' },
  { type: 'B', id: 663, code: 'B663', imageCode: '', rank: 'Boss', name: '봉인된 니켈라' },
  { type: 'B', id: 9899, code: 'B9899', imageCode: '', rank: 'Boss', name: '이클립스' },
  { type: 'B', id: 9902, code: 'B9902', imageCode: '', rank: 'Boss', name: '단테' },
  { type: 'B', id: 9903, code: 'B9903', imageCode: '', rank: 'Boss', name: '검은 용사' },
  { type: 'B', id: 9904, code: 'B9904', imageCode: '', rank: 'Boss', name: '시체골렘' },
  { type: 'B', id: 9905, code: 'B9905', imageCode: '', rank: 'Boss', name: '캠보르미어' },
  { type: 'B', id: 9906, code: 'B9906', imageCode: 'B9906', rank: 'Boss', name: '크로노스' },
  { type: 'B', id: 9907, code: 'B9907', imageCode: '', rank: 'Boss', name: '단묵광' },
  { type: 'B', id: 9998, code: 'B9998', imageCode: '', rank: 'Boss', name: '아듄' },
  { type: 'B', id: 9999, code: 'B9999', imageCode: '', rank: 'Boss', name: '타락한 세실리아' }
]);

export const CHARACTERS = Object.freeze([
  {
    "sheetId": 1317254967,
    "key": "knight",
    "name": "기사"
  },
  {
    "sheetId": 1153474027,
    "key": "fighter",
    "name": "무투가"
  },
  {
    "sheetId": 1666050253,
    "key": "slayer",
    "name": "학살자"
  },
  {
    "sheetId": 1799771231,
    "key": "gunslinger",
    "name": "총잡이"
  },
  {
    "sheetId": 1914766997,
    "key": "wizard",
    "name": "마도사"
  },
  {
    "sheetId": 1633862659,
    "key": "mercenary",
    "name": "방랑 용병"
  },
  {
    "sheetId": 2068010033,
    "key": "hunter",
    "name": "사냥꾼"
  },
  {
    "sheetId": 32694081,
    "key": "ronin",
    "name": "낭인"
  },
  {
    "sheetId": 2892499,
    "key": "werewolf",
    "name": "늑대인간"
  },
  {
    "sheetId": 1956537927,
    "key": "summoner",
    "name": "소환술사"
  },
  {
    "sheetId": 485892814,
    "key": "Assassin",
    "name": "암살자"
  },
  {
    "sheetId": 338332447,
    "key": "Guardian",
    "name": "수호자"
  },
  {
    "sheetId": 1625389673,
    "key": "Predator",
    "name": "약탈자"
  },
  {
    "sheetId": 1119498079,
    "key": "",
    "name": "주술사"
  },
  {
    "sheetId": 1385424749,
    "key": "",
    "name": "용인"
  },
  {
    "sheetId": 445782027,
    "key": "",
    "name": "소울이터"
  },
  {
    "sheetId": 367239637,
    "key": "",
    "name": "흡혈귀"
  },
  {
    "sheetId": 670829951,
    "key": "",
    "name": "얀델"
  },
  {
    "sheetId": 1608515278,
    "key": "",
    "name": "도플갱어"
  },
  {
    "sheetId": 1270232313,
    "key": "HighRoller",
    "name": "승부사"
  },
  {
    "sheetId": 1732974968,
    "key": "",
    "name": "이단심판관"
  },
  {
    "sheetId": 656151300,
    "key": "",
    "name": "광전사"
  }
]);

export const PETS = Object.freeze([
  '플라스크', '웃는 선인장', '갈매기 친구', '솜몽치', '살랑이', '서리 정령', '레프의 전령', '쁘띠 골렘',
  '보뮬상자', '데빌펌킨', '구조대', '요미', '사격 드론', '성장 버섯', '붉은 도깨비', '쁘띠 늑대',
  '보안관', '알타르', '샤크 스핀', '스퀴로', '앰버 드래곤', '솜민트', '럭셔리 눈사람', '포이즌 펌킨',
  '루치펠', '해파링', '부두인형', '아이리스', '리퍼', '초록 달팽이', '시스투스', '캐롯 래빗',
  '슝슝이', '람 코브라', '용암 달팽이', '어비시우스', '악마의 오른팔', '쨱쨱이'
].map((name, id) => Object.freeze({ id, name })));

const primarySkills = SKILLS.filter(item => item.subId === 0);
const skillById = new Map(primarySkills.map(item => [String(item.id), item]));
const skillByName = new Map(primarySkills.filter(item => item.name).map(item => [item.name.trim(), item]));
const artifactByKey = new Map(ARTIFACTS.map(item => [item.key, item]));
const artifactByName = new Map(ARTIFACTS.filter(item => item.name).map(item => [item.name.trim(), item]));
const bossByCode = new Map(BOSSES.map(item => [item.code, item]));
const bossByName = new Map();
const characterById = new Map(CHARACTERS.map((item, id) => [id, { ...item, id }]));
const characterByName = new Map(CHARACTERS.map((item, id) => [normalizeMasterName(item.name), { ...item, id }]));
const petById = new Map(PETS.map(item => [item.id, item]));
characterByName.set(normalizeMasterName('비요른 얀델'), characterById.get(17));
const weaponNamesByCharacter = [
  [['철검',0],['엑시온',1],['슬레인',2],['오베론',3],['타벤투스',4],['이그니스',5],['임펄스 블레이드',6]],
  [['손목보호대',0],['야그루쉬',1],['도철',2],['아야무르',3],['드라우프니르',4],['바람의 서곡',5]],
  [['피의 낫',0],['영혼수확자',1],['폭뢰',2],['살점 분쇄기',3],['불카누스',4],['디아블로',5]],
  [['권총',0],['센트리건-미니건',1],['센트리건-화염',2],['샷건',3],['황금총',5]],
  [['작열의 마도서',0],['빙결의 마도서',1],['섬광의 마도서',2],['피의 구체',3],['어둠의 보석',4],['태양의 노래',5]],
  [['붉은 대검',0],['용암검 카일',1],['사슬검 샤프탈',2],['마검 아란',3],['처형인의 잿빛클리버',4],['독주통 바커스',5]],
  [['멀티 샷',0],['추적자',1],['블래스트',2],['홀리라이트',3],['데몬핸즈',4],['데몬 핸즈',4],['서리여왕',5],['폴라리스의 활',6],['칠흑의 가시덩굴',6]],
  [['혈검',0],['마검',1],['공명도',2],['만독아',3],['도검',900]],
  [['과다 출혈 (인간)',0],['과다 출혈',0],['상처 새기기 (인간)',1],['상처 새기기',1],['빙하마수 스카디아',2],['파고드는 발톱',3]],
  [['대지정령',0],['계약 : 대지 정령',0],['마술토끼',1],['계약 : 마술 토끼',1],['길잃은 붉은 정령',2],['계약 : 길잃은 붉은 정령',2]],
  [['단검',0],['혈족의 상징',1]],
  [['무쇠창',0],['괴물 사냥꾼',1],['불멸',2],['미스틸테인',3],['핏빛 도끼창',4],['금고봉',5]],
  [['무쇠창',0],['괴물 사냥꾼',1],['불멸',2],['미스틸테인',3],['핏빛 도끼창',4],['금고봉',5]],
  [['멸혼부',0],['피카부',1],['염주',2],['거목',3]],
  [['Dragon Fang',0],['용의 엄니',0],['조그노트의 신성검',1],['인페르노 레조네이터',2]],
  [['소울이터',0],['오컬트 매니아',1]],
  [['피의 권능',0],['롱기누스',1]],
  [['방패',0],['시체골렘의 정수',1],['오크히어로의 정수',2],['오크 히어로의 정수',2],['오우거의 정수',3]],
  [['흑검',0],['환영도',1]],
  [['플러시',0],['짝패',1]],
  [['심판의 망치',0],['아마데우스',1]],
  [['썬더콜러',0],['블루 오버드라이브',1]]
].map(items => new Map(items.map(([name, id]) => [normalizeMasterName(name), id])));
const weaponCodePrefixes = ['Knight','Fighter','Slayer','Gunslinger','Wizard','Mercenary','Hunter','Ronin','Werewolf','Summoner','Assassin','Guardian','Predator','Shaman','Dragonian','SoulEater','Vampire','Yandel','Doppel','HighRoller','Inquisitor','Berserker'];
for (const item of BOSSES) {
  const key = normalizeMasterName(item.name);
  if (key && !bossByName.has(key)) bossByName.set(key, item);
}

export function getSkillMeta(id) {
  return skillById.get(String(id)) || null;
}

export function getSkillMetaByName(name) {
  return skillByName.get(String(name || '').trim()) || null;
}

export function getArtifactMeta(key) {
  return artifactByKey.get(String(key)) || null;
}

export function getArtifactMetaByName(name) {
  return artifactByName.get(String(name || '').trim()) || null;
}

export function getCharacterMeta(id, name) {
  const hasId = id !== null && id !== undefined && id !== '';
  const numericId = hasId ? Number(id) : NaN;
  if (Number.isInteger(numericId) && characterById.has(numericId)) return characterById.get(numericId);
  return characterByName.get(normalizeMasterName(name)) || null;
}

export function getWeaponMeta(characterId, id, name) {
  const ownerId = Number(characterId);
  if (!Number.isInteger(ownerId) || ownerId < 0 || ownerId >= weaponNamesByCharacter.length) return null;
  const hasId = id !== null && id !== undefined && id !== '';
  const numericId = hasId ? Number(id) : NaN;
  if (Number.isInteger(numericId) && numericId >= 0) return { characterId: ownerId, id: numericId, name: String(name || '') };
  if (hasId) {
    const match = String(id).trim().match(new RegExp(`^${weaponCodePrefixes[ownerId]}(\\d+)$`, 'i'));
    if (match) return { characterId: ownerId, id: Number(match[1]), code: String(id), name: String(name || '') };
  }
  const matchedId = weaponNamesByCharacter[ownerId].get(normalizeMasterName(name));
  return matchedId === undefined ? null : { characterId: ownerId, id: matchedId, name: String(name || '') };
}

export function getPetMeta(id) {
  if (id === null || id === undefined || id === '') return null;
  const numericId = Number(id);
  return Number.isInteger(numericId) ? petById.get(numericId) || null : null;
}

export function getBossMeta(id, name, rank) {
  const rawId = String(id || '').trim().toUpperCase();
  const rankText = String(rank || '').trim().toLowerCase();
  const type = rawId.startsWith('E') || rankText.includes('middle') ? 'E'
    : rawId.startsWith('B') || rankText === 'boss' ? 'B' : '';
  const digits = rawId.replace(/^[BE]/, '');
  if (type && /^\d+$/.test(digits)) {
    const code = `${type}${Number(digits) < 1000 ? String(Number(digits)).padStart(3, '0') : String(Number(digits))}`;
    const matched = bossByCode.get(code);
    if (matched) return matched;
  }
  return bossByName.get(normalizeMasterName(name)) || null;
}

function normalizeMasterName(value) {
  return String(value || '').trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
}

export const MASTER_DATA_COUNTS = Object.freeze({
  skills: primarySkills.length,
  skillVariants: SKILLS.length - primarySkills.length,
  artifacts: ARTIFACTS.filter(item => !item.cursed).length,
  cursedArtifacts: ARTIFACTS.filter(item => item.cursed).length,
  unnamedArtifacts: ARTIFACTS.filter(item => !item.name).length,
  characters: CHARACTERS.length,
  pets: PETS.length,
  nodes: NODES.length
});
