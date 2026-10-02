import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,outputs} from './build-ui.mjs';
import {withoutComments} from './check-theme-contract.mjs';

export const policyPath='packages/contracts/network-boundaries.json';
const roots=['packages/workspace-ui/src','apps/portal/Pages','apps/portal/wwwroot/js','apps/leave/Pages','apps/leave/wwwroot/js','apps/cs/public','apps/statistics/public','apps/schedule/src','apps/sheet/src/client'];
const extensions=new Set(['.html','.cshtml','.js','.mjs','.cjs','.ts','.tsx','.jsx']);
const hash=value=>createHash('sha256').update(value).digest('hex');

function* files(directory,base=root){
  const absolute=resolve(base,directory);if(!existsSync(absolute))return;
  for(const item of readdirSync(absolute,{withFileTypes:true})){
    if(['node_modules','bin','obj','.git','dist','data','generated','test','tests','__tests__'].includes(item.name))continue;
    const path=directory+'/'+item.name;
    if(item.isDirectory())yield* files(path,base);else if(extensions.has(extname(path))&&!/\.(?:test|spec)\.[^.]+$/.test(path))yield path.replaceAll('\\','/');
  }
}

export function networkCalls(path,source){
  const markup=['.html','.cshtml'].includes(extname(path));
  const body=withoutComments(source,{markup});
  const patterns=[
    /(?<![\w$])(?:(?:[A-Za-z_$][\w$]*)\s*\.\s*)?fetch\s*(?:\(|\.\s*(?:call|apply|bind)\s*\()/g,
    /\b(?:window|globalThis|self)\s*\[\s*(["'])fetch\1\s*\]\s*(?:\(|\.\s*(?:call|apply|bind)\s*\()/g,
    /\bnew\s+(?:(?:window|globalThis|self)\s*(?:\.\s*XMLHttpRequest|\[\s*(["'])XMLHttpRequest\1\s*\])|XMLHttpRequest)\s*\(/g,
    /\baxios\s*(?:\.\s*(?:request|get|post|put|patch|delete)|\[\s*(["'])(?:request|get|post|put|patch|delete)\1\s*\])\s*\(/g,
    /\bnavigator\s*(?:\.\s*sendBeacon|\[\s*(["'])sendBeacon\1\s*\])\s*\(/g,
    /\bReflect\s*\.\s*get\s*\(\s*(?:window|globalThis|self|navigator)\s*,\s*(["'])(?:fetch|XMLHttpRequest|sendBeacon)\1\s*\)\s*\(/g
  ];
  const matches=patterns.flatMap(pattern=>[...body.matchAll(pattern)]).sort((left,right)=>left.index-right.index);
  return matches.map(match=>({path,line:source.slice(0,match.index).split('\n').length}));
}

export function collectNetworkCalls(base=root){
  const generated=outputs(base),paths=[...new Set(roots.flatMap(directory=>[...files(directory,base)]))].sort();
  const calls=[];
  for(const path of paths){
    const source=readFileSync(resolve(base,path),'utf8').replaceAll('\r\n','\n');
    if(generated.has(path)&&generated.get(path)===source)continue;
    calls.push(...networkCalls(path,source));
  }
  return {paths,calls};
}

export function compareNetworkPolicy(calls,policy,base=root){
  const errors=[],actual=new Map(),allowed=new Map();
  if(policy?.version!==1||policy?.sealed!==true||!Array.isArray(policy.entries))return ['Invalid sealed browser network boundary policy.'];
  for(const call of calls){const rows=actual.get(call.path)||[];rows.push(call);actual.set(call.path,rows);}
  for(const entry of policy.entries){
    if(!entry||typeof entry.path!=='string'||!/^((apps|packages)\/[a-z][a-z0-9-]*\/)[A-Za-z0-9_./-]+$/.test(entry.path)||entry.path.includes('..')||
      !Number.isSafeInteger(entry.count)||entry.count<1||typeof entry.owner!=='string'||!entry.owner.trim()||
      typeof entry.contract!=='string'||!/^packages\/contracts\/[a-z0-9-]+\.md$/.test(entry.contract)||!existsSync(resolve(base,entry.contract))||allowed.has(entry.path)){
      errors.push('Invalid or duplicate browser network boundary policy: '+String(entry?.path));continue;
    }
    allowed.set(entry.path,entry);
  }
  for(const [path,rows] of actual){
    const entry=allowed.get(path);
    if(!entry)errors.push(`${path}:${rows[0].line}: raw browser fetch is not assigned to a reviewed transport boundary`);
    else if(rows.length!==entry.count)errors.push(`${path}: browser fetch count changed (${rows.length}/${entry.count}); review the transport contract instead of adding a page-owned request`);
  }
  for(const [path,entry] of allowed)if(!actual.has(path))errors.push(`${path}: approved browser transport retired; remove its policy entry instead of preserving an unused exception (${entry.owner})`);
  const canonical=[...policy.entries].map(entry=>entry.path).sort((a,b)=>a.localeCompare(b,'en'));
  if(JSON.stringify(policy.entries.map(entry=>entry.path))!==JSON.stringify(canonical))errors.push('Browser network boundary policy entries must be sorted by path.');
  return errors;
}

export function checkNetworkBoundaries(base=root){
  const {paths,calls}=collectNetworkCalls(base),policy=JSON.parse(readFileSync(resolve(base,policyPath),'utf8'));
  const errors=compareNetworkPolicy(calls,policy,base);if(errors.length)throw Error(errors.join('\n'));
  return {files:paths.length,calls:calls.length,policyHash:hash(JSON.stringify(policy))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(checkNetworkBoundaries());
