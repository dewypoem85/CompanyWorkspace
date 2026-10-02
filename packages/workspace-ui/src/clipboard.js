/* Shared clipboard write with one compatibility fallback owner. */
(() => {
  'use strict';
  async function copyText(value) {
    const text=String(value);
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}
    if(typeof document.execCommand!=='function')throw Error('클립보드 복사를 지원하지 않는 브라우저입니다.');
    const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const selection=document.getSelection(),ranges=[];
    if(selection)for(let index=0;index<selection.rangeCount;index++)ranges.push(selection.getRangeAt(index).cloneRange());
    const field=document.createElement('textarea');field.value=text;field.readOnly=true;field.tabIndex=-1;
    field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;inset:0 auto auto -10000px;opacity:0;pointer-events:none';
    document.body.append(field);
    let copied=false;
    try{field.select();copied=document.execCommand('copy');}
    finally{field.remove();try{active?.focus({preventScroll:true});}catch{active?.focus();}if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}}
    if(!copied)throw Error('클립보드 복사에 실패했습니다.');
  }
  window.CompanyClipboard=Object.freeze({copyText});
})();
