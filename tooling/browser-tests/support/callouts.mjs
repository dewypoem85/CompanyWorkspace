import {expect} from '@playwright/test';

export async function assertCallouts(page,expectedCount) {
  const notes=page.getByRole('note');await expect(notes).toHaveCount(expectedCount);
  const measurements=await notes.evaluateAll(nodes=>{
    const luminance=color=>{
      const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
      return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    };
    const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    return nodes.map(node=>{
      const bg=getComputedStyle(node).backgroundColor;
      return {className:node.className,tone:node.dataset.tone,live:node.getAttribute('aria-live'),hydrate:node.hasAttribute('data-workspace-state'),overflow:node.scrollWidth>node.clientWidth+1,
        texts:[...node.querySelectorAll('strong,p,code')].map(text=>({text:text.textContent,color:getComputedStyle(text).color,size:parseFloat(getComputedStyle(text).fontSize),contrast:ratio(getComputedStyle(text).color,bg)}))};
    });
  });
  for(const note of measurements){
    expect(note.className.split(' ')).toContain('cw-callout');expect(note.live).toBeNull();expect(note.hydrate).toBe(false);expect(note.overflow).toBe(false);
    expect(note.texts.length).toBeGreaterThanOrEqual(2);
    for(const text of note.texts){expect(text.size,text.text).toBeGreaterThanOrEqual(13);expect(text.contrast,text.text).toBeGreaterThanOrEqual(4.5);}
  }
}
