import React from 'react';
import { EntityIcon, Help, formatDuration, formatNumber, formatPercent } from './shared';
import { nodeStageSelectionRates } from './node-stage-rates';
import type { BuildItem, Distribution } from './types';

export function PageHead({eyebrow,title,description}:{eyebrow:string;title:string;description:string}){return <div className="page-head"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>}
export function LoadingCover({show}:{show:boolean}){return show?<div className="loading-cover"><span/>필터 결과를 불러오는 중…</div>:null}
export function ErrorBox({message}:{message:string}){return message?<div className="error-box">{message}</div>:null}
export function Stat({label,value,note}:{label:string;value:string;note?:string}){return <article className="stat"><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</article>}
export function Empty({children='조건에 해당하는 데이터가 없습니다.'}:{children?:React.ReactNode}){return <div className="empty">{children}</div>}
export function EntityName({type,item,showRate=true}:{type:string;item:Record<string,unknown>;showRate?:boolean}){const combined=['combinations','combinationsWithNodes','nodeCombinations'].includes(type);if(combined)return <div className="entity-name combined" aria-label={String(item.name||'조합')}><CombinationIcons item={item}/></div>;return <div className="entity-name"><EntityIcon type={type} item={item} showRate={showRate}/><span><b>{String(item.name||'미기록')}</b>{Boolean(item.characterName)&&<small>{String(item.characterName)}</small>}</span></div>}
function CombinationIcons({item}:{item:Record<string,unknown>}){const entries:Array<[string,Record<string,unknown>]> = [];const character=item.character as Record<string,unknown>|undefined;if(character)entries.push(['characters',character]);for(const [key,type] of [['weapons','weapons'],['pet','pets'],['skills','skills'],['artifacts','artifacts'],['nodes','nodes']] as const){const value=item[key];for(const part of (Array.isArray(value)?value:value?[value]:[]) as Record<string,unknown>[])entries.push([type,part])}const rate=typeof item.selectionRate==='number'?item.selectionRate:undefined;return <span className="icon-strip">{entries.slice(0,18).map(([type,value],index)=><EntityIcon key={`${type}-${index}`} type={type} item={value} size={32} rate={rate}/>)}</span>}
export function SortHead({label,field,current,direction,onSort,help}:{label:string;field:string;current:string;direction:string;onSort:(field:string)=>void;help?:string}){return <button type="button" className="sort-head cw-button" data-variant={current===field?'primary':'quiet'} data-size="compact" onClick={()=>onSort(field)}>{label}{current===field?<span>{direction==='asc'?'▲':'▼'}</span>:null}{help&&<Help text={help}/>}</button>}
export function Pager({page,total,pageSize,onPage}:{page:number;total:number;pageSize:number;onPage:(page:number)=>void}){const pages=Math.max(1,Math.ceil(total/pageSize));return <div className="pager"><button type="button" className="cw-button" data-variant="quiet" disabled={page<=1} onClick={()=>onPage(page-1)}>이전</button><span>{formatNumber(total)}개 · {page} / {pages}</span><button type="button" className="cw-button" data-variant="quiet" disabled={page>=pages} onClick={()=>onPage(page+1)}>다음</button></div>}
export function Metrics({item}:{item:BuildItem}){return <div className="metric-row"><Stat label="출정 횟수" value={formatNumber(item.runs)}/><Stat label="사용 플레이어" value={formatNumber(item.uniquePlayers)} note="근사값"/><Stat label="선택률" value={formatPercent(item.selectionRate)}/><Stat label="클리어율" value={formatPercent(item.clearRate)}/><Stat label="플레이 시간" value={formatDuration(item.playTime?.medianMs)} note={`느린 플레이 10% 경계 ${formatDuration(item.playTime?.p90Ms)}`}/></div>}
type ChartDetail={label:string;value:string};
export function MiniLine({values,labels,color='#41ded4',valueLabel=(value)=>formatNumber(Math.round(value)),details,hasData}:{values:number[];labels:string[];color?:string;valueLabel?:(value:number)=>string;details?:ChartDetail[][];hasData?:boolean[]}){
  const [active,setActive]=React.useState<number|null>(null);
  const series=values.map((value,index)=>({value:Number(value),label:labels[index]||'',details:details?.[index]||[],hasData:hasData?.[index]??true})).filter(point=>Number.isFinite(point.value)&&point.hasData);
  const wrapRef=React.useRef<HTMLDivElement>(null);
  const [availableWidth,setAvailableWidth]=React.useState(0);
  React.useEffect(()=>{if(active!==null&&active>=series.length)setActive(null)},[active,series.length]);
  React.useEffect(()=>{
    const element=wrapRef.current;if(!element)return;
    const update=()=>setAvailableWidth(Math.floor(element.clientWidth));update();
    if(typeof ResizeObserver==='undefined'){addEventListener('resize',update);return()=>removeEventListener('resize',update)}
    const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();
  },[series.length]);
  if(!series.length)return <Empty>표시할 그래프 데이터가 없습니다.</Empty>;
  const width=Math.max(640,availableWidth),height=270,inset={top:18,right:22,bottom:42,left:58},plotWidth=width-inset.left-inset.right,plotHeight=height-inset.top-inset.bottom;
  const rawMax=Math.max(...series.map(point=>point.value)),rawMin=Math.min(...series.map(point=>point.value));
  const padding=rawMax===rawMin?Math.max(rawMax*.12,1):(rawMax-rawMin)*.12;
  const min=Math.max(0,rawMin-padding),max=rawMax+padding,span=Math.max(max-min,1e-9);
  const x=(index:number)=>series.length===1?inset.left+plotWidth/2:inset.left+index*plotWidth/(series.length-1);
  const y=(value:number)=>inset.top+(max-value)*plotHeight/span;
  const coordinates=series.map((point,index)=>({x:x(index),y:y(point.value)}));
  const points=coordinates.map(point=>`${point.x},${point.y}`).join(' ');
  const area=`${inset.left},${height-inset.bottom} ${points} ${width-inset.right},${height-inset.bottom}`;
  const activeDetails=active===null?[]:(series[active].details.length?series[active].details:[{label:'값',value:valueLabel(series[active].value)}]);
  const tooltipWidth=220,tooltipHeight=36+activeDetails.length*18;
  const activePoint=active===null?null:coordinates[active];
  const tooltipX=activePoint?Math.max(4,Math.min(width-tooltipWidth-4,activePoint.x-tooltipWidth/2)):0;
  const tooltipY=activePoint?Math.max(4,Math.min(height-tooltipHeight-inset.bottom-4,activePoint.y-tooltipHeight-12)):4;
  const gridValues=[max,max-(span/3),max-(span*2/3),min];
  const labelStride=Math.max(1,Math.ceil(series.length/Math.max(2,Math.floor(plotWidth/62))));
  return <div ref={wrapRef} className="chart-wrap" data-valid-points={series.length}><svg style={{width}} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="표본이 없는 항목을 제외한 시간 순서 추이 그래프" onPointerLeave={()=>setActive(null)}>
    {gridValues.map((value,index)=><g className="chart-grid-row" key={index}><line x1={inset.left} x2={width-inset.right} y1={y(value)} y2={y(value)}/><text x={inset.left-9} y={y(value)+4} textAnchor="end">{valueLabel(value)}</text></g>)}
    <polygon className="chart-area-fill" points={area} fill={color}/>
    <polyline className="chart-series-line" points={points} fill="none" stroke={color}/>
    {series.map((entry,index)=>{const point=coordinates[index],previous=coordinates[index-1]?.x??inset.left,next=coordinates[index+1]?.x??width-inset.right,left=index===0?inset.left:(previous+point.x)/2,right=index===series.length-1?width-inset.right:(point.x+next)/2;const pointDetails=entry.details.length?entry.details:[{label:'값',value:valueLabel(entry.value)}];const aria=[entry.label,...pointDetails.map(detail=>`${detail.label} ${detail.value}`)].join(', ');return <g key={`${entry.label}-${index}`} tabIndex={0} aria-label={aria} onPointerEnter={()=>setActive(index)} onFocus={()=>setActive(index)} onBlur={()=>setActive(null)}>
      <rect className="chart-hit-area" x={left} y={inset.top} width={Math.max(1,right-left)} height={plotHeight} fill="transparent"/>
      <circle className="chart-point" cx={point.x} cy={point.y} r={active===index?7:5} fill={color}/>
      {(index%labelStride===0||index===series.length-1)?<text className="chart-x-label" x={point.x} y={height-13} textAnchor="middle">{entry.label}</text>:null}
    </g>})}
    {activePoint?<g className="chart-tooltip" pointerEvents="none">
      <line x1={activePoint.x} x2={activePoint.x} y1={inset.top} y2={height-inset.bottom}/>
      <circle cx={activePoint.x} cy={activePoint.y} r="10" fill="none" stroke={color} strokeWidth="2"/>
      <g transform={`translate(${tooltipX} ${tooltipY})`}>
        <rect width={tooltipWidth} height={tooltipHeight} rx="9"/>
        <text className="chart-tooltip-title" x="12" y="20">{series[active as number].label}</text>
        {activeDetails.map((detail,index)=><text key={`${detail.label}-${index}`} x="12" y={40+index*18}><tspan>{detail.label}</tspan><tspan className="chart-tooltip-value" x={tooltipWidth-12} textAnchor="end">{detail.value}</tspan></text>)}
      </g>
    </g>:null}
  </svg></div>;
}
export function TimeNote({value}:{value:Distribution}){return <span>{formatDuration(value?.medianMs)}<small> / 느린 플레이 10% 경계 {formatDuration(value?.p90Ms)}</small></span>}

type NodeItem=Record<string,unknown>&{id?:string|number;name?:string;runs?:number;selectionRate?:number};
const NODE_STAGE_ORDER=[0,10,20,30,40,50,60,70,80,90,100,110,999];
function nodeId(value:NodeItem){const parsed=Number(value.id);return Number.isInteger(parsed)?parsed:null}
function nodeStage(value:NodeItem){const id=nodeId(value);return id===999?999:id===null?null:Math.floor(id/10)*10}

export function NodeCombinationTree({combination,nodes}:{combination:Record<string,unknown>;nodes:NodeItem[]}){
  const selected=(Array.isArray(combination.nodes)?combination.nodes:[]) as NodeItem[];
  const selectedIds=new Set(selected.map(nodeId).filter((value):value is number=>value!==null));
  const byId=new Map<number,NodeItem>();
  for(const node of [...nodes,...selected]){const id=nodeId(node);if(id!==null)byId.set(id,{...byId.get(id),...node})}
  const recordedNodes=[...byId.values()].filter(node=>{
    const id=nodeId(node);
    return id!==null&&(selectedIds.has(id)||Number(node.runs||0)>0||Number(node.selectionRate||0)>0);
  });
  const stages=NODE_STAGE_ORDER.map(stage=>{
    const items=recordedNodes.filter(node=>nodeStage(node)===stage).sort((a,b)=>(nodeId(a)||0)-(nodeId(b)||0));
    const rates=nodeStageSelectionRates(items);
    return {stage,items:items.map((item,index)=>({...item,stageSelectionRate:rates[index]}))};
  }).filter(group=>group.items.length);
  return <article className="node-combination-card">
    <div className="node-combination-head">
      <small>{formatNumber(combination.runs)}회 · 선택률 {formatPercent(combination.selectionRate)} · 클리어율 {formatPercent(combination.clearRate)}</small>
      <span className="cw-state-pill" data-tone="info">{selectedIds.size}개 장착</span>
    </div>
    <div className="node-tree-scroll">
      <div className="node-tree" role="list" aria-label={`${String(combination.name||'노드 조합')} 선택 경로`}>
        {stages.map((group,index)=>{const maxRate=Math.max(...group.items.map(item=>Number(item.stageSelectionRate||0)),0);return <React.Fragment key={group.stage}>
          {index>0?<span className="node-tree-link" aria-hidden="true"/>:null}
          <div className="node-stage" role="listitem">
            {group.items.map(item=>{const id=nodeId(item) as number,rate=Number(item.stageSelectionRate||0),selected=selectedIds.has(id),signal=group.items.length>1?(rate>=50?'op':rate===maxRate&&rate>0?'top':''):'';return <div key={id} className={`node-choice${selected?' selected':''}${signal?` signal-${signal}`:''}`} title={`${String(item.name||id)} · 같은 단계 선택 기준 ${formatPercent(rate)}`}>
              {signal==='op'?<b className="node-op">OP</b>:null}
              <EntityIcon type="nodes" item={item} size={54} rate={rate} rateLabel="같은 단계 선택 기준" tooltipLabel={String(item.name||id)}/>
              <span>{String(item.name||id)}</span>
            </div>})}
          </div>
        </React.Fragment>})}
      </div>
    </div>
  </article>
}
