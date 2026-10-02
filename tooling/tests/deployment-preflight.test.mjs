import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {targets,containerFormat,sourcePath,normalizeLive,normalizeCandidate,compareBoundaries,parseArguments,execute} from '../deployment-preflight.mjs';
const image='registry.test/workspace/cs@sha256:'+'b'.repeat(64);
const raw=()=>({id:'a'.repeat(64),name:'/steam-refund-cs',imageId:'sha256:'+'c'.repeat(64),running:true,status:'running',health:'healthy',
  project:'cs',service:'steam-refund-cs',workingDirectory:'C:\\original\\cs',configFiles:'C:\\original\\cs\\docker-compose.yml',environmentFiles:'C:\\private\\cs.env',
  mounts:[{Type:'volume',Name:'cs_refund-audit',Source:'/var/lib/docker/volumes/cs_refund-audit/_data',Destination:'/app/data',RW:true,Driver:'local',Propagation:''}],
  ports:{'3000/tcp':[{HostIp:'127.0.0.1',HostPort:'3000'}]},networkNames:['cs_default','company-services']});
const config=()=>({name:'cs',services:{'steam-refund-cs':{container_name:'steam-refund-cs',image,volumes:[{type:'volume',source:'audit',target:'/app/data'}],
  ports:[{host_ip:'127.0.0.1',target:3000,published:'3000',protocol:'tcp'}],networks:{default:null,company:null},environment:{SUPER_SECRET_CANARY:'never-print-me'}}},
  volumes:{audit:{name:'cs_refund-audit'}},networks:{default:{name:'cs_default'},company:{name:'company-services'}}});
const options=()=>parseArguments(['check','--service','cs','--compose','C:/candidate/docker-compose.yml','--env-file','C:/private/cs.env','--project-directory','C:/original/cs','--project-name','cs']);
const exists=()=>({isFile:()=>true,isDirectory:()=>true});

test('deployment inventory covers every app and its checked-in Compose service/container identity',()=>{
  const apps=JSON.parse(readFileSync(resolve(root,'packages/contracts/services.json'),'utf8')).services.map(s=>s.app).sort();
  assert.deepEqual(Object.keys(targets).sort(),apps);
  for(const [app,target] of Object.entries(targets)){
    const compose=readFileSync(resolve(root,`apps/${app}/docker-compose.yml`),'utf8');
    assert.match(compose,new RegExp(`^  ${target.service}:`,'m'));assert.match(compose,new RegExp(`container_name: ${target.container}(?:\\r?\\n|$)`));
  }
});
test('Schedule Compose keeps the reviewed container DNS host for internal service calls',()=>{
  const compose=readFileSync(resolve(root,'apps/schedule/docker-compose.yml'),'utf8');
  assert.match(compose,/AllowedHosts:\s*"schedule\.example\.com;localhost;127\.0\.0\.1;company-schedule"/);
});
test('matching boundaries preserve immutable rollback identity but never constitute deployment approval',()=>{
  const result=compareBoundaries(normalizeLive('cs',raw()),normalizeCandidate('cs',config()));
  assert.equal(result.boundaryCompatible,true);assert.deepEqual(result.differences,[]);assert.equal(result.deploymentApproved,false);assert.equal(result.rollbackImageId,raw().imageId);assert.equal(result.candidateImage,image);assert.equal(result.unverified.length,6);
});
test('changed project, audit volume, bind target/mode, port, network and image pin are rejected',()=>{
  for(const [key,mutate] of [
    ['compose-project',c=>c.name='new-project'],['mounts',c=>c.volumes.audit.name='new-empty-volume'],['mounts',c=>c.services['steam-refund-cs'].volumes[0].target='/app/data-new'],
    ['mounts',c=>c.services['steam-refund-cs'].volumes[0].read_only=true],['ports',c=>c.services['steam-refund-cs'].ports[0].host_ip='0.0.0.0'],
    ['ports',c=>c.services['steam-refund-cs'].ports[0].published='3100'],['networks',c=>c.networks.company.name='different-services'],['candidate-image-not-pinned',c=>c.services['steam-refund-cs'].image='latest']]){
    const c=config();mutate(c);const result=compareBoundaries(normalizeLive('cs',raw()),normalizeCandidate('cs',c));assert.equal(result.boundaryCompatible,false,key);assert.ok(result.differences.includes(key),key);
  }
  for(const change of [{running:false,status:'exited'},{health:'starting'},{health:'unhealthy'}])assert.ok(compareBoundaries(normalizeLive('cs',{...raw(),...change}),normalizeCandidate('cs',config())).differences.includes('current-service-not-ready'));
});
test('Windows drive/separator comparison preserves directory case and never guesses engine or relative path mapping',()=>{
  assert.equal(sourcePath('C:\\dev\\docker\\sheet\\data\\'),sourcePath('c:/dev/docker/sheet/data'));assert.notEqual(sourcePath('/run/desktop/mnt/host/c/dev/docker/sheet/data'),sourcePath('C:/dev/docker/sheet/data'));
  assert.notEqual(sourcePath('C:/Data'),sourcePath('C:/data')); // A Windows directory may have case-sensitive mode enabled.
  for(const path of ['./data','../private/credential.json','\\\\server\\share','//server/share',''])assert.throws(()=>sourcePath(path));
  const r=raw();r.mounts=[{Type:'bind',Source:'C:\\original\\data',Destination:'/app/data',RW:true,Propagation:'rprivate'}];const c=config();c.services['steam-refund-cs'].volumes=[{type:'bind',source:'C:/original/data',target:'/app/data'}];
  assert.equal(compareBoundaries(normalizeLive('cs',r),normalizeCandidate('cs',c)).boundaryCompatible,true);
  c.services['steam-refund-cs'].volumes[0].source='C:/new-checkout/data';assert.ok(compareBoundaries(normalizeLive('cs',r),normalizeCandidate('cs',c)).differences.includes('mounts'));
});
test('missing identities, implicit ports and ambiguous or unsupported mount mechanisms fail closed',()=>{
  for(const mutate of [r=>r.name='/other',r=>delete r.project,r=>r.imageId='latest',r=>delete r.mounts,r=>r.mounts.push(r.mounts[0]),r=>r.mounts[0].Type='tmpfs',r=>delete r.mounts[0].Name]){const r=raw();mutate(r);assert.throws(()=>normalizeLive('cs',r));}
  for(const mutate of [c=>c.services.other={},c=>delete c.name,c=>delete c.volumes.audit.name,c=>delete c.services['steam-refund-cs'].ports[0].host_ip,c=>c.services['steam-refund-cs'].volumes.push(c.services['steam-refund-cs'].volumes[0]),c=>c.services['steam-refund-cs'].volumes[0].volume={subpath:'empty'},c=>c.services['steam-refund-cs'].secrets=['unreviewed'],c=>c.volumes.audit.driver_opts={device:'/different'}]){const c=config();mutate(c);assert.throws(()=>normalizeCandidate('cs',c));}
});
test('CLI requires explicit local config identity and only supports inspection/check, never up or restart',()=>{
  assert.equal(parseArguments(['inspect','--service','all']).app,'all');assert.equal(options().project,'cs');
  for(const args of [[],['up','--service','cs'],['inspect','--service','other'],['inspect','--service','cs','--compose','C:/x'],['check','--service','all'],['check','--service','cs'],['inspect','--service','cs','--service','cs'],['inspect','--service','cs','--output','dump.env']])assert.throws(()=>parseArguments(args));
  const args=['check','--service','cs','--compose','relative.yml','--env-file','C:/private/cs.env','--project-directory','C:/original/cs','--project-name','cs'];assert.throws(()=>parseArguments(args));
});
test('actual CLI orchestration issues only allowlisted reads and strips environment, arbitrary labels and health output',()=>{
  const calls=[],r={...raw(),Config:{Env:['SECRET=never-print-me']},labels:{other:'never-print-me'},healthLog:'never-print-me'};
  const run=(exe,args,settings)=>{calls.push(args);assert.equal(exe,'docker');assert.equal(settings.windowsHide,true);return JSON.stringify(args[0]==='info'?'engine-test':args[0]==='inspect'?r:config());};
  const result=execute(options(),run,exists);assert.equal(result.boundaryCompatible,true);assert.equal(result.deploymentApproved,false);assert.equal(calls.length,4);
  assert.equal(calls.filter(args=>args[0]==='compose').length,1);assert.ok(calls[1].includes('--no-env-resolution'));assert.ok(calls[1].includes('config'));
  assert.ok(calls.every(args=>['info','inspect','compose'].includes(args[0])));assert.equal(JSON.stringify(result).includes('never-print-me'),false);assert.equal(JSON.stringify(result).includes('SUPER_SECRET'),false);
  for(const denied of ['.Config.Env','.State.Health.Log','.Config.Cmd','.Config.Entrypoint','{{json .}}'])assert.equal(containerFormat.includes(denied),false);
});
test('daemon changes, missing source files and Docker/parser failures cannot produce a ready result or leak stderr',()=>{
  let infos=0;assert.throws(()=>execute(options(),(_,args)=>JSON.stringify(args[0]==='info'?'engine-'+infos++:args[0]==='inspect'?raw():config()),exists),/engine changed/);
  assert.throws(()=>execute(options(),()=>JSON.stringify('engine'),()=>({isFile:()=>false})),/existing file/);
  assert.throws(()=>execute(options(),()=>{throw Error('SUPER_SECRET_CANARY');},exists),error=>!error.message.includes('SUPER_SECRET_CANARY')&&error.message.includes('suppressed'));
  assert.throws(()=>execute(options(),()=>'{SUPER_SECRET_CANARY',exists),error=>!error.message.includes('SUPER_SECRET_CANARY')&&error.message.includes('invalid JSON'));
});
