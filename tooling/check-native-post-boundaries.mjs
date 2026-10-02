import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,outputs} from './build-ui.mjs';
import {withoutComments} from './check-theme-contract.mjs';

export const policyPath='packages/contracts/native-post-boundaries.json';
const roots=['packages/workspace-ui/src','apps/portal/Pages','apps/leave/Pages','apps/cs/public','apps/statistics/public','apps/schedule/src','apps/sheet/src/client'];
const extensions=new Set(['.html','.cshtml','.js','.mjs','.cjs','.ts','.tsx','.jsx']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const genericContract='packages/contracts/native-post-boundaries.md';

function attribute(tag,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`,'i'));
  return match?(match[1]??match[2]??match[3]).trim():null;
}

function postIdentity(text,kind){
  if(kind!=='form-method')return `${kind}:sha256:${hash(text.replace(/\s+/g,' ').trim().toLowerCase()).slice(0,16)}`;
  const parts=['form'];
  for(const name of ['asp-page','asp-page-handler','action','id']){
    const value=attribute(text,name);if(value!==null)parts.push(`${name}=${value}`);
  }
  const markers=[...text.matchAll(/\b(data-(?:[a-z0-9-]*-)?(?:action|form))(?=\s|=|>)/gi)]
    .map(match=>match[1].toLowerCase()).filter((value,index,all)=>all.indexOf(value)===index).sort();
  for(const marker of markers){const value=attribute(text,marker);parts.push(`marker=${marker}${value===null?'':`:${value}`}`);}
  if(parts.length===1)parts.push(`sha256=${hash(text.replace(/\s+/g,' ').trim().toLowerCase()).slice(0,16)}`);
  return parts.join('|');
}

function* files(directory,base=root){
  const absolute=resolve(base,directory);if(!existsSync(absolute))return;
  for(const item of readdirSync(absolute,{withFileTypes:true})){
    if(['node_modules','bin','obj','.git','dist','data','generated','test','tests','__tests__'].includes(item.name))continue;
    const path=directory+'/'+item.name;
    if(item.isDirectory())yield* files(path,base);else if(extensions.has(extname(path))&&!/\.(?:test|spec)\.[^.]+$/.test(path))yield path.replaceAll('\\','/');
  }
}

export function nativePostForms(path,source){
  const markup=['.html','.cshtml'].includes(extname(path)),body=withoutComments(source,{markup});
  const matches=[];
  const record=(match,kind)=>matches.push({path,line:source.slice(0,match.index).split('\n').length,index:match.index,kind,identity:postIdentity(match[0],kind)});
  for(const match of body.matchAll(/<form\b(?:[^>"']|"[^"]*"|'[^']*')*>/gis)){
    if(/\bmethod\s*=\s*(?:(["'])post\1|\{\s*(["'])post\2\s*\}|post\b)/i.test(match[0]))record(match,'form-method');
  }
  for(const match of body.matchAll(/<[A-Za-z][A-Za-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gis)){
    if(/\bformmethod\s*=\s*(?:(["'])post\1|\{\s*(["'])post\2\s*\}|post\b)/i.test(match[0]))record(match,'submitter-formmethod');
  }
  for(const match of body.matchAll(/\.(?:method|formMethod)\s*=\s*(["'])post\1/gi))record(match,'property-method');
  for(const match of body.matchAll(/\.setAttribute\s*\(\s*(["'])(?:method|formmethod)\1\s*,\s*(["'])post\2/gi))record(match,'attribute-method');
  return matches.sort((left,right)=>left.index-right.index).map(({index,...match})=>match);
}

export function collectNativePostForms(base=root){
  const generated=outputs(base),paths=[...new Set(roots.flatMap(directory=>[...files(directory,base)]))].sort(),forms=[];
  for(const path of paths){
    const source=readFileSync(resolve(base,path),'utf8').replaceAll('\r\n','\n');
    if(generated.has(path)&&generated.get(path)===source)continue;
    forms.push(...nativePostForms(path,source));
  }
  return {paths,forms};
}

export function compareNativePostPolicy(forms,policy,base=root){
  const errors=[],actual=new Map(),allowed=new Map();
  if(policy?.version!==2||policy?.sealed!==true||!Array.isArray(policy.entries))return ['Invalid sealed native POST boundary policy.'];
  for(const form of forms){const rows=actual.get(form.path)||[];rows.push(form);actual.set(form.path,rows);}
  for(const entry of policy.entries){
    if(!entry||typeof entry.path!=='string'||!/^apps\/[a-z][a-z0-9-]*\/[A-Za-z0-9_./-]+$/.test(entry.path)||entry.path.includes('..')||
      typeof entry.owner!=='string'||!entry.owner.trim()||!Array.isArray(entry.forms)||entry.forms.length<1||allowed.has(entry.path)){
      errors.push('Invalid or duplicate native POST boundary policy: '+String(entry?.path));continue;
    }
    const identities=new Set();let invalid=false;
    for(const form of entry.forms){
      if(!form||typeof form.identity!=='string'||!form.identity.trim()||identities.has(form.identity)||
        typeof form.contract!=='string'||!/^packages\/contracts\/[a-z0-9-]+\.md$/.test(form.contract)||form.contract===genericContract||!existsSync(resolve(base,form.contract))){
        invalid=true;break;
      }
      identities.add(form.identity);
    }
    if(invalid){errors.push('Invalid native POST form contract policy: '+entry.path);continue;}
    const canonicalForms=[...entry.forms].map(form=>form.identity).sort((a,b)=>a.localeCompare(b,'en'));
    if(JSON.stringify(entry.forms.map(form=>form.identity))!==JSON.stringify(canonicalForms))errors.push('Native POST form policies must be sorted by identity: '+entry.path);
    allowed.set(entry.path,entry);
  }
  for(const [path,rows] of actual){
    const entry=allowed.get(path);
    if(!entry)errors.push(`${path}:${rows[0].line}: native POST form is not assigned to a reviewed mutation boundary`);
    else{
      const found=new Map();
      for(const row of rows){
        if(found.has(row.identity))errors.push(`${path}:${row.line}: duplicate native POST identity ${row.identity}`);
        else found.set(row.identity,row);
      }
      const expected=new Map(entry.forms.map(form=>[form.identity,form]));
      for(const [identity,row] of found)if(!expected.has(identity))errors.push(`${path}:${row.line}: native POST identity is not assigned to a concrete mutation contract: ${identity}`);
      for(const [identity,form] of expected)if(!found.has(identity))errors.push(`${path}: reviewed native POST identity retired or changed; update the concrete mutation contract: ${identity} (${form.contract})`);
    }
  }
  for(const [path,entry] of allowed)if(!actual.has(path))errors.push(`${path}: reviewed native POST forms retired; remove the policy entry instead of preserving an unused exception (${entry.owner})`);
  const canonical=[...policy.entries].map(entry=>entry.path).sort((a,b)=>a.localeCompare(b,'en'));
  if(JSON.stringify(policy.entries.map(entry=>entry.path))!==JSON.stringify(canonical))errors.push('Native POST boundary policy entries must be sorted by path.');
  return errors;
}

export function checkNativePostBoundaries(base=root){
  const {paths,forms}=collectNativePostForms(base),policy=JSON.parse(readFileSync(resolve(base,policyPath),'utf8'));
  const errors=compareNativePostPolicy(forms,policy,base);if(errors.length)throw Error(errors.join('\n'));
  return {files:paths.length,forms:forms.length,policyHash:hash(JSON.stringify(policy))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(checkNativePostBoundaries());
