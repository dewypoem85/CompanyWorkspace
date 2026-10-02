(function(root){
  'use strict';
  // Observes reads only. Cancelling is not a server rollback or permission check.
  function create(){
    const channels=new Map();let disposed=false;
    function cancel(channel){const previous=channels.get(channel);channels.delete(channel);previous?.controller.abort();}
    function dispose(){disposed=true;for(const channel of channels.keys())cancel(channel);}
    async function run(channel,work,timeoutMs=30000){
      if(typeof channel!=='string'||!channel||typeof work!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw TypeError('Invalid read session request');
      if(disposed)return {status:'cancelled'};
      cancel(channel);
      const controller=new AbortController(),ticket={controller};channels.set(channel,ticket);
      const isCurrent=()=>!disposed&&channels.get(channel)===ticket;
      let expired=false,rejectAbort;
      const interrupted=new Promise((_,reject)=>{rejectAbort=()=>reject(Error('조회 시간이 초과되었습니다. 다시 시도해 주세요.'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
      const timer=setTimeout(()=>{expired=true;controller.abort();},timeoutMs);
      try{
        const value=await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error('Read cancelled');return work(controller.signal);}),interrupted]);
        if(!isCurrent()||controller.signal.aborted)return {status:'cancelled'};
        return {status:'success',value,isCurrent};
      }catch(error){
        if(!isCurrent()||controller.signal.aborted&&!expired)return {status:'cancelled'};
        return {status:'error',error,isCurrent};
      }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',rejectAbort);controller.abort();}
    }
    return Object.freeze({run,cancel,dispose});
  }
  root.CompanyReadSession=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
