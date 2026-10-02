import { taskGroups, type Grouping } from './taskGroups';
import { Fragment } from 'react';
import { useWorkspaceDisclosure } from './generated/workspace-disclosure';
import { today } from './api';
import { Avatar } from './Avatar';
import { calendarDay } from './calendarDay';
import { MilestoneProject } from './MilestoneProject';
import { MilestoneCountdown } from './MilestoneCountdown';
import { unavailableMilestoneHolidays, type MilestoneHolidays } from './MilestoneCountdown';
import { milestoneOccurrences } from './milestoneSchedules';
import { milestoneTypes } from './types';
import type { Absences, Employee, Milestone, Project, Task, WorkGoal } from './types';
import { useMemo, useState, useRef, useEffect, useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import { dateSpan, departmentColor, placeTasks, visibleLanes, weekDay, type Density } from './timeline';
export { placeTasks } from './timeline';

type Props = {
  focused?: boolean; toggleFocus?: () => void; grouping?: Grouping; employees?: Employee[]; departments?: { id: number; name: string }[];
  days: string[]; people: Employee[]; tasks: Task[]; milestones: Milestone[]; projects?: Project[]; goals?: WorkGoal[]; absences: Absences;
  milestoneHolidays?: MilestoneHolidays;
  project: string; density: Density; card: (t: Task) => ReactNode;
  create: (employeeId: number, date: string) => void; canAssign: (id: number) => boolean;
  editMilestone: (m: Milestone) => void;
  visibleWeeks?: number; rowHeight?: number; navigation?: number; loading?: boolean; extend?: (direction: -1 | 1) => void;
};

function spanFor(start:string,end:string,days:string[]){const included=days.map((date,index)=>date>=start&&date<=end?index:-1).filter(index=>index>=0);return included.length?{start:included[0],end:included.at(-1)!}:null;}

export function WeekBoard({ focused = false, toggleFocus, grouping = 'employee', employees = [], departments = [], days, people, tasks, milestones, projects = [], goals = [], absences, milestoneHolidays=unavailableMilestoneHolidays, project, density, card, create, canAssign, editMilestone, visibleWeeks = 1, rowHeight = 44, navigation = 0, loading = false, extend }: Props) {
  const mine = grouping === 'mine';
  if (mine) grouping = 'employee';
  const boardRoot = useRef<HTMLDivElement>(null);
  const disclosure = useWorkspaceDisclosure(boardRoot);
  const [mobile, setMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches);
  useEffect(() => { const media = matchMedia('(max-width: 700px)'); const update = () => setMobile(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const compact = density === 'compact'; const personGrouping=grouping==='employee';
  const rangeSpan=(start:string,end:string)=>spanFor(start,end,days);
  const dayInfo = useMemo(() => new Map(days.map(d => [d, calendarDay(d, absences.holidays || [])])), [days, absences.holidays]);
  const dayClass = (d: string) => `${dayInfo.get(d)!.className} ${d === today() ? 'today' : ''} ${weekDay(d) === '월' ? 'week-start' : ''}`;
  const scroll = useRef<HTMLDivElement>(null); const [viewport, setViewport] = useState(1100);
  const hasWeekends = days.some(d => weekDay(d) === '토'); const daysPerWeek = hasWeekends ? 7 : 5;
  const dayWidth = Math.max(40, (viewport - (personGrouping?160:0)) / (visibleWeeks * daysPerWeek));
  const template = `${personGrouping?'160px ':''}repeat(${days.length}, ${dayWidth}px)`;
  const anchor = useRef({ first: days[0], width: dayWidth, navigation, hasWeekends });
  const previousScroll = useRef(0); const adjusting = useRef(false); const pending = useRef(false);
  useEffect(() => {
    const element = scroll.current; if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth)); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = scroll.current; if (!element) return;
    const old = anchor.current;
    adjusting.current = true;
    if (old.navigation !== navigation || old.hasWeekends !== hasWeekends) element.scrollLeft = 0;
    else {
      const shiftedWeeks = (Date.parse(old.first) - Date.parse(days[0])) / (86400000 * 7);
      element.scrollLeft = Math.max(0, (element.scrollLeft / old.width + shiftedWeeks * daysPerWeek) * dayWidth);
    }
    previousScroll.current = element.scrollLeft;
    anchor.current = { first: days[0], width: dayWidth, navigation, hasWeekends };
    pending.current = false;
    const frame = requestAnimationFrame(() => { adjusting.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [days[0], days.length, dayWidth, navigation, hasWeekends]);
  useEffect(() => { if (!loading) pending.current = false; }, [loading]);
  function loadMore(direction: -1 | 1) { if (!loading && !pending.current && extend) { pending.current = true; extend(direction); } }
  function onScroll() {
    const el = scroll.current; if (!el) return;
    const delta = el.scrollLeft - previousScroll.current; previousScroll.current = el.scrollLeft;
    if (adjusting.current || loading || Math.abs(delta) < 1) return;
    if (delta > 0 && el.scrollWidth - el.clientWidth - el.scrollLeft < Math.max(80, dayWidth)) loadMore(1);
    else if (delta < 0 && el.scrollLeft < 80) loadMore(-1);
  }
  const [allExpanded, setAllExpanded] = useState(!personGrouping);
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  function expandAll(value: boolean) { setAllExpanded(value); setExpanded(new Set()); }
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  function toggle(id: number) { setExpanded(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const isExpanded = (id: number) => allExpanded !== expanded.has(id);
  const groups = useMemo(() => personGrouping ? [] : taskGroups(tasks, employees, projects, departments, grouping as 'project'|'department'|'goal', days, goals), [tasks, employees, projects, departments, goals, grouping, days,personGrouping]);
  const rows = useMemo(() => {
    const byPerson = new Map<number, Task[]>();
    const away = new Map<number, Absences['items']>();
    for (const task of tasks) { const group = byPerson.get(task.assigneeId) || []; group.push(task); byPerson.set(task.assigneeId, group); }
    for (const absence of absences.items) { const group = away.get(absence.employeeId) || []; group.push(absence); away.set(absence.employeeId, group); }
    return people.map(person => ({ person, tasks: byPerson.get(person.id) || [], placements: placeTasks(byPerson.get(person.id) || [], days), absences: (away.get(person.id) || []).filter(a => days.includes(a.date)) }));
  }, [people, tasks, absences, days]);
  const portion = (p: string) => p === 'morning' ? '오전 반차' : p === 'afternoon' ? '오후 반차' : p === 'other' ? '부재' : '연차';
  function planningSummary(task:Task) { if(!mine)return null; return <div className="my-task-details"><p>{task.body||'업무 설명 없음'}</p>{task.scheduleItems?.map(item=><span key={`schedule-${item.id}`}>{item.date}{item.endDate&&item.endDate!==item.date?` ~ ${item.endDate}`:''} · {item.title}</span>)}{task.sharedTodos?.map(item=><span key={`todo-${item.id}`} className={item.completedAt?'completed':''}>{item.completedAt?'✓':'○'} {item.title}</span>)}</div>; }
  const milestoneAccent = (type?: Milestone['type']) => type === 'review' ? '#d68b32' : type === 'update' ? '#3895de' : type === 'prototype' ? '#a273ce' : '#98a1af';
  function milestoneCard({milestone:m,schedule,index}:ReturnType<typeof milestoneOccurrences>[number]) { const milestoneProject = projects.find(p => p.id === m.projectId),label=schedule.memo?.trim()||m.title; return <button key={`${m.id}-${index}`} title={`${milestoneProject?.name || '프로젝트 미지정'} · ${milestoneTypes[schedule.type]} · ${label}${label!==m.title?`\n주요 일정: ${m.title}`:''}${m.description ? '\n' + m.description.slice(0, 200) : ''}`} onClick={() => editMilestone(m)} className={`cw-button milestone-chip milestone-${schedule.type}`} data-variant="record" data-layout="content" data-size="compact" style={{ '--record-accent': milestoneAccent(schedule.type) } as CSSProperties}><span className="milestone-chip-heading"><MilestoneProject project={milestoneProject} /></span><span className={`milestone-type ${schedule.type}`}><span>{milestoneTypes[schedule.type]}</span><MilestoneCountdown schedule={schedule} holidays={milestoneHolidays}/></span><strong>{label}</strong>{m.description && <small className="milestone-summary">{m.description}</small>}</button>; }
  const dateMilestones = (date: string) => milestoneOccurrences(milestones,date).filter(({milestone})=>!project||String(milestone.projectId)===project);
  function renderTask(task:Task,lane:number,row:number,columnOffset:number){
    const current=task.startDate&&task.endDate?rangeSpan(task.startDate,task.endDate):null;
    const taskRow=lane+row,parts:ReactNode[]=[];
    if(current)parts.push(<div key={`current-${task.id}`} className={`timeline-task ${current.start!==current.end?'period-task':''} ${mine?'with-task-details':''}`} title={`${task.startDate} ~ ${task.endDate}`} style={{gridColumn:`${current.start+columnOffset} / ${current.end+columnOffset+1}`,gridRow:taskRow}}>{card(task)}{planningSummary(task)}</div>);
    return parts;
  }
  return <div ref={boardRoot} className={`week-board ${grouping}-view standard-board`}>
    <div className="board-actions"><span className="board-count">{grouping === 'employee' ? `${people.length}명 · ${tasks.length}개 업무` : `${groups.length}개 ${grouping === 'project' ? '프로젝트' : grouping === 'goal' ? '목표' : '부서'} · ${groups.reduce((sum,g) => sum + g.tasks.length, 0)}개 업무`}</span><button type="button" className="cw-button" data-size="compact" onClick={() => expandAll(true)}>업무 모두 펼치기</button><button type="button" className="cw-button" data-size="compact" onClick={() => expandAll(false)}>업무 모두 접기</button><div className="board-guide"><button type="button" className="cw-button" data-size="compact" data-cw-disclosure="legend" disabled={!disclosure.ready}>색상 안내</button><div data-cw-disclosure-panel="legend" hidden className="calendar-legend" aria-label="일정 색상 안내"><span className="legend-saturday">토요일</span><span className="legend-holiday">일요일·공휴일</span><span className="legend-today">오늘</span><span className="legend-planning">기획</span><span className="legend-development">개발</span><span className="legend-art">아트</span></div></div><div className="grow" />{toggleFocus && <button type="button" className="cw-button" data-size="compact" aria-pressed={focused} onClick={toggleFocus}>{focused ? '기본 화면' : '크게 보기'}</button>}<span className="board-loading" role="status">{loading ? '갱신 중…' : ''}</span><button type="button" className="cw-button" data-size="compact" disabled={loading} onClick={() => loadMore(-1)} aria-label="이전 주 불러오기">← 이전</button><button type="button" className="cw-button" data-size="compact" disabled={loading} onClick={() => loadMore(1)} aria-label="다음 주 불러오기">다음 →</button></div>
    <div ref={scroll} onScroll={onScroll} onWheel={e => { if ((e.deltaX < 0 || (e.shiftKey && e.deltaY < 0)) && e.currentTarget.scrollLeft <= 1) loadMore(-1); }} onKeyDown={e => { if (e.key === 'ArrowLeft' && e.currentTarget.scrollLeft <= 1) loadMore(-1); }} tabIndex={0} aria-label="좌우로 스크롤하는 팀 일정" aria-busy={loading} className={`week-scroll desktop-week range-board ${dayWidth < 80 ? 'dense-milestones' : ''} ${compact ? 'compact-board' : 'detail-board'} ${milestonesOpen ? 'milestones-expanded' : ''}`} style={{ '--board-min-width': `${(personGrouping?160:0) + dayWidth * days.length}px`, '--row-height': `${rowHeight}px` } as CSSProperties}>
      <div className="week-head" style={{gridTemplateColumns:template}}>
        {personGrouping&&<div className="corner">담당자</div>}
        {days.map(d=><div key={d} className={`day-header ${dayClass(d)}`} title={dayInfo.get(d)!.label} aria-label={dayInfo.get(d)!.label}>
          <span>{weekDay(d)}</span><b>{d.slice(5).replace('-','.')}</b>{d===today()&&<small className="today-badge cw-state-pill" data-tone="info">오늘</small>}
          {dayInfo.get(d)!.holiday&&<span className="holiday-name">{dayInfo.get(d)!.holiday}</span>}
        </div>)}
      </div>
      {days.some(d => dateMilestones(d).length) && <div className="milestone-row" style={{ gridTemplateColumns: template }}>
        {personGrouping && <div className="person-label milestone-label"><button type="button" className="cw-button" data-size="compact" data-variant="quiet" aria-expanded={milestonesOpen} onClick={() => setMilestonesOpen(!milestonesOpen)}>◆ 주요 일정 {milestonesOpen ? '▴' : '▾'}</button></div>}
        {days.map(d => <div className={`milestone-cell ${dayClass(d)}`} key={d}>{dateMilestones(d).map(milestoneCard)}</div>)}
      </div>}
      {grouping === 'employee' && rows.map(({ person: p, placements: allPlacements, absences: away }) => {
        const open = isExpanded(p.id);
        const { lanes, total, visible, hidden } = visibleLanes(allPlacements, density, open);
        const hasAbsence = away.length > 0;
        const taskRow = hasAbsence ? 2 : 1;
        const rowEnd = lanes + taskRow;
        return <div key={p.id} className={`timeline-row ${open ? 'expanded-person' : ''}`} data-employee-id={p.id} style={{ '--department-color': departmentColor(p.department), gridTemplateColumns: template, gridTemplateRows: `${hasAbsence ? '24px ' : ''}repeat(${lanes}, minmax(${compact ? rowHeight : Math.max(86, rowHeight)}px, auto))` } as CSSProperties}>
          <div className="person-label" style={{ gridRow: `1 / ${rowEnd}`, gridColumn: 1 }}>
            <Avatar id={p.id} name={p.name} />
            <div className="person-info"><b>{p.name}</b><small>{p.department || '미지정'}</small>
              {total > (compact ? 1 : 2) && <button type="button" className="cw-button expand-person" data-size="compact" aria-expanded={open} aria-label={`${p.name} 업무 ${open ? '접기' : `${hidden}개 더 보기`}`} onClick={() => toggle(p.id)}>{open ? '접기' : `+${hidden}개`}</button>}
            </div>
          </div>
          {days.map((d, col) => <div className={`timeline-background ${dayClass(d)}`} key={d} style={{ gridColumn: col + 2, gridRow: `1 / ${rowEnd}` }}>
            {canAssign(p.id) && <button type="button" className="cw-button cell-add" data-layout="overlay" data-size="compact" data-variant="quiet" aria-label={`${p.name} ${d} 업무 등록`} onClick={() => create(p.id, d)}><span data-overlay-hint aria-hidden="true">＋</span></button>}
          </div>)}
          {hasAbsence && days.map((d, col) => <div className="absence-slot" key={d} style={{ gridColumn: col + 2, gridRow: 1 }}>
            {away.filter(a => a.date === d).map((a, index) => <span title={`${p.name} ${d} ${portion(a.portion)}`} className="absence" key={index}>{portion(a.portion)}</span>)}
          </div>)}
          {visible.flatMap(({ task, lane }) => renderTask(task,lane,taskRow,2))}
          {visible.length === 0 && <span className="no-schedule" style={{ gridColumn: `2 / ${days.length + 2}`, gridRow: taskRow }}>등록된 일정 없음</span>}
        </div>;
      })}
      {grouping !== 'employee' && groups.map(group => <Fragment key={group.id}>
        <div className="task-group-heading" style={{ '--group-color': group.color } as CSSProperties}><button type="button" className="cw-button" data-size="compact" aria-expanded={isExpanded(group.id)} onClick={() => toggle(group.id)}>{isExpanded(group.id) ? '▾' : '▸'} {group.name}<span>{group.tasks.length}개 업무</span></button></div>
        {isExpanded(group.id) && group.tasks.map(task => <div key={task.id} className="timeline-row grouped-task-row" data-task-id={task.id} style={{ '--department-color':group.color, gridTemplateColumns:template, gridTemplateRows:`minmax(${compact ? Math.max(48, rowHeight) : Math.max(96, rowHeight)}px, auto)` } as CSSProperties}>
          {days.map((d,col) => <div key={d} className={`timeline-background ${dayClass(d)}`} style={{gridColumn:col + 1,gridRow:1}} />)}
          {renderTask(task,0,1,1)}
        </div>)}
      </Fragment>)}
      {grouping !== 'employee' && !groups.length && <p className="group-empty">조회 기간에 {grouping === 'project' ? '프로젝트가 지정된' : grouping === 'goal' ? '목표에 연결된' : '부서에 소속된 직원의'} 업무가 없습니다.</p>}
    </div>
    {mobile && !focused && <div className={`mobile-week ${compact ? 'compact-mobile' : ''}`}>
      {days.map(d => <section key={d} className={`mobile-day ${dayClass(d)}`}><h2 title={dayInfo.get(d)!.label}>{d.slice(5).replace('-', '.')} {weekDay(d)}{d === today() && <span className="status-badge cw-state-pill" data-tone="info">오늘</span>}{dayInfo.get(d)!.holiday && <span className="holiday-name">{dayInfo.get(d)!.holiday}</span>}</h2>
        {dateMilestones(d).map(milestoneCard)}
        {grouping === 'employee' && rows.map(({ person: p, tasks: personTasks, absences: away }) => {
          const daily = personTasks.filter(t => dateSpan(t, [d]));
          const visible = compact && !isExpanded(p.id) ? daily.slice(0, 1) : daily;
          return <div className="mobile-person" key={p.id} style={{ "--department-color": departmentColor(p.department) } as CSSProperties}><div className="mobile-person-heading"><Avatar id={p.id} name={p.name} /><b>{p.name}</b><small>{p.department || '미지정'}</small>
            {away.filter(a => a.date === d).map((a, index) => <span className="absence" key={index}>{portion(a.portion)}</span>)}
            {canAssign(p.id) && <button type="button" className="cw-button" data-size="compact" data-layout="icon" aria-label={`${p.name} ${d} 업무 등록`} onClick={() => create(p.id, d)}>＋</button>}
          </div>{visible.map(task => <div key={task.id} className={`mobile-task ${mine?'with-task-details':''}`}>{card(task)}{planningSummary(task)}</div>)}{compact && daily.length > 1 && <button type="button" className="cw-button expand-person" data-size="compact" aria-expanded={isExpanded(p.id)} aria-label={`${p.name} ${d} 업무 ${isExpanded(p.id) ? '접기' : '더 보기'}`} onClick={() => toggle(p.id)}>{isExpanded(p.id) ? '접기' : `+${daily.length - visible.length}개 더 보기`}</button>}</div>;
        })}
        {grouping !== 'employee' && groups.map(group => { const daily = group.tasks.filter(task => dateSpan(task, [d])); return daily.length > 0 && <section className="mobile-task-group" key={group.id}><button type="button" className="cw-button" data-size="compact" aria-expanded={isExpanded(group.id)} onClick={() => toggle(group.id)}>{group.name} · {daily.length}개 업무 {isExpanded(group.id) ? '▾' : '▸'}</button>{isExpanded(group.id) && daily.map(task => <div key={task.id}>{card(task)}</div>)}</section>; })}
      </section>)}
    </div>}
  </div>;
}
