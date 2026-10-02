import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';

export async function* readGzipLines(file) {
  const source = createReadStream(file);
  const decoded = createGunzip();
  // pipe() alone does not forward the file stream's ENOENT/error to gunzip.
  // Observe pipeline rejection immediately, then propagate it to the caller.
  const finished = pipeline(source, decoded);
  void finished.catch(() => {});
  const lines = readline.createInterface({ input: decoded, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield line;
    await finished;
  } finally {
    lines.close(); source.destroy(); decoded.destroy();
    await finished.catch(() => {});
  }
}
