import { Avatar } from './Avatar';
import { useEffect, useId, useRef, useState } from 'react';
import type { Attachment, Bootstrap, Employee } from './types';
import { splitLinks } from './textLinks';
import { TextLink } from './TaskLinks';
import { WorkspaceSuggestions } from './generated/workspace-suggestions';
import { useWorkspaceModal } from './generated/workspace-modal';
import { editMentionText, insertMentionText, parseMentionText } from './mentionText';
import { useImageUploads } from './useImageUploads';
import { ScheduleToastNotice } from './ScheduleToasts';

export function readable(body: string) { return parseMentionText(body).text; }
export function Body({ text, employees }: { text: string; employees: Employee[] }) {
  const parts = text.split(/(@\[[^\]\r\n]{1,100}\]\(\d+\))/g);
  return <div className="body-text">{parts.map((p, i) => { const m = /^@\[([^\]\r\n]{1,100})\]\((\d+)\)$/.exec(p);const person=m?employees.find(e=>e.id===Number(m[2])):undefined; return m ? <span className="mention" key={i}><Avatar id={person?.id} name={person?.name||m[1]}/><span>@{person?.name || m[1]}</span></span> : splitLinks(p).map((part, j) => part.href ? <TextLink key={`${i}-${j}`} href={part.href}>{part.text}</TextLink> : part.text); })}</div>;
}
export function ImageList({ images, remove }: { images: Attachment[]; remove?: (id: string) => void }) {
  const [full, setFull] = useState<Attachment>(); const dialog = useRef<HTMLDialogElement>(null);
  const modal = useWorkspaceModal(dialog, {scope:'dismiss', onClose:()=>setFull(undefined)});
  return <><div className="image-list">{images.map(img => <div className="image-thumb" key={img.id}><button className="cw-button" data-layout="content" type="button" onClick={() => setFull(img)} title={img.name}><img loading="lazy" src={`/api/images/${img.id}`} alt={img.name || '첨부 이미지'} /></button>{remove && <button type="button" className="cw-button image-remove" data-size="compact" data-layout="icon" data-variant="danger" aria-label={`${img.name} 첨부 제거`} onClick={() => remove(img.id)}>×</button>}</div>)}</div>{full && <dialog className="cw-modal lightbox" aria-label={full.name || '첨부 이미지'} ref={dialog}><button type="button" className="cw-button close" data-variant="quiet" aria-label="이미지 닫기" onClick={()=>modal.close()}>×</button><img src={`/api/images/${full.id}`} alt={full.name} /><p>{full.name}</p></dialog>}</>;
}
export function Editor({ value, onChange, images, setImages, employees, boot, refreshIdentity, label, busyChanged, disabled = false, uploadDisabled = false }: { value: string; onChange: (v: string) => void; images: Attachment[]; setImages: (v: Attachment[]) => void; employees: Employee[]; boot: Bootstrap; refreshIdentity: () => Promise<Bootstrap>; label: string; busyChanged?: (busy: boolean) => void; disabled?: boolean; uploadDisabled?: boolean }) {
  const noticeId=useId();
  const textRef = useRef<HTMLTextAreaElement>(null); const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const uploads=useImageUploads({boot,refreshIdentity,images,setImages,disabled:disabled||uploadDisabled,label,busyChanged});
  const controlsDisabled=disabled||uploads.busy;
  const uploadControlsDisabled=controlsDisabled||uploadDisabled||uploads.locked;
  const range = useRef({ start: 0, end: 0 });
  useEffect(()=>{if(controlsDisabled)setQuery(null);},[controlsDisabled]);
  const editRange=useRef<{start:number;end:number;type:string}|undefined>(undefined);
  useEffect(()=>{const input=textRef.current;if(!input)return;const before=(event:Event)=>{editRange.current={start:input.selectionStart,end:input.selectionEnd,type:(event as InputEvent).inputType};};input.addEventListener('beforeinput',before);return()=>input.removeEventListener('beforeinput',before);},[]);
  function detect(text: string, caret: number) { const m = /@([^@\n]{0,40})$/.exec(text.slice(0, caret)); if (m) { range.current = { start: caret - m[0].length, end: caret }; setQuery(m[1]); } else setQuery(null); }
  function insert(person: Employee) {
    const same = employees.filter(e => e.name === person.name).length > 1;
    const label = same ? `${person.name} · ${person.department || '미지정'} #${person.id}` : person.name;
    const next=insertMentionText(value,range.current.start,range.current.end,label,person.id);
    onChange(next.value); setQuery(null);
    requestAnimationFrame(() => { textRef.current?.focus(); textRef.current?.setSelectionRange(next.caret,next.caret); });
  }
  return <div className="editor" onDragOver={e => { if (!uploadControlsDisabled&&e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (!uploadControlsDisabled&&e.dataTransfer.files.length) { e.preventDefault(); void uploads.upload(Array.from(e.dataTransfer.files)); } }}>
    <label className="cw-form-field">{label}<textarea className="cw-form-control" disabled={controlsDisabled} ref={textRef} aria-label={label} value={readable(value)} placeholder="내용을 적고 @로 동료를 멘션하세요. 이미지를 붙여넣거나 끌어놓을 수 있습니다." onChange={e => { onChange(editMentionText(value,e.target.value,editRange.current));editRange.current=undefined; detect(e.target.value, e.target.selectionStart); }} onClick={e => detect(e.currentTarget.value, e.currentTarget.selectionStart)} onKeyDown={e => { if (e.key === 'Escape') { setQuery(null); e.stopPropagation(); } }} onPaste={e => { const files = Array.from(e.clipboardData.files); if (!uploadControlsDisabled&&files.length) { e.preventDefault(); void uploads.upload(files); } }} /></label>
    {!controlsDisabled && query !== null && <WorkspaceSuggestions kind="employee" label="멘션할 직원" anchor={textRef} query={query} items={employees.filter(p=>p.active&&p.access&&!p.shared).map(p=>({value:String(p.id),id:p.id,name:p.name,description:p.department}))} onChoose={item=>{const person=employees.find(p=>String(p.id)===item.value);if(person&&person.active&&person.access&&!person.shared)insert(person);}} onDismiss={()=>setQuery(null)} />}
    <ImageList images={images} remove={controlsDisabled ? undefined : id => setImages(images.filter(x => x.id !== id))} />
    <div className="editor-tools"><input disabled={uploadControlsDisabled} hidden ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={e => { void uploads.upload(Array.from(e.target.files || [])); e.target.value = ''; }} /><button className="cw-button" type="button" disabled={uploadControlsDisabled} onClick={() => inputRef.current?.click()}>{uploads.busy ? '업로드 중…' : '＋ 이미지'}</button><span>{images.length}/10 · 파일당 10MB</span></div><ScheduleToastNotice id={`image-upload-${noticeId}`} state={uploads.outcome}/>
  </div>;
}
