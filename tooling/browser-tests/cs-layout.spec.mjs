import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../build-ui.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');
const css=['apps/cs/public/styles.css','apps/cs/public/theme.css','packages/workspace-ui/src/company-workspace.css'].map(read);

for(const file of ['index.html','product-commands.html','playfab-logs.html','player-data.html']) {
  for(const width of [1080,390,320]) {
    test(`CS ${file} keeps its heading below the inner bar at ${width}px`,async({page})=>{
      await page.setViewportSize({width,height:700});
      await page.setContent(read(`apps/cs/public/${file}`).replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,''));
      for(const style of css)await page.addStyleTag({content:style});
      await page.evaluate(()=>{
        document.body.classList.add('has-company-workspace','cw-has-sidebar','company-service-cs');
        const header=document.createElement('div');header.className='cw-header';document.body.prepend(header);
      });
      const geometry=await page.evaluate(()=>{
        const box=selector=>document.querySelector(selector).getBoundingClientRect();
        const inner=box('.workspace-topbar'),heading=box('.page-header'),shared=box('.cw-header');
        return {innerTop:inner.top,innerBottom:inner.bottom,headingTop:heading.top,sharedBottom:shared.bottom,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      expect(geometry.innerTop).toBeGreaterThanOrEqual(geometry.sharedBottom-1);
      expect(geometry.headingTop).toBeGreaterThanOrEqual(geometry.innerBottom);
      expect(geometry.overflow).toBe(false);
    });
  }
}
