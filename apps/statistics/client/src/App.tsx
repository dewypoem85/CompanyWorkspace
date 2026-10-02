import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { api, clearApiCache } from './api';
import { AppContextRoot, formatStamp, rangeDays, rangeStart, useApp } from './shared';

const Dashboard=lazy(()=>import('./pages/Dashboard')); const Results=lazy(()=>import('./pages/Results')); const Builds=lazy(()=>import('./pages/Builds')); const BuildDetail=lazy(()=>import('./pages/BuildDetail')); const Bosses=lazy(()=>import('./pages/Bosses')); const BossDetail=lazy(()=>import('./pages/BossDetail')); const Users=lazy(()=>import('./pages/Users'));
const NodePreview=import.meta.env.DEV?lazy(()=>import('./dev/NodePreview')):null;

export function App(){const fixture=new URLSearchParams(location.search).get('visualFixture');if(NodePreview&&['node','character'].includes(fixture||''))return <Suspense fallback={<PageLoading/>}><NodePreview/></Suspense>;return <AppContextRoot><Shell/></AppContextRoot>}
function Shell(){const {route,meta,navigate,refreshMeta}=useApp();
  const refreshStateRef=useRef<HTMLElement>(null);
  const title={dashboard:'대시보드',results:'게임 결과',builds:'빌드 분석',buildDetail:'빌드 상세',bosses:'보스 분석',bossDetail:'보스 상세',users:'유저 지표'}[route.name];
  if(meta&&(!meta.publication.completedAt||meta.publication.status==='empty'))return <Maintenance meta={meta}/>;
  return <div className="app-shell statistics-shell">
    <aside className="cw-sidebar" data-workspace-navigation="statistics" />
    <main id="statistics-main" className="workspace cw-main statistics-main">
      <header className="topbar statistics-topbar"><div className="breadcrumb"><span>게임 통계</span><b>/</b><strong>{title}</strong></div><div className="topbar-actions header-actions">{meta?.publication.inProgress&&<span className="publication-state cw-state-pill" data-tone="info">집계 중 · 이전 완료 데이터 표시</span>}<span className="cw-state-pill" data-tone="neutral">마지막 집계 {formatStamp(meta?.publication.completedAt)}</span><span className="cw-state-pill" data-tone="neutral">데이터 기준 {formatStamp(meta?.publication.dataThrough)}</span><span className="cw-state-pill" data-tone="info">ClickHouse · 최근 {meta?.retentionDays||90}일</span><EntityDetailsRefreshControl meta={meta}/><RefreshControl meta={meta} refreshMeta={refreshMeta} statusRef={refreshStateRef}/></div></header>
      <section ref={refreshStateRef} className="refresh-state" hidden/>
      <FilterBar/>
      <Suspense fallback={<PageLoading/>}><RouteView/></Suspense>
    </main>
  </div>;
}

function RefreshControl({meta,refreshMeta,statusRef}:{meta:ReturnType<typeof useApp>['meta'];refreshMeta:()=>void;statusRef:React.RefObject<HTMLElement|null>}){
  const buttonRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const button=buttonRef.current,statusNode=statusRef.current,user=meta?.currentUser;
    if(!button||!statusNode||!user?.id)return;
    let disposed=false;let controller:{dispose:()=>void;startPolling:()=>void}|null=null;
    const refreshModulePath='/refresh.js';
    void import(/* @vite-ignore */ refreshModulePath).then(module=>{
      if(disposed)return;
      controller=module.attachStatisticsRefresh({button,statusNode,user,onPublication:()=>refreshMeta(),onComplete:async()=>{clearApiCache();refreshMeta();setTimeout(()=>location.reload(),0);return true}});
      if(meta?.publication.inProgress)controller?.startPolling();
    }).catch(()=>{button.disabled=true;statusNode.hidden=false;statusNode.textContent='통계 갱신 기능을 불러오지 못했습니다.'});
    return()=>{disposed=true;controller?.dispose()};
  },[meta?.currentUser?.id,meta?.currentUser?.role]);
  return <button ref={buttonRef} className="cw-button" data-variant="primary" type="button" disabled>통계 갱신</button>;
}
type EntityDetailsStatus={configured:boolean;refreshing:boolean;updatedAt:string|null;counts:Record<string,number>|null};
function EntityDetailsRefreshControl({meta}:{meta:ReturnType<typeof useApp>['meta']}){
  const user=meta?.currentUser;
  const [status,setStatus]=React.useState<EntityDetailsStatus|null>(null);
  const [message,setMessage]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  useEffect(()=>{
    if(!user?.isAdmin)return;
    const controller=new AbortController();
    api<EntityDetailsStatus>('/api/admin/entity-details/status',controller.signal).then(setStatus).catch(error=>setMessage(error.message));
    return()=>controller.abort();
  },[user?.id,user?.role,user?.isAdmin]);
  if(!user?.isAdmin)return null;
  const refresh=async()=>{
    setBusy(true);setMessage('시트 내용을 불러오는 중…');
    try{
      const result=await api<{updatedAt:string;counts:Record<string,number>}>('/api/admin/entity-details/refresh',undefined,{method:'POST',headers:{'Content-Type':'application/json','X-Statistics-Intent':'entity-details-refresh-v1'},body:JSON.stringify({expectedUserId:user.id,expectedRole:user.role})});
      setStatus({configured:true,refreshing:false,updatedAt:result.updatedAt,counts:result.counts});
      setMessage('상세정보 갱신 완료 · 화면을 다시 불러옵니다.');
      window.setTimeout(()=>location.reload(),700);
    }catch(error){setMessage(error instanceof Error?error.message:'상세정보 갱신에 실패했습니다.');setBusy(false)}
  };
  const disabled=busy||status?.refreshing||status?.configured===false;
  const label=busy||status?.refreshing?'설명 갱신 중':'설명 갱신';
  return <span className="entity-details-refresh"><button className="cw-button" data-variant="quiet" type="button" disabled={disabled} onClick={refresh} title={status?.updatedAt?`마지막 설명 갱신 ${formatStamp(status.updatedAt)}`:'Google Sheets에서 아이콘 설명을 갱신합니다.'}>{label}</button>{message?<small role="status" aria-live="polite">{message}</small>:null}</span>;
}
function RouteView(){const {route}=useApp(); if(route.name==='results')return <Results/>;if(route.name==='builds')return <Builds/>;if(route.name==='buildDetail')return <BuildDetail/>;if(route.name==='bosses')return <Bosses/>;if(route.name==='bossDetail')return <BossDetail/>;if(route.name==='users')return <Users/>;return <Dashboard/>}
function FilterBar(){const {filters,setFilters,meta,route}=useApp(); const set=(key:keyof typeof filters,value:string|boolean)=>setFilters({...filters,[key]:value});const days=rangeDays(filters.from,filters.to);const period=(value:number)=>setFilters({...filters,from:rangeStart(filters.to,value)}); return <section className="filterbar filter-bar" aria-label="공통 조회 조건"><div className="quick period-switch" role="group" aria-label="조회 기간">{[7,30,90].map(value=><button key={value} type="button" className="cw-button" data-variant={days===value?'primary':'quiet'} aria-pressed={days===value} onClick={()=>period(value)}>{value}일</button>)}</div><label className="cw-form-field"><span>시작일</span><input className="cw-form-control" type="date" value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label className="cw-form-field"><span>종료일</span><input className="cw-form-control" type="date" value={filters.to} onChange={e=>set('to',e.target.value)}/></label><label className="cw-form-field"><span>버전</span><select className="cw-form-control" value={filters.version} onChange={e=>set('version',e.target.value)}><option value="">전체 버전</option>{Array.from(new Set(meta?.versions.flatMap(v=>[v.family,v.value]).filter(Boolean))).map(v=><option key={v} value={v}>{v}</option>)}</select></label><label className="cw-form-field"><span>게임 모드</span><select className="cw-form-control" value={filters.mode} onChange={e=>set('mode',e.target.value)}><option value="">전체 모드</option>{meta?.modes.map(v=><option key={v.value} value={v.value}>{v.value}</option>)}</select></label><label className="cw-form-field mode-level-filter"><span>최소 단계</span><input className="cw-form-control level" type="number" min="0" max="999" step="1" value={filters.minModeLevel} placeholder="전체" onChange={e=>set('minModeLevel',e.target.value)}/></label>{route.name!=='users'?<label className="check cw-check-control"><input className="cw-checkbox" type="checkbox" checked={filters.afterFirstMiddleBoss} onChange={e=>set('afterFirstMiddleBoss',e.target.checked)}/><span>1챕터 중간보스 이후</span></label>:null}</section>}
function PageLoading(){return <div className="page-loading"><span/>페이지 구성 불러오는 중…</div>}
function Maintenance({meta}:{meta:NonNullable<ReturnType<typeof useApp>['meta']>}){return <div className="maintenance"><div><b>96</b><h1>통계 시스템을 새 구조로 전환 중입니다</h1><p>최근 {meta.retentionDays||90}일 이력을 검증하고 있습니다. Azure 원본 로그는 그대로 영구 보관됩니다.</p><div className="progress"><span/></div><small>{meta.publication.error||meta.publication.currentProfile||'ClickHouse 최근 이력 백필 진행 중'}</small></div></div>}
