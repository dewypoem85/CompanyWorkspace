import { WorkspaceState } from './generated/workspace-state';
import { useWorkspaceModal } from './generated/workspace-modal';
import { confirmWorkspaceAction } from './generated/workspace-confirm';
import './settings.css';
import { DatePicker } from './DatePicker';
import { useWorkspaceNavigationRequest } from './generated/workspace-navigation';
import { useEffect, useRef, useState } from 'react';
import { MilestoneProject } from './MilestoneProject';
import { MilestoneCountdown } from './MilestoneCountdown';
import { unavailableMilestoneHolidays, type MilestoneHolidays } from './MilestoneCountdown';
import { useMilestoneHolidays } from './useMilestoneHolidays';
import { dayAdd, today } from './api';
import { milestoneTypes, type MilestoneType } from './types';
import type { Bootstrap, Milestone, MilestoneAuditSnapshot, MilestonePage, MilestoneRevision, MilestoneSchedule, TaskList } from './types';
import {milestoneSchedules} from './milestoneSchedules';
import { archivedTaskPageResponse, mergeTaskListPages, milestonePageResponse, milestoneRevisionResponse, scheduleGet } from './scheduleReads';
import { createWorkspaceReadSession, type WorkspaceReadSession } from './generated/workspace-read';
import { useMilestoneWrites } from './useMilestoneWrites';
import { ScheduleToastNotice } from './ScheduleToasts';

const blankMilestone = (): Partial<Milestone> => ({ type: 'general', title: '', description: '', deadlineMemo: '', date: today(), version: 0 });
const auditTime=(value?:string|null)=>value?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'기록 없음';
const actorName=(id:number|null|undefined,boot:Bootstrap)=>id?boot.employees.find(employee=>employee.id===id)?.name||`직원 #${id}`:'이전 기록';

function MilestoneAuthorship({milestone,boot}:{milestone:Partial<Milestone>;boot:Bootstrap}){
  if(!milestone.id)return null;
  return <span className="milestone-authorship"><span>등록: <b>{actorName(milestone.createdBy,boot)}</b> · {auditTime(milestone.createdAt)}</span><span>최근 수정: <b>{actorName(milestone.updatedBy,boot)}</b> · {auditTime(milestone.updatedAt)}</span></span>;
}

function auditSnapshot(value:string){return value?JSON.parse(value) as MilestoneAuditSnapshot:undefined;}
function auditSchedules(value:MilestoneAuditSnapshot|undefined){if(!value)return '없음';return [{type:value.type,date:value.endDate||value.date,memo:value.deadlineMemo||''},...(value.additionalSchedules||[]).map(item=>({type:item.type,date:item.endDate||item.date,memo:item.memo||''}))].map(item=>`${milestoneTypes[item.type]} ${item.date}${item.memo?` · ${item.memo}`:''}`).join(' · ');}
function historyChanges(revision:MilestoneRevision,boot:Bootstrap){
  const before=auditSnapshot(revision.beforeSnapshot),after=auditSnapshot(revision.afterSnapshot);const changes:{label:string;before?:string;after?:string}[]=[];
  const project=(id:number|null|undefined)=>id?boot.projects.find(item=>item.id===id)?.name||`프로젝트 #${id}`:'미지정';
  const add=(label:string,oldValue:string|undefined,newValue:string|undefined)=>{if(oldValue!==newValue)changes.push({label,before:oldValue,after:newValue});};
  add('제목',before?.title,after?.title);add('프로젝트',before?project(before.projectId):undefined,after?project(after.projectId):undefined);add('타입·마감',before?auditSchedules(before):undefined,after?auditSchedules(after):undefined);add('상세 내용',before?.description,after?.description);
  return changes.length?changes:[{label:'내용',after:'변경 없이 다시 저장됨'}];
}

function MilestoneHistory({items,boot,busy,error,retry}:{items:MilestoneRevision[];boot:Bootstrap;busy:boolean;error:string;retry:()=>void}){
  return <section className="milestone-history" aria-label="주요 일정 변경 이력"><h3>변경 이력</h3><ScheduleToastNotice id="milestone-history" state={busy?{kind:'loading',message:'변경 이력을 불러오는 중…'}:error?{kind:'error',message:error,actionLabel:'변경 이력 다시 조회',onAction:retry}:null}/>{!busy&&!error&&items.length===0&&<p className="empty-note">이 기능 도입 전에 작성된 일정이라 변경 이력이 없습니다.</p>}
    {items.map(revision=><article key={revision.id}><header><b>{actorName(revision.actorId,boot)}</b><span>{revision.action==='create'?'등록':revision.action==='update'?'수정':'삭제'} · <time dateTime={revision.createdAt}>{auditTime(revision.createdAt)}</time></span></header><ul>{historyChanges(revision,boot).map((change,index)=><li key={`${revision.id}-${index}`}><b>{change.label}</b>{change.before!==undefined&&<del>{change.before||'(비어 있음)'}</del>}{change.after!==undefined&&<ins>{change.after||'(비어 있음)'}</ins>}</li>)}</ul></article>)}
  </section>;
}

function ScheduleRows({milestone,holidays}:{milestone:Partial<Milestone>;holidays:MilestoneHolidays}){
  if(!milestone.date)return null;
  return <ol className="milestone-schedule-list">{milestoneSchedules(milestone as Milestone).sort((a,b)=>a.date.localeCompare(b.date)).map((schedule,index)=><li key={`${schedule.type}-${schedule.date}-${index}`}>
    <span className={`milestone-type ${schedule.type}`}>{milestoneTypes[schedule.type]}</span><time dateTime={schedule.date}>{schedule.date}</time>{schedule.memo&&<strong className="milestone-schedule-memo">{schedule.memo}</strong>}<MilestoneCountdown schedule={schedule} holidays={holidays}/>
  </li>)}</ol>;
}

export function MilestoneDetails({ milestone, projects, holidays=unavailableMilestoneHolidays }: { milestone: Partial<Milestone>; projects: Bootstrap['projects']; holidays?: MilestoneHolidays }) {
  return <section aria-label="주요 일정 상세">
    <h2>{milestone.title}</h2>
    <p className="muted"><MilestoneProject project={projects.find(p => p.id === milestone.projectId)} /></p>
    <ScheduleRows milestone={milestone} holidays={holidays}/>
    <h3>상세 내용</h3>
    {milestone.description ? <div className="body-text">{milestone.description}</div> : <p className="empty-note">등록된 상세 내용이 없습니다.</p>}
  </section>;
}

export function Settings({ boot, close, changed, refreshIdentity, selectedMilestone, openTask }: { boot: Bootstrap; close: () => void; changed: () => Promise<void>; refreshIdentity: () => Promise<Bootstrap>; selectedMilestone?: Milestone; openTask: (id: number) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState('milestones');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false); const [discarding, setDiscarding] = useState(false);
  const [milestone, setMilestone] = useState<Partial<Milestone>>(selectedMilestone || blankMilestone());
  const [baseline, setBaseline] = useState<Milestone|undefined>(selectedMilestone);
  const [milestones, setMilestones] = useState<Milestone[]>([]); const [archive, setArchive] = useState<TaskList>();
  const milestoneHolidays=useMilestoneHolidays([...milestones,milestone],boot.me.id);
  const [milestonePage,setMilestonePage]=useState<MilestonePage>();
  const [history,setHistory]=useState<MilestoneRevision[]>([]);const [historyBusy,setHistoryBusy]=useState(false);const [historyError,setHistoryError]=useState('');const [historyRetry,setHistoryRetry]=useState(0);
  const [range, setRange] = useState(selectedMilestone?.date || today());
  const readSession=useRef<WorkspaceReadSession|undefined>(undefined),readGeneration=useRef(0),historyGeneration=useRef(0);
  const current = useRef({ boot, busy, dirty, milestone, tab, archive }); current.current = { boot, busy, dirty, milestone, tab, archive };
  const discard = useRef<{ locked: boolean; mounted: boolean; epoch: number; abort: AbortController | null }>({ locked: false, mounted: true, epoch: 0, abort: null });
  const manager = boot.me.isAdmin || boot.leads.some(l => l.employeeId === boot.me.id && l.departmentId === boot.me.departmentId);
  const latest = milestones.find(m => m.id === milestone.id);
  const pageUrl=()=>`/api/milestones?from=${range}&to=${dayAdd(range,90)}&editing=true`;
  const readMilestonePage=(signal?:AbortSignal)=>scheduleGet(pageUrl(),signal||new AbortController().signal,milestonePageResponse);
  const writes=useMilestoneWrites({boot,draft:milestone,baseline,page:milestonePage,dirty,blocked:()=>busy||discard.current.locked,refreshIdentity,readPage:readMilestonePage,
    committed:receipt=>{if(receipt.deleted){setMilestone(blankMilestone());setBaseline(undefined);}else{setMilestone(receipt.milestone);setBaseline(receipt.milestone);}setDirty(false);},
    refreshed:(page,receipt)=>{setMilestonePage(page);setMilestones(page.items);if(!receipt.deleted){const saved=page.items.find(x=>x.id===receipt.milestone.id)||receipt.milestone;setMilestone(saved);setBaseline(saved);}void changed();},
    conflicted:page=>{setMilestonePage(page);setMilestones(page.items);}});
  const writing=writes.busy||writes.locked;
  const modal = useWorkspaceModal(dialog, {scope:'retain', canClose:canCloseNow, beforeCloseRequest:requestDiscard, onClose:finishClose});
  useEffect(() => {
    discard.current.mounted = true;
    try { readSession.current=createWorkspaceReadSession(); } catch(error) { setError((error as Error).message); }
    const invalidate = () => { discard.current.epoch++; discard.current.abort?.abort(); readGeneration.current++; historyGeneration.current++; readSession.current?.cancel('settings-milestones'); readSession.current?.cancel('settings-history'); readSession.current?.cancel('settings-archive'); setMilestones([]); setMilestonePage(undefined); setHistory([]); setArchive(undefined); setBusy(false); };
    document.addEventListener('workspace-entity-scope-change', invalidate);
    return () => { discard.current.mounted = false; discard.current.epoch++; discard.current.abort?.abort(); readGeneration.current++; document.removeEventListener('workspace-entity-scope-change', invalidate); readSession.current?.dispose(); readSession.current=undefined; };
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, busy]);
  useWorkspaceNavigationRequest(requestDiscard);
  useEffect(() => {
    const session=readSession.current;if(!session){setError('공통 조회 도구를 불러오지 못했습니다. 페이지를 다시 열어 주세요.');return;}
    let active=true;const generation=++readGeneration.current,channel=tab==='milestones'?'settings-milestones':'settings-archive';setError('');
    const current=(isCurrent:()=>boolean)=>active&&generation===readGeneration.current&&isCurrent();
    if(tab==='milestones')void session.run<{items:Milestone[];page:MilestonePage|undefined}>(channel,signal=>readMilestonePage(signal).then(page=>({items:page.items,page}))).then(result=>{
      if(result.status==='cancelled'||!current(result.isCurrent))return;
      if(result.status==='error')setError((result.error as Error).message);else{setMilestonePage(result.value.page);setMilestones(result.value.items);}
    });
    if(tab==='archive')void session.run(channel,signal=>scheduleGet('/api/tasks?archived=true&take=100',signal,archivedTaskPageResponse)).then(result=>{
      if(result.status==='cancelled'||!current(result.isCurrent))return;
      if(result.status==='error')setError((result.error as Error).message);else setArchive(result.value);
    });
    return()=>{active=false;session.cancel(channel);};
  }, [tab, range, boot.me.id]);
  useEffect(()=>{
    if(!milestone.id){setHistory([]);setHistoryError('');setHistoryBusy(false);return;}
    const id=milestone.id,session=readSession.current,generation=++historyGeneration.current;if(!session){setHistoryError('변경 이력 조회 도구를 불러오지 못했습니다.');return;}
    let active=true;setHistoryBusy(true);setHistoryError('');
    void session.run('settings-history',signal=>scheduleGet(`/api/milestones/${id}/history`,signal,value=>milestoneRevisionResponse(value,id))).then(result=>{
      if(!active||generation!==historyGeneration.current||result.status==='cancelled'||!result.isCurrent())return;
      if(result.status==='error')setHistoryError((result.error as Error).message);else setHistory(result.value);setHistoryBusy(false);
    });
    return()=>{active=false;session.cancel('settings-history');};
  },[milestone.id,milestone.version,historyRetry]);
  function canCloseNow() { return !busy && !discard.current.locked; }
  async function requestDiscard({ signal }: { signal: AbortSignal }): Promise<(() => boolean) | null> {
    if (!canCloseNow() || signal.aborted || !discard.current.mounted) return null;
    const start = current.current;
    const actor = JSON.stringify([start.boot.me.id, start.boot.me.active, start.boot.me.access, start.boot.me.isAdmin, start.boot.me.departmentId]);
    const snapshot = { epoch: discard.current.epoch, actor, dirty: start.dirty, tab: start.tab, milestone: JSON.stringify(start.milestone) };
    const controller = new AbortController();
    const stable = () => discard.current.mounted && discard.current.epoch === snapshot.epoch && !signal.aborted && !controller.signal.aborted
      && JSON.stringify([current.current.boot.me.id, current.current.boot.me.active, current.current.boot.me.access, current.current.boot.me.isAdmin, current.current.boot.me.departmentId]) === snapshot.actor
      && !current.current.busy && current.current.dirty === snapshot.dirty && current.current.tab === snapshot.tab && JSON.stringify(current.current.milestone) === snapshot.milestone;
    const approve = () => stable() && !discard.current.locked;
    if (!snapshot.dirty) return approve;
    const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
    discard.current.locked = true; discard.current.abort = controller; setDiscarding(true);
    try {
      const project = start.boot.projects.find(item => item.id === start.milestone.projectId);
      const projectName = project?.name || '프로젝트 미지정';
      const intent = await confirmWorkspaceAction({ title: '주요 일정 초안을 버릴까요?', message: '작성 중인 주요 일정 내용을 닫습니다. 저장하지 않은 내용은 사라집니다.', confirmLabel: '초안 버리기', tone: 'danger',
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined, signal: controller.signal,
        details: [
          { label: '주요 일정', value: start.milestone.title || '새 주요 일정' },
          { label: '프로젝트', value: projectName, entity: { kind: 'project', id: project ? String(project.id) : null, name: projectName } },
          { label: '날짜', value: start.milestone.date || '날짜 미지정' },
        ],
        validate: () => stable() ? null : '확인 중 계정 또는 초안이 변경되었습니다. 현재 내용을 다시 확인해 주세요.',
      });
      return intent && stable() ? approve : null;
    } catch {
      if (stable()) setError('초안 확인창을 열지 못했습니다. 작성 중인 내용은 유지했습니다.');
      return null;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (discard.current.abort === controller) { discard.current.abort = null; discard.current.locked = false; if (discard.current.mounted) setDiscarding(false); }
    }
  }
  async function transitionDraft(next: () => void) {
    const controller = new AbortController();
    try { const approve = await requestDiscard({ signal: controller.signal }); if (approve?.()) next(); }
    finally { controller.abort(); }
  }
  function finishClose() { current.current.dirty = false; setDirty(false); close(); }
  function requestClose() { void modal.close(); }
  function choose(next: Partial<Milestone>) { void transitionDraft(() => { setMilestone(next); setBaseline(next.id?next as Milestone:undefined); setDirty(false); setError(''); }); }
  function switchTab(next: string) { if (next !== tab) void transitionDraft(() => { setTab(next); setMilestone(blankMilestone()); setBaseline(undefined); setDirty(false); setError(''); }); }
  function field<K extends keyof Milestone>(key: K, value: Milestone[K]) { if (discard.current.locked) return; setMilestone(old => ({ ...old, [key]: value })); setDirty(true); }
  function changeAdditional(index:number, schedule:MilestoneSchedule){if(discard.current.locked)return;setMilestone(old=>({...old,additionalSchedules:(old.additionalSchedules||[]).map((item,i)=>i===index?schedule:item)}));setDirty(true);}
  function addAdditional(){if(discard.current.locked)return;setMilestone(old=>({...old,additionalSchedules:[...(old.additionalSchedules||[]),{type:'general',date:'',memo:''}]}));setDirty(true);}
  function removeAdditional(index:number){if(discard.current.locked)return;setMilestone(old=>({...old,additionalSchedules:(old.additionalSchedules||[]).filter((_,i)=>i!==index)}));setDirty(true);}
  async function loadArchiveMore() {
    if (busy || discard.current.locked) return; setError(''); setBusy(true);
    const start=archive,session=readSession.current,generation=++readGeneration.current;
    try {
      if(!start||!session||start.items.length>=start.total)throw Error('보관함 다음 페이지를 조회할 수 없습니다.');
      const result=await session.run('settings-archive',signal=>scheduleGet(`/api/tasks?archived=true&take=100&skip=${start.items.length}`,signal,archivedTaskPageResponse));
      if(result.status==='cancelled'||generation!==readGeneration.current||!result.isCurrent())return;
      if(result.status==='error')throw result.error;
      const merged=mergeTaskListPages(start,result.value);if(current.current.archive!==start)throw Error('보관함 목록이 변경되었습니다. 다시 확인해 주세요.');setArchive(merged);
    } catch(e) { if(generation===readGeneration.current&&discard.current.mounted)setError((e as Error).message); }
    finally { if(generation===readGeneration.current&&discard.current.mounted)setBusy(false); }
  }
  async function requestDelete() {
    if (busy || discard.current.locked || !milestone.id) return;
    await writes.run('delete');
  }
  return <dialog className="cw-modal task-dialog" aria-label="일정 관리" ref={dialog}><section className="detail-panel schedule-settings">
    <div className="schedule-settings-toolbar"><h1>일정 관리</h1><button className="cw-button close" data-variant="quiet" aria-label="관리 닫기" onClick={requestClose} disabled={busy || discarding}>×</button></div>
    <div className="schedule-settings-content">
    <p className="empty-note">주요 일정은 모든 일정 사용자가 등록·수정할 수 있으며, 변경한 사람과 내용이 이력에 기록됩니다.</p>
    {manager && <p className="empty-note">부서·프로젝트·책임자 정보는 회사 포털에서 관리합니다.{boot.me.isAdmin && <a href="https://company.example.com/Admin/Users"> 직원 관리 열기 ↗</a>}</p>}
    <div className="settings-tabs" aria-label="관리 보기"><button className="cw-button" aria-pressed={tab === 'milestones'} onClick={() => switchTab('milestones')}>주요 일정</button>{boot.me.isAdmin && <button className="cw-button" aria-pressed={tab === 'archive'} onClick={() => switchTab('archive')}>보관함</button>}</div>
    <ScheduleToastNotice id="settings-read" state={error?{kind:'error',message:error}:null}/>
    <ScheduleToastNotice id="settings-write" state={writes.outcome}/>
    {tab === 'milestones' && <>
      <label className="cw-form-field range-field">이 날짜부터 90일 조회<DatePicker label="주요 일정 조회 시작일" value={range} onChange={value => setRange(value || today())} /></label>
      <div className="settings-list">{milestones.map(m => <button className="cw-button milestone-card" data-layout="content" key={m.id} onClick={() => choose(m)} aria-pressed={milestone.id === m.id}>
        <span className="milestone-card-heading"><b className="milestone-card-title">{m.title}</b><MilestoneProject project={boot.projects.find(p => p.id === m.projectId)} /></span>
        <ScheduleRows milestone={m} holidays={milestoneHolidays}/>
        <MilestoneAuthorship milestone={m} boot={boot}/>
      </button>)}</div>
      <form className="milestone-editor" onSubmit={e => { e.preventDefault(); void writes.run(milestone.id?'update':'create'); }}>
        <h2>{milestone.id ? '주요 일정 수정' : '주요 일정 추가'}</h2>
        <MilestoneAuthorship milestone={milestone} boot={boot}/>
        <label className="cw-form-field">제목<input className="cw-form-control" required maxLength={200} disabled={busy || discarding || writing} value={milestone.title || ''} onChange={e => field('title', e.target.value)} /></label>
        <label className="cw-form-field">프로젝트<select className="cw-form-control" data-company-picker="project" aria-label="프로젝트" disabled={busy || discarding || writing} value={milestone.projectId || ''} onChange={e => field('projectId', e.target.value ? Number(e.target.value) : null)}><option value="">미지정</option>{boot.projects.filter(p => !p.archived || p.id === milestone.projectId).map(p => <option key={p.id} value={p.id}>{p.name}{p.isPrivate ? ' · 비공개' : ''}{p.archived ? ' · 보관됨' : ''}</option>)}</select></label>
        <div className="milestone-schedule-editor"><div className="milestone-schedule-heading"><h3>{milestoneTypes[milestone.type||'general']} 마감</h3>{milestone.date&&<MilestoneCountdown holidays={milestoneHolidays} schedule={{type:milestone.type||'general',date:milestone.endDate||milestone.date,memo:milestone.deadlineMemo||''}}/>}</div><div className="cw-form-fields milestone-fields"><label className="cw-form-field">타입<select className="cw-form-control" aria-label="주요 일정 타입" disabled={busy || discarding || writing} value={milestone.type || "general"} onChange={e => field("type", e.target.value as MilestoneType)}>{Object.entries(milestoneTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="cw-form-field">마감일<DatePicker label="주요 일정 마감일" required disabled={busy || discarding || writing} value={milestone.endDate || milestone.date || ''} onChange={value => {field('date', value);field('endDate', null);}} /></label><label className="cw-form-field milestone-memo-field">마감 메모<input className="cw-form-control" maxLength={200} disabled={busy || discarding || writing} value={milestone.deadlineMemo||''} onChange={e=>field('deadlineMemo',e.target.value)} placeholder="예: 신캐릭터 마감"/><small>{(milestone.deadlineMemo||'').length}/200자 · 비워두면 주요 일정 제목으로 표시</small></label></div></div>
        {(milestone.additionalSchedules||[]).map((schedule,index)=><div className="milestone-schedule-editor" key={index}><div className="milestone-schedule-heading"><h3>{milestoneTypes[schedule.type]} 마감</h3>{schedule.date&&<MilestoneCountdown holidays={milestoneHolidays} schedule={{type:schedule.type,date:schedule.endDate||schedule.date,memo:schedule.memo||''}}/>}<button className="cw-button" type="button" data-size="compact" aria-label={`${milestoneTypes[schedule.type]} 마감 제거`} disabled={busy || discarding || writing} onClick={()=>removeAdditional(index)}>마감 제거</button></div><div className="cw-form-fields milestone-fields"><label className="cw-form-field">타입<select className="cw-form-control" aria-label={`추가 일정 ${index+2} 타입`} disabled={busy || discarding || writing} value={schedule.type} onChange={e=>changeAdditional(index,{...schedule,type:e.target.value as MilestoneType})}>{Object.entries(milestoneTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="cw-form-field">마감일<DatePicker label={`추가 일정 ${index+2} 마감일`} required disabled={busy || discarding || writing} value={schedule.endDate||schedule.date} onChange={value=>changeAdditional(index,{...schedule,date:value,endDate:null})}/></label><label className="cw-form-field milestone-memo-field">마감 메모<input className="cw-form-control" aria-label={`추가 일정 ${index+2} 마감 메모`} maxLength={200} disabled={busy || discarding || writing} value={schedule.memo||''} onChange={e=>changeAdditional(index,{...schedule,memo:e.target.value})} placeholder="예: 신스킨 마감"/><small>{(schedule.memo||'').length}/200자 · 비워두면 주요 일정 제목으로 표시</small></label></div></div>)}
        <button className="cw-button" type="button" disabled={busy || discarding || writing || (milestone.additionalSchedules||[]).length>=20} onClick={addAdditional}>＋ 타입·일정 추가</button>
        <label className="cw-form-field">상세 내용<textarea className="cw-form-control" rows={8} maxLength={10000} disabled={busy || discarding || writing} value={milestone.description || ''} onChange={e => field('description', e.target.value)} placeholder="일정의 목적, 준비 사항, 전달할 내용을 적어 주세요." /><small>{(milestone.description || '').length.toLocaleString()}/10,000자 · 선택 입력</small></label>
        <ScheduleToastNotice id="milestone-conflict" state={latest&&latest.version!==milestone.version?{kind:'error',title:'주요 일정이 변경되었습니다.',message:'다른 사람이 이 주요 일정을 수정했습니다. 작성 내용은 유지됩니다.',actionLabel:'최신 내용 불러오기',onAction:()=>choose(latest)}:null}/>
        <div className="form-actions">
          {milestone.id && manager && <button className="cw-button" data-variant="danger" type="button" disabled={busy || discarding || writing} onClick={() => void requestDelete()}>삭제</button>}
          <button className="cw-button" type="button" disabled={busy || discarding || writing} onClick={() => choose(blankMilestone())}>새 일정</button><button className="cw-button" data-variant="primary" disabled={busy || discarding || writing}>{writes.busy ? '저장 중…' : '저장'}</button>
        </div>
      </form>
      {milestone.id&&<MilestoneHistory items={history} boot={boot} busy={historyBusy} error={historyError} retry={()=>setHistoryRetry(value=>value+1)}/>}
    </>}
    {tab === 'archive' && boot.me.isAdmin && <>
      <div className="settings-list">{archive?.items.map(t => <button className="cw-button" data-layout="content" key={t.id} onClick={() => void openTask(t.id)}><b className="milestone-card-title">{t.title}</b><small>열어서 복원</small></button>)}</div>
      {archive?.total === 0 && <WorkspaceState kind="empty" message="보관된 업무가 없습니다." />}
      {archive && archive.items.length < archive.total && <button className="cw-button" disabled={busy} onClick={() => void loadArchiveMore()}>{busy?'조회 중…':'더 보기'}</button>}
    </>}
    </div>
  </section></dialog>;
}
