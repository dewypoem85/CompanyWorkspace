import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, filterParams } from './api';
import { resolveEntityDetail } from './entity-details';
import type { Filters, Meta } from './types';

export type Route = { name: 'dashboard'|'results'|'builds'|'buildDetail'|'bosses'|'bossDetail'|'users'; type?: string; key?: string };
type AppContextValue = { filters: Filters; setFilters: (next: Filters) => void; meta: Meta | null; route: Route; navigate: (path: string) => void; refreshMeta: () => void };
const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue { const value = useContext(AppContext); if (!value) throw new Error('App context missing'); return value; }

function iso(daysAgo = 0) { const date = new Date(Date.now() - daysAgo * 86400000); return date.toISOString().slice(0, 10); }
export function readFilters(): Filters {
  const params = new URLSearchParams(location.search);
  return { from: params.get('from') || iso(6), to: params.get('to') || iso(), version: params.get('version') || '', mode: params.get('mode') || '', minModeLevel: params.get('minModeLevel') || '', afterFirstMiddleBoss: params.get('afterFirstMiddleBoss') !== '0' };
}
export function parseRoute(): Route {
  const path = location.pathname.replace(/\/+$/, '') || '/'; const params = new URLSearchParams(location.search);
  if (path === '/results') return { name: 'results' };
  if (path === '/builds/detail') return { name: 'buildDetail', type: params.get('type') || 'characters', key: params.get('key') || '' };
  if (path === '/builds') return { name: 'builds', type: params.get('type') || 'characters' };
  if (path === '/bosses/detail') return { name: 'bossDetail', key: params.get('key') || '' };
  if (path === '/bosses') return { name: 'bosses' };
  if (path === '/users') return { name: 'users' };
  return { name: 'dashboard' };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilterState] = useState(readFilters); const [route, setRoute] = useState(parseRoute); const [metaNonce, setMetaNonce] = useState(0); const [meta, setMeta] = useState<Meta|null>(null);
  const updateUrl = (nextFilters: Filters, nextRoute = parseRoute(), replace = true) => {
    const params = new URLSearchParams(location.search); for (const key of ['from','to','version','mode','minModeLevel','afterFirstMiddleBoss']) params.delete(key);
    filterParams(nextFilters).forEach((value,key) => params.set(key,value));
    const url = `${location.pathname}?${params}`; history[replace ? 'replaceState' : 'pushState']({},'',url); setRoute(nextRoute); document.dispatchEvent(new Event('company-route-change'));
  };
  const setFilters = (next: Filters) => { setFilterState(next); updateUrl(next); };
  const navigate = (path: string) => {
    const target = new URL(path, location.origin);
    filterParams(filters).forEach((value,key) => target.searchParams.set(key,value));
    history.pushState({},'',`${target.pathname}?${target.searchParams}`);
    setRoute(parseRoute());
    document.dispatchEvent(new Event('company-route-change'));
    window.scrollTo({top:0});
  };
  useEffect(() => { const onPop = () => { setFilterState(readFilters()); setRoute(parseRoute()); document.dispatchEvent(new Event('company-route-change')); }; const onClick=(event:MouseEvent)=>{const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[data-route-link]'):null;if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;const target=new URL(link.href,location.href);if(target.origin!==location.origin)return;event.preventDefault();navigate(`${target.pathname}${target.search}`)}; addEventListener('popstate',onPop);document.addEventListener('click',onClick); return()=>{removeEventListener('popstate',onPop);document.removeEventListener('click',onClick)}; },[filters]);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => api<Meta>('/api/v2/statistics/meta',controller.signal).then(setMeta).catch(()=>{});
    load();
    const timer = window.setInterval(load,30_000);
    return()=>{window.clearInterval(timer);controller.abort()};
  },[metaNonce]);
  const value = useMemo(()=>({filters,setFilters,meta,route,navigate,refreshMeta:()=>setMetaNonce(value=>value+1)}),[filters,meta,route]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useRemote<T>(url: string | null) {
  const [state,setState] = useState<{data:T|null;loading:boolean;error:string}>({data:null,loading:Boolean(url),error:''});
  const seq = useRef(0);
  useEffect(()=>{ if(!url)return; const id=++seq.current,controller=new AbortController(); setState(previous=>({...previous,loading:true,error:''}));
    api<T>(url,controller.signal).then(data=>{if(id===seq.current)setState({data,loading:false,error:''})}).catch(error=>{if(error?.name!=='AbortError'&&id===seq.current)setState(previous=>({...previous,loading:false,error:error.message||'요청에 실패했습니다.'}))});
    return()=>controller.abort();
  },[url]); return state;
}

export function formatNumber(value: unknown) { return Number(value || 0).toLocaleString('ko-KR'); }
export function formatPercent(value: unknown) { return `${Number(value || 0).toFixed(1)}%`; }
export function formatDuration(value: unknown) { const ms=Number(value||0); if(!ms)return '—'; const seconds=Math.round(ms/1000); return seconds>=3600?`${Math.floor(seconds/3600)}시간 ${Math.floor(seconds%3600/60)}분`:seconds>=60?`${Math.floor(seconds/60)}분 ${seconds%60}초`:`${seconds}초`; }
export function formatStamp(value: string|null|undefined) { if(!value)return '집계 전'; const date=new Date(value); return Number.isNaN(date.getTime())?'집계 전':new Intl.DateTimeFormat('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date); }
export function rangeStart(end:string,days:number){const date=new Date(`${end}T00:00:00Z`);if(Number.isNaN(date.getTime()))return end;date.setUTCDate(date.getUTCDate()-Math.max(0,days-1));return date.toISOString().slice(0,10)}
export function rangeDays(from:string,to:string){const start=new Date(`${from}T00:00:00Z`).getTime(),end=new Date(`${to}T00:00:00Z`).getTime();return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?Math.round((end-start)/86400000)+1:0}

const characterIds = new Map([['기사',0],['무투가',1],['학살자',2],['총잡이',3],['마도사',4],['방랑 용병',5],['사냥꾼',6],['낭인',7],['늑대인간',8],['소환술사',9],['암살자',10],['수호자',11],['약탈자',12],['주술사',13],['용인',14],['소울이터',15],['흡혈귀',16],['비요른 얀델',17],['얀델',17],['도플갱어',18],['승부사',19],['이단심판관',20],['광전사',21]]);
export function imagePath(type:string,item:Record<string,unknown>) { const n=(value:unknown)=>Number(value), name=String(item.name||'').trim();
  if(type==='characters'){const id=characterIds.get(name)??n(item.id);return Number.isInteger(id)&&id>=0?`/assets/entities/characters/${id}.png`:''}
  if(type==='skins'){const c=n(item.characterId),id=n(item.id);return Number.isInteger(c)&&Number.isInteger(id)?`/assets/entities/skins/${c}/${id}.png`:''}
  if(type==='weapons'){const c=n(item.characterId),id=n(item.id);return Number.isInteger(c)&&Number.isInteger(id)?`/assets/entities/weapons/${c}/${id}.png`:''}
  if(type==='nodes'){const c=n(item.characterId),id=n(item.id);return Number.isInteger(c)&&Number.isInteger(id)?`/assets/entities/nodes/${c}/${id}.png`:''}
  if(type==='pets'||type==='skills'){const id=n(item.id);return Number.isInteger(id)?`/assets/entities/${type}/${id}.png`:''}
  if(type==='artifacts'){const match=String(item.sourceKey||item.key||'').match(/(?:^|:)(\d+)$/);return match?`/assets/entities/artifacts/${item.cursed?'curse':'normal'}-${n(match[1])}.png`:''}
  if(type==='bosses'){const code=String(item.imageCode||item.id||'').toUpperCase();return /^[BE]\d+(?:_\d+)?$/.test(code)?`/assets/entities/bosses/${code}.png`:''} return '';
}

export function EntityIcon({type,item,size=40,rate,rateLabel,tooltipLabel,showRate=true}:{type:string;item:Record<string,unknown>;size?:number;rate?:number;rateLabel?:string;tooltipLabel?:string;showRate?:boolean}) {
  const src=imagePath(type,item);
  const resolvedRate=showRate ? (rate ?? (typeof item.selectionRate === 'number' ? item.selectionRate : undefined)) : undefined;
  const [detail,setDetail]=useState<Awaited<ReturnType<typeof resolveEntityDetail>>>(null);
  const name=String(tooltipLabel??detail?.name??item.name??'').trim();
  const resolvedRateLabel=rateLabel??(type==='nodes'?'캐릭터 출정 기준 선택률':'현재 조건 선택률');
  const title=[name,resolvedRate===undefined?'':`${resolvedRateLabel} ${formatPercent(resolvedRate)}`].filter(Boolean).join(' · ')||undefined;
  const [tooltipPosition,setTooltipPosition]=useState<{left:number;top:number}|null>(null);
  const showTooltip=(target:HTMLElement)=>{
    if(!name)return;
    const rect=target.getBoundingClientRect(),tooltipWidth=Math.min(360,window.innerWidth-24),tooltipHeight=Math.min(520,window.innerHeight-24),gap=9;
    const left=rect.right+gap+tooltipWidth<=window.innerWidth-12?rect.right+gap:Math.max(12,rect.left-gap-tooltipWidth);
    const top=Math.max(12+tooltipHeight/2,Math.min(window.innerHeight-12-tooltipHeight/2,rect.top+rect.height/2));
    setTooltipPosition({left,top});
    if(!detail)void resolveEntityDetail(type,item).then(setDetail);
  };
  const tooltip=name&&tooltipPosition?<span className="entity-name-tooltip is-visible" role="tooltip" style={{left:tooltipPosition.left,top:tooltipPosition.top}}>
    <span className="entity-tooltip-heading"><strong>{name}</strong>{detail?.category?<em>{detail.category}</em>:null}</span>
    {detail?.sections.map((section,index)=><span className="entity-tooltip-section" key={`${section.label}-${index}`}><b>{section.label}</b><span>{section.text}</span></span>)}
    {resolvedRate!==undefined?<span>{resolvedRateLabel} <b>{formatPercent(resolvedRate)}</b></span>:null}
    {type==='nodes'&&item.id!==undefined?<small>노드 코드 {String(item.id).padStart(3,'0')}</small>:null}
  </span>:null;
  return <span className={`entity-icon-wrap${name?' has-name-tooltip':''}`} style={{width:size}} title={name?undefined:title} aria-label={name||undefined} tabIndex={name?0:undefined}
    onMouseEnter={event=>showTooltip(event.currentTarget)} onMouseLeave={()=>setTooltipPosition(null)}
    onFocus={event=>showTooltip(event.currentTarget)} onBlur={()=>setTooltipPosition(null)}>
    <span className="entity-icon" style={{width:size,height:size}}>
      <span className="entity-icon-fallback">{String(item.name||'?').slice(0,1)}</span>
      {src?<img src={src} alt="" loading="lazy" onError={event=>{event.currentTarget.style.display='none'}}/>:null}
    </span>
    {resolvedRate!==undefined?<small className="entity-rate">{formatPercent(resolvedRate)}</small>:null}
    {tooltip&&typeof document!=='undefined'?createPortal(tooltip,document.body):null}
  </span>;
}
export function Help({text}:{text:string}) { return <span className="help" tabIndex={0} aria-label={text}>?</span>; }

export function AppContextRoot({children}:{children:React.ReactNode}) { return <AppProvider>{children}</AppProvider>; }
