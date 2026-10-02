(function(root){
    'use strict';
    const mediaType='application/vnd.company.workspace-form+json';
    async function read(input,signal){
        const url=new URL(String(input),root.location.href);
        if(url.origin!==root.location.origin)throw Error('직원 확인 요청 주소가 올바르지 않습니다.');
        const response=await root.fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'manual',signal,headers:{Accept:mediaType,'X-Requested-With':'XMLHttpRequest'}});
        if(!response.ok)throw Error([401,403].includes(response.status)?'로그인 상태 또는 수정 권한을 확인해 주세요.':'최신 정보를 조회하지 못했습니다.');
        const contentType=response.headers.get('content-type')||'';
        if(!contentType.includes(mediaType))throw Error('올바른 서버 응답을 받지 못했습니다.');
        const reply=await response.json();signal?.throwIfAborted();return reply;
    }
    root.CompanyAccountReview=Object.freeze({read,mediaType});
})(typeof window==='undefined'?globalThis:window);
