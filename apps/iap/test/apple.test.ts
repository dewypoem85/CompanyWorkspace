import { describe, expect, it, vi } from 'vitest';
import { AppleConnector } from '../src/server/connectors/apple.js';
import { ConnectionSchema } from '../src/server/connectors/config.js';
import { ConnectorError } from '../src/server/connectors/types.js';
import type { Json } from '../src/server/connectors/http.js';
import { ProductSchema, SettingsSchema, type Desired, type Row } from '../src/shared/domain.js';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const config = ConnectionSchema.parse({ apple: { appId: '123', issuerId: 'issuer', keyId: 'key', keyFile: 'unused', writesEnabled: true,
  verification: { testApp: 'test.app', testedAt: '2026-09-09T00:00:00Z', evidence: 'mock-contract-test-only', duplicateCreateRejected: true, lostResponseStops: true } } }).apple!;
const desired: Desired = { product: ProductSchema.parse({ productKey: 'new', appleId: 'new', name: '상품', type: 'consumable', pricePresetKey: 'P5500', localizations: { 'ko-KR': { name: '상품', description: '설명' } } }),
  settings: SettingsSchema.parse({ countries: ['KOR'] }), preset: { key: 'P5500', name: '가격', krw: '5500', apple: { KOR: { pricePointId: 'other-product-reference', selectionId: 'validated-list', currency: 'KRW', amount: '5500' } }, google: {}, steam: {}, version: 'v', confirmedBy: '1', confirmedAt: '2026-09-09T00:00:00Z' } };
const row = (): Row => ({ productKey: 'new', store: 'apple', remoteId: 'new', before: null, desired, action: 'create', state: 'running', created: { id: 'remote-new', at: '', receipt: { id: 'remote-new' } }, steps: [] });
function fixture() { const connector = new AppleConnector(config); return { connector, api: vi.spyOn(connector as any, 'api') }; }

describe('Apple API 계약과 단계 범위', () => {
  it('Apple 판매 지역과 가격 포인트 자동 환산값을 읽는다',async()=>{
    const f=fixture();f.api.mockResolvedValueOnce({data:[{id:'USA',attributes:{currency:'USD'}},{id:'KOR',attributes:{currency:'KRW'}}]});
    expect(await f.connector.territories()).toEqual([{id:'KOR',currency:'KRW'},{id:'USA',currency:'USD'}]);
    f.api.mockResolvedValueOnce({data:[{id:'eq-us',attributes:{customerPrice:'3.99'},relationships:{territory:{data:{type:'territories',id:'USA'}}}},{id:'eq-kr',attributes:{customerPrice:'5500'},relationships:{territory:{data:{type:'territories',id:'KOR'}}}}],included:[{type:'territories',id:'USA',attributes:{currency:'USD'}},{type:'territories',id:'KOR',attributes:{currency:'KRW'}}]});
    expect(await f.connector.equalizations('point')).toEqual([{territory:'KOR',amount:'5500',currency:'KRW'},{territory:'USA',amount:'3.99',currency:'USD'}]);
    expect(f.api.mock.calls[1][0]).toContain('/equalizations?include=territory');
  });
  it('가격 선택 목록은 해당 앱의 상품과 실제 국가 통화로 GET만 사용한다',async()=>{
    const f=fixture();f.api.mockResolvedValueOnce({data:[{id:'reference',attributes:{productId:'pack',name:'Pack'}}]})
      .mockResolvedValueOnce({data:{id:'KOR',attributes:{currency:'KRW'}}})
      .mockResolvedValueOnce({data:[{id:'p2',attributes:{customerPrice:'5500.00'}}],links:{next:'https://api.appstoreconnect.apple.com/v2/inAppPurchases/reference/pricePoints?cursor=2'}})
      .mockResolvedValueOnce({data:[{id:'p1',attributes:{customerPrice:'1100.00'}}]});
    expect(await f.connector.pricePoints('reference','KOR')).toEqual([{id:'p1',amount:'1100.00',currency:'KRW'},{id:'p2',amount:'5500.00',currency:'KRW'}]);
    expect(f.api.mock.calls.every(call=>call[1]===undefined||call[1]==='GET')).toBe(true);
  });
  it('다른 앱 상품과 불확실한 가격 응답을 허용하지 않는다',async()=>{
    const f=fixture();f.api.mockResolvedValue({data:[]});await expect(f.connector.pricePoints('foreign','KOR')).rejects.toThrow('프로젝트');expect(f.api).toHaveBeenCalledTimes(1);
  });
  it('앱에 등록된 Apple 상품과 번역을 상품의 관계 ID로 한 번에 읽고 가격은 별도 API임을 표시한다',async()=>{const f=fixture();f.api.mockResolvedValueOnce({data:[{id:'remote-1',attributes:{productId:'coins.100',name:'내부 이름',inAppPurchaseType:'CONSUMABLE',state:'APPROVED'},relationships:{inAppPurchaseLocalizations:{data:[{id:'locale-en',type:'inAppPurchaseLocalizations'},{id:'locale-ko',type:'inAppPurchaseLocalizations'}]}}}],included:[{id:'locale-en',type:'inAppPurchaseLocalizations',attributes:{locale:'en-US',name:'100 Coins',description:'100 game coins'}},{id:'locale-ko',type:'inAppPurchaseLocalizations',attributes:{locale:'ko',name:'코인 100개',description:'게임 코인 100개'}}]});expect(await f.connector.discover()).toEqual({products:[{productId:'coins.100',resourceId:'remote-1',name:'코인 100개',type:'consumable',description:'게임 코인 100개',localizations:{'en-US':{name:'100 Coins',description:'100 game coins'},ko:{name:'코인 100개',description:'게임 코인 100개'}},status:'APPROVED',prices:[],priceState:'separate_request',priceMessage:'Apple 현재 가격은 상품별 가격 일정 API에서 별도로 확인합니다.'}]});expect(f.api.mock.calls[0][0]).toContain('include=inAppPurchaseLocalizations');expect(f.api.mock.calls[0][0]).toContain('inAppPurchaseLocalizations');expect(f.api).toHaveBeenCalledTimes(1);expect(f.api.mock.calls.every(call=>call[1]===undefined)).toBe(true);});
  it('상품별 가격 일정에서 현재 적용 중인 대한민국 가격만 읽는다',async()=>{const f=fixture();f.api.mockResolvedValueOnce({data:[{id:'price',attributes:{startDate:null,endDate:null},relationships:{inAppPurchasePricePoint:{data:{id:'point'}}}}],included:[{type:'inAppPurchasePricePoints',id:'point',attributes:{customerPrice:'5500'},relationships:{territory:{data:{id:'KOR'}}}},{type:'territories',id:'KOR',attributes:{currency:'KRW'}}]});expect(await f.connector.discoverPrice('remote-1')).toEqual([{market:'KOR',currency:'KRW',amount:'5500',optionId:'point'}]);expect(f.api.mock.calls[0][0]).toContain('/inAppPurchasePriceSchedules/remote-1/manualPrices?');expect(f.api.mock.calls[0][0]).toContain('filter[territory]=KOR');});
  it('생성 충돌을 기존 상품 변경으로 전환하지 않는다', async () => { const f = fixture(); f.api.mockResolvedValueOnce({data:[{id:'KOR',attributes:{currency:'KRW'}}]}).mockRejectedValueOnce(new ConnectorError('ALREADY_EXISTS', 'duplicate', 'rejected')); await expect(f.connector.create('new', desired)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' }); expect(f.api).toHaveBeenCalledTimes(2); expect(f.api.mock.calls[1].slice(0, 2)).toEqual(['/v2/inAppPurchases', 'POST']); });
  it('번역은 해당 작업이 생성한 버전에만 연결한다', async () => { const f = fixture(); f.api.mockResolvedValue({ data: { id: 'localization' } }); const r = row(); await expect(f.connector.apply('locale:ko-KR', r)).rejects.toThrow('버전'); expect(f.api).not.toHaveBeenCalled(); r.steps.push({ key: 'version', state: 'done', receipt: { id: 'owned-version' } }); await f.connector.apply('locale:ko-KR', r); expect((f.api.mock.calls[0][2] as Json).data.relationships.version.data).toEqual({ type: 'inAppPurchaseVersions', id: 'owned-version' }); });
  it('다른 상품 가격 포인트 ID를 재사용하지 않고 대한민국 기준 가격 하나만 설정한다', async () => { const f = fixture(); f.api.mockResolvedValueOnce({data:{id:'KOR',attributes:{currency:'KRW'}}}).mockResolvedValueOnce({ data: [{ id: 'actual-product-point', attributes: { customerPrice: '5500.00' } }] }).mockResolvedValueOnce({ data: { id: 'schedule' } }); await f.connector.apply('prices', row()); expect(f.api.mock.calls[1][0]).toContain('/remote-new/pricePoints?'); const payload = f.api.mock.calls[2][2] as Json; expect(payload.data.relationships.baseTerritory.data.id).toBe('KOR');expect(payload.data.relationships.manualPrices.data).toHaveLength(1);expect(payload.included).toHaveLength(1);expect(payload.included[0].relationships.inAppPurchasePricePoint.data.id).toBe('actual-product-point'); expect(JSON.stringify(payload)).not.toContain('other-product-reference'); });
  it('정확한 가격 포인트가 없으면 가격 쓰기를 하지 않는다', async () => { const f = fixture(); f.api.mockResolvedValueOnce({data:{id:'KOR',attributes:{currency:'KRW'}}}).mockResolvedValue({ data: [{ id: 'point', attributes: { customerPrice: '5900' } }] }); await expect(f.connector.apply('prices', row())).rejects.toThrow('정확한'); expect(f.api).toHaveBeenCalledTimes(2); });
  it('최초 유형 심사는 앱 버전 동반 수동 작업으로 멈춘다', async () => { const f = fixture(); f.api.mockResolvedValue({ data: [] }); await expect(f.connector.apply('review.check', row())).rejects.toThrow('새 앱 버전'); expect(f.api).toHaveBeenCalledTimes(1); });
  it('가격만 승인한 변경은 번역·심사·판매지역 단계를 포함하지 않는다', () => { const f = fixture(); expect(f.connector.steps(desired, ['prices'])).toEqual(['prices', 'verify']); });
  it('웹에서 업로드한 심사 이미지는 안전한 ID로만 전용 저장소에서 읽는다',async()=>{const directory=await mkdtemp(path.join(tmpdir(),'iap-apple-image-'));try{const id='review-123e4567-e89b-42d3-a456-426614174000.png';await writeFile(path.join(directory,id),Buffer.from([137,80,78,71,13,10,26,10]));const connector=new AppleConnector(config,directory);const withImage={...desired,settings:SettingsSchema.parse({...desired.settings,reviewImageRef:id})};await expect(connector.validate(withImage,['reviewImage'])).resolves.toBeUndefined();await expect(connector.validate({...desired,settings:SettingsSchema.parse({...desired.settings,reviewImageRef:'review-missing.png'})},['reviewImage'])).rejects.toThrow('등록된');}finally{await rm(directory,{recursive:true,force:true});}});
});
