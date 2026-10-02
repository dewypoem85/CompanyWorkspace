import React from 'react';
import { filterParams } from '../api';
import { Empty, ErrorBox, LoadingCover, MiniLine, PageHead, Stat } from '../components';
import { formatDuration, formatNumber, formatPercent, rangeDays, rangeStart, useApp, useRemote } from '../shared';
import type { DashboardResponse } from '../types';

export default function Dashboard(){
  const {filters,setFilters,navigate}=useApp();
  const state=useRemote<DashboardResponse>(`/api/v2/statistics/dashboard?${filterParams(filters)}`),data=state.data;
  const days=rangeDays(filters.from,filters.to);
  const period=(value:number)=>setFilters({...filters,from:rangeStart(filters.to,value)});

  return <div className="page">
    <LoadingCover show={state.loading}/><ErrorBox message={state.error}/>
    <PageHead eyebrow="EXECUTIVE OVERVIEW" title="라이브 대시보드" description="운영 판단에 필요한 핵심 지표만 빠르게 확인합니다."/>
    {data?<>
      <div className="metric-row">
        <Stat label="활성 플레이어" value={formatNumber(data.summary.activePlayers)} note="근사 고유값"/>
        <Stat label="완료 Run" value={formatNumber(data.summary.totalRuns)}/>
        <Stat label="클리어율" value={formatPercent(data.summary.completionRate)}/>
        <Stat label="사망률" value={formatPercent(data.summary.deathRate)}/>
        <Stat label="플레이 시간" value={formatDuration(data.summary.playTime.medianMs)} note={`P90 ${formatDuration(data.summary.playTime.p90Ms)}`}/>
      </div>
      <div className="dashboard-grid">
        <section className="panel wide dashboard-trend-panel">
          <div className="panel-title action">
            <div><span>TREND</span><h2>플레이 흐름</h2><small>{filters.from} ~ {filters.to} · 출정 기록이 없는 날짜 제외</small></div>
            <div className="quick chart-period" role="group" aria-label="그래프 표시 기간">
              {[7,30,90].map(value=><button key={value} type="button" className="cw-button" data-variant={days===value?'primary':'quiet'} aria-pressed={days===value} onClick={()=>period(value)}>{value}일</button>)}
            </div>
          </div>
          <MiniLine
            values={data.trend.map(value=>value.runs)}
            labels={data.trend.map(value=>value.date.slice(5))}
            hasData={data.trend.map(value=>value.runs>0)}
            details={data.trend.map(value=>[
              {label:'출정',value:`${formatNumber(value.runs)}회`},
              {label:'클리어',value:`${formatNumber(value.clears)}회`},
              {label:'활성 플레이어',value:`약 ${formatNumber(value.players)}명`}
            ])}
          />
        </section>
        <section className="panel">
          <div className="panel-title"><span>OUTCOME</span><h2>Run 결과</h2></div>
          {data.outcomes.map(item=><div className="bar" key={item.key}><span>{item.label}<b>{formatPercent(item.rate)}</b></span><i><em style={{width:`${Math.min(100,item.rate)}%`}}/></i><small>{formatNumber(item.count)}회</small></div>)}
        </section>
        <section className="panel">
          <div className="panel-title action"><div><span>TOP BUILD</span><h2>주요 캐릭터</h2></div><button type="button" className="cw-button" data-variant="quiet" data-size="compact" onClick={()=>navigate(`/builds?type=characters&${filterParams(filters)}`)}>상세 보기 →</button></div>
          {data.topBuilds.length?data.topBuilds.map((item,index)=><button type="button" className="rank-row cw-button" data-variant="record" data-layout="content" key={item.key} onClick={()=>navigate(`/builds/detail?type=characters&key=${encodeURIComponent(item.key)}&${filterParams(filters)}`)}><b>{index+1}</b><span>{item.name}</span><strong>{formatNumber(item.runs)}</strong></button>):<Empty/>}
        </section>
        <section className="panel">
          <div className="panel-title action"><div><span>BOSS</span><h2>보스 처치</h2></div><button type="button" className="cw-button" data-variant="quiet" data-size="compact" onClick={()=>navigate(`/bosses?${filterParams(filters)}`)}>상세 보기 →</button></div>
          {data.topBosses.length?data.topBosses.map((item,index)=><button type="button" className="rank-row cw-button" data-variant="record" data-layout="content" key={item.key} onClick={()=>navigate(`/bosses/detail?key=${encodeURIComponent(item.key)}&${filterParams(filters)}`)}><b>{index+1}</b><span>{item.name}</span><strong>{formatNumber(item.killCount)}</strong></button>):<Empty/>}
        </section>
      </div>
    </>:!state.loading&&<Empty/>}
  </div>
}
