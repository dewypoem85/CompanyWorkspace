import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisResult, ImportRangeRule, SnapshotRecord } from '../shared/types.js';

export interface RulesDocument {
  spreadsheetId: string;
  createdAt: string;
  count: number;
  rules: ImportRangeRule[];
}

const root = path.resolve(process.cwd(), 'data');

async function ensureDir(name: string): Promise<string> {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function writeJson(directoryName: string, fileName: string, value: unknown): Promise<string> {
  const directory = await ensureDir(directoryName);
  const target = path.join(directory, fileName);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}

async function readJson<T>(directoryName: string, fileName: string): Promise<T> {
  const target = path.join(root, directoryName, fileName);
  return JSON.parse(await readFile(target, 'utf8')) as T;
}

export const saveAnalysis = (analysis: AnalysisResult) =>
  writeJson('analyses', `${analysis.id}.json`, analysis);

export const loadAnalysis = (analysisId: string) =>
  readJson<AnalysisResult>('analyses', `${analysisId}.json`);

export const saveSnapshot = (snapshot: SnapshotRecord) =>
  writeJson('snapshots', `${snapshot.id}.json`, snapshot);

export const loadSnapshot = (snapshotId: string) =>
  readJson<SnapshotRecord>('snapshots', `${snapshotId}.json`);

export async function listSnapshots(): Promise<SnapshotRecord[]> {
  const directory = await ensureDir('snapshots');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json'));
  const snapshots = await Promise.all(files.map((file) => readJson<SnapshotRecord>('snapshots', file)));
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const saveRules = (spreadsheetId: string, rules: ImportRangeRule[]) =>
  writeJson('rules', `${spreadsheetId}.json`, {
    spreadsheetId,
    createdAt: new Date().toISOString(),
    count: rules.length,
    rules,
  });

export const loadRules = (spreadsheetId: string) =>
  readJson<RulesDocument>('rules', `${spreadsheetId}.json`);
