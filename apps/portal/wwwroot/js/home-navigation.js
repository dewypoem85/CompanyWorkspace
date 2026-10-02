/* Portal's shell persists while registered pages replace only their main content. */
(() => {
  let root=null,edited=false,revision=0;
  const changed=event=>{
    if(!event.isTrusted||event.target.matches('[type="search"],[data-user-search],[data-department-filter],[data-project-filter]'))return;
    edited=true;revision++;
  };
  function start(view) {
    root=view;edited=false;revision=0;
    root?.addEventListener('input',changed);
    root?.addEventListener('change',changed);
  }
  function dispose() {
    root?.removeEventListener('input',changed);
    root?.removeEventListener('change',changed);
    root=null;edited=false;
  }
  const adapter={
    start,dispose,
    async beforeLeave() {
      if(!root)return true;
      if(root.querySelector('form[aria-busy="true"],[data-image-pending="true"]'))return false;
      if(!edited&&!root.querySelector('[data-dirty]'))return true;
      const captured=revision;
      const approved=await window.CompanyDialog.confirm({title:'작성 중인 회사 정보',message:'저장하지 않은 입력이 있습니다. 변경사항을 버리고 이동하시겠습니까?',confirmLabel:'버리고 이동',returnFocus:document.activeElement});
      return approved&&captured===revision&&!root.querySelector('form[aria-busy="true"],[data-image-pending="true"]');
    }
  };
  for(const id of ['home.dashboard','home.profile','home.users'])window.CompanyPageRouter?.register(id,adapter);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>start(document.querySelector('[data-workspace-view]')));
  else start(document.querySelector('[data-workspace-view]'));
})();
