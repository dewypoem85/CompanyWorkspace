// Transport, pending/denied feedback and teardown are shared; this module owns notification receipts.
const positiveLong = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
export function validateNotificationReceipt(data, expected, origin) {
  if (!data || data.operation !== expected.operation || data.employeeId !== expected.employeeId
      || !positiveLong(data.employeeId) || data.id !== expected.id
      || (data.operation === 'MarkAllRead' && data.id !== null)
      || (data.operation !== 'MarkAllRead' && !positiveLong(data.id))
      || !['MarkRead','MarkAllRead','Open'].includes(data.operation)) throw Error('Invalid notification receipt');
  if (data.operation === 'Open') {
    if (typeof data.navigateTo !== 'string' || !data.navigateTo.startsWith('/') || data.navigateTo.startsWith('//')
        || /[\\\u0000-\u001f]/.test(data.navigateTo) || new URL(data.navigateTo, origin).origin !== origin) throw Error('Invalid notification destination');
  } else if (data.navigateTo !== null) throw Error('Unexpected notification navigation');
  return data;
}

function attach(root) {
  const fields = root.querySelector('#notificationFields'), feedback = root.querySelector('#notificationState');
  const recheck = root.querySelector('#notificationRecheck'), list = root.querySelector('[data-notification-items]');
  const forms = [...root.querySelectorAll('form[data-notification-action]')], controllers = [];
  let pending = null, blocked = false, disposed = false, scope = 0;
  const rows = () => [...list.querySelectorAll('[data-notification-id]')];
  const signature = form => JSON.stringify([root.dataset.notificationOwner, form.dataset.notificationAction,
    form.elements.namedItem('id')?.value ?? null, form.elements.namedItem('expectedEmployeeId')?.value,
    rows().map(row=>row.dataset.notificationId)]);
  const show = (kind,title,message) => {
    feedback.hidden = false; window.CompanyState.render(feedback,{kind,title,message});
  };
  const markRead = row => {
    row.classList.replace('is-unread','is-read');
    const label = row.querySelector('[data-read-status]'); label.textContent = '읽음'; label.dataset.tone = 'neutral';
    const form = row.querySelector('[data-notification-action="MarkRead"]'); if (form) form.hidden = true;
  };
  const sync = () => {
    fields.disabled = disposed || blocked || Boolean(pending);
  };
  for (const form of forms) {
    let captured, receipt;
    const controller = window.CompanyForm.attach(form, {
      state:feedback, canSubmit:()=>!disposed && !blocked && !pending && !form.hidden,
      prepare:submitted=>{
        captured = {operation:form.dataset.notificationAction, employeeId:root.dataset.notificationOwner,
          id:submitted.get('id'), scope, signature:signature(form)};
        if (!['MarkRead','MarkAllRead','Open'].includes(captured.operation) || !positiveLong(captured.employeeId)
            || submitted.get('expectedEmployeeId') !== captured.employeeId
            || (captured.operation === 'MarkAllRead' ? captured.id !== null : !positiveLong(captured.id))) throw Error('Invalid notification target');
        receipt = null; pending = form; sync();
      },
      onSaved:(data,submitted,context)=>{
        if (!context.isCurrent() || disposed || blocked || captured.scope !== scope || signature(form) !== captured.signature
            || captured.id !== submitted.get('id')) throw Error('Notification target changed');
        const checked = validateNotificationReceipt(data,captured,location.origin);
        const affected = checked.operation === 'MarkAllRead' ? rows() : rows().filter(row=>row.dataset.notificationId === checked.id);
        if (checked.operation !== 'MarkAllRead' && affected.length !== 1) throw Error('Notification row missing');
        if (affected.some(row=>!row.querySelector('[data-read-status]'))) throw Error('Notification label missing');
        // Apply only after the entire receipt and target set have been checked.
        affected.forEach(markRead); receipt = checked;
        if (checked.operation === 'MarkAllRead') form.hidden = true;
      },
      onSettled:(saved,outcome)=>{
        if (disposed || captured.scope !== scope || pending !== form) return;
        pending = null;
        if (!saved) {
          blocked = true; recheck.hidden = false;
          show(outcome === 'denied' ? 'denied' : 'error', outcome === 'denied' ? '현재 계정을 확인해 주세요.' : '읽음 처리 결과를 확인하지 못했습니다.',
            '표시된 알림을 임의로 읽음 처리하지 않았습니다. 자동 재전송하지 않으며 목록을 다시 확인한 뒤 작업하세요.');
        } else {
          show('success','읽음 처리했습니다.','서버가 확인한 알림 상태를 반영했습니다.');
        }
        sync();
        if (saved && receipt?.operation === 'Open') location.assign(receipt.navigateTo);
        else if (saved) Promise.resolve(window.CompanyWorkspace?.refresh?.()).catch(()=>{
          if (!disposed && captured.scope === scope) {
            recheck.hidden = false;
            show('success','읽음 처리는 완료되었습니다.','상단 알림 상태를 갱신하지 못했습니다. 읽음 요청을 다시 보내지 말고 목록을 확인해 주세요.');
          }
        });
      }
    });
    controllers.push(controller);
  }
  const scopeChanged = () => {
    if (disposed) return;
    scope++; blocked = true; pending = null;
    controllers.forEach(controller=>controller.dispose()); list.replaceChildren();
    recheck.hidden = false; sync();
    show('denied','로그인·권한이 변경되었습니다.','이전 계정의 알림을 숨겼습니다. 현재 계정의 목록을 다시 확인해 주세요.');
  };
  const pagehide = event => {
    if (event.persisted) return;
    disposed = true; scope++; pending = null; controllers.forEach(controller=>controller.dispose()); sync();
    document.removeEventListener('workspace-entity-scope-change',scopeChanged);
    window.removeEventListener('pagehide',pagehide);
  };
  document.addEventListener('workspace-entity-scope-change',scopeChanged);
  window.addEventListener('pagehide',pagehide);
  sync();
}
if (typeof document !== 'undefined') {
  const root = document.querySelector('#notificationCenter');
  if (root) attach(root);
}
