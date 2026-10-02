import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../build-ui.mjs';

const css=readFileSync(resolve(root,'packages/workspace-ui/src/company-workspace.css'),'utf8');

test('same-origin document navigation keeps a shared-frame view transition',async({page})=>{
  await page.route('https://navigation.workspace.test/**',route=>{
    const path=new URL(route.request().url()).pathname;
    route.fulfill({contentType:'text/html',body:`<!doctype html><style>${css}</style>
      <script>
        addEventListener('pageswap',event=>sessionStorage.setItem('workspace-swap',String(!!event.viewTransition)));
        addEventListener('pagereveal',event=>sessionStorage.setItem('workspace-reveal',String(!!event.viewTransition)));
      </script>
      <body class="has-company-workspace"><header class="cw-header">회사</header>
      <aside class="cw-sidebar"><a href="/next">다음 메뉴</a></aside><main>${path}</main></body>`});
  });
  await page.goto('https://navigation.workspace.test/start');
  await page.locator('.cw-sidebar a').click();
  await expect(page).toHaveURL('https://navigation.workspace.test/next');
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('workspace-reveal'))).toBe('true');
  expect(await page.evaluate(()=>sessionStorage.getItem('workspace-swap'))).toBe('true');
});
