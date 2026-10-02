import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIndexedFactStore } from '../lib/indexed-fact-store.js';

test('날짜 교체 중 조회는 부분 데이터 대신 직전 커밋을 유지한다', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-index-'));
  const oldFile = path.join(dataDir, 'old.ndjson');
  const newFile = path.join(dataDir, 'new.ndjson');
  const store = createIndexedFactStore({ dataDir, now: () => Date.parse('2026-08-25T00:00:00Z') });
  const oldEvent = fact('old', '2026-08-24T01:00:00Z', 'Normal', 1);
  const newEvents = Array.from({ length: 20_000 }, (_, index) => fact(`new-${index}`, '2026-08-24T02:00:00Z', 'Challenge', 5));

  try {
    await fs.writeFile(oldFile, `${JSON.stringify(oldEvent)}\n`);
    await fs.writeFile(newFile, `${newEvents.map(value => JSON.stringify(value)).join('\n')}\n`);
    await store.replaceDay('20260824', 'old', oldFile);

    const replacement = store.replaceDay('20260824', 'new', newFile);
    await new Promise(resolve => setImmediate(resolve));
    const during = [];
    await store.scan(query(), event => during.push(event.id));
    assert.deepEqual(during, ['old']);

    await replacement;
    let after = 0;
    await store.scan(query(), () => { after += 1; });
    assert.equal(after, 20_000);
  } finally {
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

function fact(id, timestamp, mode, modeLevel) {
  return {
    id, timestamp: Date.parse(timestamp), type: 'battleResult', version: '0.772.0', platform: 'Windows', mode, modeLevel,
    playerId: id, result: 'Clear', reachedFirstMiddleBoss: true
  };
}

function query() {
  return {
    from: new Date('2026-08-24T00:00:00Z'), to: new Date('2026-08-25T00:00:00Z'),
    version: '', platform: '', mode: '', minModeLevel: null, afterFirstMiddleBoss: false
  };
}
