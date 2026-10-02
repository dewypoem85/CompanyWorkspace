import React, { useState } from 'react';
import { filterParams } from '../api';
import { Empty, EntityName, ErrorBox, LoadingCover, Metrics, MiniLine, NodeCombinationTree, PageHead, SortHead } from '../components';
import { EntityIcon, formatDuration, formatNumber, formatPercent, useApp, useRemote } from '../shared';
import type { BuildItem, Envelope } from '../types';

type Version={version:string;runs:number;clears:number;selectionRate:number;clearRate:number};
type VersionTrend={grouping:'exact'|'family';points:number|'all';from:string;to:string};
type Component=Record<string,unknown>&{key:string;name:string;runs:number;clears:number;uniquePlayers:number;selectionRate:number;clearRate:number};
type RelatedItem=Record<string,unknown>&{key:string;name:string;runs:number;usageRate:number};
type ItemInsights={
  bossKillTimes:Array<{code:string;name:string;averageMs:number|null;kills:number}>;
  synergies:Array<{id:number;name:string;effect:string;uses:number;usageRate:number}>;
  related:Record<string,RelatedItem[]>;
};
type Response=Envelope&{type:string;item:BuildItem&{versions:Version[];versionTrend:VersionTrend;components?:Record<string,Component[]>;collections?:Array<Record<string,unknown>>;synergies?:Array<Record<string,unknown>>;insights?:ItemInsights}};
type TrendMetric='clearRate'|'selectionRate'|'runs';
type CharacterSection='overview'|'nodes'|'skins'|'weapons'|'pets'|'skills'|'artifacts'|'combinations';
type ComponentSort='name'|'runs'|'uniquePlayers'|'selectionRate'|'clearRate';

const LABELS:Record<string,string>={skins:'스킨',weapons:'무기·고유룬',pets:'펫',skills:'스킬',artifacts:'유물',nodes:'노드별 선택 현황',nodeCombinations:'자주 사용한 노드 조합',combinations:'조합',combinationsWithNodes:'노드 포함 조합'};
const CHARACTER_SECTIONS:Array<[CharacterSection,string,string]>=[
  ['overview','종합','성과와 버전 추이'],
  ['nodes','노드','인기 조합과 선택 현황'],
  ['skins','스킨','스킨별 성과'],
  ['weapons','무기·고유룬','무기와 장착 룬'],
  ['pets','펫','동행 펫'],
  ['skills','스킬','장착 스킬'],
  ['artifacts','유물','장착 유물'],
  ['combinations','조합','전체 빌드 조합']
];
const CharacterDetailOrigin=React.createContext<{characterKey:string;section:CharacterSection}|null>(null);

function useOpenBuildDetail(){
  const {navigate}=useApp();
  const origin=React.useContext(CharacterDetailOrigin);
  return (type:string,item:Record<string,unknown>)=>{
    const key=String(item.key||'');
    if(!key)return;
    const routeType=type==='combinationsWithNodes'?'combinations':type;
    const params=new URLSearchParams({type:routeType,key});
    if(type==='combinationsWithNodes')params.set('includeNodes','1');
    if(origin){params.set('fromCharacterKey',origin.characterKey);params.set('fromSection',origin.section)}
    navigate(`/builds/detail?${params}`);
  };
}

function activateDetail(event:React.KeyboardEvent,action:()=>void){
  if(event.key!=='Enter'&&event.key!==' ')return;
  event.preventDefault();
  action();
}

export default function BuildDetail(){
  const {filters,route,navigate}=useApp();
  const type=route.type||'characters',key=route.key||'';
  const initial=new URLSearchParams(location.search);
  const fromCharacterKey=initial.get('fromCharacterKey')||'';
  const fromSection=CHARACTER_SECTIONS.some(([value])=>value===initial.get('fromSection'))?initial.get('fromSection') as CharacterSection:'overview';
  const initialSection=CHARACTER_SECTIONS.some(([value])=>value===initial.get('section'))?initial.get('section') as CharacterSection:'overview';
  const [versionGrouping,setVersionGrouping]=useState<'exact'|'family'>(initial.get('versionGrouping')==='family'?'family':'exact');
  const [versionPoints,setVersionPoints]=useState<'20'|'all'>(initial.get('versionPoints')==='all'?'all':'20');
  const [trendMetric,setTrendMetric]=useState<TrendMetric>((['clearRate','selectionRate','runs'].includes(initial.get('trendMetric')||'')?initial.get('trendMetric'):'clearRate') as TrendMetric);
  const includeNodes=initial.get('includeNodes')==='1';
  const q=filterParams(filters);
  if(includeNodes)q.set('includeNodes','1');
  q.set('versionGrouping',versionGrouping);
  q.set('versionPoints',versionPoints);
  const state=useRemote<Response>(key?`/api/v2/statistics/builds/${type}/${encodeURIComponent(key)}?${q}`:null);
  const item=state.data?.item;
  const isCombinationDetail=['combinations','combinationsWithNodes','nodeCombinations'].includes(type);

  const remember=(name:string,value:string)=>{const params=new URLSearchParams(location.search);params.set(name,value);history.replaceState({},'',`${location.pathname}?${params}`)};
  const changeGrouping=(value:'exact'|'family')=>{setVersionGrouping(value);remember('versionGrouping',value)};
  const changePoints=(value:'20'|'all')=>{setVersionPoints(value);remember('versionPoints',value)};
  const changeMetric=(value:TrendMetric)=>{setTrendMetric(value);remember('trendMetric',value)};
  const trendValues=item?.versions.map(version=>Number(version[trendMetric]||0))||[];
  const trendDetails=item?.versions.map(version=>[
    {label:'출정',value:`${formatNumber(version.runs)}회`},
    {label:'클리어',value:`${formatNumber(version.clears)}회`},
    {label:'선택률',value:formatPercent(version.selectionRate)},
    {label:'클리어율',value:formatPercent(version.clearRate)}
  ])||[];
  const trendLabel=trendMetric==='clearRate'?'클리어율':trendMetric==='selectionRate'?'선택률':'플레이 수';
  const overview=item?<Overview item={item} trendLabel={trendLabel} trendValues={trendValues} trendDetails={trendDetails} trendMetric={trendMetric} versionGrouping={versionGrouping} versionPoints={versionPoints} onGrouping={changeGrouping} onPoints={changePoints} onMetric={changeMetric}/>:null;

  return <div className="page build-detail-page">
    <button type="button" className="back cw-button" data-variant="quiet" onClick={()=>navigate(fromCharacterKey?`/builds/detail?type=characters&key=${encodeURIComponent(fromCharacterKey)}&section=${fromSection}`:`/builds?type=${type}&${filterParams(filters)}`)}>{fromCharacterKey?'← 캐릭터 상세':'← 빌드 분석'}</button>
    <LoadingCover show={state.loading}/><ErrorBox message={state.error}/>
    {item?<>
      <PageHead eyebrow="BUILD DETAIL" title={isCombinationDetail?`${LABELS[type]||'조합'} 상세`:item.name} description={type==='characters'?'항목별 탭에서 캐릭터의 성과와 빌드 구성을 확인합니다.':'선택 항목의 장기 버전 추이와 함께 사용된 구성을 확인합니다.'}/>
      <section className="hero-entity"><EntityName type={type} item={item}/></section>

      {type==='characters'?<>
        <CharacterDetailTabs key={item.key} item={item} overview={overview} initialSection={initialSection} onSectionChange={value=>remember('section',value)}/>
      </>:<>
        <Metrics item={item}/>
        <ItemInsightsPanel insights={item.insights}/>
        {overview}
        {item.components?<ComponentGroup components={item.components} types={Object.keys(item.components).filter(componentType=>componentType!=='nodeCombinations')}/>:null}
      </>}

      {type==='combinations'&&<div className="split">{[['활성 시너지',item.synergies],['활성 컬렉션',item.collections]].map(([label,values])=><section className="panel" key={String(label)}><div className="panel-title"><h2>{String(label)}</h2></div>{Array.isArray(values)&&values.length?<ul className="plain-list">{values.map((value,index)=><li key={index}>{String((value as Record<string,unknown>).name||'미기록')}</li>)}</ul>:<Empty/>}</section>)}</div>}
    </>:!state.loading&&!state.error&&<Empty/>}
  </div>;
}

export function CharacterDetailTabs({item,overview,initialSection='overview',onSectionChange=()=>{}}:{item:Response['item'];overview:React.ReactNode;initialSection?:CharacterSection;onSectionChange?:(value:CharacterSection)=>void}){
  const [section,setSection]=useState<CharacterSection>(initialSection);
  const changeSection=(value:CharacterSection)=>{setSection(value);onSectionChange(value)};
  return <CharacterDetailOrigin.Provider value={{characterKey:item.key,section}}><>
    <nav className="detail-tabs" role="tablist" aria-label="캐릭터 상세 분석">
      {CHARACTER_SECTIONS.map(([value,label,description])=><button key={value} type="button" role="tab" aria-selected={section===value} className="cw-button" data-variant={section===value?'primary':'quiet'} data-layout="content" onClick={()=>changeSection(value)}><b>{label}</b><small>{description}</small></button>)}
    </nav>
    <div className="detail-tab-content" role="tabpanel">
      {section==='overview'?<CharacterOverview item={item}>{overview}</CharacterOverview>:null}
      {section==='nodes'?<NodeBuildSection components={item.components}/>:null}
      {section==='skins'?<ComponentGroup components={item.components} types={['skins']}/>:null}
      {section==='weapons'?<ComponentGroup components={item.components} types={['weapons']}/>:null}
      {section==='pets'?<ComponentGroup components={item.components} types={['pets']}/>:null}
      {section==='skills'?<ComponentGroup components={item.components} types={['skills']}/>:null}
      {section==='artifacts'?<ComponentGroup components={item.components} types={['artifacts']}/>:null}
      {section==='combinations'?<ComponentGroup components={item.components} types={['combinations','combinationsWithNodes']}/>:null}
    </div>
  </></CharacterDetailOrigin.Provider>;
}

function CharacterOverview({item,children}:{item:Response['item'];children:React.ReactNode}){
  const components=item.components||{};
  const combinationType=components.combinations?.length?'combinations':'combinationsWithNodes';
  const combinations=components[combinationType]||[];
  return <>
    <Metrics item={item}/>
    <ItemInsightsPanel insights={item.insights}/>
    <div className="overview-summary-layout">
      <OverviewPicks components={components}/>
      <div className="overview-build-stack">
        <OverviewCombinations items={combinations} componentType={combinationType}/>
        <OverviewNodes combinations={components.nodeCombinations||[]} nodes={components.nodes||[]}/>
      </div>
    </div>
    {children}
  </>;
}

function ItemInsightsPanel({insights}:{insights?:ItemInsights}){
  const openDetail=useOpenBuildDetail();
  if(!insights)return null;
  const relatedGroups=[
    {type:'characters',label:'가장 많이 사용된 캐릭터'},
    {type:'weapons',label:'가장 많이 사용된 무기'},
    {type:'skills',label:'가장 많이 같이 사용된 스킬'},
    {type:'artifacts',label:'가장 많이 같이 사용된 유물'}
  ].filter(group=>(insights.related?.[group.type]||[]).length);
  const hasAssociations=insights.synergies.length>0||relatedGroups.length>0;
  return <div className={`item-insights-grid${hasAssociations?' has-associations':''}`}>
    <section className="panel boss-time-panel">
      <div className="panel-title"><span>LAST BOSS</span><h2>마지막 보스 평균 처치 시간</h2><small>해당 항목을 장착하고 보스를 처치한 기록만 사용합니다.</small></div>
      <div className="boss-time-list">{insights.bossKillTimes.map(boss=><article key={boss.code}>
        <span><strong>{boss.name}</strong><small>{boss.kills?`${formatNumber(boss.kills)}회 처치 기준`:'처치 기록 없음'}</small></span>
        <b>{formatDuration(boss.averageMs)}</b>
      </article>)}</div>
    </section>
    {hasAssociations?<section className="panel association-panel">
      <div className="panel-title"><span>POPULAR PAIRINGS</span><h2>함께 사용된 항목</h2><small>같은 출정에서 함께 확인된 기록을 사용량순으로 정리했습니다.</small></div>
      {insights.synergies.length?<InsightGroup title="가장 많이 사용된 시너지 타입">
        {insights.synergies.map((synergy,index)=><article className="synergy-insight" key={synergy.id}>
          <b>{index+1}</b><span><strong>{synergy.name}</strong><small>{synergy.effect}</small></span><em>{formatPercent(synergy.usageRate)}</em>
        </article>)}
      </InsightGroup>:null}
      {relatedGroups.map(group=><InsightGroup key={group.type} title={group.label}>
        {(insights.related[group.type]||[]).slice(0,5).map((related,index)=><article className="related-insight build-detail-trigger" role="link" tabIndex={0} key={related.key} onClick={()=>openDetail(group.type,related)} onKeyDown={event=>activateDetail(event,()=>openDetail(group.type,related))}>
          <b>{index+1}</b><EntityName type={group.type} item={related} showRate={false}/><span><strong>{formatPercent(related.usageRate)}</strong><small>{formatNumber(related.runs)}회 함께 사용</small></span>
        </article>)}
      </InsightGroup>)}
    </section>:null}
  </div>;
}

function InsightGroup({title,children}:{title:string;children:React.ReactNode}){
  return <section className="insight-group"><h3>{title}</h3><div>{children}</div></section>;
}

function OverviewPicks({components}:{components:Record<string,Component[]>}){
  const openDetail=useOpenBuildDetail();
  const groups=[
    {type:'skins',label:'스킨',limit:2},
    {type:'weapons',label:'무기·고유룬',limit:3},
    {type:'pets',label:'펫',limit:2},
    {type:'skills',label:'스킬',limit:4},
    {type:'artifacts',label:'유물',limit:4}
  ].filter(group=>(components[group.type]||[]).length);
  return <section className="panel overview-picks-panel">
    <div className="panel-title"><span>POPULAR PICKS</span><h2>핵심 선택 요약</h2><small>현재 조건에서 많이 사용된 항목을 캐릭터 출정 기준으로 정리했습니다.</small></div>
    {groups.length?<div className="overview-pick-groups">{groups.map(group=><div className="overview-pick-group" key={group.type}>
      <h3>{group.label}</h3>
      <div>{(components[group.type]||[]).slice(0,group.limit).map((component,index)=><article className="overview-pick build-detail-trigger" role="link" tabIndex={0} key={component.key} onClick={()=>openDetail(group.type,component)} onKeyDown={event=>activateDetail(event,()=>openDetail(group.type,component))}>
        <b className="overview-pick-rank">{index+1}</b>
        <EntityIcon type={group.type} item={component} size={42}/>
        <span><strong>{component.name}</strong><small>{formatNumber(component.runs)}회 출정 · {formatNumber(component.uniquePlayers)}명≈</small></span>
        <dl className="component-rate-pair"><div><dt>선택률</dt><dd>{formatPercent(component.selectionRate)}</dd></div><div><dt>클리어율</dt><dd>{formatPercent(component.clearRate)}</dd></div></dl>
      </article>)}</div>
    </div>)}</div>:<Empty>표시할 장비·스킬 기록이 없습니다.</Empty>}
  </section>;
}

function OverviewCombinations({items,componentType}:{items:Component[];componentType:'combinations'|'combinationsWithNodes'}){
  const openDetail=useOpenBuildDetail();
  return <section className="panel overview-combinations-panel">
    <div className="panel-title"><span>CORE BUILDS</span><h2>대표 전체 조합</h2><small>가장 많이 사용된 완성 빌드입니다.</small></div>
    {items.length?<div className="overview-combination-list">{items.slice(0,3).map(item=><article className="overview-combination build-detail-trigger" role="link" tabIndex={0} key={item.key} onClick={()=>openDetail(componentType,item)} onKeyDown={event=>activateDetail(event,()=>openDetail(componentType,item))}>
      <EntityName type={componentType} item={item}/>
      <dl><div><dt>선택률</dt><dd>{formatPercent(item.selectionRate)}</dd></div><div><dt>클리어율</dt><dd>{formatPercent(item.clearRate)}</dd></div><div><dt>출정</dt><dd>{formatNumber(item.runs)}</dd></div></dl>
    </article>)}</div>:<Empty>기록된 전체 조합이 없습니다.</Empty>}
  </section>;
}

function OverviewNodes({combinations,nodes}:{combinations:Component[];nodes:Component[]}){
  const openDetail=useOpenBuildDetail();
  const combination=combinations[0];
  const byId=new Map(nodes.map(node=>[String(node.id),node]));
  const selected=combination&&Array.isArray(combination.nodes)?(combination.nodes as Component[]).map(node=>({...byId.get(String(node.id)),...node})):[];
  return <section className="panel overview-nodes-panel">
    <div className="panel-title action"><div><span>NODE BUILD</span><h2>인기 노드 조합</h2><small>가장 많이 사용된 장착 노드를 요약합니다.</small></div>{combination?<button type="button" className="cw-button" data-variant="quiet" data-size="compact" onClick={()=>openDetail('nodeCombinations',combination)}>조합 상세 →</button>:null}</div>
    {combination?<>
      <div className="overview-node-icons">{selected.map((node,index)=><span className="build-detail-trigger" role="link" tabIndex={0} key={`${String(node.id)}-${index}`} onClick={()=>openDetail('nodes',node)} onKeyDown={event=>activateDetail(event,()=>openDetail('nodes',node))}><EntityIcon type="nodes" item={node} size={38} rate={Number(node.selectionRate||0)} tooltipLabel={String(node.name||node.id||'노드')}/></span>)}</div>
      <dl className="overview-node-stats"><div><dt>선택률</dt><dd>{formatPercent(combination.selectionRate)}</dd></div><div><dt>클리어율</dt><dd>{formatPercent(combination.clearRate)}</dd></div><div><dt>출정</dt><dd>{formatNumber(combination.runs)}</dd></div></dl>
    </>:<Empty>기록된 노드 조합이 없습니다.</Empty>}
  </section>;
}

function Overview({item,trendLabel,trendValues,trendDetails,trendMetric,versionGrouping,versionPoints,onGrouping,onPoints,onMetric}:{item:Response['item'];trendLabel:string;trendValues:number[];trendDetails:Array<Array<{label:string;value:string}>>;trendMetric:TrendMetric;versionGrouping:'exact'|'family';versionPoints:'20'|'all';onGrouping:(value:'exact'|'family')=>void;onPoints:(value:'20'|'all')=>void;onMetric:(value:TrendMetric)=>void}){
  return <div className="detail-grid">
    <section className="panel">
      <div className="panel-title action trend-title"><div><span>VERSION TREND</span><h2>버전별 {trendLabel}</h2><small>{item.versionTrend.from}~{item.versionTrend.to} 보관 데이터 기준</small></div>
        <div className="trend-controls" aria-label="버전 추이 설정">
          <select className="cw-form-control" aria-label="버전 묶음" value={versionGrouping} onChange={event=>onGrouping(event.target.value as 'exact'|'family')}><option value="exact">세부 버전</option><option value="family">마이너 통합 (0.772.x)</option></select>
          <select className="cw-form-control" aria-label="표시 버전 수" value={versionPoints} onChange={event=>onPoints(event.target.value as '20'|'all')}><option value="20">최근 20개</option><option value="all">90일 전체</option></select>
          <select className="cw-form-control" aria-label="그래프 지표" value={trendMetric} onChange={event=>onMetric(event.target.value as TrendMetric)}><option value="clearRate">클리어율</option><option value="selectionRate">선택률</option><option value="runs">플레이 수</option></select>
        </div>
      </div>
      <MiniLine values={trendValues} labels={item.versions.map(version=>version.version)} details={trendDetails} hasData={item.versions.map(version=>version.runs>0)} valueLabel={trendMetric==='runs'?formatNumber:formatPercent}/>
    </section>
    <section className="panel performance-summary"><div className="panel-title"><span>PERFORMANCE</span><h2>성과 요약</h2><small>현재 필터 조건의 실제 출정 결과입니다.</small></div><dl>
      <dt>클리어</dt><dd>{formatNumber(item.clears)}회</dd>
      <dt>미클리어</dt><dd>{formatNumber(Math.max(0,item.runs-item.clears))}회</dd>
      <dt>플레이어당 출정</dt><dd>{item.uniquePlayers?`${(item.runs/item.uniquePlayers).toFixed(1)}회`:'—'}</dd>
      <dt>중앙 플레이 시간</dt><dd>{formatDuration(item.playTime?.medianMs)}</dd>
      <dt>느린 플레이 10% 경계</dt><dd>{formatDuration(item.playTime?.p90Ms)}</dd>
      <dt>집계 기간</dt><dd>{item.versionTrend.from} ~ {item.versionTrend.to}</dd>
    </dl></section>
  </div>;
}

function NodeBuildSection({components}:{components?:Record<string,Component[]>}){
  const openDetail=useOpenBuildDetail();
  const nodes=components?.nodes||[];
  const combinations=components?.nodeCombinations||[];
  return <>
    <section className="panel component-panel node-combinations-panel featured-node-combination">
      <div className="panel-title action"><div><span>NODE BUILDS</span><h2>인기 노드 조합</h2><small>가장 많이 사용된 조합을 인게임 선택 순서로 크게 표시합니다.</small></div>{combinations[0]?<button type="button" className="cw-button" data-variant="quiet" data-size="compact" onClick={()=>openDetail('nodeCombinations',combinations[0])}>조합 상세 →</button>:null}</div>
      {combinations.length?<NodeCombinationTree combination={combinations[0]} nodes={nodes}/>:<Empty>기록된 노드 조합이 없습니다.</Empty>}
    </section>
    {combinations.length>1?<section className="panel component-panel compact-node-combinations">
      <div className="panel-title"><span>OTHER BUILDS</span><h2>그 외 자주 사용한 조합</h2><small>선택한 노드와 핵심 지표만 간단히 비교합니다.</small></div>
      <div className="node-combination-compact-list">{combinations.slice(1,10).map(combination=><CompactNodeCombination key={combination.key} combination={combination} nodes={nodes}/>)}</div>
    </section>:null}
    <ComponentSection componentType="nodes" items={nodes}/>
  </>;
}

function CompactNodeCombination({combination,nodes}:{combination:Component;nodes:Component[]}){
  const openDetail=useOpenBuildDetail();
  const byId=new Map(nodes.map(node=>[String(node.id),node]));
  const selected=(Array.isArray(combination.nodes)?combination.nodes:[]) as Component[];
  const resolved=selected.map(node=>({...byId.get(String(node.id)),...node}));
  return <article className="node-combination-compact build-detail-trigger" role="link" tabIndex={0} onClick={()=>openDetail('nodeCombinations',combination)} onKeyDown={event=>activateDetail(event,()=>openDetail('nodeCombinations',combination))}>
    <div className="node-combination-compact-main"><div className="compact-node-icons">{resolved.slice(0,13).map((node,index)=><EntityIcon key={`${String(node.id)}-${index}`} type="nodes" item={node} size={34} rate={Number(node.selectionRate||0)} tooltipLabel={String(node.name||node.id||'노드')}/>)}</div></div>
    <dl><div><dt>출정</dt><dd>{formatNumber(combination.runs)}</dd></div><div><dt>선택률</dt><dd>{formatPercent(combination.selectionRate)}</dd></div><div><dt>클리어율</dt><dd>{formatPercent(combination.clearRate)}</dd></div></dl>
  </article>;
}

function ComponentGroup({components,types}:{components?:Record<string,Component[]>;types:string[]}){
  const visible=types.filter(componentType=>(components?.[componentType]||[]).length);
  if(!visible.length)return <section className="panel component-panel"><Empty>이 탭에 표시할 기록이 없습니다.</Empty></section>;
  const combinationOnly=visible.every(componentType=>componentType==='combinations'||componentType==='combinationsWithNodes');
  return <div className={`detail-section-grid${visible.length>1?' multiple':''}${combinationOnly?' combination-sections':''}`}>{visible.map(componentType=><ComponentSection key={componentType} componentType={componentType} items={components?.[componentType]||[]}/>)}</div>;
}

function ComponentSection({componentType,items}:{componentType:string;items:Component[]}){
  const openDetail=useOpenBuildDetail();
  const isCombination=componentType==='combinations'||componentType==='combinationsWithNodes';
  return <section className="panel component-panel"><div className="panel-title"><h2>{LABELS[componentType]||componentType}</h2><small>{items.length}개 주요 항목 · {isCombination?'항목을 선택하면 조합 상세로 이동합니다.':'열 제목으로 정렬하고 행을 선택하면 해당 항목 상세로 이동합니다.'}</small></div>{isCombination?<div className="component-grid combination-component-grid">{items.map(component=><div className="component combination-component build-detail-trigger" role="link" tabIndex={0} key={component.key} onClick={()=>openDetail(componentType,component)} onKeyDown={event=>activateDetail(event,()=>openDetail(componentType,component))}><EntityName type={componentType} item={component}/><dl className="combination-metrics"><div><dt>출정</dt><dd>{formatNumber(component.runs)}</dd></div><div><dt>선택률</dt><dd>{formatPercent(component.selectionRate)}</dd></div><div><dt>클리어율</dt><dd>{formatPercent(component.clearRate)}</dd></div><div><dt>사용 플레이어</dt><dd>{formatNumber(component.uniquePlayers)}명≈</dd></div></dl></div>)}</div>:<SortableComponentTable componentType={componentType} items={items}/>}</section>;
}

function SortableComponentTable({componentType,items}:{componentType:string;items:Component[]}){
  const openDetail=useOpenBuildDetail();
  const [sort,setSort]=useState<ComponentSort>('runs');
  const [direction,setDirection]=useState<'asc'|'desc'>('desc');
  const onSort=(field:string)=>{
    const next=field as ComponentSort;
    if(sort===next)setDirection(value=>value==='asc'?'desc':'asc');
    else{setSort(next);setDirection(next==='name'?'asc':'desc')}
  };
  const sorted=[...items].sort((left,right)=>{
    const comparison=sort==='name'
      ? String(left.name||'').localeCompare(String(right.name||''),'ko')
      : Number(left[sort]||0)-Number(right[sort]||0);
    if(comparison)return direction==='asc'?comparison:-comparison;
    return Number(right.runs||0)-Number(left.runs||0)||String(left.name||'').localeCompare(String(right.name||''),'ko');
  });
  const ariaSort=(field:ComponentSort)=>sort===field?(direction==='asc'?'ascending':'descending'):'none';
  return <div className="table-scroll cw-table-scroll component-table-scroll"><table className="cw-data-table component-table"><thead><tr>
    <th scope="col">#</th>
    <th scope="col" aria-sort={ariaSort('name')}><SortHead label="대상" field="name" current={sort} direction={direction} onSort={onSort} help="아이콘에 마우스를 올리거나 키보드로 초점을 이동하면 상세정보를 확인할 수 있습니다."/></th>
    <th scope="col" aria-sort={ariaSort('runs')}><SortHead label="출정 횟수" field="runs" current={sort} direction={direction} onSort={onSort}/></th>
    <th scope="col" aria-sort={ariaSort('uniquePlayers')}><SortHead label="사용 플레이어" field="uniquePlayers" current={sort} direction={direction} onSort={onSort} help="동일 플레이어 중복을 제거한 근사값입니다."/></th>
    <th scope="col" aria-sort={ariaSort('selectionRate')}><SortHead label="선택률" field="selectionRate" current={sort} direction={direction} onSort={onSort}/></th>
    <th scope="col" aria-sort={ariaSort('clearRate')}><SortHead label="클리어율" field="clearRate" current={sort} direction={direction} onSort={onSort}/></th>
  </tr></thead><tbody>{sorted.map((component,index)=><tr className="clickable build-detail-trigger" role="link" tabIndex={0} key={component.key} onClick={()=>openDetail(componentType,component)} onKeyDown={event=>activateDetail(event,()=>openDetail(componentType,component))}>
    <td>{index+1}</td><td><EntityName type={componentType} item={component} showRate={false}/></td><td>{formatNumber(component.runs)}</td><td>{formatNumber(component.uniquePlayers)}명≈</td><td>{formatPercent(component.selectionRate)}</td><td data-tone="success" className="good">{formatPercent(component.clearRate)}</td>
  </tr>)}</tbody></table></div>;
}
