import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const storage=extract('function setSourceStatus(', 'function renderPublication(');
const publication=extract('function renderPublication(', 'function lastAggregationLabel(');
const initialize=extract('async function initialize()', 'function bindRouting()');
function fixture(config) {
  const element=()=>({textContent:'',className:'',dataset:{},classList:{toggle(){}}});
  const elements={source:element(),persistence:element(),persistenceDot:element()};
  const calls=[];
  const readSession={run:async(channel,work)=>{assert.equal(channel,'statistics-bootstrap');return{status:'success',value:await work(new AbortController().signal),isCurrent:()=>true}}};
  const sandbox={elements,state:{invalid:false,readSession},formatNumber:value=>String(value),lastAggregationLabel:()=> '마지막 집계 확인 중',
    // Local account UI has intentionally been removed; accessing it is a regression.
    $:selector=>{throw Error('Unexpected legacy DOM access: '+selector);},
    setText:()=>{throw Error('Account display belongs to the common workspace header');},
    setPeriod(){},bindRouting(){},bindGlobalFilters(){},bindDetailFilters(){},applyRoute(){},
    fetchJson:async url=>{assert.equal(url,'/api/config');return config;},
    renderPublication:()=>calls.push('publication'),attachStatisticsRefresh:()=>({startPolling:()=>calls.push('poll')}),
    loadData:async()=>calls.push('loadData'),showMessage:message=>calls.push(message)};
  vm.createContext(sandbox); vm.runInContext(storage+'\n'+publication+'\n'+initialize.slice(0,initialize.indexOf('function stopDataRequests')),sandbox);
  const renderPublication=sandbox.renderPublication;
  sandbox.renderPublication=()=>calls.push('publication');
  sandbox.initializeRefresh=()=>{ if(config.publication?.inProgress)calls.push('poll'); };
  return {sandbox,calls,elements,renderPublication};
}
test('live config initializes storage and continues to load analytics without a local avatar',async()=>{
  assert.doesNotMatch(html,/class="avatar"|data-company-user/);
  for(const attribute of ['data-source-badge','data-persistence','data-persistence-dot'])assert.ok(html.includes(attribute));
  const f=fixture({storageConfigured:true,sync:{persistence:'azure'},publication:{inProgress:false}});
  await f.sandbox.initialize();
  assert.deepEqual(f.calls,['publication','loadData']);
  assert.equal(f.elements.source.textContent,'집계 시각 확인 중');
  assert.equal(f.elements.source.dataset.tone,'neutral');
  assert.equal(f.elements.persistence.textContent,'Azure 영속 저장');
});
test('demo initialization loads data and keeps publication polling when requested',async()=>{
  const f=fixture({storageConfigured:false,publication:{inProgress:true}});
  await f.sandbox.initialize();
  assert.deepEqual(f.calls,['publication','poll','loadData']);
  assert.equal(f.elements.source.textContent,'DEMO DATA');
  assert.equal(f.elements.source.dataset.tone,'warning');
  assert.equal(f.elements.persistence.textContent,'로컬 캐시');
});
test('processed Azure storage remains labeled correctly',()=>{
  const f=fixture({});f.sandbox.renderStorageStatus({processedStorageConfigured:true});
  assert.equal(f.elements.persistence.textContent,'Azure 영속 저장');
});
test('publication states map progress, completion and failure to semantic tones',()=>{
  const f=fixture({});
  f.renderPublication({inProgress:true,totalProfiles:10,publishedProfiles:4});
  assert.equal(f.elements.source.dataset.tone,'info');
  assert.match(f.elements.source.textContent,/집계 중 4\/10/);
  f.renderPublication({inProgress:false,status:'idle'});
  assert.equal(f.elements.source.dataset.tone,'success');
  f.renderPublication({inProgress:false,status:'error'});
  assert.equal(f.elements.source.dataset.tone,'danger');
});
