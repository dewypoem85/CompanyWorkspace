import {expect} from '@playwright/test';

// Real consumer markup and styles, including fieldset-disabled inheritance.
export async function assertNativeButtons(buttons) {
  const rows=await buttons.evaluateAll(nodes=>{
    const probe=document.createElement('span');document.body.append(probe);
    const token=name=>{probe.style.color='var(--cw-'+name+')';return getComputedStyle(probe).color;};
    const palette=Object.fromEntries(['raised','text','muted','active','active-text','danger-bg','danger','hover'].map(name=>[name,token(name)]));
    const rows=nodes.filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>{
      const style=getComputedStyle(node),box=node.getBoundingClientRect(),disabled=node.matches(':disabled'),variant=node.dataset.variant;
      return {name:node.textContent.trim()||node.getAttribute('aria-label'),shared:node.classList.contains('cw-button'),
        radius:style.borderRadius,opacity:style.opacity,height:box.height,width:box.width,parentWidth:node.parentElement.getBoundingClientRect().width,compact:node.dataset.size==='compact',
        background:style.backgroundColor,color:style.color,
        expectedBackground:disabled?palette.raised:variant==='primary'?palette.active:variant==='danger'?palette['danger-bg']:variant==='quiet'?(node.matches(':hover')?palette.hover:'rgba(0, 0, 0, 0)'):palette.raised,
        expectedColor:disabled?palette.muted:variant==='primary'?palette['active-text']:variant==='danger'?palette.danger:palette.text};
    });probe.remove();return rows;
  });
  expect(rows.length).toBeGreaterThan(0);
  for(const row of rows){
    expect(row.name).toBeTruthy();expect(row.shared,row.name).toBe(true);
    expect(row.radius,row.name).toBe('8px');expect(row.opacity,row.name).toBe('1');
    expect(row.height,row.name).toBeGreaterThanOrEqual(row.compact?32:44);
    expect(row.width,row.name).toBeLessThanOrEqual(row.parentWidth+1);
    expect(row.background,row.name).toBe(row.expectedBackground);expect(row.color,row.name).toBe(row.expectedColor);
  }
}
