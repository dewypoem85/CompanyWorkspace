/* Leave-only value/receipt rules. Native transport, states and dialogs remain shared. */
(() => {
  'use strict';
  const types={Manual:'수동/보정',Annual:'연차',Monthly:'월차',CarriedOver:'이월',Imported:'가져오기'};
  const id=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&BigInt(v)<=9223372036854775807n;
  const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  function decimal(value) {
    if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(value)||value.length>60)return null;
    const negative=value[0]==='-',parts=value.replace(/^[-+]/,'').split('.');
    const whole=parts[0].replace(/^0+(?=\d)/,''),fraction=(parts[1]||'').replace(/0+$/,'');
    const text=whole+(fraction?'.'+fraction:'');return negative&&text!=='0'?'-'+text:text;
  }
  function add(a,b) {
    a=decimal(a);b=decimal(b);if(a===null||b===null)throw Error('Invalid decimal');
    const scale=Math.max((a.split('.')[1]||'').length,(b.split('.')[1]||'').length);
    const integer=v=>{const [whole,fraction='']=v.split('.');return BigInt(whole+fraction.padEnd(scale,'0'));};
    const n=integer(a)+integer(b),raw=(n<0n?-n:n).toString().padStart(scale+1,'0');
    return decimal((n<0n?'-':'')+(scale?raw.slice(0,-scale)+'.'+raw.slice(-scale):raw));
  }
  const negate=v=>v==='0'?'0':v.startsWith('-')?v.slice(1):'-'+v;
  const half=v=>{const n=decimal(v);return n!==null&&n!=='0'&&(!n.includes('.')||n.endsWith('.5'));};
  function date(v) {
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))return false;
    const [y,m,d]=v.split('-').map(Number),time=new Date(0);time.setUTCHours(0,0,0,0);time.setUTCFullYear(y,m-1,d);
    return time.getUTCFullYear()===y&&time.getUTCMonth()===m-1&&time.getUTCDate()===d;
  }
  function expiry(v) {
    if(!date(v)||v.startsWith('9999'))return null;
    let [y,m,d]=v.split('-').map(Number);y++;
    const last=new Date(0);last.setUTCFullYear(y,m,0);d=Math.min(d,last.getUTCDate());
    const time=new Date(0);time.setUTCHours(0,0,0,0);time.setUTCFullYear(y,m-1,d-1);
    return time.toISOString().slice(0,10);
  }
  const amount=v=>typeof v==='string'&&decimal(v)===v;
  function grant(g,employee) {
    return g&&id(g.id)&&g.employeeId===employee&&Object.hasOwn(types,g.type)&&date(g.grantedDate)&&date(g.expiresDate)&&
      amount(g.days)&&(g.note===null||typeof g.note==='string')&&typeof g.isImported==='boolean'&&(g.sourceGrantId===null||id(g.sourceGrantId));
  }
  function catalog(data,employee,context) {
    if(!data||data.protocol!=='leave-grants-v1'||!id(employee)||data.employeeId!==employee||data.actorEmployeeId!==context.actor||
      data.actorName!==context.actorName||data.today!==context.today||data.reasonRequired!==context.required||data.canDelete!==context.canDelete||
      typeof data.employeeName!=='string'||!data.employeeName||!hash(data.employeeSnapshot)||!date(data.defaultDate)||!Array.isArray(data.grants))throw Error('Unconfirmed grant catalog');
    const ids=new Set(),slots=new Set();
    for(const row of data.grants) {
      const g=row?.grant,key=g&&[g.type,g.grantedDate].join(':');
      if(!grant(g,employee)||!hash(row.snapshot)||ids.has(g.id)||slots.has(key)||!amount(row.allocated)||!amount(row.settled)||!amount(row.remaining)||
        row.remaining!==add(add(g.days,negate(row.allocated)),negate(row.settled)))throw Error('Unconfirmed grant row');
      ids.add(g.id);slots.add(key);
    }
    return data;
  }
  function resource(intent) { return ['leave-grant-slot',intent.employeeId,intent.type,intent.grantedDate,intent.previousSnapshot].join(':'); }
  function saved(data,intent,context) {
    const old=intent.previous?.grant,g=data?.grant;
    const before=old?.days||'0',total=intent.operation==='Adjust'?add(before,intent.days):intent.days;
    let note;
    if(intent.operation==='Adjust') {
      const text=`${context.today} ${context.actorName}: ${intent.days.startsWith('-')?'':'+'}${intent.days}일 보정 - ${intent.reason}`;
      note=old?.note?.trim()?old.note+'\n'+text:text;
    } else if(intent.operation==='AddGrant')note=`관리자 수동 추가 - ${context.actorName}: ${intent.reason}`;
    else note=old?.note;
    if(!data||data.operation!==intent.operation||data.actorEmployeeId!==context.actor||data.employeeId!==intent.employeeId||
      data.employeeSnapshot!==intent.employeeSnapshot||data.previousSnapshot!==intent.previousSnapshot||data.beforeDays!==before||
      data.inputDays!==intent.days||data.reason!==intent.reason||data.navigateTo!==`/Admin/Adjustments?employeeId=${intent.employeeId}`||
      !grant(g,intent.employeeId)||g.type!==intent.type||g.grantedDate!==intent.grantedDate||g.expiresDate!==intent.expiresDate||g.days!==total||
      (note===null?g.note!==null:typeof g.note!=='string'||g.note.replace(/\r\n/g,'\n')!==note.replace(/\r\n/g,'\n'))||g.isImported!==(old?.isImported??false)||g.sourceGrantId!==(old?.sourceGrantId??null)||
      (old?g.id!==old.id:intent.catalog.grants.some(row=>row.grant.id===g.id))||
      (intent.operation==='DeleteGrant'?data.snapshot!=='':!hash(data.snapshot)||data.snapshot===intent.previousSnapshot))throw Error('Unconfirmed grant receipt');
    return data;
  }
  globalThis.LeaveGrantContract=Object.freeze({types,id,hash,decimal,add,half,date,expiry,catalog,resource,saved});
})();
