import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {root} from '../build-ui.mjs';
const projects=[{id:'56',name:'보관 프로젝트',archived:true},{id:'12',name:'던전슬래셔',archived:false},{id:'34',name:'두 번째 프로젝트',archived:false}];
const definitions=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(p=>p.service==='iap');
const matrixVersion=`matrix-${'a'.repeat(64)}`;
async function fixture(page,{linked=false,failed=false,publish=true,product=false,splitProducts=false,allowReviewUpload=false,remoteProducts=false,unconfiguredPrice=false,sheetWritable=true}={}){
  const writes=[],payloads=[],details=[],errors=[];let uploadedAsset=null,savedCsvPrice=false,catalogRevision='snapshot-1',lastPlan=null;page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){
      writes.push(path);
      if(request.headers()['content-type']?.startsWith('image/')){payloads.push({binaryBytes:request.postDataBuffer()?.length??0});if(allowReviewUpload){uploadedAsset={id:'review-123e4567-e89b-42d3-a456-426614174000.png',fileName:url.searchParams.get('fileName'),mimeType:'image/png',size:68,sha256:'synthetic',url:'/api/review-images/review-123e4567-e89b-42d3-a456-426614174000.png'};return route.fulfill({status:201,json:uploadedAsset});}}
      else payloads.push(request.postDataJSON());
      if(remoteProducts&&path==='/api/games/existing-id/remote-products/scan'){await new Promise(resolve=>setTimeout(resolve,250));return route.fulfill({status:201,json:{id:'scan-123',gameId:'existing-id',catalogRevision:'snapshot-1',scannedAt:'2026-09-15T09:00:00Z',expiresAt:'2026-09-15T09:10:00Z',sources:{google:{state:'ok',count:2},apple:{state:'ok',count:2},steam:{state:'ok',count:1}},products:[{id:'google-refresh',store:'google',remoteId:'starter',productKey:'starter',name:'Google 최신 이름',type:'consumable',description:'Google 최신 설명',localizations:{'ko-KR':{name:'Google 최신 이름',description:'Google 최신 설명'}},status:'active',prices:[{market:'KR',currency:'KRW',amount:'5500',availability:'AVAILABLE'}],priceState:'available',action:'refresh',catalogProductKey:'starter',message:'이 스토어의 현재 값을 플랫폼별 스냅샷으로 저장합니다.'},{id:'apple-refresh',store:'apple',remoteId:'starter',resourceId:'apple-uuid',productKey:'starter',name:'Apple 최신 이름',type:'consumable',description:'Apple 최신 설명',localizations:{'ko-KR':{name:'Apple 최신 이름',description:'Apple 최신 설명'}},status:'APPROVED',prices:[],priceState:'separate_request',priceMessage:'Apple 현재 가격은 상품별 가격 일정 API에서 별도로 확인합니다.',action:'refresh',catalogProductKey:'starter'},{id:'apple-second',store:'apple',remoteId:'store_only',resourceId:'apple-uuid-2',productKey:'store_only',name:'Apple 두 번째 상품',type:'consumable',description:'Apple 두 번째 설명',localizations:{'ko-KR':{name:'Apple 두 번째 상품',description:'Apple 두 번째 설명'}},status:'APPROVED',prices:[],priceState:'separate_request',priceMessage:'Apple 현재 가격은 상품별 가격 일정 API에서 별도로 확인합니다.',action:'new'},{id:'google-new',store:'google',remoteId:'store_only',productKey:'store_only',name:'스토어 전용',type:'unconfigured',description:'',localizations:{},status:'inactive',prices:[{market:'KR',currency:'KRW',amount:'1100'}],priceState:'available',action:'new'}]}});}
      if(remoteProducts&&path.startsWith('/api/games/existing-id/remote-products/scan-123/')&&path.endsWith('/price')){await new Promise(resolve=>setTimeout(resolve,150));const second=path.includes('/apple-second/');return route.fulfill({json:{prices:[{market:'KOR',currency:'KRW',amount:second?'11000':'5500'}],priceState:'available'}});}
      if(remoteProducts&&path==='/api/games/existing-id/remote-products/import'){catalogRevision='snapshot-2';return route.fulfill({json:{gameId:'existing-id',snapshotId:catalogRevision,missingKeys:[],products:[{productKey:'starter',name:'스타터',type:'consumable',description:'',webManaged:true,googleId:'starter',appleId:'starter',steamId:'1001',pricePresetKey:'P5500',gameReady:true,localizations:{}},{productKey:'store_only',name:'스토어 전용',type:'unconfigured',description:'',webManaged:true,googleId:'store_only',appleId:'store_only',pricePresetKey:'UNCONFIGURED',gameReady:false,localizations:{}}]}});}
      if(path==='/api/games/existing-id/content/starter'){savedCsvPrice=true;catalogRevision='snapshot-2';return route.fulfill({json:{gameId:'existing-id',snapshotId:catalogRevision,missingKeys:[],products:[{productKey:'starter',name:'스타터',type:'consumable',description:'상품 설명',webManaged:true,googleId:'starter',appleId:'starter',steamId:'1001',pricePresetKey:`CSV_5500_${'a'.repeat(64)}`,gameReady:true,localizations:{'ko-KR':{name:'스타터',description:'상품 설명'}}}]}});}
      if(path==='/api/games/existing-id/settings/starter/google'||path==='/api/games/existing-id/settings/starter/apple')return route.fulfill({json:request.postDataJSON()});
      if(path==='/api/create/plans'){
        const body=request.postDataJSON(),plannedProduct={productKey:body.productKeys[0],name:'신규 팩',type:'consumable',description:'신규 상품 설명',webManaged:true,googleId:'new_pack',appleId:'new_pack',steamId:'1002',pricePresetKey:'P5500',gameReady:true,localizations:{}},plannedPreset={key:'P5500',name:'기본',krw:'5500',google:{KR:{currency:'KRW',amount:'5500'}},apple:{KOR:{currency:'KRW',amount:'5500',pricePointId:'p',selectionId:'s'}},steam:{KRW:'5500'},version:'v1',confirmedAt:'2026-09-15T00:00:00Z',confirmedBy:'1'};
        lastPlan={id:'plan-1',mode:'create',game:{id:'existing-id',name:'던전슬래셔',portalProjectId:'12',spreadsheetId:'test_sheet-123',connectorKey:'fixture'},actorId:'1',createdAt:'2026-09-16T00:00:00Z',sourceHash:'source',connections:{},rows:body.stores.map(store=>({productKey:plannedProduct.productKey,store,remoteId:plannedProduct[`${store}Id`],before:null,desired:{product:plannedProduct,preset:plannedPreset,settings:{countries:[store==='apple'?'KOR':'KR'],localizations:{},priceOverrides:{},reviewNote:'',submitReview:false,activate:false}},action:'create',steps:[{key:'create',state:'pending'}],state:'pending'})),hash:'plan-hash'};
        return route.fulfill({status:201,json:lastPlan});
      }
      if(path==='/api/games/existing-id/products'){
        const body=request.postDataJSON();catalogRevision='snapshot-2';
        const created={productKey:body.productKey,name:body.name,sourceName:body.name,type:body.type,description:'',webManaged:true,googleId:body.googleId,appleId:body.appleId,steamId:body.steamId,pricePresetKey:'UNCONFIGURED',gameReady:false,localizations:{}};
        return route.fulfill({status:201,json:{catalog:{gameId:'existing-id',snapshotId:catalogRevision,missingKeys:[],products:[created]},product:created}});
      }
      if(path.endsWith('/visibility'))return route.fulfill({json:{gameId:'existing-id',productKey:path.split('/').at(-2),...request.postDataJSON()}});
      return route.fulfill({status:409,json:{error:'합성 검증에서 쓰기 차단'}});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:{authenticated:true,isAdmin:publish,csrfToken:'synthetic',user:{id:1,name:'검증 사용자',email:'test@example.test',role:publish?'admin':'employee'},profiles:{},projectIcons:{},projects,employees:[],services:[{key:'iap',name:'상품 관리',href:'/workspace/iap'}]}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/api/workspace/navigation')return route.fulfill({json:{pages:definitions.map(p=>p.id),badges:{}}});
    if(path==='/api/me')return route.fulfill({json:{actor:{id:'1',name:'검증 사용자',permissions:['iap.access',...(publish?['iap.publish']:[])]},demo:false}});
    if(path==='/api/projects')return route.fulfill(failed?{status:503,json:{error:'회사 프로젝트 조회 실패'}}:{json:projects});
    if(path==='/api/games')return route.fulfill({json:linked?[{id:'existing-id',name:'던전슬래셔',portalProjectId:'12',spreadsheetId:'test_sheet-123',connectorKey:'fixture'}]:[]});
    if(path==='/api/presets')return route.fulfill({json:product?[savedCsvPrice?{key:`CSV_5500_${'a'.repeat(64)}`,name:'5,500원',krw:'5500',google:{KR:{currency:'KRW',amount:'5500'},US:{currency:'USD',amount:'4.9'},JP:{currency:'JPY',amount:'640'}},apple:{KOR:{currency:'KRW',amount:'5500',pricePointId:'matrix-KOR-5500',selectionId:matrixVersion}},steam:{KRW:'5500',USD:'4.9',JPY:'640'},version:'v2',confirmedAt:'2026-09-15T00:00:00Z',confirmedBy:'1'}:{key:'P5500',name:'기본',krw:'5500',google:{KR:{currency:'KRW',amount:'5500'},US:{currency:'USD',amount:'3.99'}},apple:{KOR:{currency:'KRW',amount:'5500',pricePointId:'p',selectionId:'s'}},steam:{KRW:'5500',USD:'3.99'},version:'v1',confirmedAt:'2026-09-15T00:00:00Z',confirmedBy:'1'}]:[]});
    if(path==='/api/jobs')return route.fulfill({json:[]});
    if(path==='/api/plans/plan-1'&&lastPlan)return route.fulfill({json:lastPlan});
    if(path==='/api/price-matrix')return route.fulfill({json:{id:matrixVersion,sha256:'a'.repeat(64),sourceFile:'pricing-matrix.csv',territoryCount:175,currencyCount:43,sourceRowCount:809,points:[{id:'matrix-KOR-400',amount:'400',currency:'KRW'},{id:'matrix-KOR-5500',amount:'5500',currency:'KRW'},{id:'matrix-KOR-14900',amount:'14900',currency:'KRW'}]}});
    if(path.startsWith('/api/review-images/')){if(path.endsWith('/metadata'))return route.fulfill({json:uploadedAsset});const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');return route.fulfill({body:png,contentType:'image/png'});}
    if(path.startsWith('/api/games/')){details.push(path);if(path.endsWith('/products/starter/apple-price-points')){await new Promise(resolve=>setTimeout(resolve,150));return route.fulfill({json:{id:'apple-live-list',gameId:'existing-id',productId:'apple-uuid',territory:'KOR',points:[{id:'apple-standard',amount:'5500',currency:'KRW'},{id:'apple-extended',amount:'9000000',currency:'KRW'}]}});}if(path.endsWith('/store-details'))return route.fulfill({json:unconfiguredPrice?[{id:'existing-id:starter:google',data:{gameId:'existing-id',productKey:'starter',store:'google',remoteId:'starter',name:'스토어 한국어 이름',type:'consumable',description:'스토어 한국어 설명',localizations:{'ko-KR':{name:'스토어 한국어 이름',description:'스토어 한국어 설명'},'en-US':{name:'Store English Name',description:'Store English Description'}},prices:[{market:'KR',currency:'KRW',amount:'14900'}],priceState:'available',scannedAt:'2026-09-15T09:00:00Z'}}]:[]});if(product&&path.endsWith('/catalog'))return route.fulfill({json:{gameId:'existing-id',snapshotId:catalogRevision,missingKeys:[],products:[{productKey:'starter',name:'스타터',type:'consumable',description:'',webManaged:true,googleId:'starter',appleId:'starter',steamId:'1001',pricePresetKey:unconfiguredPrice?'UNCONFIGURED':savedCsvPrice?`CSV_5500_${'a'.repeat(64)}`:'P5500',gameReady:true,localizations:{}},...(splitProducts?[{productKey:'new_pack',name:'신규 팩',type:'consumable',description:'',webManaged:true,googleId:'new_pack',appleId:'new_pack',steamId:'1002',pricePresetKey:'P5500',gameReady:true,localizations:{}}]:[])]}});if(product&&path.endsWith('/upload-status')){await new Promise(resolve=>setTimeout(resolve,300));return route.fulfill({json:[{productKey:'starter',state:'uploaded',stores:{google:{state:'uploaded'},apple:{state:'uploaded'},steam:{state:'uploaded'}}},...(splitProducts?[{productKey:'new_pack',state:'not_uploaded',stores:{google:{state:'missing'},apple:{state:'missing'},steam:{state:'missing'}}}]:[])]});}if(product&&path.endsWith('/product-visibility'))return route.fulfill({json:{hiddenKeys:[]}});if(product&&path.endsWith('/settings'))return route.fulfill({json:[]});if(path.includes('/apple-territories'))return route.fulfill({json:{territories:[{code:'KOR',name:'대한민국',englishName:'South Korea',currency:'KRW',search:'대한민국 south korea kr kor krw'},{code:'USA',name:'미국',englishName:'United States',currency:'USD',search:'미국 united states us usa usd'},{code:'JPN',name:'일본',englishName:'Japan',currency:'JPY',search:'일본 japan jp jpn jpy'}]}});return route.fulfill({json:path.endsWith('/connections')?{google:{connected:true},apple:{connected:true},steam:{connected:true},sheets:{connected:true,writesEnabled:sheetWritable}}:null});}
    const shared={'/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js','/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js','/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css'}[path];
    if(url.origin==='https://company.example.com'&&path==='/images/company-logo.png')return route.fulfill({body:readFileSync(resolve(root,'apps/portal/wwwroot/images/company-logo.png')),contentType:'image/png'});
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    if(url.hostname==='iap.workspace.test'&&!path.startsWith('/api/')){const asset=path.startsWith('/assets/')?path.slice(1):'index.html';return route.fulfill({body:readFileSync(resolve(root,'apps/iap/dist/client',asset)),contentType:extname(asset)==='.css'?'text/css':extname(asset)==='.js'?'application/javascript':'text/html'});}
    return route.abort();
  });return {writes,payloads,details,errors};
}
for(const definition of definitions)test(`IAP shared shell ${definition.id} 390px dark`,async({page})=>{
  await page.setViewportSize({width:390,height:900});await page.emulateMedia({colorScheme:'dark'});
  const f=await fixture(page);
  const path=definition.path.replace(':gameId','existing-id').replace(':productKey','starter').replace(':planId','plan-1');
  await page.goto('https://iap.workspace.test'+path);
  await expect(page.locator('.cw-header')).toHaveCount(1);
  await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  const gap=await page.evaluate(()=>document.querySelector('.iap-app').getBoundingClientRect().top-document.querySelector('.cw-header').getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(-1);
  expect(f.errors).toEqual([]);
});
for(const [width,theme] of [[390,'dark'],[1440,'light']])test(`IAP 회사 프로젝트 두 개를 연결 전에도 검색·선택 ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  await page.goto('https://iap.workspace.test/');const sidebar=page.locator('.cw-sidebar');
  if(width<=900)await page.locator('[data-cw-nav]').click();
  await expect(sidebar).toBeVisible();await expect(sidebar.locator('[data-workspace-page]')).toHaveCount(4);
  for(const label of ['상품 목록','가격 데이터 버전','업로드 이력','프로젝트·연결'])await expect(sidebar.getByText(label,{exact:true})).toBeVisible();
  if(width<=900)await page.locator('[data-cw-nav]').click();
  const select=page.getByRole('combobox',{name:'프로젝트 선택',exact:true});await expect(select).toBeEnabled();await expect(select).toHaveValue('');await expect(select.locator('option')).toHaveCount(3);
  await select.press('Enter');const dialog=page.getByRole('dialog',{name:'프로젝트 선택',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('searchbox').fill('ㄷㅂㅉ');await dialog.getByRole('option',{name:'두 번째 프로젝트 (IAP 연결 필요)'}).click();
  await expect(select).toHaveValue('34');await expect(page.getByText('두 번째 프로젝트 · IAP 연결이 필요합니다',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'프로젝트 연결 설정',exact:true}).click();await expect(page.getByRole('combobox',{name:'회사 프로젝트',exact:true})).toHaveValue('34');
  await page.screenshot({path:info.outputPath('company-projects.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.writes).toEqual([]);expect(f.details).toEqual([]);expect(f.errors).toEqual([]);
});
test('IAP 기존 연결만 내부 game ID로 조회하고 미연결 선택 시 이전 상품을 제거',async({page})=>{
  const f=await fixture(page,{linked:true});await page.goto('https://iap.workspace.test/');await expect(page.getByRole('heading',{name:'던전슬래셔 상품'})).toBeVisible();
  const projects=page.getByRole('combobox',{name:'프로젝트 선택',exact:true});await expect(projects).toHaveValue('12');await expect(projects.locator('option')).toHaveText(['프로젝트 선택','던전슬래셔','두 번째 프로젝트 (IAP 연결 필요)']);
  const sheetLink=page.getByRole('link',{name:'던전슬래셔 연결 시트 새 탭으로 열기'});await expect(sheetLink).toHaveAttribute('href','https://docs.google.com/spreadsheets/d/test_sheet-123/edit');await expect(sheetLink).toHaveAttribute('target','_blank');await expect(sheetLink).toHaveAttribute('rel','noopener noreferrer');
  await page.getByRole('combobox',{name:'프로젝트 선택',exact:true}).selectOption('34');await expect(page.getByRole('heading',{name:'던전슬래셔 상품'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'연결 시트 없음'})).toBeDisabled();await expect(page.getByRole('link',{name:/연결 시트 새 탭으로 열기/})).toHaveCount(0);
  expect(f.details.every(path=>path.startsWith('/api/games/existing-id/'))).toBe(true);expect(f.writes).toEqual([]);
});
test('IAP 모바일 상품 카드와 상세 설정은 상태 문구를 유지하고 가로로 넘치지 않는다',async({page},info)=>{
  await page.setViewportSize({width:390,height:850});await page.emulateMedia({colorScheme:'dark'});const f=await fixture(page,{linked:true,product:true,splitProducts:true});await page.goto('https://iap.workspace.test/');
  const card=page.locator('.product-card').filter({hasText:'스타터'});await expect(card.getByText('Google Play',{exact:true})).toHaveCount(0);await expect(card.locator('.store-presence').first()).toContainText('등록됨');
  await expect(card.locator('.store-presence').first()).toHaveCSS('font-size','11px');await page.screenshot({path:info.outputPath('mobile-product-cards.png'),animations:'disabled'});
  await card.getByRole('button',{name:'상품 설정 열기'}).click();await expect(page.getByRole('navigation',{name:'상품 상세 설정'})).toBeVisible();await page.getByRole('button',{name:'상품 내용',exact:true}).click();
  await expect(page.getByLabel('기본 상품명 (한국어)')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('mobile-product-detail.png'),animations:'disabled'});expect(f.errors).toEqual([]);
});
test('IAP 상품을 업로드 상태별로 분리하고 숨김을 복구하며 세 플랫폼을 기본 선택',async({page},info)=>{
  const f=await fixture(page,{linked:true,product:true,splitProducts:true});await page.goto('https://iap.workspace.test/');
  const required=page.locator('.product-group.not_uploaded'),uploaded=page.locator('.product-group.uploaded');
  await expect(required.getByRole('heading',{name:'업로드 필요'})).toBeVisible();await expect(required.getByText('신규 팩',{exact:true})).toBeVisible();
  await expect(uploaded.getByRole('heading',{name:'업로드 완료'})).toBeVisible();await expect(uploaded.getByText('스타터',{exact:true})).toBeVisible();
  for(const store of ['Google Play','App Store','Steam'])await expect(page.locator('.store-checks label').filter({hasText:store}).locator('input')).toBeChecked();
  await uploaded.getByRole('button',{name:'목록에서 숨기기'}).click();await expect(page.getByRole('status')).toContainText('상품을 웹 목록에서 숨겼습니다.');await expect(page.locator('.product-group.uploaded')).toHaveCount(0);
  await page.getByRole('button',{name:'숨긴 상품 1개 보기'}).click();const hidden=page.locator('.hidden-products');await expect(hidden.getByText('스타터',{exact:true})).toBeVisible();await hidden.getByRole('button',{name:'다시 표시'}).click();await expect(page.locator('.product-group.uploaded')).toBeVisible();
  await page.screenshot({path:info.outputPath('grouped-products.png'),animations:'disabled',fullPage:true});
  expect(f.writes).toEqual(['/api/games/existing-id/products/starter/visibility','/api/games/existing-id/products/starter/visibility']);expect(f.payloads).toEqual([{hidden:true},{hidden:false}]);expect(f.errors).toEqual([]);
});
test('IAP 상품 목록 진입 시 플랫폼 상태를 자동 확인하고 완료 전에는 실패로 표시하지 않는다',async({page},info)=>{
  const f=await fixture(page,{linked:true,product:true});await page.goto('https://iap.workspace.test/');await expect(page.getByRole('status')).toContainText('스토어 등록 상태를 확인하고 있습니다.');
  for(const store of ['G','A','S'])await expect(page.locator('.store-presence').filter({hasText:`${store}확인 중`})).toBeVisible();await page.screenshot({path:info.outputPath('platform-status-checking.png'),animations:'disabled'});
  await expect(page.locator('.product-group.uploaded')).toBeVisible();await expect(page.locator('.store-presence.unknown')).toHaveCount(0);for(const store of ['G','A','S'])await expect(page.locator('.store-presence').filter({hasText:`${store}등록됨`})).toBeVisible();await page.screenshot({path:info.outputPath('platform-status-complete.png'),animations:'disabled'});
  expect(f.details).toContain('/api/games/existing-id/upload-status');expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
test('IAP 새 상품을 확인한 시트 행으로 추가하고 독립 상세 페이지로 이동',async({page},info)=>{
  const f=await fixture(page,{linked:true,product:true});await page.goto('https://iap.workspace.test/');await page.getByRole('button',{name:'＋ 새 상품 추가'}).click();
  await expect(page).toHaveURL(/\/projects\/existing-id\/products\/new$/);await page.getByLabel('결제 키').fill('monthly_pack');await page.getByLabel('시트 식별용 이름').fill('월간 상품');await page.getByLabel('Google Play 상품 ID').fill('monthly_pack');await page.getByLabel('App Store 상품 ID').fill('monthly_pack');await page.getByLabel('Steam 숫자 ID').fill('2001');
  await page.getByRole('button',{name:'추가 내용 확인 →'}).click();const row=page.getByRole('table',{name:'추가할 상품 시트 행'});await expect(row).toContainText('monthly_pack');await expect(row).toContainText('2001');await page.getByRole('button',{name:'상품 원본 추가'}).click();
  await expect(page).toHaveURL(/\/projects\/existing-id\/products\/monthly_pack$/);await expect(page.getByRole('heading',{name:'월간 상품',level:2})).toBeVisible();await expect(page.getByRole('button',{name:'상품 내용',exact:true})).toHaveAttribute('aria-current','page');await page.screenshot({path:info.outputPath('new-product-detail.png'),animations:'disabled',fullPage:true});
  expect(f.writes).toEqual(['/api/games/existing-id/products']);expect(f.payloads).toEqual([{revision:'snapshot-1',productKey:'monthly_pack',name:'월간 상품',type:'consumable',googleId:'monthly_pack',appleId:'monthly_pack',steamId:'2001'}]);expect(f.errors).toEqual([]);
});
test('IAP 상품 상세 주소로 직접 진입하고 뒤로 가기로 목록에 복귀한다',async({page})=>{
  const f=await fixture(page,{linked:true,product:true});await page.goto('https://iap.workspace.test/');await page.goto('https://iap.workspace.test/projects/existing-id/products/starter');
  await expect(page.getByRole('heading',{name:'스타터',level:2})).toBeVisible();await expect(page.getByRole('button',{name:'개요',exact:true})).toHaveAttribute('aria-current','page');
  await page.goBack();await expect(page).toHaveURL('https://iap.workspace.test/');await expect(page.getByRole('heading',{name:'던전슬래셔 상품'})).toBeVisible();expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
test('IAP 세 플랫폼 업로드 계획을 독립 페이지에서 다시 불러온다',async({page})=>{
  const f=await fixture(page,{linked:true,product:true,splitProducts:true});await page.goto('https://iap.workspace.test/');await page.getByLabel('신규 팩 선택').check();await page.getByRole('button',{name:'선택 플랫폼 등록 검토 →'}).click();
  await expect(page).toHaveURL(/\/plans\/plan-1$/);await expect(page.getByRole('heading',{name:'업로드 계획 검토',level:2})).toBeVisible();for(const label of ['Google Play · new_pack','App Store · new_pack','Steam · 1002'])await expect(page.getByText(label,{exact:true})).toBeVisible();await expect(page.getByText('신규 생성',{exact:true})).toHaveCount(3);
  await page.reload();await expect(page.getByRole('heading',{name:'업로드 계획 검토',level:2})).toBeVisible();expect(f.writes).toEqual(['/api/create/plans']);expect(f.payloads).toEqual([{gameId:'existing-id',productKeys:['new_pack'],stores:['google','apple','steam']}]);expect(f.errors).toEqual([]);
});
test('IAP 스토어 번역을 상품 편집기에 불러온다',async({page},info)=>{
  const f=await fixture(page,{linked:true,product:true,unconfiguredPrice:true});await page.goto('https://iap.workspace.test/');await page.getByRole('button',{name:'상품 설정 열기'}).click();await page.getByRole('button',{name:'상품 내용',exact:true}).click();
  await expect(page.getByRole('heading',{name:'스토어 번역 가져오기'})).toBeVisible();await page.getByRole('button',{name:'Google Play 번역 2개 불러오기'}).click();
  await expect(page.getByLabel('기본 상품명 (한국어)')).toHaveValue('스토어 한국어 이름');await expect(page.getByLabel('기본 설명 (한국어)')).toHaveValue('스토어 한국어 설명');await expect(page.getByText('영어 (미국) · en-US')).toBeVisible();await expect(page.locator('.store-source-notice')).toContainText('상품 내용 저장을 눌러야 반영됩니다.');
  await page.screenshot({path:info.outputPath('store-translation-import.png'),animations:'disabled',fullPage:true});expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
test('IAP 상세의 저장하지 않은 변경은 섹션 이동과 프로젝트 전환을 막는다',async({page})=>{
  const f=await fixture(page,{linked:true,product:true});await page.goto('https://iap.workspace.test/');await page.getByRole('button',{name:'상품 설정 열기'}).click();await page.getByRole('button',{name:'상품 내용',exact:true}).click();await page.getByLabel('기본 설명 (한국어)').fill('저장 전 설명');
  await expect(page.getByText('저장하지 않은 변경',{exact:true})).toBeVisible();await page.getByRole('button',{name:'가격',exact:true}).click();let dialog=page.getByRole('dialog',{name:'저장하지 않은 변경을 버릴까요?'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'취소'}).click();await expect(page.getByLabel('기본 설명 (한국어)')).toHaveValue('저장 전 설명');
  await page.getByRole('combobox',{name:'프로젝트 선택',exact:true}).selectOption('34');dialog=page.getByRole('dialog',{name:'저장하지 않은 변경을 버릴까요?'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'취소'}).click();await expect(page.getByRole('combobox',{name:'프로젝트 선택',exact:true})).toHaveValue('12');expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
for(const [width,theme] of [[390,'dark'],[1440,'light']])test(`IAP 스토어별 등록 정보를 모두 웹에 저장 ${width}px ${theme}`,async({page},info)=>{await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{linked:true,product:true,remoteProducts:true});await page.goto('https://iap.workspace.test/');await page.getByRole('button',{name:'스토어에서 가져오기'}).click();await expect(page.locator('.iap-toast .cw-feedback')).toHaveAttribute('data-state-kind','loading');await expect(page.locator('.iap-toast')).toContainText('스토어 상품 확인 중');await expect(page.locator('.iap-toast .cw-feedback')).toHaveAttribute('data-state-kind','success');await expect(page.locator('.iap-toast')).toContainText('플랫폼별 등록 정보');const result=page.getByRole('region',{name:'스토어 상품 확인 결과'});await expect(result).toBeVisible();await expect(result.getByText('Google Play · 2개',{exact:true})).toBeVisible();const google=result.locator('.remote-product-row').filter({hasText:'Google 최신 이름'}),apple=result.locator('.remote-product-row').filter({hasText:'Apple 최신 이름'}),appleSecond=result.locator('.remote-product-row').filter({hasText:'Apple 두 번째 상품'});await expect(google.getByText('등록값 갱신',{exact:true})).toBeVisible();await expect(google.getByText('5,500 KRW',{exact:true})).toBeVisible();await expect(apple.getByText('가격 미조회',{exact:true})).toBeVisible();await expect(result.locator('input[type=checkbox]')).toHaveCount(0);await result.getByRole('button',{name:'App Store 현재 가격 전체 읽기',exact:true}).click();await expect(page.locator('.iap-toast')).toContainText('App Store 현재 가격 전체 읽기');await expect(page.locator('.notice')).toContainText('App Store 상품 2개의 현재 한국 가격을 모두 읽었습니다.');await expect(apple.getByText('5,500 KRW',{exact:true})).toBeVisible();await expect(appleSecond.getByText('11,000 KRW',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('remote-product-scan.png'),animations:'disabled',fullPage:true});await result.getByRole('button',{name:'연결 가능한 4개 정보 저장'}).click();await expect(page.locator('.notice')).toContainText('플랫폼별로 웹에 저장했습니다.');await expect(page.locator('.iap-toast')).toContainText('원격 스토어는 변경하지 않았습니다.');await expect(page.getByText('스토어 전용',{exact:true})).toBeVisible();await page.getByText('게임 프로젝트 적용 확인 (업로드 전 필수)',{exact:true}).click();await expect(page.getByText('실제 게임 빌드의 보상·구매 제한·해금 조건·상점 UI에 연결됐는지 확인하는 단계입니다.')).toBeVisible();await page.screenshot({path:info.outputPath('remote-product-import.png'),animations:'disabled',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.writes).toEqual(['/api/games/existing-id/remote-products/scan','/api/games/existing-id/remote-products/scan-123/apple-refresh/price','/api/games/existing-id/remote-products/scan-123/apple-second/price','/api/games/existing-id/remote-products/import']);expect(f.payloads).toEqual([{}, {}, {}, {scanId:'scan-123'}]);expect(f.errors).toEqual([]);});
test('IAP 프로젝트 조회 실패는 빈 목록으로 숨기지 않는다',async({page})=>{
  await fixture(page,{failed:true});await page.goto('https://iap.workspace.test/');await expect(page.locator('.error[role=alert]')).toContainText('회사 프로젝트 조회 실패');await expect(page.getByRole('combobox',{name:'프로젝트 선택',exact:true})).toBeDisabled();await expect(page.getByText('선택 가능한 회사 프로젝트가 없습니다',{exact:true})).toHaveCount(0);
});
test('IAP 조회 권한 사용자는 프로젝트를 선택할 수 있지만 연결 쓰기를 시작하지 못한다',async({page})=>{
  const f=await fixture(page,{publish:false});await page.goto('https://iap.workspace.test/');const projects=page.getByRole('combobox',{name:'프로젝트 선택',exact:true});await expect(projects).toBeEnabled();await expect(projects).toHaveValue('');await projects.selectOption('12');await expect(page.getByText('상품 배포 권한이 있는 담당자에게 IAP 연결을 요청해 주세요.')).toBeVisible();await expect(page.getByRole('button',{name:'프로젝트 연결 설정',exact:true})).toHaveCount(0);expect(f.writes).toEqual([]);
});

for(const [width,theme] of [[390,'dark'],[1440,'light']])test(`IAP 입력 도움말 호버·키보드·클릭과 URL 입력 ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  await page.goto('https://iap.workspace.test/');await page.getByRole('combobox',{name:'프로젝트 선택',exact:true}).selectOption('12');await page.getByRole('button',{name:'프로젝트 연결 설정',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'회사 프로젝트',exact:true}).locator('option')).toHaveText(['프로젝트 선택','던전슬래셔','두 번째 프로젝트','보관 프로젝트 (보관됨)']);
  const help=page.getByRole('button',{name:'상품 시트 주소 또는 ID 입력 도움말',exact:true});
  await help.hover();await expect(help).toHaveAttribute('aria-expanded','true');await expect(page.getByText('gid=0',{exact:true})).toBeVisible();
  await page.getByRole('heading',{name:'새 프로젝트의 IAP 연결 설정',exact:true}).hover();await expect(help).toHaveAttribute('aria-expanded','false');
  await help.focus();await expect(help).toHaveAttribute('aria-expanded','true');await help.press('Escape');await expect(help).toHaveAttribute('aria-expanded','false');
  await help.click();await page.getByLabel('상품 시트 주소 또는 ID',{exact:true}).fill('https://docs.google.com/spreadsheets/d/test_sheet-123/edit?gid=0#gid=0');await expect(help).toHaveAttribute('aria-expanded','true');
  const profileHelp=page.getByRole('button',{name:'서버 연결 프로필 키 입력 도움말',exact:true});await profileHelp.click();await expect(page.getByText('dungeon-slasher',{exact:true})).toBeVisible();
  await page.getByLabel('서버 연결 프로필 키',{exact:true}).fill(' dungeon-slasher ');await expect(profileHelp).toHaveAttribute('aria-expanded','true');
  await page.screenshot({path:info.outputPath('connection-help.png'),animations:'disabled',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'선택한 프로젝트 연결 추가',exact:true}).click();await expect(page.getByRole('alert')).toContainText('합성 검증에서 쓰기 차단');
  expect(f.payloads).toEqual([{id:'project-12',portalProjectId:'12',name:'던전슬래셔',spreadsheetId:'test_sheet-123',connectorKey:'dungeon-slasher'}]);
  await expect(page.getByLabel('상품 시트 주소 또는 ID',{exact:true})).toHaveValue('https://docs.google.com/spreadsheets/d/test_sheet-123/edit?gid=0#gid=0');expect(f.errors).toEqual([]);
});
test('IAP 잘못된 시트 주소는 초안을 유지하고 저장 요청을 보내지 않는다',async({page})=>{
  const f=await fixture(page);await page.goto('https://iap.workspace.test/');await page.getByRole('combobox',{name:'프로젝트 선택',exact:true}).selectOption('12');await page.getByRole('button',{name:'프로젝트 연결 설정',exact:true}).click();
  await page.getByLabel('상품 시트 주소 또는 ID',{exact:true}).fill('https://example.com/not-a-sheet');await page.getByLabel('서버 연결 프로필 키',{exact:true}).fill('dungeon-slasher');await page.getByRole('button',{name:'선택한 프로젝트 연결 추가',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Google 시트 주소 전체 또는 문서 ID');expect(f.writes).toEqual([]);await expect(page.getByLabel('상품 시트 주소 또는 ID',{exact:true})).toHaveValue('https://example.com/not-a-sheet');
});

test('IAP Google 앱 판매 지역 표시와 App Store 전체 선택·심사 이미지 업로드',async({page})=>{
  const f=await fixture(page,{linked:true,product:true,allowReviewUpload:true});await page.goto('https://iap.workspace.test/');
  await page.getByRole('button',{name:'상품 설정 열기',exact:true}).click();await page.getByRole('button',{name:'스토어 설정',exact:true}).click();await expect(page.getByText('Google Play 판매 지역은 앱 설정을 따릅니다')).toBeVisible();await expect(page.getByRole('searchbox',{name:'Google Play 국가 검색'})).toHaveCount(0);
  await page.getByRole('tab',{name:'App Store',exact:true}).click();await expect(page.getByLabel('선택된 판매 지역').getByText(/KOR · KRW/)).toBeVisible();await page.getByRole('button',{name:'제공 지역 전체 선택'}).click();await expect(page.getByLabel('선택된 판매 지역').locator('.selected-region')).toHaveCount(3);await expect(page.getByLabel('선택된 판매 지역').getByText(/USA · USD/)).toBeVisible();await expect(page.getByText('등록된 심사 이미지 이름',{exact:true})).toHaveCount(0);const input=page.getByLabel('App Store 심사 이미지 선택');await input.setInputFiles({name:'심사.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});await expect(page.getByAltText('선택한 App Store 심사 이미지 미리보기')).toBeVisible();await expect(page.getByText('심사.png',{exact:true})).toBeVisible();
  expect(f.writes).toContain('/api/games/existing-id/products/starter/review-images');expect(f.payloads.at(-1)).toEqual({binaryBytes:68});expect(f.errors).toEqual([]);
});

test('IAP 상품 설정에서 제공 CSV 가격을 직접 선택하고 저장',async({page},info)=>{
  const f=await fixture(page,{linked:true,product:true});await page.goto('https://iap.workspace.test/');
  await page.getByText('가격 데이터 버전',{exact:true}).click();await expect(page.getByRole('heading',{name:'가격 데이터 버전',level:1})).toBeVisible();await expect(page.getByText('pricing-matrix.csv',{exact:true})).toBeVisible();await expect(page.getByText('가격을 만들거나 별도로 확정하는 단계는 없습니다. 상품 목록에서 상품을 열어 가격을 선택하세요.')).toBeVisible();await expect(page.getByRole('combobox',{name:'대한민국 판매 가격'})).toHaveCount(0);await page.screenshot({path:info.outputPath('price-data-version.png'),animations:'disabled',fullPage:true});
  await page.getByText('상품 목록',{exact:true}).click();await page.getByRole('button',{name:'상품 설정 열기',exact:true}).click();await page.getByRole('button',{name:'가격',exact:true}).click();
  const price=page.getByRole('combobox',{name:'대한민국 판매 가격'});await expect(price).toHaveValue('5,500원');await price.click();await expect(price).toHaveValue('');await price.fill('5,500');await expect(page.getByRole('listbox',{name:'대한민국 판매 가격 검색 결과'})).toBeVisible();await expect(page.getByRole('option',{name:'5,500원'})).toBeVisible();await expect(page.getByRole('option',{name:'400원'})).toHaveCount(0);await page.screenshot({path:info.outputPath('product-price-search.png'),animations:'disabled',fullPage:true});await price.press('ArrowDown');await price.press('Enter');await expect(price).toHaveValue('5,500원');
  await expect(page.getByText(/제공 CSV · 3개 가격 · 175개 국가 · 43개 통화/)).toBeVisible();await page.getByRole('button',{name:'가격 저장',exact:true}).click();
  await expect(page.locator('.notice')).toContainText('CSV 기본 가격을 저장했습니다. 스토어 상품은 변경하지 않았습니다.');
  await page.screenshot({path:info.outputPath('product-csv-price.png'),animations:'disabled',fullPage:true});
  expect(f.writes).toEqual(['/api/games/existing-id/content/starter']);expect(f.payloads).toEqual([{revision:'snapshot-1',content:{name:'스타터',description:'',type:'consumable',localizations:{'ko-KR':{name:'스타터',description:''}}},price:{matrixVersion,tierId:'matrix-KOR-5500'}}]);expect(f.errors).toEqual([]);
});

test('IAP 스토어에서 읽은 한국 가격을 CSV 가격 선택기에 자동 반영',async({page})=>{
  const f=await fixture(page,{linked:true,product:true,unconfiguredPrice:true});await page.goto('https://iap.workspace.test/');await page.getByRole('button',{name:'상품 설정 열기',exact:true}).click();await page.getByRole('button',{name:'가격',exact:true}).click();
  const source=page.locator('.store-price-source');await expect(source).toContainText('Google Play에서 읽은 현재 한국 가격: 14,900 KRW');await expect(source).toContainText('같은 금액의 CSV 행을 자동 선택합니다.');await expect(page.getByRole('combobox',{name:'대한민국 판매 가격'})).toHaveValue('14,900원');
  await page.getByText('스토어에서 읽은 가격 모두 보기',{exact:true}).click();await expect(page.getByText('KR · 14,900 KRW',{exact:true})).toBeVisible();expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('IAP App Store Connect에서 상품별 확장 가격 전체를 검색해 예외로 저장',async({page},info)=>{
  const f=await fixture(page,{linked:true,product:true});await page.goto('https://iap.workspace.test/');await page.getByRole('button',{name:'상품 설정 열기',exact:true}).click();await page.getByRole('button',{name:'스토어 설정',exact:true}).click();await page.getByRole('tab',{name:'App Store',exact:true}).click();
  const overrides=page.locator('details.store-price-overrides');await overrides.getByText('App Store 가격만 다르게 설정',{exact:true}).click();await overrides.getByRole('button',{name:'App Store 전체 가격 읽기 (확장 가격 포함)',exact:true}).click();await expect(page.locator('.iap-toast')).toContainText('App Store 전체 가격 읽기 완료');await expect(overrides.getByText(/App Store Connect 전체 가격 · 2개 가격/)).toBeVisible();
  const price=overrides.getByRole('combobox',{name:'대한민국 판매 가격'});await price.click();await price.fill('9000000');await overrides.getByRole('option',{name:'9,000,000원'}).click();await expect(price).toHaveValue('9,000,000원');await page.screenshot({path:info.outputPath('apple-expanded-price.png'),animations:'disabled',fullPage:true});await page.getByRole('button',{name:'스토어 설정 저장',exact:true}).click();
  expect(f.writes).toContain('/api/games/existing-id/settings/starter/apple');expect(f.payloads.at(-1)).toMatchObject({priceOverrides:{KOR:{currency:'KRW',amount:'9000000',referenceId:'apple-extended',sourceVersion:'apple-live-list'}}});expect(f.errors).toEqual([]);
});

test('IAP CSV 기본 가격 위에 상품별 Google 가격 예외를 저장',async({page})=>{
  const f=await fixture(page,{linked:true,product:true});await page.goto('https://iap.workspace.test/');await page.getByRole('button',{name:'상품 설정 열기',exact:true}).click();await page.getByRole('button',{name:'스토어 설정',exact:true}).click();
  await page.getByText('Google Play 국가별 가격만 다르게 설정',{exact:true}).click();await page.getByLabel('판매 금액',{exact:true}).fill('5900');await page.getByRole('button',{name:'이 가격 사용',exact:true}).click();await expect(page.getByText(/현재 예외: 5,900 KRW/)).toBeVisible();
  await page.getByRole('button',{name:'스토어 설정 저장',exact:true}).click();await expect(page.locator('.notice')).toContainText('Google Play 설정 초안을 저장했습니다.');expect(f.writes).toContain('/api/games/existing-id/settings/starter/google');expect(f.payloads.at(-1)).toMatchObject({countries:['KR'],priceOverrides:{KR:{currency:'KRW',amount:'5900'}}});expect(f.errors).toEqual([]);
});
