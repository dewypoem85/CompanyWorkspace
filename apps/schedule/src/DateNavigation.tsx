import { useRef, useState } from 'react';
import { DatePicker } from './DatePicker';
import { useWorkspaceModal } from './generated/workspace-modal';

export function DateNavigation({ start, end, jump }: { start: string; end: string; jump: (date: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(start);
  const [isOpen,setOpen] = useState(false);
  const modal = useWorkspaceModal(dialog, {scope:'dismiss', onClose:()=>setOpen(false)});
  function open() {
    setDate(start);
    setOpen(true);
  }
  return <>
    <button className="cw-button date-range-button" data-layout="content" data-size="compact" aria-label={`날짜로 이동: ${start}부터 ${end}까지`} aria-haspopup="dialog" onClick={open}>
      <strong>{start.replaceAll('-', '.')} — {end.replaceAll('-', '.')}</strong>
      <span>날짜 선택 ▾</span>
    </button>
    {isOpen && <dialog ref={dialog} className="cw-modal date-navigation-dialog" aria-labelledby="date-navigation-title">
      <form onSubmit={event => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity() || !date) return;
        jump(date); modal.close();
      }}>
        <h2 id="date-navigation-title">원하는 날짜로 이동</h2>
        <p id="date-navigation-help">연·월·일을 직접 입력하거나 달력에서 선택하세요. 선택한 날짜가 포함된 주로 바로 이동합니다.</p>
        <label className="cw-form-field">이동할 날짜<DatePicker label="이동할 날짜" required value={date} onChange={setDate} /></label>
        <div className="form-actions">
          <button type="button" className="cw-button" onClick={() => modal.close()}>취소</button>
          <button type="submit" className="cw-button" data-variant="primary">이동</button>
        </div>
      </form>
    </dialog>}
  </>;
}
