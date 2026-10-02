import { validPublication } from './refresh-contract.js';

const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const text=value=>typeof value==='string'&&value.length>0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const nonnegative=value=>finite(value)&&value>=0;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const rate=value=>finite(value)&&value>=0&&value<=100;
const nullableRate=value=>value===null||rate(value);
const nullableNonnegative=value=>value===null||nonnegative(value);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const identifier=value=>value===null||typeof value==='string'&&value.length>0||Number.isSafeInteger(value)&&value>=0;
const optional=(value,key,check)=>!Object.hasOwn(value,key)||check(value[key]);
const fail=path=>{throw Error(`통계 조회 응답의 ${path} 형식이 올바르지 않습니다.`)};
const requireValue=(condition,path)=>{if(!condition)fail(path)};
const array=(value,path,visit)=>{requireValue(Array.isArray(value),path);value.forEach((item,index)=>visit(item,`${path}[${index}]`))};
const optionalArray=(value,key,path,visit)=>{if(Object.hasOwn(value,key))array(value[key],path,visit)};

function distribution(value,path){
  requireValue(record(value)&&count(value.sampleSize)&&optional(value,'averageMs',v=>v===null||finite(v)&&v>=0)
    &&optional(value,'medianMs',v=>v===null||finite(v)&&v>=0)&&optional(value,'p90Ms',v=>v===null||finite(v)&&v>=0)
    &&optional(value,'estimated',v=>typeof v==='boolean')&&optional(value,'calculationSamples',count),path);
}
function descriptor(value,path){
  requireValue(record(value)&&text(value.name)&&optional(value,'id',v=>v===''||identifier(v))&&optional(value,'masterId',identifier)
    &&optional(value,'characterId',identifier)&&optional(value,'key',text)&&optional(value,'nodeKey',text)
    &&optional(value,'sourceKey',v=>typeof v==='string')&&optional(value,'code',v=>typeof v==='string')&&optional(value,'imageCode',v=>typeof v==='string')
    &&optional(value,'characterName',v=>typeof v==='string')&&optional(value,'slot',v=>typeof v==='string')
    &&optional(value,'rank',v=>typeof v==='string'||count(v))&&optional(value,'source',v=>['id','name','mixed'].includes(v))
    &&optional(value,'known',v=>typeof v==='boolean')&&optional(value,'cursed',v=>typeof v==='boolean'),path);
}
function versionMetric(value,path){
  requireValue(record(value)&&text(value.version)&&count(value.runs)&&count(value.clears)&&rate(value.clearRate),path);
}
function collection(value,path){
  requireValue(record(value)&&identifier(value.id)&&text(value.name)&&typeof value.effect==='string'&&Array.isArray(value.requirements)
    &&value.requirements.every(text)&&count(value.activations)&&rate(value.activationRate),path);
}
function runeDescriptor(value,path){
  requireValue(record(value)&&text(value.key)&&optional(value,'id',identifier)&&optional(value,'name',text)
    &&optional(value,'characterId',identifier)&&optional(value,'weaponId',identifier)
    &&optional(value,'weaponSlot',v=>typeof v==='string')&&optional(value,'runeSlot',v=>typeof v==='string')
    &&optional(value,'type',text)&&optional(value,'rank',count)&&optional(value,'color',count)
    &&optional(value,'uniqueOptionId',count)&&optional(value,'colorName',v=>typeof v==='string')
    &&optional(value,'colorKey',v=>typeof v==='string')&&optional(value,'uniqueKey',v=>typeof v==='string')
    &&optional(value,'effectKey',v=>typeof v==='string')&&optional(value,'effectDescription',v=>typeof v==='string')
    &&optional(value,'known',v=>typeof v==='boolean'),path);
  optionalArray(value,'options',`${path}.options`,(option,optionPath)=>requireValue(record(option)&&count(option.optionId)
    &&count(option.step)&&text(option.slot)&&text(option.name)&&optional(option,'category',v=>typeof v==='string')
    &&optional(option,'known',v=>typeof v==='boolean'),optionPath));
}
function rune(value,path){
  runeDescriptor(value,path);
  requireValue(count(value.runs)&&count(value.clears)&&count(value.uniquePlayers)
    &&rate(value.adoptionRate)&&rate(value.clearRate),path);
  optionalArray(value,'runes',`${path}.runes`,runeDescriptor);
}
function nestedDescriptors(value,path){
  if(Object.hasOwn(value,'character')&&value.character!==null)descriptor(value.character,`${path}.character`);
  if(Object.hasOwn(value,'skin')&&value.skin!==null)descriptor(value.skin,`${path}.skin`);
  if(Object.hasOwn(value,'pet')&&value.pet!==null)descriptor(value.pet,`${path}.pet`);
  for(const key of ['parts','weapons','skills','artifacts','nodes'])optionalArray(value,key,`${path}.${key}`,descriptor);
  requireValue(optional(value,'includesNodes',v=>typeof v==='boolean'),`${path}.includesNodes`);
}
function component(value,path){
  descriptor(value,path);
  requireValue(count(value.runs)&&count(value.clears)&&count(value.uniquePlayers)&&rate(value.adoptionRate)&&rate(value.clearRate),path);
  if(Object.hasOwn(value,'playTime'))distribution(value.playTime,`${path}.playTime`);
  if(Object.hasOwn(value,'runeLoggedRuns'))requireValue(count(value.runeLoggedRuns),`${path}.runeLoggedRuns`);
  if(Object.hasOwn(value,'runeEquippedRuns'))requireValue(count(value.runeEquippedRuns),`${path}.runeEquippedRuns`);
  optionalArray(value,'runes',`${path}.runes`,rune);optionalArray(value,'runeConfigurations',`${path}.runeConfigurations`,rune);
  nestedDescriptors(value,path);
}
function build(value,path,complete=true){
  descriptor(value,path);
  requireValue(count(value.runs)&&count(value.clears)&&count(value.uniquePlayers)&&rate(value.selectionRate)&&rate(value.clearRate),path);
  distribution(value.playTime,`${path}.playTime`);
  if(complete)array(value.versions,`${path}.versions`,versionMetric);else optionalArray(value,'versions',`${path}.versions`,versionMetric);
  optionalArray(value,'collections',`${path}.collections`,collection);optionalArray(value,'synergies',`${path}.synergies`,collection);
  if(Object.hasOwn(value,'components')){
    requireValue(record(value.components),`${path}.components`);
    for(const key of ['skins','weapons','pets','nodes','skills','artifacts'])optionalArray(value.components,key,`${path}.components.${key}`,component);
  }
  optionalArray(value,'topCombinations',`${path}.topCombinations`,(item,itemPath)=>build(item,itemPath,false));
  optionalArray(value,'topNodeCombinations',`${path}.topNodeCombinations`,(item,itemPath)=>build(item,itemPath,false));
  if(Object.hasOwn(value,'characterAdoptionRate'))requireValue(rate(value.characterAdoptionRate),`${path}.characterAdoptionRate`);
  if(Object.hasOwn(value,'characterSelectionRate'))requireValue(rate(value.characterSelectionRate),`${path}.characterSelectionRate`);
  if(Object.hasOwn(value,'globalSelectionRate'))requireValue(rate(value.globalSelectionRate),`${path}.globalSelectionRate`);
  if(Object.hasOwn(value,'runeLoggedRuns'))requireValue(count(value.runeLoggedRuns),`${path}.runeLoggedRuns`);
  if(Object.hasOwn(value,'runeEquippedRuns'))requireValue(count(value.runeEquippedRuns),`${path}.runeEquippedRuns`);
  optionalArray(value,'runes',`${path}.runes`,rune);optionalArray(value,'runeConfigurations',`${path}.runeConfigurations`,rune);
  nestedDescriptors(value,path);
}
function bossBuild(value,path){
  descriptor(value,path);
  requireValue(count(value.encounters)&&count(value.kills)&&count(value.matchedKills)&&count(value.uniquePlayers)
    &&nullableRate(value.encounterAdoptionRate)&&nullableNonnegative(value.clearRate),path);
  nestedDescriptors(value,path);
}
function boss(value,path){
  descriptor(value,path);
  requireValue(count(value.killCount)&&count(value.uniquePlayers)&&count(value.linkedRuns)&&rate(value.linkedClearRate)
    &&typeof value.legacy==='boolean',path);
  distribution(value.fightDuration,`${path}.fightDuration`);distribution(value.legacyFightDuration,`${path}.legacyFightDuration`);
  requireValue(optional(value,'durationQuality',v=>['trusted','legacy_unreliable','missing'].includes(v))
    &&optional(value,'encounterCount',count)&&optional(value,'encounterPlayers',count)
    &&optional(value,'matchedKills',count)&&optional(value,'encounterKillCount',count)
    &&optional(value,'encounterClearRate',nullableRate),path);
  if(Object.hasOwn(value,'buildStats')){
    requireValue(record(value.buildStats),`${path}.buildStats`);
    for(const key of ['characters','skins','weapons','pets','nodes','skills','artifacts','combinations'])array(value.buildStats[key],`${path}.buildStats.${key}`,bossBuild);
  }
}
function resultMetric(value,path,key='key'){
  requireValue(record(value)&&text(value[key])&&count(value.players)&&count(value.runs)&&count(value.clears)
    &&count(value.deaths)&&count(value.fails)&&rate(value.clearRate)&&rate(value.deathRate),path);
  if(Object.hasOwn(value,'playTime'))distribution(value.playTime,`${path}.playTime`);
}

function statistics(value,path){
  requireValue(record(value),path);
  const flags=new Set(['snapshot','snapshotPending','indexedStore','queryCache','filterFallback','factStore','snapshotStale']);
  const stamps=new Set(['requestedTo','dataThrough']);
  for(const [key,item] of Object.entries(value)){
    if(flags.has(key)){requireValue(typeof item==='boolean',`${path}.${key}`);continue}
    if(stamps.has(key)){requireValue(stamp(item),`${path}.${key}`);continue}
    if(key==='indexedStoreState'){
      requireValue(record(item)&&count(item.revision)&&count(item.days)&&count(item.rows)
        &&typeof item.fromDate==='string'&&typeof item.toDate==='string'&&typeof item.updatedAt==='string'
        &&text(item.file),`${path}.${key}`);
      continue;
    }
    requireValue(count(item),`${path}.${key}`);
  }
}

export function readStatisticsOverview(value){
  requireValue(record(value)&&['live','demo'].includes(value.mode)&&text(value.environment)&&stamp(value.generatedAt)
    &&stamp(value.from)&&stamp(value.to)&&Date.parse(value.from)<=Date.parse(value.to)&&text(value.schemaCutoverVersion)
    &&optional(value,'publishedAt',v=>v===null||stamp(v))&&optional(value,'publication',validPublication)
    &&optional(value,'sync',record), 'root');
  const summary=value.summary;
  requireValue(record(summary)&&count(summary.activePlayers)&&count(summary.totalRuns)&&count(summary.gameCompletions)
    &&count(summary.bossKills)&&optional(summary,'bossEncounters',count)&&rate(summary.completionRate)&&rate(summary.deathRate)
    &&record(summary.deltas), 'summary');
  distribution(summary.playTime,'summary.playTime');
  for(const key of ['activePlayers','totalRuns','completionRate','bossKills'])requireValue(summary.deltas[key]===null||finite(summary.deltas[key]),`summary.deltas.${key}`);
  array(value.trend,'trend',(item,path)=>requireValue(record(item)&&text(item.date)&&count(item.players)&&count(item.runs)&&count(item.clears)
    &&optional(item,'deaths',count)&&optional(item,'fails',count),path));
  array(value.outcomes,'outcomes',(item,path)=>requireValue(record(item)&&text(item.key)&&text(item.label)&&count(item.count)&&rate(item.rate),path));
  array(value.versions,'versions',(item,path)=>{resultMetric(item,path,'version');distribution(item.playTime,`${path}.playTime`)});
  requireValue(record(value.dimensions),'dimensions');
  for(const key of ['platforms','modes'])array(value.dimensions[key],`dimensions.${key}`,resultMetric);
  requireValue(record(value.builds)&&record(value.builds.sourceRuns)&&record(value.builds.masterData),'builds');
  for(const number of Object.values(value.builds.sourceRuns))requireValue(count(number),'builds.sourceRuns');
  for(const number of Object.values(value.builds.masterData))requireValue(count(number),'builds.masterData');
  for(const key of ['characters','skins','weapons','pets','nodes','nodeCombinations','skills','artifacts','combinations'])optionalArray(value.builds,key,`builds.${key}`,build);
  array(value.bosses,'bosses',boss);
  requireValue(record(value.schema),'schema');
  for(const key of ['totalEvents','v2Events','legacyEvents','incompleteV2Events','missingRunId','linkedBossKills'])requireValue(count(value.schema[key]),`schema.${key}`);
  for(const key of ['structuredRate','bossLinkRate'])requireValue(rate(value.schema[key]),`schema.${key}`);
  statistics(value.stats,'stats');
  return value;
}
