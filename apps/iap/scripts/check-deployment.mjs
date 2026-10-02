import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GoogleAuth} from 'google-auth-library';

// Run inside the production container. Prints checks, never credentials or sheet rows.
const origin=process.env.APP_ORIGIN;
assert(origin?.startsWith('https://'),'APP_ORIGIN must be the production HTTPS origin');
async function check(path,status,options={}){
  const response=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(15000),...options});
  assert.equal(response.status,status,`${path} unexpected status`);
  console.log(`${path}: ${status}`);return response;
}
const health=await check('/api/health',200);assert.equal((await health.json()).status,'ok');
await check('/api/games',401);
await check('/api/presets',401,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
const login=await check('/auth/login',303);assert.equal(login.headers.get('location'),process.env.COMPANY_PORTAL_URL+'/workspace/iap');
const internal=await fetch(process.env.COMPANY_PORTAL_INTERNAL_URL+'/api/internal/workspace/session',{redirect:'manual',signal:AbortSignal.timeout(10000)});
assert.equal(internal.status,401,'Internal portal authentication must reject unsigned requests');
console.log('Internal portal: reachable, unsigned requests rejected');

const spreadsheetId=process.env.IAP_TEST_SPREADSHEET_ID;
if(spreadsheetId){
  assert(/^[a-zA-Z0-9_-]+$/.test(spreadsheetId));
  const profiles=JSON.parse(await readFile(process.env.CONNECTOR_CONFIG_FILE,'utf8'));
  const profile=profiles[process.env.IAP_TEST_CONNECTOR??'dungeon-slasher'];
  assert(profile?.sheets?.keyFile,'Sheets reader profile missing');
  const auth=new GoogleAuth({keyFile:profile.sheets.keyFile,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Products!A1:E2`,{headers:{Authorization:'Bearer '+await auth.getAccessToken()},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,'Service account cannot read the designated sheet');
  const sheet=await response.json();assert.deepEqual(sheet.values?.[0],['productKey','name','googleId','appleId','steamId']);
  console.log('Designated sheet: readonly access and five-column schema verified');
}
console.log('Deployment checks passed; no store writes sent.');
