import {expect} from '@playwright/test';

// Actual computed styles, not just class names. App-owned diff canvas geometry
// is the one transparent input; every standard control uses shared primitives.
export async function assertCsControls(page) {
  const result=await page.locator('main').evaluate(root=>{
    const probe=document.createElement('span');document.body.append(probe);
    const color=token=>{probe.style.backgroundColor=`var(${token})`;return getComputedStyle(probe).backgroundColor;};
    const palette=Object.fromEntries(['raised','text','muted','active','active-text','danger-bg','danger','accent','hover'].map(key=>[key,color('--cw-'+key)]));
    const visible=node=>node.getClientRects().length>0;
    const fields=[...root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]),select,textarea')].filter(visible).map(node=>{
      const style=getComputedStyle(node);return {id:node.id,shared:node.classList.contains('cw-form-control'),field:!!node.closest('.cw-form-field'),background:style.backgroundColor,color:style.color,font:parseFloat(style.fontSize),height:node.getBoundingClientRect().height,overlay:node.id==='jsonEditor',family:style.fontFamily};
    });
    const buttons=[...root.querySelectorAll('button:not([data-state-action])')].filter(visible).map(node=>{
      const style=getComputedStyle(node),disabled=node.matches(':disabled'),variant=node.dataset.variant;
      const selected=node.getAttribute('aria-pressed')==='true'||node.getAttribute('aria-selected')==='true';
      return {id:node.id||node.textContent,shared:node.classList.contains('cw-button'),height:node.getBoundingClientRect().height,compact:node.dataset.size==='compact',background:style.backgroundColor,color:style.color,
        expectedBackground:disabled?palette.raised:selected||variant==='primary'?palette.active:variant==='danger'?palette['danger-bg']:variant==='quiet'?(node.matches(':hover')?palette.hover:'rgba(0, 0, 0, 0)'):palette.raised,
        expectedColor:disabled?palette.muted:selected||variant==='primary'?palette['active-text']:variant==='danger'?palette.danger:palette.text};
    });
    probe.remove();return {fields,buttons,palette};
  });
  expect(result.fields.length).toBeGreaterThan(0);expect(result.buttons.length).toBeGreaterThan(0);
  for(const field of result.fields){
    expect(field.shared,field.id).toBe(true);expect(field.field,field.id).toBe(true);expect(field.font,field.id).toBeGreaterThanOrEqual(13);expect(field.height,field.id).toBeGreaterThanOrEqual(44);
    expect(field.background,field.id).toBe(field.overlay?'rgba(0, 0, 0, 0)':result.palette.raised);expect(field.color,field.id).toBe(result.palette.text);
    if(field.overlay)expect(field.family).toContain('Consolas');
  }
  for(const button of result.buttons){
    expect(button.shared,button.id).toBe(true);expect(button.height,button.id).toBeGreaterThanOrEqual(button.compact?32:44);
    expect(button.background,button.id).toBe(button.expectedBackground);expect(button.color,button.id).toBe(button.expectedColor);
  }
}

export async function assertCsStatePill(page, selector, tone) {
  const pill=page.locator(selector);
  await expect(pill).toHaveClass(/\bcw-state-pill\b/);
  await expect(pill).toHaveAttribute('data-tone',tone);
  const colors=await pill.evaluate((node,currentTone)=>{
    const probe=document.createElement('span');document.body.append(probe);
    const color=token=>{probe.style.backgroundColor=`var(${token})`;return getComputedStyle(probe).backgroundColor;};
    const tokens=currentTone==='neutral'?['--cw-raised','--cw-muted']:currentTone==='info'?['--cw-active','--cw-active-text']:[`--cw-${currentTone}-bg`,`--cw-${currentTone}`];
    const style=getComputedStyle(node),result={background:style.backgroundColor,color:style.color,expectedBackground:color(tokens[0]),expectedColor:color(tokens[1])};probe.remove();return result;
  },tone);
  expect(colors.background,selector).toBe(colors.expectedBackground);
  expect(colors.color,selector).toBe(colors.expectedColor);
}
