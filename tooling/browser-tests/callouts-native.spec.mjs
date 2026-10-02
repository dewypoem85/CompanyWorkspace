import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {assertCallouts} from './support/callouts.mjs';

const css=readFileSync(resolve(root,'apps/portal/wwwroot/css/company-workspace.css'),'utf8');
const code='gzip-v1:33554432:'+('AbCd0123456789+/'.repeat(24));
for(const width of [320,390,720,1440])for(const theme of ['light','dark']){
  test(`native callouts ${width}px ${theme}`,async({browser},info)=>{
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:900}});
    try{
      const page=await context.newPage();
      // Theme resolution normally runs in the shared shell. Seed the selected theme
      // explicitly here to verify native CSS, not JavaScript theme initialization.
      await page.setContent(`<!doctype html><html lang="ko" data-theme="${theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main>${['neutral','info','warning','danger'].map(tone=>`<section class="cw-callout" data-tone="${tone}" role="note"><strong>${tone} · 줄바꿈이 필요한 긴 업무 안내 제목을 표시합니다</strong><p>원본 문자열과 공백 없는 코드도 보존합니다. <code>${code}</code> 안내 끝.</p></section>`).join('')}</main></body></html>`);
      await assertCallouts(page,4);
      for(const element of await page.locator('.cw-callout code').all())await expect(element).toHaveText(code);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      const boxes=await page.getByRole('note').evaluateAll(nodes=>nodes.map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,textBottom:node.querySelector('p').getBoundingClientRect().bottom})));
      boxes.forEach((box,index)=>{expect(box.textBottom).toBeLessThan(box.bottom);if(index)expect(box.top).toBeGreaterThanOrEqual(boxes[index-1].bottom);});
      await page.screenshot({path:info.outputPath('notes.png'),fullPage:true,animations:'disabled'});
    }finally{await context.close();}
  });
}
