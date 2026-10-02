/* Account-specific acknowledgement rules; transport, feedback and field definitions are shared. */
(() => {
  'use strict';
  const multiple = new Set(['ProjectIds', 'Permissions']);
  const same = (a,b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4)) > 0 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  const positiveLong = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
  function validateAcknowledgement(data, submitted, defaults) {
    const account = data?.account, values = account?.fields, keys = Object.keys(defaults);
    if (!positiveLong(account?.id) || !positiveLong(account?.updatedAtTicks) || !values ||
        !same(Object.keys(values), keys)) throw Error('Incomplete account acknowledgement');
    const expected = Object.fromEntries(keys.map(key => [key, submitted.has(key) ? submitted.getAll(key) : [...defaults[key]]]));
    expected.Name = expected.Name.map(value => value.trim());
    expected.Email = expected.Email.map(value => value.trim().toLowerCase());
    const shared = expected.AccountType[0] === 'shared';
    if (shared) { expected.DepartmentId = ['']; expected.BirthDate = ['']; expected.ProjectIds = []; expected.Role = ['employee']; }
    if (expected.Role[0] === 'master') expected.ProjectIds = [];
    if (expected.Permissions.includes('iap.publish')) expected.Permissions.push('iap.access');
    expected.Permissions = [...new Set(expected.Permissions)];
    expected.ProjectIds = [...new Set(expected.ProjectIds)];
    for (const key of keys) {
      const value = values[key];
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string') ||
          (!multiple.has(key) && value.length !== 1) || new Set(value).size !== value.length) throw Error('Invalid account field');
      if (key === 'HireDate' && shared && !submitted.has(key)) {
        if (!date(value[0])) throw Error('Invalid generated hire date');
      } else if (!same(value, expected[key])) throw Error('Account acknowledgement differs from submitted values');
    }
    return account;
  }
  function attach(form, options) {
    const defaults = JSON.parse(form.dataset.accountDefaults), keys = Object.keys(defaults);
    const state = form.querySelector('[data-add-result]'), followup = form.querySelector('[data-add-followup]');
    const followupMessage = form.querySelector('[data-add-followup-message]'), initialFollowupMessage = followupMessage.textContent;
    const another = form.querySelector('[data-add-another]'), submit = form.querySelector('[type="submit"]');
    const fields = () => [...form.elements].filter(control => keys.includes(control.name));
    const initialDisabled = new Map(fields().map(control => [control,control.disabled]));
    const signature = () => JSON.stringify(fields().map(control => [control.name,control.value,control.type === 'checkbox' ? control.checked : null]));
    const dirty = () => keys.some(key => {
      const controls = fields().filter(control => control.name === key);
      const value = controls.filter(control => control.type !== 'checkbox' || control.checked).map(control => control.value);
      return !same(value.length || multiple.has(key) ? value : defaults[key], defaults[key]);
    });
    let phase = form.dataset.htmlBlocked === 'true' ? 'blocked' : 'editing', scopeInvalid = false, sentSignature, disposed = false, resetting = false;
    const sync = () => {
      if (disposed || transport.busy) return;
      fields().forEach(control => { control.disabled = initialDisabled.get(control) ?? false; });
      options.updateType();
      if (phase === 'saved') fields().forEach(control => { control.disabled = true; });
      submit.disabled = phase !== 'editing' || scopeInvalid;
      submit.textContent = phase === 'saved' ? '등록 완료' : phase === 'blocked' ? '등록 여부 확인 필요' : '계정 등록';
      submit.classList.toggle('button-primary', phase === 'editing');
      submit.classList.toggle('button-secondary', phase !== 'editing');
      another.hidden = phase !== 'saved' || scopeInvalid;
      followup.hidden = phase === 'editing';
      form.dataset.createPhase = phase;
      form.toggleAttribute('data-create-dirty', phase !== 'saved' && dirty());
    };
    const write = values => {
      // Validate representability before changing any field, including automatically granted dependencies.
      for (const key of keys) {
        const controls = fields().filter(control => control.name === key);
        if (multiple.has(key) && values[key].some(value => !controls.some(control => control.value === value))) throw Error('Missing account choice');
        for (const control of controls) if (control.tagName === 'SELECT' && ![...control.options].some(option => option.value === values[key][0])) throw Error('Missing account option');
      }
      for (const control of fields()) {
        if (control.type === 'checkbox') control.checked = values[control.name].includes(control.value);
        else control.value = values[control.name][0] ?? '';
      }
    };
    const transport = window.CompanyForm.attach(form, {
      state, canSubmit:() => !disposed && !scopeInvalid && phase === 'editing',
      prepare:() => { sentSignature = signature(); phase = 'pending'; form.dataset.createPhase = phase; submit.textContent = '등록 중…'; },
      onSaved:(data, submitted) => {
        const account = validateAcknowledgement(data, submitted, defaults);
        if (signature() !== sentSignature || scopeInvalid) throw Error('Draft or account scope changed');
        write(account.fields);
        form.dataset.createdAccountId = account.id;
        followupMessage.textContent = `${account.fields.Name[0]} (${account.fields.Email[0]}) 등록 완료. 아래 목록과 현황은 새로고침 후 반영됩니다. 다른 직원의 수정 내용은 그대로 유지했습니다.`;
        phase = 'saved';
      },
      onSettled:(saved, outcome) => {
        phase = saved ? 'saved' : outcome === 'invalid' && !scopeInvalid ? 'editing' : 'blocked';
        sync();
      }
    });
    const reset = event => {
      if (!resetting && phase !== 'editing') event.preventDefault();
      if (!event.defaultPrevented) queueMicrotask(sync);
    };
    const next = () => {
      if (disposed || phase !== 'saved' || scopeInvalid || transport.busy) return;
      resetting = true; form.reset(); resetting = false;
      write(defaults); phase = 'editing'; delete form.dataset.createdAccountId;
      state.hidden = true; followupMessage.textContent = initialFollowupMessage;
      for (const search of form.querySelectorAll('input[type="search"]')) { search.value = ''; search.dispatchEvent(new Event('input',{bubbles:true})); }
      sync();window.CompanyEntityChoices?.refresh();form.elements.namedItem('Name')?.focus();
    };
    const beforeUnload = event => {
      if (!disposed && (transport.busy || (phase !== 'saved' && dirty()))) { event.preventDefault(); event.returnValue = ''; }
    };
    const scopeChanged = () => {
      const wasSaved = phase === 'saved';scopeInvalid = true;if(!wasSaved)phase = 'blocked';sync();state.hidden = false;
      window.CompanyState.render(state,{kind:'denied',title:'현재 계정과 등록 여부를 확인해 주세요.',
        message:wasSaved ? '확인된 등록 결과는 유지됩니다. 계정이나 권한이 바뀌어 추가 등록은 새로고침 후 가능합니다.' : '입력은 유지했습니다. 이전 요청은 서버에 반영되었을 수 있으므로 목록에서 확인한 뒤 새로고침해 주세요.'});
    };
    form.addEventListener('input',sync);form.addEventListener('change',sync);form.addEventListener('reset',reset);
    another.addEventListener('click',next);window.addEventListener('beforeunload',beforeUnload);
    document.addEventListener('workspace-entity-scope-change',scopeChanged);
    sync();
    return {get phase(){return phase;}, dispose(){
      disposed = true;transport.dispose();
      form.removeEventListener('input',sync);form.removeEventListener('change',sync);form.removeEventListener('reset',reset);
      another.removeEventListener('click',next);window.removeEventListener('beforeunload',beforeUnload);
      document.removeEventListener('workspace-entity-scope-change',scopeChanged);
    }};
  }
  window.CompanyAccountCreate = {attach,validateAcknowledgement};
})();
