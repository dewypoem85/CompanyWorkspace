import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoOverview } from '../lib/demo-data.js';
import { readStatisticsOverview } from '../public/overview-contract.js';

const source=()=>createDemoOverview({from:'2026-09-01',to:'2026-09-07'});
const clone=value=>structuredClone(value);

test('overview contract accepts the complete demo response without normalizing numeric data',()=>{
  const value=source();
  assert.equal(readStatisticsOverview(value),value);
  assert.equal(value.builds.combinations[0].artifacts[0].key,'0:33');
});

test('overview contract rejects malformed top-level and summary fields',()=>{
  for(const mutate of [
    value=>{value.mode='preview'},
    value=>{value.generatedAt='today'},
    value=>{value.to='invalid'},
    value=>{value.summary.totalRuns='22154'},
    value=>{value.summary.completionRate=101},
    value=>{value.summary.playTime.medianMs=-1},
    value=>{value.stats.rowsScanned=1.5}
  ]){const value=clone(source());mutate(value);assert.throws(()=>readStatisticsOverview(value),/통계 조회 응답/)}
});

test('overview contract rejects malformed nested trend, result and build fields',()=>{
  for(const mutate of [
    value=>{value.trend[0].players=-1},
    value=>{value.outcomes[0].rate=NaN},
    value=>{value.versions[0].playTime.sampleSize='1'},
    value=>{value.dimensions.platforms[0].deaths=null},
    value=>{value.builds.characters[0].versions[0].clears=-1},
    value=>{value.builds.characters[0].components.weapons[0].adoptionRate=200},
    value=>{value.builds.combinations[0].character.id={unsafe:true}},
    value=>{value.builds.combinations[0].collections[0].requirements='artifact'}
  ]){const value=clone(source());mutate(value);assert.throws(()=>readStatisticsOverview(value),/통계 조회 응답/)}
});

test('overview contract validates optional live boss and rune structures when present',()=>{
  const value=clone(source()),boss=value.bosses[0];
  boss.id='';
  Object.assign(boss,{encounterCount:1,encounterPlayers:1,matchedKills:1,encounterKillCount:1,encounterClearRate:100,
    buildStats:{characters:[{id:0,key:'id:0',name:'기사',encounters:2,kills:3,matchedKills:3,uniquePlayers:1,encounterAdoptionRate:100,clearRate:150}],skins:[],weapons:[],pets:[],nodes:[],skills:[],artifacts:[],combinations:[]}});
  value.builds.weapons[0].runeLoggedRuns=1;value.builds.weapons[0].runeEquippedRuns=1;
  value.builds.weapons[0].runes=[{key:'unique:1',name:'고유 룬',runs:1,clears:1,uniquePlayers:1,adoptionRate:100,clearRate:100}];
  value.builds.weapons[0].runeConfigurations=[];
  assert.equal(readStatisticsOverview(value),value);
  boss.buildStats.characters[0].matchedKills='1';
  assert.throws(()=>readStatisticsOverview(value),/bosses\[0\]\.buildStats\.characters\[0\]/);
  boss.buildStats.characters[0].matchedKills=3;
  boss.buildStats.characters[0].clearRate=-1;
  assert.throws(()=>readStatisticsOverview(value),/bosses\[0\]\.buildStats\.characters\[0\]/);
});

test('overview contract accepts descriptor-only runes nested inside rune configurations',()=>{
  const value=clone(source());
  const descriptor={id:null,key:'weapon:0|normal:4:1:101:4',type:'normal',name:'빨간 룬 4등급',
    characterId:0,weaponId:0,weaponSlot:'주무기',runeSlot:'일반룬',rank:4,color:1,colorName:'빨간 룬',
    colorKey:'red',effectDescription:'무기스킬 데미지증가',known:true,
    options:[{optionId:101,step:4,slot:'주 옵션',name:'무기스킬 데미지증가',category:'무기스킬 데미지',known:true}]};
  const configuration={key:descriptor.key,runes:[descriptor],runs:1,clears:1,uniquePlayers:1,adoptionRate:100,clearRate:100};
  value.builds.weapons[0].runeConfigurations=[configuration];
  value.builds.characters[0].components.weapons[0].runeConfigurations=[configuration];
  assert.equal(readStatisticsOverview(value),value);
  descriptor.key='';
  assert.throws(()=>readStatisticsOverview(value),/runeConfigurations\[0\]\.runes\[0\]/);
});

test('overview contract accepts legacy components with an empty source key',()=>{
  const value=clone(source());
  const artifact=value.builds.characters[0].components.artifacts[0];
  artifact.sourceKey='';
  artifact.known=false;
  assert.equal(readStatisticsOverview(value),value);
  artifact.sourceKey=null;
  assert.throws(()=>readStatisticsOverview(value),/components\.artifacts\[0\]/);
});

test('overview contract accepts runtime snapshot metadata without weakening field types',()=>{
  const value=clone(source());
  Object.assign(value.stats,{
    snapshot:true,snapshotPending:false,indexedStore:true,queryCache:true,filterFallback:false,factStore:true,
    requestedTo:'2026-09-07T23:59:59.999Z',dataThrough:'2026-09-07T20:59:55.687Z',cacheRevision:6,
    snapshotFormatRevision:15,factSourceDays:7,factCacheRevision:7,indexedRowsScanned:225749,
    indexedStoreState:{revision:1,days:23,rows:225749,fromDate:'2026-08-20',toDate:'2026-09-12',
      updatedAt:'2026-09-13T06:22:00.180Z',file:'/app/data/analytics-index-v1.sqlite'}
  });
  assert.equal(readStatisticsOverview(value),value);
  value.stats.snapshot='true';
  assert.throws(()=>readStatisticsOverview(value),/stats\.snapshot/);
  value.stats.snapshot=true;
  value.stats.indexedStoreState.rows=-1;
  assert.throws(()=>readStatisticsOverview(value),/stats\.indexedStoreState/);
});
