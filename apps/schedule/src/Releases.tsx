import { useEffect, useRef, useState } from 'react';
import { stamp, today } from './api';
import { ReleaseActor, ReleaseProject } from './ReleaseIdentity';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import { WorkspaceState } from './generated/workspace-state';
import { useWorkspaceModal } from './generated/workspace-modal';
import { useWorkspaceDisclosure } from './generated/workspace-disclosure';
import {useReleaseList,releaseSeriesPage,releaseRecordsPage,legacyReleasePage,releaseProjectPage,releaseReferenceResponse,releaseRevisionPage,type ReleaseSeries as Series} from './useReleaseList';
import { useReleaseEditor } from './useReleaseEditor';
import { releaseActorScope, type ReleaseDraft as Draft } from './releaseReview';
import {scheduleGet} from './scheduleReads';
import { releaseName, releaseStatuses, type Bootstrap, type LegacyReleaseRecord, type ReleaseRecord, type ReleaseRevision, type ReleaseStatus } from './types';
import { ScheduleToastNotice } from './ScheduleToasts';

type Page<T> = { items: T[]; total: number };
const blank = (projectId: number): Draft => ({ projectId, baseVersion: 1, minor: 0, releasedOn: today(), notes: '', status: 'stable', issue: '', rollbackTargetId: null, resolvedInId: null, version: 0 });
export function ReleaseBadge({ status }: { status: ReleaseStatus }) {
  const tone = status === 'stable' ? 'success' : status === 'unrecorded' ? 'neutral' : 'danger';
  return <span className="release-status cw-state-pill" data-tone={tone}>{status === 'stable' ? '●' : status === 'unrecorded' ? '○' : '⚠'} {releaseStatuses[status]}</span>;
}
function ReleaseListState({list,title,empty,id}:{list:{busy:boolean;error:string;denied:boolean;loaded:boolean;page:{total:number};load:()=>Promise<void>};title:string;empty?:string;id:string}) {
  const notice=list.busy?{kind:'loading' as const,title:`${title} 조회 중…`}:list.error?{kind:(list.denied?'denied':'error') as 'denied'|'error',title:`${title}을 불러오지 못했습니다.`,message:list.error,actionLabel:'목록 다시 조회',onAction:()=>void list.load()}:null;
  return <><ScheduleToastNotice id={id} state={notice}/>{list.loaded&&!list.page.total&&empty&&<WorkspaceState kind="empty" title={empty}/>}</>;
}
function LegacyReleases({ projectId,scope }: { projectId: number;scope:string }) {
  const root=useRef<HTMLDivElement>(null),disclosure=useWorkspaceDisclosure(root);
  const list=useReleaseList<LegacyReleaseRecord>(projectId?`/api/legacy-releases?projectId=${projectId}`:'',scope,value=>legacyReleasePage(value,projectId),item=>item.id);
  const {page,busy}=list;
  return <div ref={root} className="legacy-releases" hidden={!projectId||list.loaded&&!page.total&&!list.error&&!busy}>
    <ReleaseListState id={`legacy-release-${projectId}`} list={list} title="버전 미기재 기록"/>
    <button className="cw-button" data-cw-disclosure="legacy" disabled={!disclosure.ready||!page.total}>버전 미기재 기록 · {page.total}건</button>
    <div data-cw-disclosure-panel="legacy" hidden>
    <p className="muted">원본 시트에 버전 번호가 없는 기록입니다. 날짜가 비어 있는 행도 원본 순서대로 보존했습니다.</p>
    {page.items.map(record => <article key={record.id}><header><time>{record.releasedOn || '날짜 미기재'}</time><a href={record.sourceReference} target="_blank" rel="noreferrer">원본 시트 ↗</a></header><div className="body-text">{record.notes || '주요 내용 미기재'}</div>{record.issue && <p className="release-issue">{record.issue}</p>}</article>)}
    {page.items.length < page.total && <button className="cw-button" disabled={busy} onClick={() => void list.load(true)}>이전 기록 더 보기</button>}
    </div>
  </div>;
}
export function Releases({ boot, refreshIdentity }: { boot: Bootstrap; refreshIdentity: () => Promise<Bootstrap> }) {
  const [projectId, setProjectId] = useState(boot.projects.find(p => !p.archived)?.id || boot.projects[0]?.id || 0);
  const scope=releaseActorScope(boot);
  const list=useReleaseList<Series>(projectId?`/api/release-series?projectId=${projectId}`:'',scope,value=>releaseSeriesPage(value,projectId),item=>item.baseVersion);
  const {page,busy}=list;
  const [selected, setSelected] = useState<Draft>(); const [revision, setRevision] = useState(0);
  const manager = boot.me.active && boot.me.access && !boot.me.shared;
  const project = boot.projects.find(p => p.id === projectId);
  useEffect(() => { if (!boot.projects.some(p => p.id === projectId)) { setSelected(undefined); setProjectId(boot.projects.find(p => !p.archived)?.id || boot.projects[0]?.id || 0); } }, [boot.projects, projectId]);
  async function load(more = false, requireSuccess = false) {
    await list.load(more,requireSuccess);setRevision(r=>r+1);
  }
  return <section className="releases-page">
    <div className="page-heading"><div><span className="eyebrow">VERSION HISTORY</span><h1>프로젝트 업데이트 버전</h1></div>{manager && <button className="cw-button" data-variant="primary" disabled={!project || project.archived} onClick={() => setSelected({ ...blank(projectId), baseVersion: page.items[0] ? page.items[0].baseVersion + 1 : 1 })}>＋ 기본 버전 등록</button>}</div>
    <div className="release-toolbar"><label className="cw-form-field">프로젝트 <select className="cw-form-control" data-company-picker="project" aria-label="업데이트 버전 프로젝트" value={projectId || ''} onChange={e => setProjectId(Number(e.target.value))}>{!projectId && <option value="">프로젝트 선택</option>}{boot.projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.isPrivate ? ' · 비공개' : ''}{p.archived ? ' · 보관됨' : ''}</option>)}</select></label><button className="cw-button" disabled={busy || !projectId} onClick={() => void load()}>새로고침</button></div>
    <ReleaseListState id={`release-list-${projectId}`} list={list} title="버전 목록" empty="아직 등록된 버전이 없습니다."/>
    {!projectId&&<WorkspaceState kind="empty" title="프로젝트를 선택해 주세요."/>}
    <p className="release-guide">770 → 770.1 → 770.2처럼 기본 버전 안에 마이너 패치를 기록합니다. 버전을 펼치면 각 패치와 문제 해결 이력을 확인할 수 있습니다. <strong>빨강: 버전 건너뜀·미해결 문제·롤백</strong></p>
    <div className="release-table-scroll cw-table-scroll" tabIndex={0} role="region" aria-label="프로젝트 업데이트 버전 표"><table className="release-table cw-data-table"><thead><tr><th>버전</th><th>최종</th><th>최초 업데이트</th><th>주요 내용</th></tr></thead>{page.items.map(series => <SeriesRow key={`${projectId}-${series.baseVersion}`} series={series} scope={scope} revision={revision} manager={manager && !project?.archived} select={setSelected} />)}</table></div>
    {page.items.length < page.total && <button disabled={busy} className="cw-button load-more" onClick={() => void load(true)}>이전 버전 더 보기</button>}
    <LegacyReleases key={projectId} projectId={projectId} scope={scope}/>
    {selected && <ReleaseEditor key={selected.id || 'new'} record={selected} boot={boot} manager={manager} close={() => setSelected(undefined)} saved={() => load(false,true)} refreshIdentity={refreshIdentity} />}
  </section>;
}
function SeriesRow({ series, revision, manager, select,scope }: { series: Series; revision: number; manager: boolean; select: (draft: Draft) => void;scope:string }) {
  const root=useRef<HTMLTableSectionElement>(null),[open,setOpen]=useState(false);
  const disclosure=useWorkspaceDisclosure(root,{onChange:change=>setOpen(change.open)});
  const list=useReleaseList<ReleaseRecord>(`/api/releases?projectId=${series.first.projectId}&baseVersion=${series.baseVersion}`,`${scope}:${revision}`,value=>releaseRecordsPage(value,series.first.projectId,series.baseVersion),item=>item.id,open);
  const {page,busy}=list;
  const skipped = series.first.status === 'skipped'; const problematic = ['unstable', 'rolled_back', 'skipped'].includes(series.latest.status) && !series.latest.resolvedInId;
  return <tbody ref={root}><tr><td data-tone={skipped || series.first.status === 'unstable' ? 'danger' : undefined}><button className="cw-button version-expand" data-size="compact" data-variant={skipped || series.first.status === 'unstable' ? 'danger' : 'quiet'} data-cw-disclosure="series" disabled={!disclosure.ready}>{open ? '▾' : '▸'} {series.baseVersion}</button>{skipped && <small>건너뜀</small>}</td><td data-tone={skipped || problematic ? 'danger' : undefined}><button className="cw-button" data-size="compact" data-variant={skipped || problematic ? 'danger' : 'quiet'} title={`${releaseName(series.latest)} 기록 ${manager ? '수정' : '보기'}`} onClick={() => select(series.latest)}>{releaseName(series.latest)}</button>{problematic && !skipped && <small>{releaseStatuses[series.latest.status]}</small>}</td><td><time>{series.first.releasedOn}</time></td><td className="version-summary">{series.first.notes}</td></tr>
    <tr data-cw-disclosure-panel="series" hidden><td colSpan={4} className="series-details"><div className="cw-table-detail"><div className="series-actions"><button className="cw-button" onClick={() => select(series.first)}>기본 버전 내용 {manager ? '수정' : '보기'}</button>{manager && <button className="cw-button" onClick={() => select({ ...blank(series.first.projectId), baseVersion: series.baseVersion, minor: series.latest.minor + 1 })}>＋ {series.baseVersion} 마이너 등록</button>}</div><ReleaseListState id={`release-minors-${series.baseVersion}`} list={list} title="마이너 기록" empty="등록된 마이너 기록이 없습니다."/>{page.items.map(r => <button key={r.id} data-layout="content" data-variant={!r.resolvedInId && ['unstable','rolled_back','skipped'].includes(r.status)?'danger':undefined} className={`cw-button release-card ${r.resolvedInId ? 'resolved' : r.status}`} aria-label={`${releaseName(r)} 기록 ${manager ? '수정' : '보기'}`} onClick={() => select(r)}><span className="release-card-heading"><strong>{releaseName(r)}</strong>{r.resolvedInId ? <span className="release-status cw-state-pill" data-tone="success">✓ {page.items.find(p => p.id === r.resolvedInId) ? releaseName(page.items.find(p => p.id === r.resolvedInId)!) : '후속 마이너'}에서 해결</span> : <ReleaseBadge status={r.status} />}<time>{r.releasedOnUnknown ? '출시일 미기재' : r.releasedOn}</time></span><span className="release-notes-preview">{r.notes}</span>{r.issue && <span className="release-issue">{r.issue}</span>}<span className="release-card-action">{manager ? '수정' : '보기'} →</span></button>)}{page.items.length < page.total && <button className="cw-button" disabled={busy} onClick={() => void list.load(true)}>이전 마이너 더 보기</button>}</div></td></tr>
  </tbody>;
}

function ReleaseRevisionBody({snapshot}:{snapshot:ReleaseRecord}) {
  const root=useRef<HTMLDivElement>(null),disclosure=useWorkspaceDisclosure(root);
  return <div ref={root}><button className="cw-button" data-cw-disclosure="revision" disabled={!disclosure.ready}>당시 패치·조치 내용</button><div data-cw-disclosure-panel="revision" hidden><div className="body-text">{snapshot.notes}</div>{snapshot.issue&&<div className="body-text release-issue">{snapshot.issue}</div>}{snapshot.resolvedInId&&<p>해결 마이너 기록 #{snapshot.resolvedInId}</p>}{snapshot.rollbackTargetId&&<p>복귀 기록 #{snapshot.rollbackTargetId}</p>}</div></div>;
}

function ReleaseEditor({ record, boot, manager, close, saved, refreshIdentity }: { record: Draft; boot: Bootstrap; manager: boolean; close: () => void; saved: () => Promise<void>; refreshIdentity: () => Promise<Bootstrap> }) {
  const dialog = useRef<HTMLDialogElement>(null); const edit=useReleaseEditor(record,boot,refreshIdentity,saved,close);const {form,busy}=edit; const [error, setError] = useState('');
  const [history, setHistory] = useState<Page<ReleaseRevision>>(); const [historyBusy, setHistoryBusy] = useState(false);
  const [resolved, setResolved] = useState<ReleaseRecord>();
  const [targets, setTargets] = useState<Page<ReleaseRecord>>({ items: [], total: 0 }); const [target, setTarget] = useState<ReleaseRecord>(); const [targetsBusy, setTargetsBusy] = useState(false);
  const reads=useRef(0),historyRequest=useRef(0),targetsRequest=useRef(0),active=useRef(true),readSession=useRef<WorkspaceReadSession|undefined>(undefined),scope=releaseActorScope(boot);
  function cancelReads(){for(const channel of ['release-target','release-resolved','release-targets','release-history'])readSession.current?.cancel(channel);}
  function resetReads(){reads.current++;cancelReads();setHistory(undefined);setTarget(undefined);setResolved(undefined);setTargets({items:[],total:0});setError('');setHistoryBusy(false);setTargetsBusy(false);}
  useEffect(()=>{active.current=true;try{readSession.current=createWorkspaceReadSession();}catch(cause){setError((cause as Error).message);}document.addEventListener('workspace-entity-scope-change',resetReads);return()=>{active.current=false;reads.current++;readSession.current?.dispose();document.removeEventListener('workspace-entity-scope-change',resetReads);};},[]);
  useEffect(resetReads,[form.id,form.version,scope]);
  const currentRead=(generation:number)=>active.current&&generation===reads.current;
  async function readValue<T>(channel:string,path:string,parse:(value:unknown)=>T,generation:number):Promise<T|undefined>{
    const session=readSession.current;if(!session)throw Error('공통 버전 조회 도구를 사용할 수 없습니다. 페이지를 다시 열어 주세요.');
    const result=await session.run(channel,signal=>scheduleGet(path,signal,parse));
    if(result.status==='cancelled'||!result.isCurrent()||!currentRead(generation))return;
    if(result.status==='error')throw result.error;return result.value;
  }
  const modal = useWorkspaceModal(dialog, {scope:'retain', canClose:edit.canCloseNow, beforeCloseRequest:edit.requestDiscard, onClose:close});
  useEffect(() => {const generation=reads.current;setTarget(undefined);const id=form.rollbackTargetId;if(id)void readValue('release-target',`/api/releases/${id}`,value=>releaseReferenceResponse(value,id,form.projectId),generation).then(next=>{if(next)setTarget(next);}).catch(e=>{if(currentRead(generation))setError(e.message);});return()=>readSession.current?.cancel('release-target');},[form.rollbackTargetId,form.id,form.version,scope]);
  useEffect(() => {const generation=reads.current;setResolved(undefined);const id=form.resolvedInId;if(id)void readValue('release-resolved',`/api/releases/${id}`,value=>releaseReferenceResponse(value,id,form.projectId),generation).then(next=>{if(next)setResolved(next);}).catch(e=>{if(currentRead(generation))setError(e.message);});return()=>readSession.current?.cancel('release-resolved');},[form.resolvedInId,form.id,form.version,scope]);
  function requestClose() { modal.close(); }
  function field<K extends keyof Draft>(key: K, value: Draft[K]) { edit.change({[key]:value}); }
  async function loadTargets() {const generation=reads.current,request=++targetsRequest.current;setTargetsBusy(true);setError('');try{const next=await readValue('release-targets',`/api/releases?projectId=${form.projectId}&skip=${targets.items.length}`,value=>releaseProjectPage(value,form.projectId),generation);if(next&&currentRead(generation)&&request===targetsRequest.current)setTargets(old=>({...next,items:[...new Map([...old.items,...next.items].map(item=>[item.id,item])).values()]}));}catch(e){if(currentRead(generation)&&request===targetsRequest.current)setError((e as Error).message);}finally{if(currentRead(generation)&&request===targetsRequest.current)setTargetsBusy(false);}}
  useEffect(() => { if ((form.status === 'rolled_back' || form.issue.trim()) && !targets.items.length) void loadTargets(); }, [form.status, !!form.issue.trim(),form.id,form.version,scope,targets.items.length]);
  const lower = (r: ReleaseRecord) => r.baseVersion < form.baseVersion || (r.baseVersion === form.baseVersion && r.minor < form.minor);
  const options = [...new Map([...(target ? [target] : []), ...targets.items].filter(lower).map(r => [r.id, r])).values()];
  async function loadHistory(more = false) {
    const generation=reads.current,request=++historyRequest.current;
    setHistoryBusy(true);setError('');
    try {
      const next=await readValue('release-history',`/api/releases/${form.id}/history?skip=${more?history?.items.length||0:0}`,value=>releaseRevisionPage(value,{id:form.id!,projectId:form.projectId}),generation);
      if(next&&currentRead(generation)&&request===historyRequest.current)setHistory(old=>more&&old?{...next,items:[...new Map([...old.items,...next.items].map(item=>[item.id,item])).values()]}:next);
    } catch(e) {
      if(currentRead(generation)&&request===historyRequest.current)setError(e instanceof SyntaxError?'변경 이력을 해석하지 못했습니다. 다시 조회해 주세요.':(e as Error).message);
    } finally {
      if(currentRead(generation)&&request===historyRequest.current)setHistoryBusy(false);
    }
  }
  return <dialog className="cw-modal task-dialog" data-placement="drawer" aria-label="업데이트 버전" ref={dialog}><section className="detail-panel release-detail"><button className="cw-button close" data-variant="quiet" aria-label="업데이트 버전 닫기" onClick={requestClose} disabled={busy}>×</button>
    <span className="eyebrow"><ReleaseProject project={boot.projects.find(p => p.id === form.projectId)}/></span>{form.sourceReference && <p className="release-source"><a href={form.sourceReference} target="_blank" rel="noreferrer">원본 시트 기록 ↗</a></p>}<h1>{form.id ? `버전 ${releaseName(form)}` : form.minor ? `${form.baseVersion} 마이너 등록` : '기본 버전 등록'}</h1>
    <ScheduleToastNotice id={`release-editor-${form.id||'new'}-read`} state={error?{kind:'error',message:error}:targetsBusy?{kind:'loading',message:'연결할 버전을 조회하고 있습니다…'}:historyBusy?{kind:'loading',message:'변경 이력을 조회하고 있습니다…'}:null}/>
    <ScheduleToastNotice id={`release-editor-${form.id||'new'}-write`} state={edit.outcome?{...edit.outcome,actionLabel:edit.listFailed&&!busy?'목록 다시 확인':undefined,onAction:edit.listFailed&&!busy?()=>void edit.refreshList():undefined}:null}/>
    {manager&&form.id&&<WorkspaceState kind={busy&&!edit.closing?'loading':'empty'} title="저장 전 버전 변경 확인" message="수정 전·내 초안·현재 서버 값을 비교합니다. 적용 후 저장은 별도로 실행합니다." actionLabel={busy?undefined:'버전 변경 비교'} onAction={busy?undefined:()=>void edit.review()}/>}
    {manager ? <form onSubmit={e => { e.preventDefault(); void edit.save(); }}><fieldset disabled={busy} className="release-fields cw-form-fields"><div className="version-numbers cw-form-wide">{(['baseVersion', 'minor'] as const).map((key, index) => <label className="cw-form-field" key={key}>{['기본 버전', '마이너'][index]}<input className="cw-form-control" aria-label={['기본 버전 번호', '마이너 번호'][index]} type="number" required min="0" max="99999" step="1" readOnly={!!form.id || (key === 'baseVersion' ? record.minor > 0 : record.minor === 0)} value={Number.isNaN(form[key]) ? '' : form[key]} onChange={e => field(key, e.target.value === '' ? NaN : Number(e.target.value))} /></label>)}</div>
      {form.id && <small className="muted">버전 번호는 기록과 복귀 연결을 보존하기 위해 고정됩니다.</small>}
      <label className="cw-form-field">출시일<input className="cw-form-control" type="date" required={!form.releasedOnUnknown} value={form.releasedOnUnknown ? '' : form.releasedOn} onChange={e => edit.change({releasedOn:e.target.value,releasedOnUnknown:false})} />{form.releasedOnUnknown && <small>원본 시트에 마이너 출시일이 기재되어 있지 않습니다.</small>}</label>
      <label className="cw-form-field">패치 내용<textarea className="cw-form-control" rows={8} required maxLength={20000} value={form.notes} onChange={e => field('notes', e.target.value)} placeholder="이 버전에서 추가·수정·해결한 내용을 적어 주세요." /></label>
      <label className="cw-form-field">버전 상태<select className="cw-form-control" aria-label="버전 상태" value={form.status} onChange={e => edit.change({status:e.target.value as ReleaseStatus,rollbackTargetId:null})}>{Object.entries(releaseStatuses).filter(([value]) => value !== 'skipped' || form.minor === 0).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <ReleaseBadge status={form.status} />
      <label className="cw-form-field">문제·조치 내용{!['stable', 'unrecorded'].includes(form.status) && ' (필수)'}<textarea className="cw-form-control" rows={4} required={!['stable', 'unrecorded'].includes(form.status)} maxLength={10000} value={form.issue} onChange={e => { field('issue', e.target.value); if (!e.target.value.trim()) field('resolvedInId', null); }} placeholder="불안정 원인, 롤백 사유, 후속 조치를 기록해 주세요." /></label>
      {form.status === 'rolled_back' && <><label className="cw-form-field">복귀 버전<select className="cw-form-control" aria-label="복귀 버전" required value={form.rollbackTargetId || ''} onChange={e => field('rollbackTargetId', Number(e.target.value) || null)}><option value="">더 낮은 버전 선택</option>{options.map(r => <option key={r.id} value={r.id}>{releaseName(r)} · {releaseStatuses[r.status]}</option>)}</select></label>{targets.items.length < targets.total && <button className="cw-button" type="button" disabled={targetsBusy} onClick={() => void loadTargets()}>이전 복귀 버전 더 불러오기</button>}</>}
      {form.issue.trim() && <><label className="cw-form-field">문제 해결 마이너<select className="cw-form-control" aria-label="문제 해결 마이너" value={form.resolvedInId || ''} onChange={e => field('resolvedInId', Number(e.target.value) || null)}><option value="">미해결 / 미지정</option>{[...new Map([...(resolved ? [resolved] : []), ...targets.items].filter(r => r.baseVersion === form.baseVersion && r.minor > form.minor && r.status === 'stable').map(r => [r.id, r])).values()].map(r => <option key={r.id} value={r.id}>{releaseName(r)}에서 해결</option>)}</select></label>{targets.items.length < targets.total && <button className="cw-button" type="button" disabled={targetsBusy} onClick={() => void loadTargets()}>해결 마이너 목록 더 불러오기</button>}</>}
      <div className="form-actions">{form.id&&<button className="cw-button" data-variant="danger" type="button" title={edit.dirty?'수정 내용을 저장하거나 되돌린 뒤 삭제할 수 있습니다.':undefined} disabled={busy||edit.unavailable||edit.dirty||edit.deleted} onClick={()=>void edit.remove()}>업데이트 버전 삭제</button>}<button className="cw-button" data-variant="primary" disabled={busy||edit.unavailable||!edit.dirty}>{busy&&!edit.closing ? '저장 중…' : '업데이트 버전 저장'}</button></div></fieldset></form> : <><ReleaseBadge status={form.status} /><p className="muted">출시일 {form.releasedOnUnknown ? '미기재' : form.releasedOn}</p><h2>패치 내용</h2><div className="body-text">{form.notes}</div>{form.issue && <><h2>문제·조치 내용</h2><div className={`body-text ${!['stable', 'unrecorded'].includes(form.status) ? 'release-issue' : ''}`}>{form.issue}</div></>}{target && <p>복귀 버전: {releaseName(target)}</p>}{resolved && <p>문제 해결: {releaseName(resolved)}</p>}</>}
    {form.id && <section className="release-history"><h2>기록 변경 이력</h2><button className="cw-button" disabled={historyBusy} onClick={() => void loadHistory()}>변경 이력 조회</button>{history?.items.map(revision => { const snapshot = JSON.parse(revision.snapshot) as ReleaseRecord; return <article key={revision.id}><b>{stamp(revision.createdAt)} · <ReleaseActor actorId={revision.actorId} employees={boot.employees} imported={Boolean(snapshot.sourceReference)}/></b><p>기록 수정 #{snapshot.version} · {releaseName(snapshot)} · {snapshot.releasedOnUnknown ? '출시일 미기재' : snapshot.releasedOn}</p><ReleaseBadge status={snapshot.status} /><ReleaseRevisionBody snapshot={snapshot}/></article>; })}{history && history.items.length < history.total && <button className="cw-button" disabled={historyBusy} onClick={() => void loadHistory(true)}>이전 변경 이력 더 보기</button>}</section>}
  </section></dialog>;
}
