import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, build } from './build-ui.mjs';
import { validateCatalog } from './check-architecture.mjs';
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function template({service,title}) {
  return `<!doctype html>
<html lang="ko"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <script src="https://company.example.com/js/company-workspace.js?v=generated"></script>
  <link rel="stylesheet" href="https://company.example.com/css/company-workspace.css?v=generated">
</head><body>
  <div data-company-workspace data-company-service="${service}"></div>
  <aside class="cw-sidebar" data-workspace-navigation="${service}"></aside>
  <main class="cw-main"><header><h1>${escape(title)}</h1></header><section aria-label="페이지 내용"><div data-workspace-state="empty" data-state-title="페이지 준비 중" data-state-message="업무 내용을 연결해 주세요."></div></section></main>
</body></html>
`;
}
export function create(service,slug,title) {
  if(!['cs','statistics','sheet','schedule','home','leave'].includes(service))throw Error('Unknown service. Register and verify its shared adapter before scaffolding pages.');
  if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)||!title?.trim())throw Error('Usage: npm run page:new -- <cs|statistics|sheet|schedule|home|leave> <slug> "제목"');
  const pagesPath=resolve(root,'packages/contracts/pages.json');
  const registry=JSON.parse(readFileSync(pagesPath,'utf8'));
  const services=JSON.parse(readFileSync(resolve(root,'packages/contracts/services.json'),'utf8')).services;
  const adapter=services.find(s=>s.id===service);
  const spa=adapter?.adapter==='static-spa';
  const react=adapter?.adapter==='react';
  const razor=adapter?.adapter==='razor';
  const page={id:service+'.'+slug.replaceAll('-','.'),service,path:'/'+slug,title:title.trim(),permission:adapter?.permission,icon:spa?'chart':'log',entry:`apps/${adapter?.app}/public/${spa?'index':slug}.html`};
  if(spa||react)page.view=slug.replace(/-([a-z0-9])/g,(_,char)=>char.toUpperCase());
  if(react)page.entry=`apps/${adapter.app}/${adapter.client}/pages/${slug}.tsx`;
  if(razor){page.entry=`apps/${adapter.app}/Pages/Workspace/${slug}.cshtml`;page.policy=adapter.defaultPolicy;}
  const errors=validateCatalog({services,pages:[...registry.pages,page]});
  if(errors.length)throw Error(errors.join('\n'));
  const dest=resolve(root,page.entry);
  let body;
  if(spa) {
    body=readFileSync(dest,'utf8');
    if((body.match(/<\/main>/g)||[]).length!==1)throw Error('SPA adapter must have exactly one main closing landmark');
    if(body.includes(`data-page="${page.view}"`))throw Error('Refusing to overwrite existing SPA view '+page.view);
    const section=`  <section class="page hidden" data-page="${page.view}"><header class="page-heading"><h1>${escape(page.title)}</h1></header><section aria-label="페이지 내용"><div data-workspace-state="empty" data-state-title="페이지 준비 중" data-state-message="업무 내용을 연결해 주세요."></div></section></section>\n`;
    body=body.replace('</main>',section+'</main>');
  } else {
    if(existsSync(dest))throw Error('Refusing to overwrite '+page.entry);
    body=razor?`@page\n@using ${adapter.namespace}\n@{\n    var workspacePage = WorkspacePages.Resolve(ViewContext.RouteData.Values["page"] as string, Context.Request.Query)!;\n}\n<header class="cw-page-heading"><h1>@workspacePage.Title</h1></header>\n<section aria-label="페이지 내용"><div data-workspace-state="empty" data-state-title="페이지 준비 중" data-state-message="업무 내용을 연결해 주세요."></div></section>\n`:react?`import { WorkspaceState } from '../generated/workspace-state';\nexport default function Page() {\n  return <section><header><h1>{${JSON.stringify(page.title)}}</h1></header><WorkspaceState kind="empty" title="페이지 준비 중" message="업무 내용을 연결해 주세요." /></section>;\n}\n`:template(page);
  }
  mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,body);
  registry.pages.push(page); writeFileSync(pagesPath,JSON.stringify(registry,null,2)+'\n');
  build();
  console.log(`Created ${page.id} in ${page.entry}; route and shared navigation registered under ${page.permission}. Run npm run check, browser tests and ${service} tests before deployment.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) create(...process.argv.slice(2));
