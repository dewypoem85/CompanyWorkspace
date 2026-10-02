import React, { useState } from 'react';
import { filterParams } from '../api';
import { Empty, ErrorBox, LoadingCover, PageHead, Stat } from '../components';
import { EntityIcon, formatNumber, formatPercent, useApp, useRemote } from '../shared';
import type { UserMetricItem, UserMetricsResponse } from '../types';

const TYPES: Array<[string,string]> = [
  ['characters','캐릭터'],['skins','스킨'],['weapons','무기'],['pets','펫'],
  ['skills','스킬'],['artifacts','유물'],['nodes','노드']
];
const BUCKETS: Record<string,string> = {
  '0_5m':'5분 이내','5_10m':'5~10분','10_20m':'10~20분','20_30m':'20~30분',
  '30_60m':'30~60분','60m_plus':'60분 이상',unknown:'시간 미기록'
};

export default function Users(){
  const {filters}=useApp();
  const [type,setType]=useState('characters');
  const params=filterParams({...filters,afterFirstMiddleBoss:false});
  const state=useRemote<UserMetricsResponse>(`/api/v2/statistics/users?${params}`),data=state.data;
  const items=data?.usage[type]||[];
  return <div className="page">
    <LoadingCover show={state.loading}/><ErrorBox message={state.error}/>
    <PageHead eyebrow="UNIQUE USER JOURNEY" title="유저 지표" description="계정 연동 UID를 기준으로 같은 사용자는 조회 기간에 한 번만 계산합니다."/>
    <div className="user-metric-notice">개별 UID는 화면과 API에 노출하지 않습니다. 이 화면은 초기 이탈을 보기 위해 ‘1챕터 중간보스 이후’ 조건을 적용하지 않습니다.</div>
    {data?<>
      <div className="metric-row">
        <Stat label="계정 연동 고유 사용자" value={formatNumber(data.summary.uniqueUsers)} note="기간 내 중복 제거"/>
        <Stat label="출정 횟수" value={formatNumber(data.summary.runs)}/>
        <Stat label="1회 출정 후 이탈" value={formatNumber(data.summary.oneRunUsers)} note={formatPercent(data.summary.oneRunRate)}/>
        <Stat label="사용자당 평균 출정" value={`${data.summary.averageRuns.toFixed(1)}회`}/>
        <Stat label="챕터 미기록 사용자" value={formatNumber(data.summary.unknownChapterUsers)}/>
      </div>

      <section className="panel user-usage-panel">
        <div className="panel-title"><span>UNIQUE ADOPTION</span><h2>고유 사용자 사용률</h2><small>{data.definitions.usageRate}</small></div>
        <div className="tabs user-metric-tabs" role="tablist" aria-label="사용 항목 종류">
          {TYPES.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={type===key} className="cw-button" data-variant={type===key?'primary':'quiet'} onClick={()=>setType(key)}>{label}</button>)}
        </div>
        {items.length?<div className="user-usage-grid">{items.map(item=><UsageCard key={item.key} type={type} item={item}/>)}</div>:<Empty/>}
      </section>

      <div className="user-metric-grid">
        <section className="panel">
          <div className="panel-title"><span>CHAPTER FUNNEL</span><h2>챕터 도달률</h2><small>{data.definitions.chapter}</small></div>
          <div className="funnel-list">{data.chapters.map(row=><div className="funnel-row" key={row.chapter}><span>챕터 {row.chapter}</span><div><i style={{width:`${Math.min(100,row.reachRate)}%`}}/></div><b>{formatPercent(row.reachRate)}</b><small>{formatNumber(row.reachedUsers)}명</small></div>)}</div>
        </section>
        <section className="panel">
          <div className="panel-title"><span>FIRST OBSERVED RUN</span><h2>첫 출정 시간과 이탈</h2><small>{data.definitions.firstPlay}</small></div>
          <div className="table-scroll cw-table-scroll"><table className="cw-data-table user-metric-table"><thead><tr><th scope="col">첫 출정 시간</th><th scope="col">사용자</th><th scope="col">1회 출정 후 이탈</th><th scope="col">이탈률</th></tr></thead><tbody>{data.firstPlay.map(row=><tr key={row.bucket}><td>{BUCKETS[row.bucket]||row.bucket}</td><td>{formatNumber(row.users)}</td><td>{formatNumber(row.oneRunUsers)}</td><td>{formatPercent(row.exitRate)}</td></tr>)}</tbody></table></div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-title"><span>LEVEL RETIREMENT</span><h2>단계별 도달·이탈</h2><small>{data.definitions.retirement}</small></div>
        {data.levels.length?<div className="table-scroll cw-table-scroll"><table className="cw-data-table user-metric-table"><thead><tr><th scope="col">단계</th><th scope="col">도달 사용자</th><th scope="col">도달률</th><th scope="col">이 단계가 최고 기록</th><th scope="col">도달자 중 이탈률</th></tr></thead><tbody>{data.levels.map(row=><tr key={row.level}><td>{row.level}단계</td><td>{formatNumber(row.reachedUsers)}</td><td>{formatPercent(row.reachRate)}</td><td>{formatNumber(row.retiredUsers)}</td><td>{formatPercent(row.retireRate)}</td></tr>)}</tbody></table></div>:<Empty>선택한 조건에 단계 기록이 없습니다.</Empty>}
      </section>
    </>:!state.loading&&<Empty>선택한 기간에 계정 연동 UID 데이터가 없습니다.</Empty>}
  </div>;
}

function UsageCard({type,item}:{type:string;item:UserMetricItem}){
  return <article className="user-usage-card"><EntityIcon type={type} item={item} size={52} rate={item.usageRate} tooltipLabel={item.name}/><div><strong>{item.name}</strong><span>전체 유저 중 {formatPercent(item.usageRate)}</span><small>{formatNumber(item.uniqueUsers)}명 사용</small></div></article>;
}
