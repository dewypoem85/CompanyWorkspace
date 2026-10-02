(function(root){
    'use strict';
    const paths=new Set(['/leave','/leave/index']);
    const queryKeys=new Set(['Year','Month','CalendarView','SelfOnly','ShowOthers','ViewEmployeeId','RequestPage','RequestLimit','SaveCalendarPreference']);
    async function read(input,signal){
        const url=new URL(String(input),root.location.href);
        if(url.origin!==root.location.origin||url.hash||!paths.has(url.pathname.toLowerCase())||[...url.searchParams.keys()].some(key=>!queryKeys.has(key)||url.searchParams.getAll(key).length!==1))throw Error('연차 조회 주소가 올바르지 않습니다.');
        const response=await root.fetch(url,{headers:{'X-Requested-With':'XMLHttpRequest',Accept:'text/html'},credentials:'same-origin',cache:'no-store',redirect:'error',signal});
        if(!response.ok)throw Error(`연차 정보를 조회하지 못했습니다. (HTTP ${response.status})`);
        if(!(response.headers.get('content-type')||'').toLowerCase().includes('text/html'))throw Error('올바른 연차 조회 응답을 받지 못했습니다.');
        const html=await response.text();signal?.throwIfAborted();return html;
    }
    root.LeaveDashboardRead=Object.freeze({read});
})(typeof window==='undefined'?globalThis:window);
