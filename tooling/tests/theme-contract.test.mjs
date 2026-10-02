import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {root} from '../build-ui.mjs';
import {tokenOwner,themeDefinition,checkThemeSource,collectThemeSources,checkThemes} from '../check-theme-contract.mjs';

const canonical=readFileSync(resolve(root,tokenOwner),'utf8');
const definition=themeDefinition(canonical);
const token=(source,selector,name)=>{
  const block=source.match(new RegExp(selector+'\\s*\\{([^}]*)\\}'))?.[1]||'';
  const value=block.match(new RegExp(name.replaceAll('-','\\-')+'\\s*:\\s*(#[0-9a-f]{3,8})','i'))?.[1];
  assert.ok(value,`${selector} ${name}`);
  return value;
};
const rgb=value=>{
  let hex=value.slice(1);if(hex.length===3)hex=hex.split('').map(x=>x+x).join('');
  return [0,2,4].map(offset=>parseInt(hex.slice(offset,offset+2),16));
};
const distance=(left,right)=>Math.sqrt(rgb(left).reduce((sum,value,index)=>sum+(value-rgb(right)[index])**2,0));
const luminance=value=>{
  const channels=rgb(value).map(item=>{const normalized=item/255;return normalized<=.04045?normalized/12.92:((normalized+.055)/1.055)**2.4;});
  return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
};
const contrast=(left,right)=>{const values=[luminance(left),luminance(right)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);};
test('canonical theme and every registered UI source satisfy the contract',()=>{
  assert.deepEqual(definition.errors,[]);
  assert.ok(definition.names.size>=40);
  assert.ok(definition.names.has('--cw-control-knob'));
  for(const name of ['--cw-text-soft','--cw-accent-hover','--cw-danger-line','--cw-success-line','--cw-warning-line','--cw-info-line','--cw-sunday-bg','--cw-saturday-bg'])assert.ok(definition.names.has(name),name);
  const result=checkThemes();assert.ok(result.files>190);assert.equal(result.tokens,definition.names.size);
});
test('both palettes separate canvas, controls, hover and selected states',()=>{
  for(const selector of [':root','html\\[data-theme="dark"\\]']){
    const colors=Object.fromEntries(['canvas','surface','raised','hover','active','text','active-text'].map(name=>[name,token(canonical,selector,`--cw-${name}`)]));
    assert.ok(distance(colors.canvas,colors.surface)>=10,`${selector} canvas/surface`);
    assert.ok(distance(colors.surface,colors.raised)>=8,`${selector} surface/raised`);
    assert.ok(distance(colors.raised,colors.hover)>=10,`${selector} raised/hover`);
    assert.ok(distance(colors.surface,colors.active)>=18,`${selector} surface/active`);
    assert.ok(contrast(colors.text,colors.surface)>=7,`${selector} text contrast`);
    assert.ok(contrast(colors['active-text'],colors.active)>=4.5,`${selector} selected contrast`);
  }
  const darkSurface=rgb(token(canonical,'html\\[data-theme="dark"\\]','--cw-surface'));
  assert.ok(Math.max(...darkSurface)-Math.min(...darkSurface)<=8,'dark surface must stay neutral, not blue-tinted');
});
test('missing mode, missing counterpart, duplicate and out-of-block definitions fail',()=>{
  for(const changed of [
    canonical.replace('html[data-theme="dark"]','html[data-theme="other"]'),
    canonical.replace('--cw-text:#f1f3f5;',''),
    canonical.replace('--cw-text:#f1f3f5;','--cw-text:#f1f3f5;--cw-text:white;'),
    canonical+'\n.other{--cw-text:red;}',
    canonical.replace('--cw-text:#f1f3f5;','--cw-text:#f1f3f5;--cw-only-dark:black;'),
    canonical.replace('--cw-text:#f1f3f5;','--cw-text:#f1f3f5;--cw-header-height:88px;')
  ])assert.ok(themeDefinition(changed).errors.length,changed.slice(-80));
});
test('undefined references fail in styles, Razor, React, and script reads',()=>{
  for(const [file,body] of [
    ['x.css','a{background:var(--cw-input,black)}'],
    ['x.cshtml','<div style="color:var(--cw-missing)">text</div>'],
    ['x.tsx','const style={color:"var(--cw-missing)"};'],
    ['x.js','style.getPropertyValue("--cw-missing")'],
    ['x.js','style.getPropertyValue(`--cw-text${mode}`)']
  ])assert.match(checkThemeSource(file,body,definition).join('\n'),/undefined or computed/);
  assert.match(checkThemeSource('x.css','\n\na{color:var(--cw-missing)}',definition)[0],/x.css:3:/);
});
test('known tokens are read-only outside their canonical owner',()=>{
  for(const [file,body] of [
    ['x.css',':root{--cw-text:red}'],
    ['x.js','node.style.setProperty("--cw-text", "red")'],
    ['x.tsx','const style={"--cw-text":"red"}'],
    ['x.cshtml','<div style="--cw-text:red"></div>'],
    ['x.css','@property --cw-text { syntax:"<color>"; }']
  ])assert.match(checkThemeSource(file,body,definition).join('\n'),/owned by the shared theme/);
  assert.deepEqual(checkThemeSource('x.js','style.getPropertyValue("--cw-text")',definition),[]);
  assert.deepEqual(checkThemeSource('x.css','a{color:var(--cw-text);background:var(--cw-raised)}',definition),[]);
});
test('applications cannot own theme modes or foundational palette values',()=>{
  for(const body of [
    'html[data-theme="dark"] body{background:black}',
    '[data-theme=light] .card{color:white}',
    '.theme-dark .card{background:#111}',
    '@media(prefers-color-scheme:dark){body{background:#111}}'
  ])assert.match(checkThemeSource('apps/example/public/theme.css',body,definition).join('\n'),/theme-mode CSS is forbidden/);
  for(const body of [
    ':root{--surface:#fff}',
    ':root{--bg:rgb(1,2,3)}',
    ':root{--primary:blue}',
    ':root{--calendar-red:#c00}'
  ])assert.match(checkThemeSource('apps/example/public/theme.css',body,definition).join('\n'),/palette alias/);
  assert.deepEqual(checkThemeSource('apps/example/public/theme.css',':root{--surface:var(--cw-surface);--primary:var(--cw-accent)}',definition),[]);
  assert.deepEqual(checkThemeSource(tokenOwner,'html[data-theme="dark"] body{background:var(--cw-canvas)}',definition),[]);
});
test('comments are ignored without treating quoted URLs as comments',()=>{
  assert.deepEqual(checkThemeSource('x.js','// --cw-unknown\nconst url="https://example.test"; /* --cw-unknown */',definition),[]);
  assert.deepEqual(checkThemeSource('x.cshtml','<!-- --cw-unknown --> @* --cw-unknown *@ <p style="color:var(--cw-text)"></p>',definition),[]);
  assert.deepEqual(checkThemeSource('x.css','/* --cw-unknown */ a{background:url("https://example.test/a.png")}',definition),[]);
  assert.ok(checkThemeSource('x.js','const url="https://example.test";style.getPropertyValue("--cw-unknown")',definition).length);
});
test('all adapters include newly added nested UI files, with narrowly bounded generated/vendor exceptions',()=>{
  mkdirSync(resolve(root,'artifacts'),{recursive:true});
  const base=mkdtempSync(resolve(root,'artifacts/theme-inventory-'));
  const catalog=JSON.parse(readFileSync(resolve(root,'packages/contracts/services.json'),'utf8'));
  const add=(path,body='')=>{mkdirSync(dirname(resolve(base,path)),{recursive:true});writeFileSync(resolve(base,path),body);};
  add('packages/workspace-ui/src/new.css');add('packages/workspace-ui/react/new.tsx');
  const expected=[];
  for(const service of catalog.services){
    const app='apps/'+service.app;
    const boundaries=service.adapter==='razor'?['Pages','wwwroot']:service.adapter==='react'?[service.client]:['public'];
    for(const boundary of boundaries){const path=app+'/'+boundary+'/new/nested/theme.css';expected.push(path);add(path);}
    if(service.adapter==='react')add(app+'/'+(service.document||service.client+'/index.html'));
  }
  add('apps/portal/wwwroot/css/company-workspace.css');
  add('apps/portal/wwwroot/css/company-workspace-copy.css');
  add('apps/leave/wwwroot/lib/jquery/jquery.js');
  add('apps/leave/wwwroot/lib/new-widget/theme.css');
  const files=collectThemeSources(base,catalog);
  for(const path of expected)assert.ok(files.includes(path),path);
  assert.ok(!files.includes('apps/portal/wwwroot/css/company-workspace.css'));
  assert.ok(files.includes('apps/portal/wwwroot/css/company-workspace-copy.css'));
  assert.ok(!files.includes('apps/leave/wwwroot/lib/jquery/jquery.js'));
  assert.ok(files.includes('apps/leave/wwwroot/lib/new-widget/theme.css'));
  assert.throws(()=>collectThemeSources(base,{services:[]}),/registered/);
  assert.throws(()=>collectThemeSources(base,{services:[{app:'../outside',adapter:'razor'}]}),/path/);
  assert.throws(()=>collectThemeSources(base,{services:[{app:'missing',adapter:'razor'}]}),/ENOENT/);
  assert.throws(()=>collectThemeSources(base,{services:[{app:'schedule',adapter:'react',client:'src',document:'../../outside.html'}]}),/stay in/);
});
