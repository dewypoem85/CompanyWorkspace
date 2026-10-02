import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

// The same real Razor documents and built CSS, but without application JavaScript.
// Theme is explicitly seeded because the runtime theme resolver is JavaScript.
// Long labels are synthetic layout stress data, not a different server contract.
for(const path of ['/Admin','/Admin/Security'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`native responsive records ${path} ${width} ${theme}`,async({browser},info)=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:900},colorScheme:theme});
  try{
    const page=await context.newPage(),requests=[];
    const catalog=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages;
    const model=JSON.parse(readFileSync(resolve(root,'artifacts/razor/leave.admin.json'),'utf8'));
    const definition=catalog.find(p=>p.service==='leave'&&p.path===path),document=model.pages.find(p=>p.id===definition.id);
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'){requests.push(request.method());return route.abort();}
      if(url.pathname===path)return route.fulfill({body:readFileSync(resolve(root,'artifacts/razor',document.file),'utf8').replace('<html lang="ko">',`<html lang="ko" data-theme="${theme}">`),contentType:'text/html'});
      const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,url.pathname.slice(1));
      if(file.startsWith(base+sep)&&existsSync(file)&&['.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:extname(file)==='.css'?'text/css':'image/svg+xml'});
      if(url.pathname!=='/favicon.ico')requests.push(url.pathname);return route.abort();
    });
    await page.goto('https://leave.workspace.test'+path);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const table=page.locator('table[data-layout]').first();
    await expect(table).toHaveAttribute('role','table');
    await expect(table.getByRole(path==='/Admin'?'columnheader':'rowheader').first()).toBeAttached();
    const token=await table.evaluate(node=>{
      const probe=document.createElement('span');probe.style.color='var(--cw-text)';node.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;
    });
    await expect(table.locator('td').first()).toHaveCSS('color',token);
    if(path==='/Admin'){
      const form=table.locator('form').first();
      await expect(form.locator('[name="__RequestVerificationToken"]')).toHaveCount(1);
      const before=await form.evaluate(node=>[...new FormData(node)].map(([key,value])=>[key,String(value)]));
      const cell=table.locator('td[data-label]').first(),long='아주 긴 직원 연결 정보와 현재 계정의 표시 상태를 설명하는 항목 제목';
      await cell.evaluate((node,label)=>{node.dataset.label=label;node.closest('table').querySelector('thead th').textContent=label;},long);
      if(width===320){
        await expect(cell).toHaveCSS('display','grid');
        const boxes=await cell.evaluate(node=>{
          const css=getComputedStyle(node,'::before'),probe=document.createElement('div');
          Object.assign(probe.style,{position:'absolute',visibility:'hidden',font:css.font,lineHeight:css.lineHeight,width:getComputedStyle(node).gridTemplateColumns.split(' ')[0],overflowWrap:'anywhere'});
          probe.textContent=node.dataset.label;document.body.append(probe);
          const result={label:probe.getBoundingClientRect().height,cell:node.getBoundingClientRect().height,next:node.nextElementSibling.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom};probe.remove();return result;
        });
        expect(boxes.label).toBeGreaterThan(50);expect(boxes.cell).toBeGreaterThanOrEqual(boxes.label+16);expect(boxes.next).toBeGreaterThanOrEqual(boxes.bottom-1);
      }
      expect(await form.evaluate(node=>[...new FormData(node)].map(([key,value])=>[key,String(value)]))).toEqual(before);
    }else if(width===320){
      const row=table.locator('tr').first(),header=await row.locator('th').boundingBox(),value=await row.locator('td').boundingBox();
      expect(value.y).toBeGreaterThanOrEqual(header.y+header.height-1);
    }
    await table.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('native-records.png'),animations:'disabled'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    expect(requests).toEqual([]);
  }finally{await context.close();}
});
