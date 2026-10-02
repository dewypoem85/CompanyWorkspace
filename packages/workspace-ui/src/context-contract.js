/* Company account context validation. Values are observed, never normalized. */
(() => {
  'use strict';
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const identifier=value=>(typeof value==='string'&&value.length>0)||(Number.isSafeInteger(value)&&value>=0);
  const optionalString=value=>value===undefined||value===null||typeof value==='string';
  function stringRecord(value,label) {
    if(value===undefined)return;
    if(!object(value)||Object.entries(value).some(([key,item])=>!key||typeof item!=='string'||!item))throw Error(`회사 ${label} 정보를 확인할 수 없습니다.`);
  }
  function read(value) {
    if(!object(value)||typeof value.authenticated!=='boolean')throw Error('회사 계정 응답을 확인할 수 없습니다.');
    if(!value.authenticated)return value;
    const user=value.user;
    if(!object(user)||!identifier(user.id)||typeof user.name!=='string'||!user.name.trim()||!['master','admin','employee'].includes(user.role))throw Error('회사 계정 사용자 정보를 확인할 수 없습니다.');
    for(const field of ['email','department','accountType','avatarUrl'])if(!optionalString(user[field]))throw Error('회사 계정 사용자 정보를 확인할 수 없습니다.');
    if(!Array.isArray(value.services)||value.services.some(service=>!object(service)||typeof service.key!=='string'||!service.key||typeof service.name!=='string'||!service.name.trim()||typeof service.href!=='string'||!service.href))throw Error('회사 서비스 권한 정보를 확인할 수 없습니다.');
    if(new Set(value.services.map(service=>service.key)).size!==value.services.length)throw Error('회사 서비스 권한 정보가 중복되었습니다.');
    if(value.isAdmin!==undefined&&typeof value.isAdmin!=='boolean'||value.csrfToken!==undefined&&typeof value.csrfToken!=='string')throw Error('회사 계정 권한 정보를 확인할 수 없습니다.');
    stringRecord(value.profiles,'프로필');stringRecord(value.projectIcons,'프로젝트 아이콘');
    if(value.projects!==undefined&&(!Array.isArray(value.projects)||value.projects.some(project=>!object(project)||!identifier(project.id)||typeof project.name!=='string'||!project.name.trim()||project.isPrivate!==undefined&&typeof project.isPrivate!=='boolean')))throw Error('회사 프로젝트 정보를 확인할 수 없습니다.');
    return value;
  }
  window.CompanyContextContract=Object.freeze({read});
})();
