import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { readGzipLines } from '../lib/read-gzip-lines.js';

test('gzip reader preserves lines and propagates missing files/CRC errors without crashing the worker', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-query-read-'));
  const file = path.join(directory, 'query.gz');
  const collect = async () => { const values = []; for await (const line of readGzipLines(file)) values.push(line); return values; };
  try {
    await assert.rejects(collect(), { code: 'ENOENT' });
    const compressed = gzipSync('첫 번째\n{"id":"9007199254740993"}\n');
    await fs.writeFile(file, compressed);
    assert.deepEqual(await collect(), ['첫 번째', '{"id":"9007199254740993"}']);
    compressed[compressed.length - 8] ^= 255;
    await fs.writeFile(file, compressed);
    await assert.rejects(collect(), { code: 'Z_DATA_ERROR' });
    await fs.writeFile(file, gzipSync('one\ntwo\n'));
    for await (const line of readGzipLines(file)) { assert.equal(line, 'one'); break; }
    assert.deepEqual(await collect(), ['one', 'two']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
