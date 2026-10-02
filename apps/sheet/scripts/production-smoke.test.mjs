import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sheetId='synthetic-sheet-for-production-smoke';
async function runtime(t,authenticatedOnly=false){
  const temporary=await mkdtemp(join(tmpdir(),'company-sheet-smoke-'));
  // Do not inherit company/Google credentials, .env paths, NODE_OPTIONS or proxies.
  const inherited=Object.fromEntries(['SystemRoot','WINDIR','SystemDrive','TEMP','TMP','PATH'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  const child=spawn(process.execPath,[fileURLToPath(new URL('./production-smoke-child.mjs',import.meta.url))],{
    cwd:temporary,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...inherited,
      NODE_ENV:'production',WORKSPACE_RUNTIME_SMOKE:'1',PORT:'0',ALLOW_SHEET_WRITES:'false',
      DOTENV_CONFIG_PATH:join(temporary,'absent.env'),TEST_SPREADSHEET_ID:sheetId,
      GOOGLE_SERVICE_ACCOUNT_JSON:'',GOOGLE_APPLICATION_CREDENTIALS:'',
      COMPANY_SSO_REQUIRED:String(authenticatedOnly),
      COMPANY_PORTAL_URL:authenticatedOnly?'https://company.invalid':'',
      COMPANY_SSO_SHARED_SECRET:authenticatedOnly?'synthetic-smoke-secret-not-a-real-credential':'',
    }
  });
  let finished=false;
  const exited=new Promise(resolve=>{
    child.once('exit',()=>{finished=true;resolve();});
    child.once('error',()=>{if(child.pid===undefined){finished=true;resolve();}});
  });
  t.after(async()=>{
    if(!finished)child.kill();
    let timer;
    try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Runtime fixture did not exit.')),5000);})]);}
    finally{clearTimeout(timer);}
    // Delete only this test's direct, uniquely created temporary directory.
    assert.equal(dirname(resolve(temporary)),resolve(tmpdir()));
    assert.ok(basename(temporary).startsWith('company-sheet-smoke-'));
    await rm(temporary,{recursive:true,force:true});
  });
  let output='',errors='';
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4096);});
  const origin=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`Runtime startup timed out: ${errors}`)),30000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Runtime exited ${code}: ${errors}`));});
    child.stdout.on('data',chunk=>{
      output=(output+chunk).slice(-4096);
      const match=/^SHEET_SMOKE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)$/m.exec(output);
      if(match){clearTimeout(timer);resolve(match[1]);}
    });
  });
  return (path,options={})=>{
    assert.ok(path.startsWith('/')&&!path.startsWith('//'));
    const url=new URL(path,origin);assert.equal(url.origin,origin);
    return fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(5000)});
  };
}

test('production bundle serves registered pages/assets and demo reads while real writes remain disabled',{timeout:60000},async t=>{
  const request=await runtime(t);
  const health=await request('/api/health');assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
  const config=await request('/api/config');assert.equal(config.status,200);
  const settings=await config.json();assert.equal(settings.mode,'demo');assert.equal(settings.writesEnabled,false);assert.equal(settings.defaultSpreadsheetId,sheetId);
  assert.equal(settings.actorId,'local-development');
  for(const path of ['/overview','/migration','/translations','/releases','/snapshots']){
    const page=await request(path);assert.equal(page.status,200,path);assert.match(page.headers.get('content-type'),/text\/html/);
    const html=await page.text(),asset=html.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];assert.ok(asset,path);
    const bundle=await request(asset);assert.equal(bundle.status,200);assert.match(bundle.headers.get('content-type'),/javascript/);
  }
  const analysis=await request('/api/spreadsheets/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spreadsheet:sheetId})});
  assert.equal(analysis.status,200);const result=await analysis.json();assert.equal(result.mode,'demo');assert.ok(Array.isArray(result.rules));
  const write=await request('/api/migrations/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:'수식 제거'})});
  assert.equal(write.status,503);assert.equal((await write.json()).code,'GOOGLE_CREDENTIALS_REQUIRED');
  assert.equal((await request('/unregistered-page')).status,404);
  const malformed=await request('/api/spreadsheets/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
  const oversized=await request('/api/spreadsheets/analyze',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`spreadsheet=${'a'.repeat(65*1024)}`});assert.equal(oversized.status,413);
});

test('production bundle with required company authentication rejects unauthenticated pages and API writes',{timeout:60000},async t=>{
  const request=await runtime(t,true);
  assert.equal((await request('/api/health')).status,200);
  for(const path of ['/api/config','/api/snapshots'])assert.equal((await request(path)).status,401);
  const page=await request('/migration');assert.equal(page.status,303);assert.equal(page.headers.get('cache-control'),'no-store');
  assert.equal(new URL(page.headers.get('location')).origin,'https://company.invalid');
  const write=await request('/api/migrations/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(write.status,401);
});
