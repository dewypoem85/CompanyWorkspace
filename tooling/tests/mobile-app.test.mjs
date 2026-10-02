import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {outputs,root} from '../build-ui.mjs';

const contract=JSON.parse(readFileSync(resolve(root,'packages/contracts/mobile-app.json'),'utf8'));
const generated=outputs();
const text=path=>String(generated.get(path));

test('mobile contract generates the same Digital Asset Links policy for every trusted service',()=>{
  assert.equal(contract.packageId,'com.nspg.companyworkspace');
  assert.equal(contract.trustedOrigins.length,7);
  const targets=['portal/wwwroot','leave/wwwroot','schedule/public','cs/public','statistics/public','sheet/src/client/public','iap/public'];
  for(const target of targets){
    const policy=JSON.parse(text(`apps/${target}/.well-known/assetlinks.json`));
    assert.deepEqual(policy[0].relation,['delegate_permission/common.handle_all_urls','delegate_permission/common.use_as_origin']);
    assert.equal(policy[0].target.package_name,contract.packageId);
    assert.deepEqual(policy[0].target.sha256_cert_fingerprints,[contract.signingCertificateSha256]);
  }
});

test('PWA shell keeps authenticated and business data out of the offline cache',()=>{
  const worker=readFileSync(resolve(root,'apps/portal/wwwroot/service-worker.js'),'utf8');
  assert.match(worker,/offline\.html/);
  assert.match(worker,/fetch\(new Request\(request,\{cache:'reload'\}\)\)/);
  assert.doesNotMatch(worker,/\/api\//);
  assert.doesNotMatch(worker,/notifications|employees|leave|schedule/i);
  const portal=readFileSync(resolve(root,'apps/portal/Program.cs'),'utf8');
  assert.match(portal,/StartsWithSegments\("\/css\/company-workspace\.css"\)/);
  assert.match(portal,/StartsWithSegments\("\/js\/company-workspace\.js"\)/);
  assert.match(portal,/Headers\.CacheControl = "no-store"/);
  const manifest=JSON.parse(text('apps/portal/wwwroot/manifest.webmanifest'));
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.display,'standalone');
});

test('PWA shared CSS uses the network before a cached fallback',async()=>{
  const handlers=new Map(),old={value:'old'},fresh={ok:true,type:'basic',value:'fresh',clone(){return this}};
  let online=true,putCount=0;
  const cache={put:async()=>{putCount++}};
  const worker=readFileSync(resolve(root,'apps/portal/wwwroot/service-worker.js'),'utf8');
  runInNewContext(worker,{
    self:{location:{origin:'https://company.example.com'},addEventListener:(kind,handler)=>handlers.set(kind,handler)},
    caches:{open:async()=>cache,match:async()=>old},
    fetch:async()=>{if(!online)throw new Error('offline');return fresh},
    Request:class{constructor(request,options){Object.assign(this,request);this.cache=options.cache}},
    URL
  });
  const request={method:'GET',url:'https://company.example.com/css/company-workspace.css',mode:'same-origin'};
  const run=async()=>{
    let response,lifetime;
    handlers.get('fetch')({request,respondWith:value=>{response=value},waitUntil:value=>{lifetime=value}});
    const result=await response;
    if(lifetime)await lifetime;
    return result;
  };
  assert.equal(await run(),fresh);
  assert.equal(putCount,1);
  online=false;
  assert.equal(await run(),old);
});

test('Android source contains no committed Firebase or signing secret',()=>{
  const gradle=readFileSync(resolve(root,'apps/mobile-android/app/build.gradle.kts'),'utf8');
  assert.match(gradle,/ANDROID_KEYSTORE_PATH/);
  assert.doesNotMatch(gradle,/storePassword\s*=\s*"/);
  assert.match(readFileSync(resolve(root,'apps/mobile-android/.gitignore'),'utf8'),/google-services\.json/);
});

test('Android launch artwork keeps the logo inside the splash mask',()=>{
  const android=resolve(root,'apps/mobile-android/app/src/main/res');
  const modern=readFileSync(resolve(android,'values-v31/styles.xml'),'utf8');
  const splash=readFileSync(resolve(android,'drawable/splash_icon.xml'),'utf8');
  const legacy=readFileSync(resolve(android,'drawable/launch_background.xml'),'utf8');
  assert.match(modern,/<item name="android:windowSplashScreenAnimatedIcon">@drawable\/splash_icon<\/item>/);
  assert.match(splash,/android:width="288dp" android:height="288dp"/);
  assert.match(splash,/android:width="128dp" android:height="128dp"/);
  assert.match(splash,/<bitmap android:src="@drawable\/company_logo"/);
  assert.match(legacy,/android:width="96dp" android:height="96dp"/);
  assert.equal(contract.versionName,'1.1.10');
  assert.equal(contract.versionCode,15);
});

test('native shell keeps Google login in a Custom Tab and web content on trusted hosts',()=>{
  const activity=readFileSync(resolve(root,'apps/mobile-android/app/src/main/java/com/nspg/companyworkspace/NativeShellActivity.kt'),'utf8');
  assert.match(activity,/CustomTabsIntent\.Builder\(\)/);
  assert.match(activity,/MobileInputPolicy\.isTrustedHttps/);
  assert.match(activity,/MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(activity,/clearCache\(true\)/);
  assert.doesNotMatch(activity,/removeAllCookies|deleteAllData/);
  assert.match(activity,/WindowInsetsCompat\.Type\.systemBars\(\)/);
  assert.match(activity,/WindowInsetsCompat\.Type\.ime\(\)/);
  assert.match(activity,/WindowInsetsCompat\.CONSUMED/);
  assert.doesNotMatch(activity,/WindowCompat\.getInsetsController\(window, root\)/);
  assert.doesNotMatch(activity,/addJavascriptInterface/);
  assert.equal(contract.appName,'96%');
});

test('native shell keeps the common web header and its theme, account and service navigation',()=>{
  const activity=readFileSync(resolve(root,'apps/mobile-android/app/src/main/java/com/nspg/companyworkspace/NativeShellActivity.kt'),'utf8');
  const shell=readFileSync(resolve(root,'packages/workspace-ui/src/company-workspace.js'),'utf8');
  assert.doesNotMatch(activity,/company-native-shell-style|--cw-header-height','0px'|\.cw-header\{display:none/);
  assert.doesNotMatch(activity,/root\.addView\(top/);
  assert.match(shell,/data-cw-nav/);
  assert.match(shell,/class="cw-current"/);
  assert.match(shell,/data-cw-panel="services"/);
  assert.match(shell,/data-cw-panel="theme"/);
  assert.match(shell,/data-cw-account/);
  assert.match(shell,/data-cw-logout/);
  assert.match(activity,/setForceDarkAllowed\(false\)/);
  assert.match(activity,/setAlgorithmicDarkeningAllowed\(false\)/);
});
