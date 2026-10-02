import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './build-ui.mjs';
const executable=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
const git=(...args)=>execFileSync(executable,['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args],{encoding:'utf8'}).trim();
const manifest=JSON.parse(readFileSync(resolve(root,'migration-sources.json'),'utf8'));
for(const source of manifest.sources){
  git('merge-base','--is-ancestor',source.commit,'HEAD');
  const merges=git('log','--all','--merges','--format=%H %P').split('\n');
  const merge=merges.find(line=>line.split(' ').slice(2).includes(source.commit))?.split(' ')[0];
  if(!merge)throw Error(`Missing import merge for ${source.name}`);
  if(git('rev-parse',`${merge}:apps/${source.name}`)!==source.tree)throw Error(`Import tree mismatch: ${source.name}`);
  for(const ref of source.refs){
    const [name,object]=ref.split(' ');
    const target=name.replace('refs/heads/',`refs/heads/archive/${source.name}/`).replace('refs/tags/',`refs/tags/archive/${source.name}/`);
    if(git('rev-parse',target)!==object)throw Error(`Archived ref mismatch: ${name}`);
  }
  console.log(`${source.name}: original ancestry, exact import tree and ${source.refs.length} archived refs verified`);
}
