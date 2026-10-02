/* Project scope is distinct from the signed-in user's profile. */
(() => {
  'use strict';
  function attach(options) {
    const form=options.root.querySelector('[data-project-icon-form]');if(!form)return;
    const id=form.elements.ProjectId.value;
    const allowed=value=>!!value.isAdmin&&Array.isArray(value.projects)&&value.projects.some(project=>String(project.id)===id);
    return window.CompanyImageEditor.attach({...options,resource:{prefix:'project-icon',label:'프로젝트 아이콘',
      imagePath:'/api/workspace/project-icon/'+id,reloadUrl:'/Admin/Organization?tab=projects&id='+id,allowed,
      canEdit:()=>form.elements.ProjectId.value===id&&document.querySelector('[data-organization-form]')?.getAttribute('aria-busy')!=='true',
      snapshotUrl:value=>{if(!value.projectIcons||typeof value.projectIcons!=='object'||Array.isArray(value.projectIcons))throw Error('프로젝트 아이콘 목록을 확인할 수 없습니다.');return value.projectIcons[id]??null;},receiptUrl:data=>data.iconUrl,
      receiptMatches:(data,sent)=>data.projectId===id&&sent.get('ProjectId')===id&&data.previousVersion===sent.get('ExpectedVersion')}});
  }
  window.CompanyProjectIcon={attach};
})();
