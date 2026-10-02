import {describe,it,expect,vi} from 'vitest';
import supertest from 'supertest';
import {ProductSchema,type Preset} from '../src/shared/domain.js';
import {MemoryRepository} from '../src/server/repository.js';
import {createSheetProduct,parseSheets,importSheetCatalog,saveProductContent,importCatalog,manifest} from '../src/server/catalog.js';
import {createApp} from '../src/server/app.js';
import {DemoConnector} from '../src/server/connectors/index.js';
import {applePriceList,verifyAppleSelections} from '../src/server/apple-prices.js';
import {bindProject} from '../src/server/projects.js';
const auth={demo:true,origin:'http://localhost:4180',secret:'',portalUrl:'https://company.example.com',portalInternalUrl:'http://unused',secure:false};
const actor={id:'demo',name:'demo',permissions:['iap.access','iap.publish']};
async function fixture(){const repo=new MemoryRepository();await repo.put('game','g',{id:'g',name:'원래 이름',connectorKey:'demo'});await repo.put('preset','v',{key:'P5500',version:'v'});const adapter=new DemoConnector('apple');return {repo,adapter,factory:()=>adapter};}
const minimal=[['productKey','name','googleId','appleId','steamId'],['pack','식별 이름','pack','pack','1']];
describe('최소 시트와 웹 설정 소유권',()=>{
  it('5개 공통 열만 허용하고 웹 설정 없이 가져온 상품은 미설정 상태이다',async()=>{
    const {repo}=await fixture();const catalog=await importSheetCatalog(repo,'g',parseSheets(minimal),'demo','sheet');
    expect(catalog.products[0]).toMatchObject({sourceName:'식별 이름',type:'unconfigured',pricePresetKey:'UNCONFIGURED'});
    expect((await manifest(repo,'g')).products).toEqual([]);
    expect(()=>parseSheets([['productKey','name','googleId','appleId','steamId','type'],['a','a','','','','consumable']])).toThrow('5개');
  });
  it('시트 재가져오기는 웹 이름·설명·번역·가격표·유형·이관 키를 보존한다',async()=>{
    const {repo}=await fixture();const product=ProductSchema.parse({productKey:'pack',name:'초기',type:'consumable',googleId:'pack',appleId:'pack',steamId:'1',pricePresetKey:'P5500',saveName:'history',assetGuid:'guid',legacyName:'asset'});
    let c=await importCatalog(repo,'g',[product],'demo','migration');
    c=await saveProductContent(repo,'g','pack',c.snapshotId,{name:'판매 이름',description:'판매 설명',type:'consumable',localizations:{'en-US':{name:'Name',description:'Description'}}},'demo');
    const updated=await importSheetCatalog(repo,'g',parseSheets(minimal),'demo','sheet');
    expect(updated.products[0]).toMatchObject({name:'판매 이름',sourceName:'식별 이름',description:'판매 설명',saveName:'history',assetGuid:'guid',legacyName:'asset',type:'consumable',pricePresetKey:'P5500',localizations:{'en-US':{name:'Name',description:'Description'}}});
    const json=await importCatalog(repo,'g',[product],'demo','migration');expect(json.products[0].name).toBe('판매 이름');expect(json.products[0].localizations).toEqual(c.products[0].localizations);
    await expect(importSheetCatalog(repo,'g',parseSheets([minimal[0],['pack','이름','changed','pack','1']]),'demo','sheet')).rejects.toThrow('식별값');
    await expect(importSheetCatalog(repo,'g',parseSheets([minimal[0],['pack','이름','','pack','1']]),'demo','sheet')).rejects.toThrow('식별값');
  });
  it('웹 설정 저장은 오래된 revision·ID 주입·확정 유형 변경을 거부하고 원격 쓰기가 없다',async()=>{
    const {repo,adapter,factory}=await fixture();let c=await importSheetCatalog(repo,'g',parseSheets(minimal),'demo','sheet');const revision=c.snapshotId;
    const create=vi.spyOn(adapter,'create'),apply=vi.spyOn(adapter,'apply');const {app}=createApp(repo,factory,auth),matrix=(await supertest(app).get('/api/price-matrix')).body,price={matrixVersion:matrix.id,tierId:matrix.points.find((point:any)=>point.amount==='5500').id};
    const content={name:'상품',description:'설명',type:'nonConsumable',localizations:{'ko-KR':{name:'상품',description:'설명'}}};
    const put=(body:object)=>supertest(app).put('/api/games/g/content/pack').set('Origin',auth.origin).send(body);
    expect((await put({revision,content:{...content,appleId:'changed'}})).status).toBe(400);
    const saved=await put({revision,content,price});expect(saved.status,JSON.stringify(saved.body)).toBe(200);c=saved.body;
    expect((await put({revision,content,price})).status).toBe(409);
    expect((await put({revision:c.snapshotId,content:{...content,type:'consumable'},price})).status).toBe(400);
    expect(create).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();expect((await manifest(repo,'g')).products[0].type).toBe('nonConsumable');
  });
});
describe('웹 신규 상품의 시트 원본 추가',()=>{
  const header=['productKey','name','googleId','appleId','steamId'];
  const input={revision:null,productKey:'new_pack',name:'신규 팩',type:'consumable' as const,googleId:'new_pack_gp',appleId:'new.pack.ios',steamId:'2001'};
  it('검증한 A:E 행을 한 번만 추가하고 유형을 웹 카탈로그에 보존한다',async()=>{
    const {repo}=await fixture();let rows:unknown[][]=[header],appends=0;
    const result=await createSheetProduct(repo,'g',input,'demo',async()=>structuredClone(rows),async row=>{appends++;rows.push(row);});
    expect(appends).toBe(1);expect(rows[1]).toEqual(['new_pack','신규 팩','new_pack_gp','new.pack.ios','2001']);expect(result.product).toMatchObject({productKey:'new_pack',type:'consumable',sourceKind:'sheet',webManaged:true});expect(result.sheet.range).toBe('Products!A:E');
  });
  it('응답 유실 뒤 같은 행을 재조회해 복구하고 행을 다시 추가하지 않는다',async()=>{
    const {repo}=await fixture();let rows:unknown[][]=[header],appends=0;
    const result=await createSheetProduct(repo,'g',input,'demo',async()=>structuredClone(rows),async row=>{appends++;rows.push(row);throw new Error('response lost');});
    expect(appends).toBe(1);expect(rows).toHaveLength(2);expect(result.product.productKey).toBe('new_pack');
    const retry=await createSheetProduct(repo,'g',{...input,revision:result.catalog.snapshotId},'demo',async()=>structuredClone(rows),async()=>{appends++;});
    expect(appends).toBe(1);expect(retry.product.type).toBe('consumable');
  });
  it('오래된 revision과 같은 키의 다른 행 및 중복 스토어 ID를 쓰기 전에 거부한다',async()=>{
    const {repo}=await fixture();let rows:unknown[][]=[header,['other','기존','new_pack_gp','other','1001']],appends=0;
    await expect(createSheetProduct(repo,'g',input,'demo',async()=>structuredClone(rows),async()=>{appends++;})).rejects.toThrow('중복 googleId');expect(appends).toBe(0);
    rows=[header,['new_pack','다른 값','different','different','3001']];await expect(createSheetProduct(repo,'g',input,'demo',async()=>structuredClone(rows),async()=>{appends++;})).rejects.toThrow('다른 값');expect(appends).toBe(0);
    await importSheetCatalog(repo,'g',parseSheets([header,['existing','기존','existing','existing','1']]),'demo','sheet');rows=[header,['existing','기존','existing','existing','1']];await expect(createSheetProduct(repo,'g',input,'demo',async()=>structuredClone(rows),async()=>{appends++;})).rejects.toThrow('다른 변경');expect(appends).toBe(0);
  });
});
describe('Apple 가격 조회 증거',()=>{
  it('캐시된 가격 선택만 허용하고 금액·통화·국가 변조 및 오래된 목록을 거부한다',async()=>{
    const {repo,factory}=await fixture();const list=await applePriceList(repo,factory,'g','demo-reference',true);
    expect((await applePriceList(repo,factory,'g','demo-reference',true)).id).toBe(list.id);
    expect((await applePriceList(repo,factory,'g','demo-reference',true,true)).id).not.toBe(list.id);
    const point=list.points[1];const price={selectionId:list.id,pricePointId:point.id,amount:point.amount,currency:point.currency};
    await expect(verifyAppleSelections(repo,factory,{KOR:price},true)).resolves.toMatchObject({id:list.id,territory:'KOR'});
    for(const altered of [{...price,amount:'5555'},{...price,currency:'USD'},{...price,pricePointId:'forged'},{...price,selectionId:undefined}])await expect(verifyAppleSelections(repo,factory,{KOR:altered},true)).rejects.toThrow();
    await expect(verifyAppleSelections(repo,factory,{USA:price},true)).rejects.toThrow();
    await expect(verifyAppleSelections(repo,factory,{KOR:price},false)).rejects.toThrow();
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse(list.expiresAt)+1);try{await expect(verifyAppleSelections(repo,factory,{KOR:price},true)).rejects.toThrow('다시 조회');}finally{clock.mockRestore();}
    await expect(repo.put('apple_prices',list.id,list)).rejects.toThrow('불변');
  });
});
describe('회사 프로젝트 연결',()=>{
  it('포털의 프로젝트만 연결하고 내부 ID·상품을 보존하며 중복 연결을 거부한다',async()=>{
    const {repo}=await fixture();const c=await importSheetCatalog(repo,'g',parseSheets(minimal),'demo','sheet');
    const game=await bindProject(repo,auth,actor,'g','1');expect(game).toMatchObject({id:'g',portalProjectId:'1',name:'던전슬래셔'});expect((await repo.get('catalog','g'))?.data).toEqual(c);
    await expect(bindProject(repo,auth,actor,'g','999')).rejects.toThrow('프로젝트');
    await repo.put('game','g2',{id:'g2',name:'another',connectorKey:'demo'});await expect(bindProject(repo,auth,actor,'g2','1')).rejects.toThrow('이미 연결');
  });
});
