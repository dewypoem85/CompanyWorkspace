// Unity YAML을 편집하지 않는 이관 사전 검사. 에셋 해시는 재검사 시 보존 증거로 비교한다.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? '');
const output = process.argv[3];
if (!process.argv[2] || !output) throw new Error('Usage: node scripts/audit-unity.mjs UNITY_ROOT REPORT_JSON');
const dataRoot = join(root, 'Assets/10.Data/IAP Product Database');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(folder) {
  const files = [];
  for (const item of await readdir(folder, { withFileTypes: true })) {
    if (item.isDirectory()) files.push(...await walk(join(folder, item.name)));
    else if (/\.asset(?:\.meta)?$/.test(item.name)) files.push(join(folder, item.name));
  }
  return files.sort();
}
function scalar(text, key) {
  const match = text.match(new RegExp('^  ' + key + ': ?([^\\r\\n]*)$', 'm'));
  if (!match) return undefined;
  if (match[1].startsWith('"')) return JSON.parse(match[1]);
  return match[1];
}
const linked = new Set([...(await readFile(join(dataRoot, 'IAPProductDatabase.asset'), 'utf8')).matchAll(/guid: ([a-f0-9]{32})/g)].map(m => m[1]));
const products = [], hashes = [];
for (const file of await walk(dataRoot)) {
  const bytes = await readFile(file), text = bytes.toString('utf8');
  hashes.push([relative(root, file).replaceAll('\\', '/'), digest(bytes)]);
  if (!file.endsWith('.asset') || scalar(text, 'productId') === undefined) continue;
  const productId = scalar(text, 'productId');
  if (!productId || scalar(text, 'isDeprecated') === '1' || scalar(text, 'isNonStoreProduct') === '1' || scalar(text, 'useDatabasePrice') === '1' || scalar(text, 'productType') === '2') continue;
  const block = text.match(/^  storeIds:([^]*?)(?=^  [A-Za-z_]|$(?![^]))/m)?.[1] ?? '';
  const ids = Object.fromEntries([...block.matchAll(/- store: (\d+)\r?\n    id: ([^\r\n]*)/g)].map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
  const guid = (await readFile(file + '.meta', 'utf8')).match(/^guid: ([a-f0-9]{32})$/m)?.[1];
  if (!guid) throw new Error('Missing GUID: ' + relative(root, file));
  if (!linked.has(guid)) continue;
  products.push({ path: relative(root, file).replaceAll('\\', '/'), productKey: productId, googleId: ids['1'] || productId, appleId: ids['2'] || productId, steamId: ids['4'] || null, assetGuid: guid, saveName: scalar(text, 'saveName') ?? '', priceEnumValue: scalar(text, 'price'), assetHash: digest(bytes) });
}
const duplicates = {};
for (const field of ['productKey', 'googleId', 'appleId', 'steamId']) {
  const groups = new Map();
  for (const p of products) if (p[field]) groups.set(p[field], [...(groups.get(p[field]) ?? []), p.path]);
  duplicates[field] = [...groups].filter(([, paths]) => paths.length > 1).map(([id, paths]) => ({ id, paths }));
}
const report = { checkedAt: new Date().toISOString(), mode: 'read-only', productCount: products.length, assetAndMetaCount: hashes.length, treeHash: digest(JSON.stringify(hashes)), duplicateGroups: duplicates, importIdentityCheckPassed: Object.values(duplicates).every(groups => groups.length === 0), products, hashes, note: '정적 식별값/원본 보존 검사이며 Unity 실행·실구매·복원 검증을 대신하지 않습니다.' };
await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ productCount: report.productCount, assetAndMetaCount: hashes.length, treeHash: report.treeHash, duplicateGroups: Object.fromEntries(Object.entries(duplicates).map(([key, value]) => [key, value.length])), importIdentityCheckPassed: report.importIdentityCheckPassed }, null, 2));
