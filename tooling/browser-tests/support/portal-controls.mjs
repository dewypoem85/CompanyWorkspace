import {expect} from '@playwright/test';

// The real Razor controls must consume shared styles in both create and edit.
// Entity pickers, checkboxes and image preparation have their own shared contracts.
export async function assertPortalControls(root) {
  const result=await root.evaluate(container=>{
    const probe=document.createElement('span');document.body.append(probe);
    const token=name=>{probe.style.backgroundColor=`var(--cw-${name})`;return getComputedStyle(probe).backgroundColor;};
    const palette=Object.fromEntries(['raised','text','muted','active','active-text','danger-bg','danger','hover'].map(name=>[name,token(name)]));
    const fields=[...container.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')].filter(node=>node.getClientRects().length).map(node=>{
      const style=getComputedStyle(node);return {name:node.name||node.getAttribute('aria-label'),shared:node.classList.contains('cw-form-control'),label:!!node.closest('.cw-form-field'),height:node.getBoundingClientRect().height,font:parseFloat(style.fontSize),background:style.backgroundColor,color:style.color};
    });
    const buttons=[...container.querySelectorAll('button.cw-button')].filter(node=>node.getClientRects().length).map(node=>{
      const style=getComputedStyle(node),disabled=node.matches(':disabled'),variant=node.dataset.variant;
      return {name:node.textContent,height:node.getBoundingClientRect().height,compact:node.dataset.size==='compact',background:style.backgroundColor,color:style.color,
        expectedBackground:disabled?palette.raised:variant==='primary'?palette.active:variant==='danger'?palette['danger-bg']:variant==='quiet'?(node.matches(':hover')?palette.hover:'rgba(0, 0, 0, 0)'):palette.raised,
        expectedColor:disabled?palette.muted:variant==='primary'?palette['active-text']:variant==='danger'?palette.danger:palette.text};
    });
    probe.remove();return {fields,buttons,palette};
  });
  expect(result.fields.length).toBeGreaterThan(0);
  for(const field of result.fields){
    expect(field.shared,field.name).toBe(true);expect(field.label,field.name).toBe(true);
    expect(field.height,field.name).toBeGreaterThanOrEqual(44);expect(field.font,field.name).toBeGreaterThanOrEqual(13);
    expect(field.background,field.name).toBe(result.palette.raised);expect(field.color,field.name).toBe(result.palette.text);
  }
  for(const button of result.buttons){
    expect(button.height,button.name).toBeGreaterThanOrEqual(button.compact?32:44);
    expect(button.background,button.name).toBe(button.expectedBackground);expect(button.color,button.name).toBe(button.expectedColor);
  }
}
