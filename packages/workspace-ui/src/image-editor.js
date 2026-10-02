/* Shared image editing lifetime. Resource adapters own targets, scope and receipt fields. */
(() => {
  'use strict';
  function attach({root,getContext,readContext,applyContext,publishChange,resource}) {
    const prefix=resource.prefix,label=resource.label;
    const form=root.querySelector('[data-'+prefix+'-form]');if(!form)return;
    const input=form.querySelector('[name=Photo]'),preview=root.querySelector('[data-'+prefix+'-preview]'),state=root.querySelector('[data-'+prefix+'-status]');
    const save=form.querySelector('[data-'+prefix+'-save]'),remove=form.querySelector('[data-'+prefix+'-remove]');
    const owner=form.elements.ExpectedUserId.value,version=form.elements.ExpectedVersion;
    let selected=null,serial=0,preparing=false,checking=false,confirming=false,blocked=root.dataset.imageWriteLocked==='true',invalid=false,disposed=false,scope=null,readAbort=null,confirmAbort=null;
    const scopeOf=value=>value?.authenticated?JSON.stringify([String(value.user?.id),value.user?.role,!!value.isAdmin,(value.services||[]).map(s=>s.key).sort()]):'';
    const current=token=>!disposed&&!invalid&&token===serial&&scope===scopeOf(getContext())&&form.isConnected;
    const show=(kind,title,message,actionLabel='',onAction)=>{state.hidden=false;window.CompanyState.render(state,{kind,title,message,actionLabel,onAction});};
    const clear=()=>{selected=null;input.value='';preview.removeAttribute('src');preview.hidden=true;};
    let transport;
    const lock=()=>{
      const busy=!scope||preparing||checking||confirming||transport?.busy||blocked||invalid||disposed;
      input.disabled=!!busy;save.disabled=!!busy||!selected;remove.disabled=!!busy||!version.value;
      root.dataset.imagePending=String(!!(input.files.length||preparing||checking||confirming||transport?.busy));
    };
    const invalidate=()=>{
      if(invalid||disposed)return;invalid=true;serial++;readAbort?.abort();confirmAbort?.abort();transport?.dispose();clear();
      root.querySelector('[data-'+prefix+'-summary]')?.replaceChildren();lock();
      show('denied','계정과 권한이 변경되었습니다.','이전 화면의 이미지는 수정하지 않습니다. 현재 설정을 다시 열어 주세요.','현재 설정 열기',()=>location.assign(resource.reloadUrl));
    };
    function contextChanged(){
      const value=getContext(),next=scopeOf(value);
      if(!next||String(value.user.id)!==owner||scope!==null&&scope!==next||!resource.allowed(value)){invalidate();return;}
      scope=next;lock();
    }
    function stamp(value){
      if(value===null)return '';
      if(typeof value!=='string'||!value.startsWith(resource.imagePath+'?v='))throw Error('이미지 대상을 확인할 수 없습니다.');
      const version=value.slice(resource.imagePath.length+3);
      if(version.length!==32||!/^[a-f0-9]{32}$/.test(version))throw Error('이미지 버전을 확인할 수 없습니다.');return version;
    }
    async function refresh(saved=false){
      if(disposed||invalid||checking||transport?.busy)return;
      checking=true;const token=serial,abort=new AbortController();readAbort=abort;lock();
      let timer;
      try{
        const value=await Promise.race([readContext(abort.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('조회 시간이 초과되었습니다.'));},15000);})]);
        if(!current(token)||abort.signal.aborted)return;
        if(!value?.authenticated||String(value.user?.id)!==owner||scopeOf(value)!==scope||!resource.allowed(value)){applyContext(value);invalidate();return;}
        const next=stamp(resource.snapshotUrl(value));
        version.value=next;blocked=false;applyContext(value);
        show('success',saved?label+' 변경을 완료했습니다.':'현재 '+label+'을 확인했습니다.',selected?'선택한 사진은 유지했습니다. 현재 사진과 미리보기를 확인한 뒤 저장하세요.':'모든 회사 서비스가 같은 이미지 정보를 사용합니다.');
      }catch(error){if(current(token)){blocked=true;show(saved?'success':'error',saved?label+' 변경은 완료했습니다.':'현재 '+label+'을 확인하지 못했습니다.','화면 갱신을 확인하지 못했습니다. 다시 확인은 조회만 수행하며 사진을 재전송하지 않습니다.','현재 사진 다시 확인',()=>refresh(saved));}}
      finally{clearTimeout(timer);if(readAbort===abort)readAbort=null;if(current(token)){checking=false;lock();}}
    }
    async function select(){
      if(invalid||disposed||transport?.busy||checking||confirming||resource.canEdit?.()===false)return;
      const file=input.files[0],token=++serial;selected=null;preview.hidden=true;preview.removeAttribute('src');
      if(!file){preparing=false;lock();state.hidden=true;return;}
      preparing=true;lock();show('loading','사진을 준비하고 있습니다.','정사각형 미리보기를 만들고 있습니다.');
      let bitmap,expired=false;
      const observe=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('사진 준비 시간이 초과되었습니다. 다른 사진을 선택해 주세요.'));},15000);})]);}finally{clearTimeout(timer);}};
      try{
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('8MB 이하의 PNG, JPG, WebP 사진을 선택해 주세요.');
        bitmap=await observe(createImageBitmap(file).then(value=>{if(expired||!current(token)){value.close();return null;}return value;}));if(!current(token))return;
        if(!bitmap.width||!bitmap.height||bitmap.width>8192||bitmap.height>8192)throw Error('사진의 가로·세로 크기는 8192px 이하여야 합니다.');
        const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
        const ctx=canvas.getContext('2d'),side=Math.min(bitmap.width,bitmap.height);
        ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);
        const png=await observe(new Promise(resolve=>canvas.toBlob(resolve,'image/png')));if(!current(token))return;
        if(!png||!png.size||png.size>524288)throw Error('사진을 준비하지 못했습니다. 다른 사진을 선택해 주세요.');
        selected=png;preview.src=canvas.toDataURL('image/png');preview.hidden=false;
        show('success','저장할 사진을 준비했습니다.','미리보기만 생성했습니다. 저장을 눌러야 실제 이미지에 반영됩니다.');
      }catch(error){if(current(token))show('error','사진을 준비하지 못했습니다.',String(error.message||error));}
      finally{bitmap?.close();if(current(token)){preparing=false;lock();}}
    }
    const submitCapture=event=>{
      if(transport?.busy||blocked||invalid||preparing||checking||confirming||!selected||resource.canEdit?.()===false){event.preventDefault();event.stopImmediatePropagation();return;}
      form.elements.Operation.value='save';
    };
    form.addEventListener('submit',submitCapture,true);
    transport=window.CompanyForm.attach(form,{state,canSubmit:()=>!invalid&&!blocked&&!checking&&!preparing&&!confirming&&!!scope&&resource.canEdit?.()!==false,
      prepare:data=>{
        if(scope!==scopeOf(getContext())||String(getContext()?.user?.id)!==owner)throw Error('계정이 변경되었습니다.');
        if(data.get('Operation')==='save'){if(!selected)throw Error('사진을 선택해 주세요.');data.set('Photo',selected,'profile.png');}
        else data.delete('Photo');
        root.dataset.imagePending='true';
      },
      onSaved:(data,sent)=>{
        if(!data||data.operation!==sent.get('Operation')||data.userId!==owner||!resource.receiptMatches(data,sent)||data.version!==stamp(resource.receiptUrl(data))||data.operation==='save'&&!data.version||data.operation==='remove'&&resource.receiptUrl(data)!==null)throw Error('프로필 저장 결과를 확인할 수 없습니다.');
        version.value=data.version;clear();publishChange();
      },
      onSettled:(saved,outcome)=>{
        if(disposed||invalid)return;
        if(saved){lock();void refresh(true);return;}
        if(outcome!=='invalid')blocked=true;lock();
        if(outcome!=='invalid')show(outcome==='denied'?'denied':'error',label+' 변경 결과를 확인해야 합니다.','선택한 사진은 유지했습니다. 서버에는 반영되었을 수 있으며 자동으로 다시 전송하지 않습니다.','현재 사진 다시 확인',()=>refresh());
      }});
    const removeClick=async()=>{
      if(remove.disabled||resource.canEdit?.()===false)return;const token=serial,captured=version.value,opener=remove;
      confirming=true;confirmAbort=new AbortController();lock();
      try{
        const accepted=await window.CompanyDialog.confirm({title:'기본 '+label+' 이미지로 변경할까요?',message:'현재 이미지를 제거합니다. 이름과 다른 정보는 변경하지 않습니다.',confirmLabel:'기본 사진으로 변경',returnFocus:opener,signal:confirmAbort.signal});
        if(!current(token)||!accepted||version.value!==captured||resource.canEdit?.()===false)return;
        confirming=false;form.elements.Operation.value='remove';
        // Native form submission remains owned by CompanyForm; only this explicit confirmation bypasses the save-only capture guard.
        form.removeEventListener('submit',submitCapture,true);try{form.requestSubmit();}finally{form.addEventListener('submit',submitCapture,true);}
      }catch(error){if(current(token))show('error','확인창을 열지 못했습니다.',String(error.message||error));}
      finally{confirmAbort=null;if(current(token)){confirming=false;lock();}}
    };
    input.addEventListener('change',select);remove.addEventListener('click',removeClick);
    document.addEventListener('company-context',contextChanged);document.addEventListener('workspace-entity-scope-change',invalidate);
    const pagehide=event=>{if(!event.persisted)dispose();};
    const beforeunload=event=>{if(input.files.length||transport.busy){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',beforeunload);
    function dispose(){if(disposed)return;disposed=true;serial++;readAbort?.abort();confirmAbort?.abort();transport.dispose();clear();lock();input.removeEventListener('change',select);remove.removeEventListener('click',removeClick);form.removeEventListener('submit',submitCapture,true);document.removeEventListener('company-context',contextChanged);document.removeEventListener('workspace-entity-scope-change',invalidate);window.removeEventListener('pagehide',pagehide);window.removeEventListener('beforeunload',beforeunload);}
    window.addEventListener('pagehide',pagehide);
    lock();if(getContext()!==undefined)contextChanged();
    return {dispose};
  }
  window.CompanyImageEditor={attach};
})();
