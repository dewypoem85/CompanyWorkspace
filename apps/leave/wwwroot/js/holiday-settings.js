import {validateHolidaySnapshot, validateHolidayReceipt, holidayTextHash} from './holiday-contract.js';

function attach(screen) {
  const fields = screen.querySelector('[data-holiday-fields]'), state = screen.querySelector('[data-holiday-state]');
  const source = screen.querySelector('[data-holiday-snapshot]'), recheck = screen.querySelector('[data-holiday-recheck]');
  const rows = screen.querySelector('[data-holiday-rows]'), filter = screen.querySelector('[data-holiday-year-form]');
  const session = window.CompanyForm.createSession(), bindings = new Map(), drafts = new Map(), owners = new Set();
  let baseline = validateHolidaySnapshot(JSON.parse(source.textContent)), year = Number(screen.dataset.year);
  let locked = screen.dataset.locked === 'true', disposed = false, busy = false, accepted = null;
  const values = (form, hidden) => JSON.stringify([...form.elements].filter(el => el.name && el.type !== 'submit' && (hidden || el.type !== 'hidden')).map(el => [el.name, el.value, el.type === 'checkbox' ? el.checked : null]));
  const show = (kind, title, message) => { state.hidden = false; window.CompanyState.render(state, {kind, title, message}); state.scrollIntoView({block:'nearest', behavior:'instant'}); };
  const sync = () => {
    fields.disabled = locked || disposed || busy || session.invalid;
    for (const [form, saved] of drafts) if (form.dataset.holidayAction !== 'ImportOnline') form.querySelector('button[type="submit"]').disabled = values(form, false) === saved;
  };
  const targetYear = (operation, intent, before) => operation === 'Add' ? Number(intent.date.slice(0, 4)) : operation === 'Delete' ? Number(before.items.find(row => row.id === intent.id)?.date.slice(0, 4)) : intent.year;
  const showRecheck = value => { recheck.hidden = false; recheck.querySelector('a').href = '/Admin/Holidays?Year=' + value; };

  function bind(form) {
    const operation = form.dataset.holidayAction, owner = operation + (operation === 'Delete' ? ':' + form.elements.namedItem('id').value : '');
    if (!owners.has(owner)) {
      if (operation !== 'Delete') drafts.set(form, values(form, false));
      session.track(owner, () => drafts.has(form) && values(form, false) !== drafts.get(form)); owners.add(owner);
    }
    for (const [name, value] of [['expectedEmployeeId', baseline.actorEmployeeId], ['expectedStateToken', baseline.stateToken]]) {
      const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
    }
    let lease, before, signature, intent, result;
    const gate = async event => {
      if (accepted === form) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (disposed || locked || busy || !form.reportValidity() || ['Add','ImportJson'].includes(operation) && values(form, false) === drafts.get(form)) return;
      lease = session.begin(owner, []); if (!lease) return;
      before = structuredClone(baseline); signature = values(form, true);
      const focus = event.submitter || document.activeElement;
      busy = true; sync();
      try {
        if (operation === 'Add') intent = {date:form.elements.namedItem('Input.Date').value, name:form.elements.namedItem('Input.Name').value.trim()};
        else if (operation === 'Delete') intent = {id:form.elements.namedItem('id').value};
        else intent = {year:Number(form.elements.namedItem('Import.Year').value), overwriteExisting:form.querySelector('[type="checkbox"]').checked,
          jsonHash:operation === 'ImportJson' ? await holidayTextHash(form.elements.namedItem('Import.JsonText').value) : null};
        if (!lease.current || disposed || locked || signature !== values(form, true) || !form.isConnected) return;
        const target = before.items.find(row => row.id === intent.id), previous = before.items.find(row => row.date === intent.date);
        const details = operation === 'Delete' ? [{label:'날짜', value:target?.date || ''}, {label:'공휴일', value:target?.name || ''}] : operation === 'Add' ?
          [{label:'날짜', value:intent.date}, {label:'이전 이름', value:previous?.name || '신규 날짜'}, {label:'저장할 이름', value:intent.name}] :
          [{label:'연도', value:String(intent.year)}, {label:'동일 날짜', value:intent.overwriteExisting ? '이름 덮어쓰기' : '기존 이름 유지'}, {label:'입력', value:operation === 'ImportJson' ? 'JSON 원문을 그대로 전송' : '온라인 조회 및 기존 대체휴무 보정'}];
        const confirmed = await window.CompanyDialog.confirm({title:operation === 'Delete' ? '공휴일을 삭제할까요?' : operation === 'Add' ? '공휴일을 저장할까요?' : '공휴일을 가져와 저장할까요?',
          message:operation === 'Delete' ? '해당 날짜의 공휴일 설정을 삭제합니다. 다른 입력 초안은 유지합니다.' : '확인한 설정으로 저장합니다. 다른 양식의 입력은 저장하거나 초기화하지 않습니다.',
          details, confirmLabel:operation === 'Delete' ? '삭제' : '저장', tone:operation === 'Delete' ? 'danger' : undefined, returnFocus:focus, signal:lease.signal,
          validate:() => signature !== values(form, true) ? '입력이 변경되었습니다. 취소 후 다시 확인하세요.' : undefined});
        if (!confirmed || !lease.current || disposed || locked || signature !== values(form, true) || !form.isConnected) return;
        const destination = targetYear(operation, intent, before);
        if (Number.isInteger(destination)) recheck.querySelector('a').href = '/Admin/Holidays?Year=' + destination;
        fields.disabled = false; accepted = form; form.requestSubmit(); accepted = null;
      } catch { if (!disposed && !locked) show('error', '요청을 보내지 않았습니다.', '날짜·이름과 가져오기 입력을 확인하세요. 원문은 유지했습니다.'); }
      finally {
        accepted = null;
        if (!controller.busy) { lease?.finish('cancelled'); busy = false; sync(); if (focus?.isConnected && !focus.disabled && !disposed) focus.focus({preventScroll:true}); }
      }
    };
    form.addEventListener('submit', gate, true);
    const controller = window.CompanyForm.attach(form, {state,
      canSubmit:() => accepted === form && lease?.current && !locked && !disposed,
      prepare:data => { if (signature !== values(form, true) || data.get('expectedEmployeeId') !== before.actorEmployeeId || data.get('expectedStateToken') !== before.stateToken) throw Error('Holiday intent changed'); sync(); },
      onSaved:(data, sent, context) => {
        if (!context.isCurrent() || !lease.current || disposed || locked || signature !== values(form, true)) throw Error('Stale holiday response');
        result = validateHolidayReceipt(data, operation, before, intent);
      },
      onSettled:(saved, outcome) => {
        if (disposed) return;
        lease?.finish(saved ? 'saved' : outcome === 'invalid' ? 'invalid' : 'unknown'); busy = false;
        if (saved) {
          try {
            if (drafts.has(form)) drafts.set(form, values(form, false));
            baseline = result.snapshot; source.textContent = JSON.stringify(baseline); render(result.year); showRecheck(result.year);
            show('success', result.year + '년 공휴일 반영을 확인했습니다.', result.counts ? `추가 ${result.counts.created}건 · 수정 ${result.counts.updated}건 · 건너뜀 ${result.counts.skipped}건. 다른 양식과 JSON 원문은 그대로 유지했습니다.` : '목록을 갱신했습니다. 다른 양식과 입력 원문은 그대로 유지했습니다.');
          } catch { locked = true; session.invalidate(); showRecheck(year); show('error', '저장 후 화면을 갱신하지 못했습니다.', '저장은 확인했습니다. 다시 저장하지 말고 새 탭에서 현재 목록을 확인하세요.'); }
        } else if (outcome !== 'invalid') {
          locked = true; recheck.hidden = false;
          show(outcome === 'denied' ? 'denied' : 'error', '처리 결과를 확인해 주세요.', '공휴일이 이미 반영되었을 수 있습니다. 원문은 유지하며 자동 재전송하지 않습니다. 새 탭에서 현재 목록을 확인하세요.');
        }
        sync();
      }
    });
    bindings.set(form, () => { controller.dispose(); form.removeEventListener('submit', gate, true); });
  }

  function render(nextYear) {
    year = nextYear; filter.elements.Year.value = String(year);
    screen.querySelector('[data-holiday-list-title]').textContent = year + ' 년 공휴일';
    for (const [form, remove] of bindings) if (form.dataset.holidayAction === 'Delete') { remove(); bindings.delete(form); }
    rows.replaceChildren();
    for (const row of baseline.items.filter(item => Number(item.date.slice(0, 4)) === year)) {
      const node = screen.querySelector('[data-holiday-row-template]').content.firstElementChild.cloneNode(true);
      node.dataset.holidayRow = row.id; node.querySelector('[data-holiday-date]').textContent = row.date; node.querySelector('[data-holiday-name]').textContent = row.name;
      node.querySelector('[name="id"]').value = row.id; rows.append(node); bind(node.querySelector('form'));
    }
    if (!rows.children.length) rows.append(screen.querySelector('[data-holiday-empty-template]').content.cloneNode(true));
    for (const form of bindings.keys()) { form.elements.expectedEmployeeId.value = baseline.actorEmployeeId; form.elements.expectedStateToken.value = baseline.stateToken; }
  }
  screen.querySelectorAll('[data-holiday-action]').forEach(bind);
  const changeYear = event => {
    event.preventDefault();
    if (disposed || locked || busy || session.invalid || !filter.reportValidity()) return;
    const next = Number(filter.elements.Year.value);
    if (Number.isInteger(next) && next >= 2000 && next <= 2100) render(next);
  };
  const unload = event => { if (busy || session.hasDraftExcept('')) { event.preventDefault(); event.returnValue = ''; } };
  const dispose = event => {
    if (event?.persisted || disposed) return;
    disposed = true; session.dispose(); for (const remove of bindings.values()) remove(); bindings.clear(); observer.disconnect();
    fields.removeEventListener('input', sync); fields.removeEventListener('change', sync); filter.removeEventListener('submit', changeYear);
    document.removeEventListener('workspace-entity-scope-change', invalidate); document.removeEventListener('company-page-leave', dispose); window.removeEventListener('pagehide', dispose); window.removeEventListener('beforeunload', unload); sync();
  };
  const invalidate = () => {
    if (disposed) return; locked = true; session.invalidate(); dispose({persisted:false}); fields.replaceChildren(); source.textContent = ''; showRecheck(year);
    show('denied', '로그인·권한이 변경되었습니다.', '이전 계정의 공휴일 정보와 입력을 숨겼습니다. 현재 계정으로 설정을 다시 확인하세요.');
  };
  const observer = new MutationObserver(() => {
    if (!screen.isConnected || !fields.isConnected) dispose({persisted:false});
    else if ([...bindings.keys()].some(form => !form.isConnected)) { locked = true; showRecheck(year); dispose({persisted:false}); show('error', '처리 화면이 변경되었습니다.', '공휴일이 반영되었을 수 있습니다. 현재 목록을 확인하고 자동으로 다시 저장하지 마세요.'); }
  });
  observer.observe(document.body, {childList:true, subtree:true});
  fields.addEventListener('input', sync); fields.addEventListener('change', sync); filter.addEventListener('submit', changeYear);
  document.addEventListener('workspace-entity-scope-change', invalidate); document.addEventListener('company-page-leave', dispose); window.addEventListener('pagehide', dispose); window.addEventListener('beforeunload', unload); sync();
}

export function mountWorkspacePage(root=document) {
const screen = root.querySelector('[data-holiday-screen]');
if (screen) try { attach(screen); } catch {
  screen.querySelector('[data-holiday-fields]').disabled = true;
  const state = screen.querySelector('[data-holiday-state]'); state.hidden = false;
  window.CompanyState?.render(state, {kind:'error', title:'공휴일 설정을 확인하지 못했습니다.', message:'현재 설정 화면을 다시 열어 주세요.'});
  screen.querySelector('[data-holiday-recheck]').hidden = false;
}
}
if(typeof document!=='undefined')mountWorkspacePage();
