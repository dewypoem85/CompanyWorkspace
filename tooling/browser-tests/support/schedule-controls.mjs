import {expect} from '@playwright/test';

export async function assertScheduleModal(root) {
  const frame=await root.evaluate(dialog=>{
    const probe=document.createElement('span');dialog.append(probe);
    const token=(name,property)=>{probe.style[property]=`var(--cw-${name})`;return getComputedStyle(probe)[property];};
    const style=getComputedStyle(dialog),rect=dialog.getBoundingClientRect();
    const result={shared:dialog.classList.contains('cw-modal'),label:dialog.getAttribute('aria-label')||dialog.getAttribute('aria-labelledby'),
      background:style.backgroundColor,expectedBackground:token('surface','backgroundColor'),color:style.color,expectedColor:token('text','color'),
      backdrop:getComputedStyle(dialog,'::backdrop').backgroundColor,expectedBackdrop:token('backdrop','backgroundColor'),
      left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight,overflow:dialog.scrollWidth-dialog.clientWidth};
    probe.remove();return result;
  });
  expect(frame.shared).toBe(true);expect(frame.label).toBeTruthy();expect(frame.background).toBe(frame.expectedBackground);expect(frame.color).toBe(frame.expectedColor);
  expect(frame.backdrop).toBe(frame.expectedBackdrop);expect(frame.left).toBeGreaterThanOrEqual(-1);expect(frame.right).toBeLessThanOrEqual(frame.width+1);
  expect(frame.top).toBeGreaterThanOrEqual(-1);expect(frame.bottom).toBeLessThanOrEqual(frame.height+1);expect(frame.overflow).toBeLessThanOrEqual(1);
}

// Used for migrated release/TODO/task/editor/management/date-navigation and calendar roots.
// Entity picker/suggestion portals have separate owners; do not inspect them as native primitives.
export async function assertScheduleControls(root, {minFields=1,minButtons=1,buttonSelector='button:not([data-state-action])'}={}) {
  const modal=root.locator('xpath=ancestor-or-self::dialog[1]');
  if(await modal.count())await assertScheduleModal(modal);
  const result=await root.evaluate((container,buttonSelector)=>{
    const probe=document.createElement('span');document.body.append(probe);
    const token=name=>{probe.style.backgroundColor=`var(--cw-${name})`;return getComputedStyle(probe).backgroundColor;};
    const palette=Object.fromEntries(['raised','text','muted','active','active-text','danger-bg','danger','hover'].map(name=>[name,token(name)]));
    const visible=node=>node.getClientRects().length>0;
    const fields=[...container.querySelectorAll('input:not([type=checkbox]):not([type=hidden]),select,textarea')].filter(visible).map(node=>{
      const style=getComputedStyle(node);return {name:node.getAttribute('aria-label')||node.closest('label')?.textContent,shared:node.classList.contains('cw-form-control'),label:!!node.closest('.cw-form-field'),height:node.getBoundingClientRect().height,font:parseFloat(style.fontSize),color:style.color,background:style.backgroundColor};
    });
    const buttons=[...container.querySelectorAll(buttonSelector)].filter(visible).map(node=>{
      const style=getComputedStyle(node),variant=node.dataset.variant,disabled=node.matches(':disabled'),selected=node.getAttribute('aria-selected')==='true'||node.getAttribute('aria-pressed')==='true';
      const emphasis=node.dataset.emphasis,tint=node.matches(':hover')?23:emphasis==='low'?5:emphasis==='high'?24:13;
      probe.style.backgroundColor=`color-mix(in srgb,${style.getPropertyValue('--record-accent').trim()||'var(--cw-accent)'} ${tint}%,${palette.raised})`;
      const recordBackground=getComputedStyle(probe).backgroundColor;
      return {name:node.textContent,shared:node.classList.contains('cw-button'),height:node.getBoundingClientRect().height,compact:node.dataset.size==='compact',color:style.color,background:style.backgroundColor,opacity:style.opacity,
        expectedColor:disabled?palette.muted:selected||variant==='primary'?palette['active-text']:variant==='danger'?palette.danger:palette.text,
        expectedBackground:disabled?palette.raised:selected||variant==='primary'?palette.active:variant==='danger'?palette['danger-bg']:variant==='record'?recordBackground:variant==='quiet'?(node.matches(':hover')?palette.hover:'rgba(0, 0, 0, 0)'):palette.raised};
    });
    probe.remove();return {fields,buttons,palette};
  },buttonSelector);
  expect(result.fields.length).toBeGreaterThanOrEqual(minFields);expect(result.buttons.length).toBeGreaterThanOrEqual(minButtons);
  for(const textarea of await root.locator('.editor textarea').all())expect(await textarea.evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(140);
  for(const field of result.fields){expect(field.shared,field.name).toBe(true);expect(field.label,field.name).toBe(true);expect(field.height,field.name).toBeGreaterThanOrEqual(44);expect(field.font,field.name).toBeGreaterThanOrEqual(13);expect(field.background,field.name).toBe(result.palette.raised);expect(field.color,field.name).toBe(result.palette.text);}
  for(const button of result.buttons){expect(button.shared,button.name).toBe(true);expect(button.height,button.name).toBeGreaterThanOrEqual(button.compact?32:44);expect(button.background,button.name).toBe(button.expectedBackground);expect(button.color,button.name).toBe(button.expectedColor);expect(button.opacity,button.name).toBe('1');}
}

export async function assertTaskDateControls(root) {
  const dates=await root.locator('.date-input').evaluateAll(nodes=>nodes.map(node=>{
    const input=node.querySelector('input').getBoundingClientRect(),trigger=node.querySelector('button').getBoundingClientRect(),parent=node.getBoundingClientRect();
    return {inputWidth:input.width,inputHeight:input.height,triggerHeight:trigger.height,gap:trigger.left-input.right,overflow:trigger.right-parent.right};
  }));
  expect(dates).toHaveLength(2);
  for(const date of dates){expect(date.inputWidth).toBeGreaterThanOrEqual(120);expect(date.inputHeight).toBe(date.triggerHeight);expect(date.gap).toBeGreaterThanOrEqual(6);expect(date.overflow).toBeLessThanOrEqual(1);}
  expect(await root.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
}
