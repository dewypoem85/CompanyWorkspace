(() => {
    'use strict';
    let active = null;
    function start(root = document) {
    const form = root.querySelector('[data-organization-form]');
    if (!form) return null;
    const state = form.querySelector('[data-organization-result]');
    const iconEditor = document.querySelector('[data-cw-project-icon]');
    const submit = form.querySelector('[type="submit"]');
    const snapshot = () => JSON.stringify([...form.elements].filter(el => el.name && !['file','submit','button'].includes(el.type))
        .map(el => [el.name, el.value, el.checked === true]));
    let dirty = false, locked = form.dataset.writeLocked === 'true', disposed = false;
    let confirmation = null, confirmed = false, sentSnapshot = '';
    const show = (kind, title, message) => { state.hidden = false; window.CompanyState.render(state, {kind, title, message}); };
    const iconPending = () => iconEditor?.dataset.imagePending === 'true' || iconEditor?.querySelector('[data-project-icon-file]')?.files.length > 0;
    const allowed = () => {
        if (locked || disposed) return false;
        // Images and organization fields remain independent transactions and drafts.
        if (iconPending()) { show('error', '아이콘 작업을 먼저 마쳐 주세요.', '프로젝트 아이콘은 별도로 저장됩니다. 아이콘을 저장하거나 파일 선택을 해제한 뒤 조직 정보를 저장하세요.'); return false; }
        return true;
    };
    const confirm = async event => {
        if (confirmed) { confirmed = false; return; }
        event.preventDefault(); event.stopImmediatePropagation();
        if (!allowed() || controller.busy || confirmation || !form.reportValidity()) return;
        const captured = snapshot(), abort = new AbortController(); confirmation = abort;
        const approved = await window.CompanyDialog.confirm({title:'조직 정보 저장',
            message:'소속·참여 직원과 공개 범위 변경이 다른 회사 서비스에도 적용됩니다.',
            details:[{label:'관리 항목',value:form.elements.Tab.value === 'projects' ? '프로젝트' : '부서'},
                {label:'이름',value:form.elements['Form.Name'].value}], confirmLabel:'저장', returnFocus:event.submitter || submit, signal:abort.signal});
        if (confirmation !== abort) return;
        confirmation = null;
        if (!approved || abort.signal.aborted || !allowed() || captured !== snapshot()) return;
        confirmed = true; form.requestSubmit(submit);
    };
    form.addEventListener('submit', confirm, true);
    const controller = window.CompanyForm.attach(form, {state, canSubmit:allowed,
        prepare() { sentSnapshot = snapshot(); if (iconEditor) iconEditor.inert = true; },
        onSaved(data, sent) {
            const previousId = sent.get('Form.Id'), previousVersion = sent.get('Form.Version');
            const decimal = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
            if (!data || data.tab !== sent.get('Tab') || !['projects','departments'].includes(data.tab)
                || data.userId !== sent.get('ExpectedUserId') || !decimal(data.id) || data.id.length > 19 || BigInt(data.id) > 9223372036854775807n
                || !decimal(data.version) || data.version.length > 10 || BigInt(data.version) > 2147483647n
                || data.previousId !== previousId || data.previousVersion !== previousVersion
                || (previousId && data.id !== previousId) || BigInt(data.version) !== (previousId ? BigInt(previousVersion) + 1n : 1n)
                || sentSnapshot !== snapshot() || iconPending()) throw Error('Unconfirmed organization receipt');
            dirty = false; locked = true;
            // Reload the saved edit page, including normalized values and newly available controls.
            location.assign('/Admin/Organization?tab=' + data.tab + '&id=' + data.id);
        },
        onSettled(saved, outcome) {
            if (iconEditor) iconEditor.inert = false;
            if (saved || ['unknown','conflict','denied','scope-changed'].includes(outcome)) locked = true;
            submit.disabled = locked;
        }
    });
    const changed = event => { if (!event.target.matches('[data-choice-search]')) dirty = true; };
    const unload = event => { if (dirty || iconPending()) { event.preventDefault(); event.returnValue = ''; } };
    const invalidate = () => {
        if (disposed) return;
        locked = true; submit.disabled = true; confirmation?.abort(); confirmation = null;
        show('denied', '로그인 상태 또는 권한이 바뀌었습니다.', '이전 입력은 유지했습니다. 새 탭에서 현재 계정과 저장 상태를 확인해 주세요.');
    };
    const dispose = event => {
        if (event?.persisted || disposed) return;
        disposed = true; confirmation?.abort(); confirmation = null; controller.dispose(); if (iconEditor) iconEditor.inert = false;
        form.removeEventListener('submit', confirm, true); form.removeEventListener('input', changed); form.removeEventListener('change', changed);
        document.removeEventListener('workspace-entity-scope-change', invalidate);
        window.removeEventListener('beforeunload', unload); window.removeEventListener('pagehide', dispose);
    };
    form.addEventListener('input', changed); form.addEventListener('change', changed);
    document.addEventListener('workspace-entity-scope-change', invalidate);
    window.addEventListener('beforeunload', unload); window.addEventListener('pagehide', dispose);
    return {
        dispose,
        async beforeLeave() {
            if (controller.busy || confirmation) return false;
            if (!dirty && !iconPending()) return true;
            const captured = snapshot();
            const approved = await window.CompanyDialog.confirm({
                title: '작성 중인 조직 정보',
                message: '저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 이동하시겠습니까?',
                confirmLabel: '버리고 이동', returnFocus: submit
            });
            return approved && captured === snapshot() && !controller.busy && !confirmation;
        }
    };
    }
    const adapter = {
        start(root) { active = start(root); },
        beforeLeave() { return active?.beforeLeave() ?? true; },
        dispose() { active?.dispose(); active = null; }
    };
    window.CompanyPageRouter?.register('home.departments', adapter);
    window.CompanyPageRouter?.register('home.projects', adapter);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { active = start(); });
    else active = start();
})();
