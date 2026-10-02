import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanText, createEntityDetailsStore, parseEntityDetails } from '../lib/entity-details-store.js';

test('시트 키를 아이콘 상세정보 종류와 ID에 맞게 변환한다', () => {
  const details = parseEntityDetails({
    characters: [['Keys', 'Korean'], ['Knight', '기사'], ['Knight Weapon Name 3', '오베론'], ['Knight Weapon Info Active 3', '<color=#fff>순간 이동 공격</color>'], ['Knight Skin Name 1', '제국의 별'], ['Knight Skin Info 1', '전용 연출'], ['Knight Node 110 Name', '완성된 신성'], ['Knight Node 110 Info', '최종 효과']],
    skills: [['Keys', 'Korean'], ['Skill7.name', '유체화'], ['Skill7.CardInfo', '이동 속도 증가'], ['Skill7.EasyInfo', '[*y][N]</color>초 지속']],
    artifacts: [['Keys', 'Korean'], ['Arti2.Name', '횃대'], ['Arti2.PowerText', '화염구 생성'], ['Arti2.Tooltip', '아직도 타오릅니다.'], ['CursedArti1.Name', '핏빛 문양'], ['CursedArti1.PowerText', '저주 효과']],
    pets: [['Keys', 'Korean'], ['PetName0', '플라스크'], ['PetInfo0', '하트를 회복합니다.']],
    sinPoints: [['Keys', 'Korean'], ['Sin_Wrath_Name', '분노'], ['Sin_Wrath_DefaultInfo', '공격력 <color=#ff0>+{0}%</color>']]
  });

  assert.equal(details.characters['0'].name, '기사');
  assert.equal(details.weapons['0:3'].active, '순간 이동 공격');
  assert.equal(details.skins['0:1'].description, '전용 연출');
  assert.equal(details.nodes['0:110'].description, '최종 효과');
  assert.equal(details.skills['7'].summary, '[N]초 지속');
  assert.equal(details.artifacts['normal:2'].flavor, '아직도 타오릅니다.');
  assert.equal(details.artifacts['curse:1'].description, '저주 효과');
  assert.equal(details.pets['0'].description, '하트를 회복합니다.');
  assert.equal(details.sinPoints.wrath.description, '공격력 +{0}%');
  assert.equal(cleanText('A\r\n<color=#fff>B</color>'), 'A\nB');
});

test('갱신 성공본을 원자 저장하고 다음 프로세스가 캐시에서 다시 읽는다', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-entity-details-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credentialsJson = JSON.stringify({ client_email: 'statistics@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const rows = {
    '1mIew5_ss0Yt3dJ_EvWOASGBlhv_s0QrhZvZJ42ORhlE': [['Keys', 'Korean'], ['Skill0.name', '연속타격']],
    '1yR3vUhLKnYWno-rSqWLzrCvjDTS3teKndUMdRwQ_A9Y': [['Keys', 'Korean'], ['Arti0.Name', '문자가 새겨진 돌']],
    '1lNtUTH899DPSzQWVNMHlW5PIy-2JZqnk85MzTNnnQm8': [['Keys', 'Korean'], ['Knight', '기사']],
    '1c1LyP3OUej2acQ5KGWuYQRoY5AhEM4p8rw7ZmLPckHA': [['Keys', 'Korean'], ['PetName0', '플라스크'], ['Sin_Wrath_Name', '분노']]
  };
  const fetchImpl = async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token' });
    const id = String(url).match(/spreadsheets\/([^/]+)\/values/)?.[1];
    return Response.json({ valueRanges: [{ values: rows[id] || [] }] });
  };
  const store = createEntityDetailsStore({ dataDir: directory, credentialsJson, fetchImpl, now: () => '2026-09-23T12:00:00.000Z' });
  const refreshed = await store.refresh();
  assert.equal(refreshed.details.skills['0'].name, '연속타격');
  assert.equal(refreshed.updatedAt, '2026-09-23T12:00:00.000Z');

  const restored = await createEntityDetailsStore({ dataDir: directory, credentialsJson: '' }).load();
  assert.deepEqual(restored, refreshed);
});
