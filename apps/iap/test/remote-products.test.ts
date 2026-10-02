import {describe,expect,it} from 'vitest';
import {ProductSchema,type Desired,type Remote,type Row,type Store} from '../src/shared/domain.js';
import {MemoryRepository} from '../src/server/repository.js';
import type {Connector,ConnectorProduct} from '../src/server/connectors/types.js';
import {importCatalog,importSheetCatalog} from '../src/server/catalog.js';
import {importRemoteProducts,scanRemoteProductPrice,scanRemoteProducts} from '../src/server/remote-products.js';

class DiscoveryConnector implements Connector{
  fingerprint='read-only';writes:string[]=[];
  constructor(public store:Store,public products:ConnectorProduct[]){ }
  async discover(){return {products:this.products};}
  async discoverPrice(_resourceId:string){return this.store==='apple'?[{market:'KOR',currency:'KRW',amount:'5500'}]:[];}
  async read(_id:string):Promise<Remote|null>{return null;}
  async validate(_desired:Desired){ }
  steps(){return [];}
  async create(_id:string,_desired:Desired):Promise<{id:string;receipt:unknown}>{this.writes.push('create');throw new Error('write called');}
  async apply(_step:string,_row:Row){this.writes.push('apply');throw new Error('write called');}
}

async function fixture(){
  const repo=new MemoryRepository();await repo.put('game','g',{id:'g',name:'게임',connectorKey:'demo'},0);
  const existing=ProductSchema.parse({productKey:'shared_pack',name:'기존 이름',type:'consumable',googleId:'shared_pack',pricePresetKey:'P5500'});
  await importCatalog(repo,'g',[existing],'actor','fixture');
  const connectors={
    google:new DiscoveryConnector('google',[{productId:'shared_pack',name:'Google 현재 이름',type:'unconfigured',description:'Google 현재 설명',localizations:{'ko-KR':{name:'Google 현재 이름',description:'Google 현재 설명'}},prices:[{market:'KR',currency:'KRW',amount:'5500'}],priceState:'available'},{productId:'google_only',name:'Google 전용',type:'unconfigured',prices:[{market:'KR',currency:'KRW',amount:'1100'}],priceState:'available'}]),
    apple:new DiscoveryConnector('apple',[{productId:'shared_pack',resourceId:'apple-shared',name:'Apple 기존',type:'consumable',localizations:{ko:{name:'Apple 한국어',description:'Apple 한국어 설명'},'ja':{name:'Apple 일본어',description:'Apple 일본어 설명'}},priceState:'separate_request',priceMessage:'별도 조회'},{productId:'apple_only',resourceId:'apple-only',name:'Apple 전용',type:'nonConsumable'}]),
    steam:new DiscoveryConnector('steam',[{productId:'1001',suggestedProductKey:'shared_pack',name:'Steam 기존',type:'unconfigured',prices:[{market:'KRW',currency:'KRW',amount:'5500'}]}]),
  };
  return {repo,connectors,factory:(_game:any,store:Store)=>connectors[store]};
}

describe('기존 스토어 상품 가져오기',()=>{
  it('모든 연결 가능한 플랫폼 정보를 한 번에 저장하고 원격 쓰기를 호출하지 않는다',async()=>{
    const f=await fixture(),scan=await scanRemoteProducts(f.repo,f.factory,'g','actor');
    expect(scan.products.find(product=>product.store==='google'&&product.remoteId==='shared_pack')?.action).toBe('refresh');
    expect(scan.products.find(product=>product.store==='apple'&&product.remoteId==='shared_pack')?.action).toBe('attach');
    expect(scan.products.find(product=>product.store==='steam'&&product.remoteId==='1001')?.action).toBe('attach');
    const apple=scan.products.find(product=>product.store==='apple'&&product.remoteId==='shared_pack')!;expect(await scanRemoteProductPrice(f.repo,f.factory,'g',scan.id,apple.id,'actor')).toMatchObject({prices:[{market:'KOR',currency:'KRW',amount:'5500'}],priceState:'available'});const catalog=await importRemoteProducts(f.repo,'g',scan.id,'actor');
    expect(catalog.products.find(product=>product.productKey==='shared_pack')).toMatchObject({name:'Google 현재 이름',googleId:'shared_pack',appleId:'shared_pack',steamId:'1001'});
    expect(catalog.products.find(product=>product.productKey==='apple_only')).toMatchObject({name:'Apple 전용',appleId:'apple_only',type:'nonConsumable',sourceKind:'remote',pricePresetKey:'UNCONFIGURED'});
    expect(catalog.products.find(product=>product.productKey==='google_only')).toMatchObject({googleId:'google_only',sourceKind:'remote',pricePresetKey:expect.stringMatching(/^CSV_1100_/)});
    expect((await f.repo.get<any>('store_detail','g:shared_pack:google'))?.data).toMatchObject({name:'Google 현재 이름',prices:[{market:'KR',currency:'KRW',amount:'5500'}]});
    expect((await f.repo.get<any>('store_detail','g:shared_pack:apple'))?.data).toMatchObject({name:'Apple 기존',priceState:'available',prices:[{market:'KOR',currency:'KRW',amount:'5500'}]});
    for(const connector of Object.values(f.connectors))expect(connector.writes).toEqual([]);
  });
  it('다른 프로젝트와 조회 후 카탈로그 변경을 거부한다',async()=>{
    const f=await fixture(),scan=await scanRemoteProducts(f.repo,f.factory,'g','actor');
    await expect(importRemoteProducts(f.repo,'other',scan.id,'actor')).rejects.toMatchObject({code:'SCAN_SCOPE'});
    const current=(await f.repo.get<any>('catalog','g'))!;await f.repo.put('catalog','g',{...current.data,snapshotId:'changed'},current.version);
    await expect(importRemoteProducts(f.repo,'g',scan.id,'actor')).rejects.toMatchObject({code:'STALE_CATALOG'});
  });
  it('비어 있는 웹 내용은 Google 번역을 우선하고 App Store의 없는 언어를 보완하되 기존 설정은 덮어쓰지 않는다',async()=>{const f=await fixture(),scan=await scanRemoteProducts(f.repo,f.factory,'g','actor'),catalog=await importRemoteProducts(f.repo,'g',scan.id,'actor'),product=catalog.products.find(product=>product.productKey==='shared_pack');expect(product).toMatchObject({name:'Google 현재 이름',description:'Google 현재 설명',localizations:{'ko-KR':{name:'Google 현재 이름',description:'Google 현재 설명'},ja:{name:'Apple 일본어',description:'Apple 일본어 설명'}},googleId:'shared_pack',appleId:'shared_pack'});expect((await f.repo.get<any>('store_detail','g:shared_pack:google'))?.data.localizations['ko-KR'].name).toBe('Google 현재 이름');expect((await f.repo.get<any>('store_detail','g:shared_pack:apple'))?.data.localizations.ko.name).toBe('Apple 한국어');const configured={...product!,name:'웹 이름',description:'웹 설명',localizations:{'ko-KR':{name:'웹 이름',description:'웹 설명'}}};const row=await f.repo.get<any>('catalog','g');await f.repo.put('catalog','g',{...row!.data,snapshotId:'configured',products:row!.data.products.map((value:any)=>value.productKey==='shared_pack'?configured:value)},row!.version);const fresh=await scanRemoteProducts(f.repo,f.factory,'g','actor'),again=await importRemoteProducts(f.repo,'g',fresh.id,'actor');expect(again.products.find(value=>value.productKey==='shared_pack')).toMatchObject({name:'웹 이름',description:'웹 설명',localizations:{'ko-KR':{name:'웹 이름',description:'웹 설명'}}});});
  it('스토어에서 가져온 상품은 이후 시트 재가져오기에서 누락 처리하지 않는다',async()=>{
    const f=await fixture(),scan=await scanRemoteProducts(f.repo,f.factory,'g','actor');await importRemoteProducts(f.repo,'g',scan.id,'actor');
    const catalog=await importSheetCatalog(f.repo,'g',[{productKey:'shared_pack',name:'시트 상품',googleId:'shared_pack',appleId:'shared_pack',steamId:'1001'}],'actor','sheet');
    expect(catalog.products.find(product=>product.productKey==='apple_only')?.sourceKind).toBe('remote');expect(catalog.missingKeys).not.toContain('apple_only');
  });
});
