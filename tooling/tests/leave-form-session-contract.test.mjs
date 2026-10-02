import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveFormSession} from '../check-architecture.mjs';
const read=file=>readFileSync(resolve(root,file),'utf8');
test('Leave cannot replace the common session with independent document locks or reuse stale resources',()=>{
  const shared=read('packages/workspace-ui/src/forms.js'),consumers=['leave-application','leave-self-actions','leave-external-schedules','leave-calendar-admin'].map(name=>read('apps/leave/wwwroot/js/'+name+'.js')),markup=read('apps/leave/Pages/Leave/Index.cshtml');
  assert.deepEqual(checkLeaveFormSession(shared,consumers,markup),[]);
  for(const marker of ['active !== token','captured.forEach(key => spent.add(key))',"outcome === 'unknown'",'previous?.abort.abort()','workspace-entity-scope-change'])assert.ok(checkLeaveFormSession(shared.replaceAll(marker,'BYPASS'),consumers,markup).length,marker);
  for(let index=0;index<consumers.length;index++)for(const marker of ['window.LeaveFormSession ||= window.CompanyForm.createSession()','session.track(sessionOwner','session.begin(sessionOwner','lease?.current',"lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown')",'session.hasDraftExcept(sessionOwner)','session.subscribe(']){const changed=[...consumers];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveFormSession(shared,changed,markup).length,`${index}: ${marker}`);}
  assert.ok(checkLeaveFormSession(shared,consumers,markup.replace("dataset.applicationSaved === 'true'",'false')).length);
  assert.ok(checkLeaveFormSession(shared,consumers,markup.replace('formRevision !== window.LeaveFormSession?.revision','false')).length);
  const changed=[...consumers];changed[2]=changed[2].replace('setEditor({...data.input,id:data.id,snapshot:data.snapshot})','baseline=snapshot(form)');assert.ok(checkLeaveFormSession(shared,changed,markup).length);
});
