/* Notification requests are scoped to the current company account; domain storage stays in each service. */
(() => {
  'use strict';
  function attach({getContext,request,onFeed,onReset,onState,onLock,timeoutMs=15000}) {
    let scope='',generation=0,active=null,ready=false,suspended=false,disposed=false;
    const identity=()=>{
      try {
      const context=getContext();
      if(!context?.authenticated)return '';
      const id=window.CompanyNotificationContract.id(context.user?.id);
      return JSON.stringify([id,context.user.role,!!context.isAdmin,(context.services||[]).map(s=>s.key).sort()]);
      } catch { return ''; }
    };
    const current=token=>!disposed&&!suspended&&token.generation===generation&&token.scope===scope&&scope===identity();
    const lock=()=>onLock(disposed||suspended||!ready||!!active);
    const state=(kind,title,message,retry=false)=>onState({kind,title,message,retry:retry?()=>read():null});
    function invalidate() {
      generation++;ready=false;suspended=true;
      active?.controller.abort();active=null;onReset();lock();
      if(!disposed)state('denied','계정 정보를 다시 확인해야 합니다.','이전 계정의 알림은 표시하지 않습니다. 계정 연결을 새로 확인해 주세요.');
    }
    function update() {
      if(disposed)return;
      let next;try{next=identity();}catch{next='';}
      if(next!==scope||suspended){invalidate();scope=next;suspended=false;}
      lock();
      if(!scope){onReset();state('denied','로그인이 필요합니다.','회사 계정으로 로그인한 후 알림을 확인하세요.');return;}
      void read();
    }
    async function run(kind,work) {
      let expected;try{expected=identity();}catch{return null;}
      if(disposed||suspended||!scope||scope!==expected||active)return null;
      const token={scope,generation,controller:new AbortController(),kind};active=token;lock();
      state('loading',kind==='write'?'읽음 처리 중입니다.':'알림을 확인하고 있습니다.','잠시만 기다려 주세요.');
      let abort,timer;
      const interrupted=new Promise((_,reject)=>{
        abort=()=>reject(Error('응답 확인 시간이 초과되었습니다.'));
        token.controller.signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>token.controller.abort(),timeoutMs);
      });
      try {
        const value=await Promise.race([Promise.resolve().then(()=>{
          if(!current(token)||token.controller.signal.aborted)throw Error('계정 범위가 변경되었습니다.');
          return work(token);
        }),interrupted]);
        if(token.controller.signal.aborted)throw Error('응답 확인 시간이 초과되었습니다.');
        return current(token)?{value,token}:null;
      } catch(error) {
        if(current(token)){
          ready=false;
          const denied=[401,403,409].includes(error.status);
          if(denied)onReset();
          state(denied?'denied':'error',kind==='write'?'읽음 처리 결과를 확인해야 합니다.':'알림을 불러오지 못했습니다.',
            kind==='write'?'반영 여부가 확인되지 않았습니다. 자동으로 다시 요청하지 않습니다. 목록을 다시 확인해 주세요.':
              denied?'현재 계정과 접근 권한을 확인해 주세요.':String(error.message||'연결을 확인해 주세요.'),true);
        }
        return null;
      } finally {
        clearTimeout(timer);token.controller.signal.removeEventListener('abort',abort);
        if(active===token){active=null;lock();}
      }
    }
    async function read({saved=false}={}) {
      if(active)return false;
      const expected={scope,generation};
      const result=await run('read',async token=>{
        const userId=JSON.parse(token.scope)[0];
        return window.CompanyNotificationContract.feed(await request('/notifications?take=10&expectedUserId='+userId,{signal:token.controller.signal}));
      });
      if(!result){
        if(saved&&current(expected))state('success','읽음 처리는 완료했습니다.','목록 갱신은 확인하지 못했습니다. 다시 확인은 조회만 수행합니다.',true);
        return false;
      }
      if(!current(result.token))return false;
      onFeed(result.value);ready=true;lock();
      const partial=result.value.sources.some(source=>!source.available);
      if(saved)state('success','읽음 처리를 완료했습니다.',partial?'일부 서비스의 최신 목록을 확인하지 못했습니다.':'현재 알림 목록을 갱신했습니다.',partial);
      else if(partial)state('error','일부 서비스 알림을 불러오지 못했습니다.','확인된 서비스의 알림만 표시합니다.',true);
      else onState(null);
      return true;
    }
    async function write(target,afterSaved) {
      if(!ready||active||suspended||disposed)return false;
      let path;
      try { const key=target==='all'?null:window.CompanyNotificationContract.key(target);
        path=key?'/notifications/'+key.source+'/'+key.id+'/read':'/notifications/read-all';
      }catch(error){state('error','알림 대상을 확인할 수 없습니다.',error.message,true);return false;}
      const result=await run('write',token=>request(path+'?expectedUserId='+JSON.parse(token.scope)[0],{method:'POST',signal:token.controller.signal,expectedStatus:204}));
      if(!result||!current(result.token))return false;
      state('success','읽음 처리를 완료했습니다.','요청한 읽음 처리를 서버에서 확인했습니다.');
      if(afterSaved)afterSaved();else await read({saved:true});
      return true;
    }
    function dispose(){if(disposed)return;disposed=true;invalidate();}
    return {read,write,update,invalidate,dispose};
  }
  window.CompanyNotificationSession={attach};
})();
