import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {root} from '../build-ui.mjs';
const sandbox={};vm.runInNewContext(readFileSync(resolve(root,'apps/leave/wwwroot/js/leave-grants-contract.js'),'utf8'),sandbox);const C=sandbox.LeaveGrantContract;
const context={actor:'1',actorName:'관리자',today:'2026-09-11',required:true,canDelete:true};
function sample(operation='Adjust') {
  const g={id:'9007199254740995',employeeId:'9007199254740993',type:'Manual',grantedDate:'2024-02-29',expiresDate:'2025-02-27',days:'10.5',note:'기존 메모',sourceGrantId:null,isImported:false};
  const catalog={protocol:'leave-grants-v1',actorEmployeeId:'1',actorName:context.actorName,today:context.today,reasonRequired:true,canDelete:true,employeeId:g.employeeId,employeeName:'직원',employeeSnapshot:'a'.repeat(64),defaultDate:'2026-01-01',grants:[{grant:g,snapshot:'b'.repeat(64),allocated:'0.5',settled:'1',remaining:'9'}]};
  const intent={operation,employeeId:g.employeeId,employeeSnapshot:catalog.employeeSnapshot,previousSnapshot:'b'.repeat(64),previous:catalog.grants[0],catalog,type:'Manual',grantedDate:g.grantedDate,expiresDate:g.expiresDate,days:'-1.5',reason:'보정 사유'};
  const data={operation,actorEmployeeId:'1',employeeId:g.employeeId,employeeSnapshot:catalog.employeeSnapshot,previousSnapshot:intent.previousSnapshot,snapshot:'c'.repeat(64),grant:{...g,days:'9',note:'기존 메모\r\n2026-09-11 관리자: -1.5일 보정 - 보정 사유'},beforeDays:'10.5',inputDays:'-1.5',reason:intent.reason,navigateTo:'/Admin/Adjustments?employeeId='+g.employeeId};
  return {catalog,intent,data};
}
test('grant decimal arithmetic and IDs preserve precision and signed zero rules',()=>{
  assert.equal(C.add('9007199254740993.5','-0.5'),'9007199254740993');assert.equal(C.add('-0.25','0.5'),'0.25');assert.equal(C.add('-1.5','1.5'),'0');
  assert.equal(C.decimal('+001.500'),'1.5');assert.equal(C.decimal('-000.00'),'0');for(const value of ['NaN','1e4',' 1','1,5','Infinity',''])assert.equal(C.decimal(value),null);
  assert.equal(C.half('-1.5'),true);for(const value of ['0','-0','0.25','1.51'])assert.equal(C.half(value),false);
  assert.equal(C.id('9007199254740993'),true);for(const id of [9007199254740993,'01','0','-1','9223372036854775808'])assert.equal(C.id(id),false);
});
test('grant expiry follows DateOnly clamped AddYears then previous day, not local-time arithmetic',()=>{
  for(const [input,expected] of [['2024-02-29','2025-02-27'],['2023-02-28','2024-02-27'],['0001-01-01','0001-12-31'],['9998-12-31','9999-12-30']])assert.equal(C.expiry(input),expected);
  for(const input of ['2023-02-29','2026-13-01','0000-01-01','bad']){assert.equal(C.date(input),false);assert.equal(C.expiry(input),null);}assert.equal(C.expiry('9999-01-01'),null);
});
test('grant catalog rejects changed scope, incomplete rows and inconsistent exact remaining amounts',()=>{
  const {catalog}=sample();assert.equal(C.catalog(catalog,catalog.employeeId,context),catalog);
  for(const path of ['protocol','actorEmployeeId','actorName','today','reasonRequired','canDelete','employeeId','employeeSnapshot','defaultDate','grants.0.snapshot','grants.0.remaining','grants.0.grant.id','grants.0.grant.type','grants.0.grant.days','grants.0.grant.sourceGrantId']){
    const changed=structuredClone(catalog),parts=path.split('.');let target=changed;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]='wrong';assert.throws(()=>C.catalog(changed,catalog.employeeId,context),/Unconfirmed/,path);
  }
  const duplicate=structuredClone(catalog);duplicate.grants.push(duplicate.grants[0]);assert.throws(()=>C.catalog(duplicate,catalog.employeeId,context),/Unconfirmed/);
});
test('grant acknowledgement validates all actual values before any UI commit',()=>{
  const {intent,data}=sample();assert.equal(C.saved(data,intent,context),data);
  for(const path of ['operation','actorEmployeeId','employeeId','employeeSnapshot','previousSnapshot','snapshot','beforeDays','inputDays','reason','navigateTo','grant.id','grant.employeeId','grant.type','grant.grantedDate','grant.expiresDate','grant.days','grant.note','grant.sourceGrantId','grant.isImported']){
    const changed=structuredClone(data),parts=path.split('.');let target=changed;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]='wrong';assert.throws(()=>C.saved(changed,intent,context),/Unconfirmed/,path);
  }
  const other={...intent,operation:'DeleteGrant'};assert.equal(C.resource(other),C.resource(intent));assert.notEqual(C.resource({...intent,grantedDate:'2024-03-01'}),C.resource(intent));
});
test('grant add rejects reused IDs and delete preserves null notes and exact before image',()=>{
  const {intent,data}=sample();intent.operation=data.operation='AddGrant';intent.previous=null;intent.previousSnapshot=data.previousSnapshot='';intent.days=data.inputDays='-2.5';data.beforeDays='0';data.grant.days='-2.5';data.grant.note='관리자 수동 추가 - 관리자: 보정 사유';
  assert.throws(()=>C.saved(data,intent,context),/Unconfirmed/);data.grant.id='9007199254740999';assert.equal(C.saved(data,intent,context),data);
  const remove=sample('DeleteGrant');remove.intent.days=remove.intent.previous.grant.days;remove.intent.previous.grant.note=null;
  remove.data.grant={...remove.intent.previous.grant};remove.data.inputDays=remove.intent.days;remove.data.snapshot='';assert.equal(C.saved(remove.data,remove.intent,context),remove.data);
  remove.data.grant.note='';assert.throws(()=>C.saved(remove.data,remove.intent,context),/Unconfirmed/);
});
