import {describe,expect,it} from 'vitest';
import {ProductSchema,type Store} from '../src/shared/domain.js';
import {uploadState,uploadStatusesFromScan} from '../src/shared/product-status.js';
import {productUploadStatuses} from '../src/server/product-status.js';
import {MemoryRepository} from '../src/server/repository.js';

describe('상품 업로드 상태',()=>{
  it('세 플랫폼 전체·일부·실패 상태를 보수적으로 분류한다',()=>{
    expect(uploadState({google:{state:'uploaded'},apple:{state:'uploaded'},steam:{state:'uploaded'}})).toBe('uploaded');
    expect(uploadState({google:{state:'uploaded'},apple:{state:'missing'},steam:{state:'not_configured'}})).toBe('partial');
    expect(uploadState({google:{state:'missing'},apple:{state:'missing'},steam:{state:'not_configured'}})).toBe('not_uploaded');
    expect(uploadState({google:{state:'missing'},apple:{state:'unknown'},steam:{state:'missing'}})).toBe('unknown');
  });

  it('상품 수와 관계없이 스토어별 전체 목록을 한 번씩 읽어 상태를 판정한다',async()=>{
    const repo=new MemoryRepository(),product=ProductSchema.parse({productKey:'pack',name:'상품',type:'consumable',googleId:'pack',appleId:'pack',steamId:'7',pricePresetKey:'P5500'});
    await repo.put('game','g',{id:'g',name:'게임',connectorKey:'test'},0);await repo.put('catalog','g',{gameId:'g',snapshotId:'s',products:[product],missingKeys:[]},0);
    const calls:Store[]=[],factory=(_game:unknown,store:Store)=>({store,fingerprint:'test',discover:async()=>{calls.push(store);return {products:store==='google'?[]:[{productId:store==='apple'?'pack':'7',name:'상품',type:'unconfigured'}]};}}) as any;
    expect((await productUploadStatuses(repo,factory,'g'))[0]).toMatchObject({state:'partial',stores:{google:{state:'missing'},apple:{state:'uploaded'},steam:{state:'uploaded'}}});
    expect(calls.sort()).toEqual(['apple','google','steam']);
  });

  it('수동 전체 조회 결과도 같은 규칙으로 등록·미등록·미연결을 표시한다',()=>{
    const product=ProductSchema.parse({productKey:'pack',name:'상품',type:'consumable',googleId:'pack',appleId:'pack',steamId:'7',pricePresetKey:'P5500'}),catalog={gameId:'g',snapshotId:'s',products:[product],missingKeys:[]};
    const scan:any={id:'scan',gameId:'g',catalogRevision:'s',scannedAt:'2026-09-16T00:00:00Z',expiresAt:'2026-09-16T00:10:00Z',sources:{google:{state:'ok',count:0},apple:{state:'cached',count:1},steam:{state:'not_connected',count:0}},products:[{store:'apple',remoteId:'pack'}]};
    expect(uploadStatusesFromScan(catalog,scan)[0]).toMatchObject({state:'unknown',stores:{google:{state:'missing'},apple:{state:'uploaded'},steam:{state:'not_connected'}}});
  });
});
