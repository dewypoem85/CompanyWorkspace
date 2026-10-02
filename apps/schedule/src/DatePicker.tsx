import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScheduleToastNotice } from './ScheduleToasts';
import { useWorkspaceModal } from './generated/workspace-modal';
import { createWorkspaceReadSession, type WorkspaceReadSession } from './generated/workspace-read';
import { today } from './api';
import { calendarDay } from './calendarDay';
import { dateError, monthDays, shiftMonth, validDate } from './calendarPickerDates';
import { absencesResponse, scheduleGet } from './scheduleReads';
import type { CalendarHoliday } from './types';
import './datePicker.css';

type Props = { value: string; onChange: (date: string) => void; label: string; required?: boolean; disabled?: boolean; min?: string; max?: string };
export function DatePicker({ value, onChange, label, required, disabled, min = '0001-01-01', max = '9998-12-31' }: Props) {
  const [draft, setDraft] = useState(value); const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null); const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  const [month, setMonth] = useState((value || today()).slice(0, 7));
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]); const [loading, setLoading] = useState(false); const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);
  const readSession = useRef<WorkspaceReadSession|undefined>(undefined);
  const days = monthDays(month);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { input.current?.setCustomValidity(dateError(draft, min, max)); }, [draft, min, max]);
  const modal = useWorkspaceModal(dialog, {scope:'dismiss', returnFocus:input, onClose:()=>setOpen(false)});
  useEffect(() => {
    try { readSession.current = createWorkspaceReadSession(); } catch { readSession.current = undefined; }
    const scopeChanged = () => { readSession.current?.cancel('date-picker-holidays'); setHolidays([]); setLoading(false); setFailed(false); };
    document.addEventListener('workspace-entity-scope-change', scopeChanged);
    return () => { document.removeEventListener('workspace-entity-scope-change', scopeChanged); readSession.current?.dispose(); readSession.current = undefined; };
  }, []);
  useEffect(() => {
    if (!open) { readSession.current?.cancel('date-picker-holidays'); return; }
    const session = readSession.current;
    if (!session) { setHolidays([]); setLoading(false); setFailed(true); return; }
    let active = true; setLoading(true); setFailed(false); setHolidays([]);
    const from = days[0] < '0001-01-01' ? '0001-01-01' : days[0];
    const to = days[41] > '9998-12-31' ? '9998-12-31' : days[41];
    void session.run('date-picker-holidays', signal => scheduleGet(`/api/absences?from=${from}&to=${to}`, signal, absencesResponse)).then(result => {
      if (!active || result.status === 'cancelled' || !result.isCurrent()) return;
      if (result.status === 'error') setFailed(true);
      else { setHolidays(result.value.holidays || []); setFailed(result.value.holidaysAvailable !== true); }
      setLoading(false);
    });
    return () => { active = false; session.cancel('date-picker-holidays'); };
  }, [open, month, retry]);
  function close() { modal.close(); }
  function choose(date: string) { setDraft(date); onChange(date); close(); }
  function show() { const date = validDate(value) ? value : today(); setMonth((date < min ? min : date > max ? max : date).slice(0, 7)); setOpen(true); }
  return <span className="date-input"><input className="cw-form-control" ref={input} aria-label={label} type="text" placeholder="YYYY-MM-DD" inputMode="numeric" required={required} disabled={disabled} value={draft} maxLength={10} onChange={event => {
    const next = event.target.value; setDraft(next); const error = dateError(next, min, max); event.target.setCustomValidity(error); if (!error) onChange(next);
  }} /><button type="button" className="cw-button date-picker-trigger" data-variant="quiet" disabled={disabled} aria-label={`${label} 달력 열기`} aria-haspopup="dialog" onClick={show}>▦</button>
    {open && createPortal(<dialog ref={dialog} className="cw-modal calendar-picker-dialog" aria-labelledby={titleId}>
      <header><h2 id={titleId}>{label}</h2><button className="cw-button" data-variant="quiet" type="button" aria-label="달력 닫기" onClick={close}>×</button></header>
      <div className="calendar-month-nav"><button className="cw-button" data-size="compact" data-layout="icon" type="button" aria-label="이전 달" disabled={month <= min.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <label className="cw-form-field">연도<input className="cw-form-control" aria-label="달력 연도" type="number" min={Number(min.slice(0, 4))} max={Number(max.slice(0, 4))} key={month.slice(0, 4)} defaultValue={Number(month.slice(0, 4))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} onBlur={event => { const year = Number(event.target.value); if (year >= 1 && year <= 9998) { const next = `${String(year).padStart(4, '0')}-${month.slice(5)}`; const bounded = next < min.slice(0, 7) ? min.slice(0, 7) : next > max.slice(0, 7) ? max.slice(0, 7) : next; setMonth(bounded); event.currentTarget.value = String(Number(bounded.slice(0, 4))); } else event.currentTarget.value = String(Number(month.slice(0, 4))); }} /></label>
        <label className="cw-form-field">월<select className="cw-form-control" aria-label="달력 월" value={month.slice(5)} onChange={event => setMonth(`${month.slice(0, 4)}-${event.target.value}`)}>{Array.from({ length:12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => <option key={m} value={m} disabled={`${month.slice(0, 4)}-${m}` < min.slice(0, 7) || `${month.slice(0, 4)}-${m}` > max.slice(0, 7)}>{Number(m)}월</option>)}</select></label>
        <button className="cw-button" data-size="compact" data-layout="icon" type="button" aria-label="다음 달" disabled={month >= max.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      <CalendarDays days={days} month={month} value={value} holidays={holidays} min={min} max={max} choose={choose} />
      <p className="picker-legend"><span className="calendar-saturday">토요일</span><span className="calendar-sunday">일요일·공휴일</span></p>
      <ScheduleToastNotice id={`date-picker-${titleId}`} state={loading?{kind:'loading',message:'공휴일 확인 중…'}:failed?{kind:'error',message:'공휴일을 불러오지 못했습니다. 주말만 표시합니다.',actionLabel:'다시 시도',onAction:()=>setRetry(n=>n+1)}:null}/>
      <footer><button className="cw-button" type="button" onClick={() => choose('')}>날짜 지우기</button><button className="cw-button" type="button" disabled={!!dateError(today(), min, max)} onClick={() => choose(today())}>오늘</button></footer>
    </dialog>, document.body)}
  </span>;
}

export function CalendarDays({ days, month, value, holidays, min, max, choose }: { days: string[]; month: string; value: string; holidays: CalendarHoliday[]; min: string; max: string; choose: (date: string) => void }) {
  return <div className="calendar-date-grid"><div className="calendar-week-labels">{['일','월','화','수','목','금','토'].map((day, i) => <span key={day} className={i === 0 ? 'calendar-sunday' : i === 6 ? 'calendar-saturday' : ''}>{day}</span>)}</div>
    <div className="calendar-day-buttons">{days.map(date => { const info = calendarDay(date, holidays); return <button type="button" data-size="compact" data-layout="content" data-variant="quiet" key={date} className="cw-button" data-other-month={!date.startsWith(month)} aria-label={info.label} aria-pressed={date === value} aria-current={date === today() ? 'date' : undefined} title={info.label} disabled={date < min || date > max} onClick={() => choose(date)}><span className={info.className}>{Number(date.slice(-2))}</span>{info.holiday && <small>{info.holiday}</small>}</button>; })}</div>
  </div>;
}
