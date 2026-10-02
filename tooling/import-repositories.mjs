// One-time, additive import. Never modifies a source checkout or production runtime.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, '..');
const gitExe = process.env.WORKSPACE_GIT || (process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git');
const sources = [['portal','company-portal'],['leave','LeaveManager'],['schedule','schedule'],['cs','CS'],['statistics','statistics'],['sheet','sheet'],['iap','product-upload']];
function git(cwd, ...args) {
  return execFileSync(gitExe, ['-c', `safe.directory=${cwd.replaceAll('\\','/')}`, '-C', cwd, ...args], { encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:32*1024*1024 }).trim();
}
const manifestPath = resolve(root, 'migration-sources.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath,'utf8')) : { format:1, sources:[] };
// Preflight all sources before any write: preserve user edits, never silently discard them.
for (const [name, folder] of sources) {
  const cwd=resolve(sourceRoot,folder);
  if (git(cwd,'status','--porcelain')) throw Error(`${name}: source is not clean; preserve and resolve changes before import`);
  if (git(cwd,'branch','--show-current')!=='main') throw Error(`${name}: source is not on main`);
  if (manifest.sources.some(s=>s.name===name)) continue;
  if (existsSync(resolve(root,'apps',name))) throw Error(`${name}: destination exists; inspect interrupted import, do not overwrite`);
}
if (!existsSync(resolve(root,'.git'))) {
  git(root,'init','-b','main');
  git(root,'add','AGENTS.md','.gitignore','README.md','docs','tooling');
  git(root,'commit','-m','chore: 회사 워크스페이스 이관 기반 및 작업 규칙 추가');
}
if (git(root,'status','--porcelain')) throw Error('Destination is not clean; inspect changes before importing');
for (const [name, folder] of sources) {
  if (manifest.sources.some(s=>s.name===name)) { console.log(`${name}: already imported`); continue; }
  const cwd=resolve(sourceRoot,folder), commit=git(cwd,'rev-parse','HEAD');
  const tree=git(cwd,'rev-parse','HEAD^{tree}');
  const refs=git(cwd,'for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/tags').split('\n').filter(Boolean);
  git(root,'fetch','--no-tags',cwd,`refs/heads/*:refs/heads/archive/${name}/*`,`refs/tags/*:refs/tags/archive/${name}/*`);
  git(root,'merge','--allow-unrelated-histories','--no-commit','-s','ours',commit);
  git(root,'read-tree',`--prefix=apps/${name}/`,'-u',commit);
  manifest.sources.push({name, folder, remote:git(cwd,'remote','get-url','origin'),commit,tree,refs});
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  git(root,'add','migration-sources.json');
  git(root,'commit','-m',`chore: ${name} 원본 이력을 보존하여 앱 이관`);
  const actual=git(root,'rev-parse',`HEAD:apps/${name}`);
  if (actual!==tree) throw Error(`${name}: imported tree differs from source`);
  git(root,'merge-base','--is-ancestor',commit,'HEAD');
  console.log(`${name}: preserved ${commit}, tree ${tree}`);
}
