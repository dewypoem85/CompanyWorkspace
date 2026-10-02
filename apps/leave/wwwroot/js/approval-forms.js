/* Leave owns approval transitions. Shared primitives own form/confirmation/state UI. */
(() => {
    'use strict';
    const root=document.querySelector('[data-approval-screen]');if(!root)return;
    const state=root.querySelector('[data-approval-state]'),owner=root.dataset.employeeId,readSession=window.CompanyReadSession.create();
    let disposed=false,invalid=false,locked=root.dataset.writeLocked==='true',active=null,confirmation=null,reading=null,sequence=0,readFailed=false,summaryRead=false;
    let bindings=[],currentUrl=location.href;const completed=new Set();
    const areas=()=>[root.querySelector('#adminApprovalQueuesArea'),root.querySelector('#adminRecentRequestsArea')];
    const hasDraft=()=>[...root.querySelectorAll('[name=reason]')].some(input=>input.value.length>0);
    const show=(kind,title,message,action=false)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message,actionLabel:action?'목록 다시 확인':'',onAction:action?()=>reload(true):undefined});};
    function lock(){const busy=active||(reading&&!summaryRead)||invalid||disposed;areas().forEach(area=>{if(area)area.inert=!!busy;});root.querySelector('[data-approval-refresh]').disabled=!!busy;root.querySelectorAll('[data-approval-form]').forEach(form=>form.querySelectorAll('button').forEach(button=>{button.disabled=locked||invalid||disposed||completed.has(form.elements.id.value);}));}
    // Read values even while CompanyForm has disabled controls; never re-enable fields to serialize a receipt check.
    const snapshot=(form,button)=>JSON.stringify([form.elements.id.value,form.elements.expectedEmployeeId.value,form.elements.expectedSnapshot.value,form.elements.reason?.value??null,button?.name==='approve'?button.value:null]);
    const interruptSummary=()=>{if(reading&&summaryRead){sequence++;readSession.cancel(reading.channel);reading=null;summaryRead=false;}};
    function bind(){
        bindings.forEach(binding=>binding.dispose());bindings=[];
        root.querySelectorAll('[data-approval-form]').forEach(form=>{
            let accepted=false,captured='',submitter=null;
            const operation=form.dataset.operation,id=form.elements.id.value;
            const confirm=async event=>{
                if(accepted)return;
                event.preventDefault();event.stopImmediatePropagation();
                interruptSummary();if(active||reading||locked||invalid||disposed||completed.has(id)||!form.reportValidity())return;
                submitter=event.submitter;if(operation!=='ForceDelete'&&!['true','false'].includes(submitter?.value))return;
                captured=snapshot(form,submitter);active=form;confirmation=new AbortController();lock();
                try {
                    const action=submitter?.textContent.trim()||'강제 삭제';
                    const ok=await window.CompanyDialog.confirm({title:action+'하시겠습니까?',message:operation==='ForceDelete'?'신청 날짜와 배정 내역을 제거합니다. 되돌릴 수 없으며 사유가 감사 기록에 남습니다.':'이 신청에 대한 결정을 저장하고 직원에게 알림을 보냅니다.',details:[{label:'대상',value:form.dataset.requestLabel},{label:'신청 번호',value:id},...(operation==='ForceDelete'?[{label:'사유',value:form.elements.reason.value}]:[])],confirmLabel:action,returnFocus:submitter,signal:confirmation.signal});
                    if(!ok||invalid||disposed||!form.isConnected||snapshot(form,submitter)!==captured)return;
                    accepted=true;form.requestSubmit(submitter);accepted=false;
                }catch {if(!invalid&&!disposed)show('error','처리 확인을 열지 못했습니다.','입력은 유지했습니다. 다시 확인해 주세요.');}
                finally {confirmation=null;if(!controller.busy){active=null;lock();}}
            };
            form.addEventListener('submit',confirm,true);
            const controller=window.CompanyForm.attach(form,{state,
                canSubmit:()=>active===form&&!locked&&!invalid&&!disposed&&!reading&&!completed.has(id),
                prepare:()=>{if(form.elements.expectedEmployeeId.value!==owner||snapshot(form,submitter)!==captured)throw Error('Changed approval draft');},
                onSaved:(data,sent)=>{
                    const approve=operation==='ForceDelete'?null:sent.get('approve');
                    const status=operation==='ForceDelete'?'deleted':operation==='Decide'?(approve==='true'?'Approved':'Rejected'):(approve==='true'?'Cancelled':'Approved');
                    if(!data||data.operation!==operation||data.employeeId!==owner||data.id!==id||data.approve!==approve||data.previousSnapshot!==sent.get('expectedSnapshot')||data.status!==status||snapshot(form,submitter)!==captured)throw Error('Unconfirmed approval response');
                    completed.add(id);if(form.elements.reason)form.elements.reason.value='';
                },
                onSettled:(saved,outcome)=>{
                    active=null;if(disposed||invalid)return;
                    if(!saved&&outcome!=='invalid')locked=true;lock();
                    if(saved){show('success','연차 신청 처리를 완료했습니다.',hasDraft()?'다른 신청의 삭제 사유를 유지했습니다. 목록은 새로고침 후 최신 상태로 표시됩니다.':'최신 신청 내역을 확인하고 있습니다.');if(!hasDraft())void reload(false,true);}
                    else if(outcome!=='invalid')show('error','처리 결과를 다시 확인해 주세요.','입력은 유지했습니다. 서버에는 반영되었을 수 있으므로 자동으로 다시 전송하지 않습니다.',true);
                }});
            bindings.push({dispose(){form.removeEventListener('submit',confirm,true);controller.dispose();}});
        });lock();
    }
    const current=token=>!disposed&&!invalid&&token===sequence&&root.isConnected;
    async function read(channel,url,accept,token){
        const result=await readSession.run(channel,async signal=>{const response=await fetch(url,{credentials:'same-origin',redirect:'manual',cache:'no-store',headers:{'X-Requested-With':'XMLHttpRequest',Accept:accept},signal});if(!current(token))throw Error('Stale read');if(!response.ok)throw Object.assign(Error('HTTP '+response.status),{status:response.status});if(!(response.headers.get('content-type')||'').includes(accept))throw Error('Invalid content type');const value=accept==='application/json'?await response.json():await response.text();signal.throwIfAborted();if(!current(token))throw Error('Stale read');return value;},15000);
        if(result.status==='cancelled'||!current(token)||!result.isCurrent?.())throw Object.assign(Error('Stale read'),{cancelled:true});
        if(result.status==='error')throw result.error;
        return result.value;
    }
    async function reload(manual=false,saved=false,url=currentUrl){
        interruptSummary();if(active||reading||invalid||disposed)return;
        if(hasDraft()){
            if(!manual)return;const draft=JSON.stringify([...root.querySelectorAll('[name=reason]')].map(x=>x.value));confirmation=new AbortController();active=root;lock();
            try{const ok=await window.CompanyDialog.confirm({title:'목록을 다시 불러올까요?',message:'입력 중인 강제 삭제 사유는 사라집니다. 서버의 최신 내역을 조회하며 승인이나 삭제를 다시 실행하지 않습니다.',confirmLabel:'목록 새로고침',returnFocus:root.querySelector('[data-approval-refresh]'),signal:confirmation.signal});if(!ok||invalid||disposed||draft!==JSON.stringify([...root.querySelectorAll('[name=reason]')].map(x=>x.value)))return;}
            finally{confirmation=null;active=null;lock();}
        }
        const address=new URL(url,location.href);if(address.origin!==location.origin||!['/Admin','/Admin/Index'].includes(address.pathname))return;
        const token=++sequence,channel='approval-lists';reading={channel,token};lock();
        try{
            const html=await read(channel,address.href,'text/html',token);if(!current(token)||reading?.token!==token)return;
            const doc=new DOMParser().parseFromString(html,'text/html'),next=doc.querySelector('[data-approval-screen]');
            if(!next)throw Error('Missing approval screen');if(next.dataset.employeeId!==owner){invalidate();return;}
            const incoming=[next.querySelector('#adminApprovalQueuesArea'),next.querySelector('#adminRecentRequestsArea')];if(incoming.some(area=>!area))throw Error('Missing queues');
            bindings.forEach(binding=>binding.dispose());bindings=[];areas().forEach((area,i)=>area.replaceWith(incoming[i]));
            currentUrl=address.href;history.replaceState(history.state,'',currentUrl);
            locked=false;readFailed=false;completed.clear();bind();window.setMobileTableLabels?.();updateBadge();
            show('success',saved?'연차 신청 처리를 완료했습니다.':'최신 신청 내역을 확인했습니다.','목록과 처리 상태를 갱신했습니다.');
        }catch(error){if(current(token)){if([401,403].includes(error.status)){invalidate();return;}readFailed=true;show(saved?'success':'error',saved?'처리는 완료했지만 목록을 갱신하지 못했습니다.':'목록을 확인하지 못했습니다.','이전 내용을 유지했습니다. 다시 확인은 조회만 수행하며 승인을 반복하지 않습니다.',true);}}
        finally{if(current(token)&&reading?.token===token){reading=null;lock();}}
    }
    function updateBadge(){const area=areas()[0];window.CompanyNavigation?.setBadge('leave','leave.approvals',Number(area.dataset.pendingCount)+Number(area.dataset.cancelPendingCount));}
    async function poll(){
        if(active||reading||locked||readFailed||invalid||disposed||document.hidden||hasDraft())return;
        const area=areas()[0],token=++sequence,channel='approval-summary';reading={channel,token};summaryRead=true;let changed=false;
        try{const data=await read(channel,area.dataset.queueSummaryUrl,'application/json',token);if(!current(token)||reading?.token!==token)return;
            const version=typeof data.version==='string'?data.version:Number.isSafeInteger(data.version)?String(data.version):'';
            if(!/^(0|[1-9][0-9]*)$/.test(version)||!Number.isSafeInteger(data.pendingCount)||data.pendingCount<0||!Number.isSafeInteger(data.cancelPendingCount)||data.cancelPendingCount<0)throw Error('Invalid queue summary');
            changed=[data.pendingCount,data.cancelPendingCount,version].join(':')!==[area.dataset.pendingCount,area.dataset.cancelPendingCount,area.dataset.queueVersion].join(':');
        }catch(error){if(current(token)){if([401,403].includes(error.status)){invalidate();return;}readFailed=true;show('error','승인 대기열 갱신을 확인하지 못했습니다.','표시된 목록이 최신이 아닐 수 있습니다. 다시 확인은 조회만 수행합니다.',true);}}
        finally{if(current(token)&&reading?.token===token){reading=null;summaryRead=false;lock();}}
        if(changed&&current(token)&&!hasDraft())void reload();
    }
    const invalidate=()=>{if(invalid||disposed)return;invalid=true;sequence++;readSession.dispose();reading=null;confirmation?.abort();bindings.forEach(binding=>binding.dispose());areas().forEach(area=>{area.hidden=true;});lock();show('denied','로그인 상태 또는 권한이 바뀌었습니다.','이전 계정의 신청을 처리하지 않습니다. 새 탭에서 현재 계정과 처리 결과를 확인해 주세요.');};
    const click=event=>{if(event.target.closest('[data-approval-refresh]'))void reload(true);const link=event.target.closest('#adminRecentRequestsArea .pager a[href]');if(link){event.preventDefault();if(!link.classList.contains('is-disabled'))void reload(true,false,link.href);}};
    const submit=event=>{if(event.target.matches('#adminRecentListForm,#adminRecentPageJumpForm')){event.preventDefault();const url=new URL(currentUrl);url.search=new URLSearchParams(new FormData(event.target)).toString();void reload(true,false,url.href);}};
    const change=event=>{if(event.target.matches('#adminRecentListForm select')){event.target.form.elements.RecentPage.value='1';event.target.form.requestSubmit();}};
    const visibility=()=>{if(!document.hidden)void poll();};
    const unload=event=>{if(active||hasDraft()){event.preventDefault();event.returnValue='';}};
    const dispose=event=>{if(event?.persisted||disposed)return;disposed=true;sequence++;readSession.dispose();reading=null;confirmation?.abort();bindings.forEach(binding=>binding.dispose());clearInterval(timer);root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('change',change);document.removeEventListener('workspace-entity-scope-change',invalidate);document.removeEventListener('company-page-leave',dispose);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',poll);window.removeEventListener('leave:notifications',poll);window.removeEventListener('beforeunload',unload);window.removeEventListener('pagehide',dispose);};
    root.addEventListener('click',click);root.addEventListener('submit',submit);root.addEventListener('change',change);document.addEventListener('workspace-entity-scope-change',invalidate);document.addEventListener('company-page-leave',dispose);document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',poll);window.addEventListener('leave:notifications',poll);window.addEventListener('beforeunload',unload);window.addEventListener('pagehide',dispose);
    bind();const timer=setInterval(poll,3000);
})();
