import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresRepository} from '../src/server/repository.js';
import {Pool} from 'pg';
const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL is required');
const schema='iap_test_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA "${schema}"`);
const isolated=new URL(url);isolated.searchParams.set('options',`-c search_path=${schema}`);
const first=new PostgresRepository(isolated.toString()),second=new PostgresRepository(isolated.toString());
try{
  await first.migrate();await first.put('snapshot','s',{original:true},0);await assert.rejects(()=>first.put('snapshot','s',{original:false}));
  await first.put('apple_prices','prices',{points:[{id:'point',amount:'5500'}]},0);await assert.rejects(()=>first.put('apple_prices','prices',{points:[]}));
  await first.put('apple_equalizations','equalizations',{prices:[{territory:'KOR',amount:'5500',currency:'KRW'}]},0);await assert.rejects(()=>first.put('apple_equalizations','equalizations',{prices:[]}));
  await first.put('apple_territories','territories',{territories:[{code:'KOR',currency:'KRW'}]},0);await assert.rejects(()=>first.put('apple_territories','territories',{territories:[]}));
  await first.put('remote_scan','scan',{products:[{id:'remote'}]},0);await assert.rejects(()=>first.put('remote_scan','scan',{products:[]}));
  assert.equal((await second.get<any>('apple_prices','prices'))?.data.points[0].amount,'5500');
  await first.put('job','j',{state:'running',created:{id:'remote-123'},steps:[{key:'prices',state:'inflight'}]},0);
  assert.equal((await second.get<any>('job','j'))?.data.created.id,'remote-123');
  await first.lock('same-store',async()=>{await assert.rejects(()=>second.lock('same-store',async()=>{}));});
  await second.lock('same-store',async()=>{});
  await first.put('approval','a',{used:false},0);const before=await second.get('approval','a');await first.put('approval','a',{used:true},1);await assert.rejects(()=>second.put('approval','a',{used:false},before!.version));
  console.log('PostgreSQL: immutable records and remote scans, durable in-flight receipts, cross-connection advisory locks, optimistic approval consumption passed.');
}finally{await first.pool.end();await second.pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
