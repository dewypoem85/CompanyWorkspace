import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {root,outputs} from './build-ui.mjs';
import {collectThemeSources,withoutComments} from './check-theme-contract.mjs';

export const inventoryPath='packages/contracts/ui-primitive-debt.json';
const markupExtensions=new Set(['.html','.cshtml','.svg']);
const sourceExtensions=new Set([...markupExtensions,'.js','.mjs','.cjs','.ts','.tsx','.jsx']);
const rules=new Set(['native-field','native-range','native-button','native-table','native-dialog','native-dom','native-confirm','static-note']);
const hash=text=>createHash('sha256').update(text).digest('hex');
const mask=text=>text.replace(/[^\r\n]/g,' ');
const normalized=text=>text.replace(/\s+/g,' ').trim();
function literalPrefix(value) {
  const index=value.search(/\$\{|@/);if(index<0)return value;
  // A dynamic suffix could change the last token (cw-button${suffix}). Only
  // whitespace-terminated tokens before the expression are guaranteed classes.
  return value.slice(0,index).replace(/\S+$/,'');
}

// This scans literal native markup (including JS templates), not arbitrary evaluated code.
// Quoted attributes and JSX expressions may contain >; they do not end the opening tag.
function openingTag(body,start) {
  let quote='',depth=0;
  for(let i=start;i<body.length;i++) {
    const c=body[i];
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++;
    else if(c==='}'&&depth)depth--;
    else if(c==='>'&&!depth)return body.slice(start,i+1);
  }
  return body.slice(start);
}
function attributes(tag,markup) {
  const result=new Map(),duplicates=new Set();let i=/^<\w+/.exec(tag)?.[0].length||0;
  while(i<tag.length) {
    if(/[\s/>]/.test(tag[i])){i++;continue;}
    const match=/^[\w:.-]+/.exec(tag.slice(i));if(!match){i++;continue;}
    const name=markup?match[0].toLowerCase():match[0];if(result.has(name))duplicates.add(name);
    i+=name.length;while(/\s/.test(tag[i]||'')&&i<tag.length)i++;
    if(tag[i]!=='='){result.set(name,null);continue;}i++;while(/\s/.test(tag[i]||'')&&i<tag.length)i++;
    const start=i,c=tag[i];let depth=0,quote='';
    if(c==='{'||c==='"'||c==="'"||c==='`') {
      if(c==='{')depth=1;else quote=c;i++;
      while(i<tag.length){const ch=tag[i++];if(quote){if(ch==='\\'){i++;continue;}if(ch===quote){quote='';if(!depth)break;}continue;}if(ch==='"'||ch==="'"||ch==='`')quote=ch;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0)break;}
    } else while(i<tag.length&&!/[\s>]/.test(tag[i]))i++;
    const raw=tag.slice(start,i),inner=c==='{'?raw.slice(1,-1).trim():raw;
    let literal=null;
    if(['"',"'",'`'].includes(inner[0])) {
      let end=1;for(;end<inner.length;end++){if(inner[end]==='\\'){end++;continue;}if(inner[end]===inner[0])break;}
      if(end===inner.length-1)literal=inner.slice(1,-1);
    }
    // Only a literal/prefix is provable. Conditional or concatenated expressions
    // cannot borrow a common class from an inactive branch or a different attribute.
    result.set(name,literal!==null?literalPrefix(literal):c==='{'?null:literalPrefix(raw));
  }
  for(const name of duplicates)result.set(name,null);
  return result;
}
function hasClass(attrs,name,markup) {return (attrs.get('class')||(!markup&&attrs.get('className'))||'').split(/\s+/).includes(name);}

export function primitiveViolations(path,source) {
  const extension=extname(path);if(!sourceExtensions.has(extension))return [];
  const markup=markupExtensions.has(extension);
  let body=withoutComments(source,{markup});
  // JSX comments are also masked; HTML templates and quoted URLs remain inspectable.
  body=body.replace(/\{\/\*[\s\S]*?\*\/\}/g,mask);
  const found=[],add=(rule,index,snippet)=>found.push({path,rule,line:source.slice(0,index).split('\n').length,signature:hash(rule+'\0'+normalized(snippet)),snippet:normalized(snippet)});
  const pattern=new RegExp('<(input|select|textarea|button|table|dialog|aside|section|div)\\b',markupExtensions.has(extension)?'gi':'g');
  let end=0;
  for(const match of body.matchAll(pattern)) {
    if(match.index<end)continue;
    const tag=openingTag(body,match.index),name=match[1].toLowerCase(),attrs=attributes(tag,markup);end=match.index+tag.length;
    if(['aside','section','div'].includes(name)) {
      if(attrs.get('role')==='note'||hasClass(attrs,'cw-callout',markup)){
        const tail=body.slice(end),close=tail.search(/<\/section\s*>/i),inside=close<0?'':tail.slice(0,close);
        if(name!=='section'||attrs.get('role')!=='note'||!hasClass(attrs,'cw-callout',markup)||!['neutral','info','warning','danger'].includes(attrs.get('data-tone'))||attrs.has('aria-live')||attrs.has('data-workspace-state')||attrs.has('style')||/<section\b/i.test(inside)||!/^\s*<strong\b[^>]*>[\s\S]+?<\/strong>\s*<p\b[^>]*>[\s\S]+?<\/p>\s*$/i.test(inside))
          add('static-note',match.index,tag);
      }
      continue;
    }
    if(name==='input') {
      const type=attrs.get('type')?.toLowerCase();
      if(type==='range') {
        if(!hasClass(attrs,'cw-range',markup))add('native-range',match.index,tag);
        continue;
      }
      // Non-text controls are not supported by cw-form-control. They need their own
      // shared component migration; never count adding the wrong class as compliant.
      if(['hidden','checkbox','radio','file'].includes(type))continue;
      if(['button','submit','reset','image'].includes(type)){add('native-button',match.index,tag);continue;}
    }
    const rule=['input','select','textarea'].includes(name)?'native-field':'native-'+name;
    const expected=rule==='native-field'?'cw-form-control':rule==='native-button'?'cw-button':rule==='native-table'?'cw-data-table':'cw-dialog-form';
    if(name==='table'&&hasClass(attrs,'cw-data-table',markup)&&attrs.has('data-layout')) {
      // Literal-table guard only; rendered header/label correspondence and geometry need browser tests.
      const tail=body.slice(end),close=tail.search(/<\/table\s*>/i),inside=close<0?'':tail.slice(0,close),cards=attrs.get('data-layout')==='cards';
      const cells=[...inside.matchAll(/<(td|th)\b/gi)].map(cell=>{
        const opening=openingTag(inside,cell.index),following=inside.slice(cell.index+opening.length).trimStart();
        return {name:cell[1].toLowerCase(),attrs:attributes(opening,markup),value:/^<div\b/i.test(following)&&hasClass(attributes(openingTag(following,0),markup),'cw-table-value',markup)};
      });
      const invalid=!['cards','key-value'].includes(attrs.get('data-layout'))||/<table\b/i.test(inside)||attrs.get('role')!=='table'||!cells.some(cell=>cell.name==='th')||cells.some(cell=>cell.name==='th'?cell.attrs.get('scope')!==(cards?'col':'row'):cards&&(!cell.attrs.has('data-label')||!cell.value));
      if(invalid)add(rule,match.index,tag);
      continue;
    }
    if(name==='table'&&hasClass(attrs,'cw-calendar-table',markup)) {
      // Calendar grids keep native table semantics and app-owned date cells while
      // the shared primitive owns geometry, accessible naming and column headers.
      const tail=body.slice(end),close=tail.search(/<\/table\s*>/i),inside=close<0?'':tail.slice(0,close);
      const layout=attrs.get('data-calendar-layout');
      const headers=[...inside.matchAll(/<th\b/gi)].map(header=>attributes(openingTag(inside,header.index),markup));
      const dateCells=[...inside.matchAll(/<td\b/gi)].map(cell=>attributes(openingTag(inside,cell.index),markup));
      const invalid=!['year-mini','month'].includes(layout)||attrs.get('role')!=='table'||
        !['aria-label','aria-labelledby'].some(key=>attrs.has(key))||/<table\b/i.test(inside)||
        headers.length===0||headers.some(header=>header.get('scope')!=='col')||
        (layout==='month'&&(!dateCells.some(cell=>cell.has('data-date')&&cell.has('data-date-label'))||!/<button\b[^>]*\bdata-day-detail-trigger\b/i.test(inside)));
      if(invalid)add(rule,match.index,tag);
      continue;
    }
    if(name==='dialog'&&hasClass(attrs,'cw-modal',markup)) {
      const connected=/\buseWorkspaceModal\s*\(/.test(body)||/\bCompanyDialog\s*\.\s*attach\s*\(/.test(body);
      const duplicated=['open','onCancel','onClose','oncancel','onclose'].some(key=>attrs.has(key));
      if(!connected||duplicated||!['aria-label','aria-labelledby'].some(key=>attrs.has(key)))add(rule,match.index,tag);
      continue;
    }
    if(!hasClass(attrs,expected,markup)&&!(name==='dialog'&&['cw-review','cw-modal'].some(token=>hasClass(attrs,token,markup))))add(rule,match.index,tag);
  }
  // Rebuilding a native control in application JS bypasses markup ownership checks.
  // Use a shared component, or a static template with the common classes instead.
  for(const match of body.matchAll(/\b(?:[A-Za-z_$][\w$]*\s*\.\s*)?createElement\s*\(\s*(['"])(input|select|textarea|button|table|dialog)\1/gi)) {
    const before=body.slice(Math.max(0,match.index-100),match.index),variable=/\b(?:const|let|var)\s+(\w+)\s*=\s*$/.exec(before)?.[1];
    const after=body.slice(match.index+match[0].length);
    if(match[2].toLowerCase()==='input'&&variable&&new RegExp('^\\s*\\)\\s*;\\s*'+variable+'\\.type\\s*=\\s*["\']hidden["\']').test(after))continue;
    add('native-dom',match.index,match[0]);
  }
  for(const match of body.matchAll(/(?<![\w.$])(?:(?:window|globalThis)\s*\.\s*)?(?:confirm|prompt|alert)\s*\(/g))add('native-confirm',match.index,match[0]);
  return found;
}

export function collectPrimitiveViolations(base=root) {
  const catalog=JSON.parse(readFileSync(resolve(base,'packages/contracts/services.json'),'utf8'));
  // Exact generator outputs, not a blanket generated/ directory or a magic comment.
  const generated=outputs(base);
  // HTML/Razor version stamping is not UI generation: their editable bodies must
  // still be checked, especially the CS and Statistics entry documents.
  const paths=collectThemeSources(base,catalog).filter(path=>path.startsWith('apps/')&&(!generated.has(path)||markupExtensions.has(extname(path)))&&sourceExtensions.has(extname(path))&&!/(?:^|\/)__tests__\/|\.(?:test|spec)\.[^.]+$/.test(path));
  for(const [path,expected] of generated)if(sourceExtensions.has(extname(path))&&readFileSync(resolve(base,path),'utf8').replaceAll('\r\n','\n')!==expected)throw Error('Generated UI changed outside its shared owner: '+path);
  return {paths,violations:paths.flatMap(path=>primitiveViolations(path,readFileSync(resolve(base,path),'utf8')))};
}
const key=row=>row.path+'\0'+row.rule+'\0'+row.signature;
export function groupViolations(violations) {
  const grouped=new Map();
  for(const row of violations){const id=key(row),entry=grouped.get(id);if(entry)entry.count++;else grouped.set(id,{path:row.path,rule:row.rule,signature:row.signature,count:1});}
  return [...grouped.values()].sort((a,b)=>key(a).localeCompare(key(b),'en'));
}
export function comparePrimitiveDebt(violations,inventory) {
  const errors=[],allowed=new Map(),actual=new Map(groupViolations(violations).map(row=>[key(row),row]));
  if(inventory?.version!==1||typeof inventory.sealed!=='boolean'||!Array.isArray(inventory.entries)||!Array.isArray(inventory.files)||!/^[a-f0-9]{40}$/.test(inventory.baselineCommit||''))return ['Invalid UI primitive debt inventory.'];
  if(inventory.sealed&&(inventory.entries.length||inventory.files.length))errors.push('Invalid sealed UI primitive debt inventory: allowances cannot be restored.');
  const paths=new Set();
  for(const file of inventory.files) {
    if(!file||typeof file.path!=='string'||typeof file.reason!=='string'||typeof file.removeWhen!=='string'){errors.push('Invalid primitive debt file policy.');continue;}
    if(!/^apps\/[a-z][a-z0-9-]*\/[A-Za-z0-9_./-]+$/.test(file.path)||file.path.includes('..')||paths.has(file.path)||!file.reason.trim()||!file.removeWhen.trim())errors.push('Invalid or duplicate primitive debt file policy: '+file.path);
    paths.add(file.path);
  }
  for(const row of inventory.entries) {
    if(!row||typeof row!=='object'){errors.push('Invalid primitive debt entry.');continue;}
    if(!paths.has(row.path)||!rules.has(row.rule)||!/^[a-f0-9]{64}$/.test(row.signature||'')||!Number.isSafeInteger(row.count)||row.count<1||allowed.has(key(row)))errors.push('Invalid or duplicate primitive debt entry: '+row.path);
    else allowed.set(key(row),row);
  }
  for(const [id,row] of actual) {
    const debt=allowed.get(id);
    if(!debt||row.count>debt.count){const sample=violations.find(value=>key(value)===id);errors.push(`${row.path}:${sample.line}: ${row.rule}: new/increased non-shared UI (${row.count}/${debt?.count||0}). Use common primitives; do not expand the debt inventory. ${sample.snippet}`);}
  }
  for(const [id,row] of allowed)if((actual.get(id)?.count||0)<row.count)errors.push(`${row.path}: retired ${row.rule} debt remains; prune obsolete entries, never restore the old UI.`);
  for(const path of paths)if(!inventory.entries.some(row=>row?.path===path))errors.push('Retired primitive debt file policy remains: '+path);
  return errors;
}

// The only writer decreases existing allowances. It cannot add new signatures,
// paths or counts, including when there are simultaneous new violations.
export function prunePrimitiveDebt(violations,inventory) {
  const actual=new Map(groupViolations(violations).map(row=>[key(row),row]));
  const entries=inventory.entries.flatMap(row=>{const count=Math.min(row.count,actual.get(key(row))?.count||0);return count?[{...row,count}]:[];});
  return {...inventory,files:inventory.files.filter(file=>entries.some(row=>row.path===file.path)),entries};
}
export function checkPrimitives(base=root) {
  const {paths,violations}=collectPrimitiveViolations(base),inventory=JSON.parse(readFileSync(resolve(base,inventoryPath),'utf8'));
  const errors=comparePrimitiveDebt(violations,inventory);
  if(inventory?.sealed!==true)errors.unshift('UI primitive debt inventory seal must remain enabled.');
  if(errors.length)throw Error(errors.join('\n'));
  return {files:paths.length,remaining:violations.length,signatures:inventory.entries.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.includes('--report'))console.log(JSON.stringify(collectPrimitiveViolations(),null,2));
  else if(process.argv.includes('--prune')) {
    const {violations}=collectPrimitiveViolations(),file=resolve(root,inventoryPath),previous=JSON.parse(readFileSync(file,'utf8'));
    if(previous?.sealed!==true)throw Error('UI primitive debt inventory seal must remain enabled.');
    // Validate malformed metadata before a mechanical prune. Missing/retired entries
    // are expected, other structural failures are not.
    const structural=comparePrimitiveDebt(violations,previous).filter(error=>error.startsWith('Invalid'));
    if(structural.length)throw Error(structural.join('\n'));
    const next=prunePrimitiveDebt(violations,previous),errors=comparePrimitiveDebt(violations,next);
    if(errors.length)throw Error(errors.join('\n'));
    writeFileSync(file,JSON.stringify(next,null,2)+'\n');
    console.log('Retired primitive debt pruned. New violations are never accepted.');console.log(checkPrimitives());
  } else console.log(checkPrimitives());
}
