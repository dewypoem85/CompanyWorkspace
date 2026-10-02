/* Profile context and receipt adapter; image UI/lifetimes are shared. */
(() => {
  'use strict';
  function attach(options) {
    const form=options.root.querySelector('[data-profile-form]');if(!form)return;
    const owner=form.elements.ExpectedUserId.value;
    return window.CompanyImageEditor.attach({...options,resource:{prefix:'profile',label:'프로필',reloadUrl:form.action,
      imagePath:'/api/workspace/avatar/'+owner,allowed:()=>true,
      snapshotUrl:value=>{
        if((value.profiles?.[owner]??null)!==value.user.avatarUrl)throw Error('프로필 목록과 계정 정보가 일치하지 않습니다.');
        return value.user.avatarUrl;
      },receiptUrl:data=>data.avatarUrl,receiptMatches:()=>true}});
  }
  window.CompanyProfile={attach};
})();
