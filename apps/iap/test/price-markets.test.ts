import {describe,expect,it} from 'vitest';
import {PresetSchema} from '../src/shared/domain.js';
import {PRICE_MARKETS,deriveStorePricesFromApple,priceMarket,searchPriceMarkets} from '../src/shared/price-markets.js';

describe('프리셋 국가 검색과 코드 경계',()=>{
  it('한국어·영문·양쪽 ISO 코드 검색이 같은 국가를 선택한다',()=>{
    for(const query of ['일본',' japan ','jp','JPN']){
      expect(searchPriceMarkets('google',query).map(m=>m.code)).toContain('JP');
      expect(searchPriceMarkets('apple',query).map(m=>m.code)).toContain('JPN');
    }
    expect(searchPriceMarkets('apple','대한민국')[0].code).toBe('KOR');
    expect(searchPriceMarkets('google','UK')[0].code).toBe('GB');
    expect(searchPriceMarkets('google','호주')[0].code).toBe('AU');
    expect(searchPriceMarkets('google','없는나라')).toEqual([]);
  });
  it('스토어별 통화 매핑과 Steam 통화 선택을 구분한다',()=>{
    expect(priceMarket('google','JP')?.currency).toBe('JPY');
    expect(priceMarket('apple','UKR')?.currency).toBe('USD');
    expect(priceMarket('google','UA')?.currency).toBe('UAH');
    expect(priceMarket('google','CN')).toBeUndefined();
    expect(priceMarket('apple','CHN')?.currency).toBe('CNY');
    expect(searchPriceMarkets('steam','미국 달러')[0].code).toBe('USD');
    expect(priceMarket('steam','TRY')).toBeUndefined();
  });
  it('국가 목록에 중복 코드가 없고 직접 입력하는 Google·Steam 선택이 서버 검증을 통과한다',()=>{
    for(const store of ['google','apple','steam'] as const){
      expect(new Set(PRICE_MARKETS[store].map(m=>m.code)).size).toBe(PRICE_MARKETS[store].length);
      if(store==='apple')continue;
      for(const market of PRICE_MARKETS[store]){
        const preset={key:'P1',name:'테스트',krw:'5500',google:{KR:{currency:'KRW',amount:'5500'}},apple:{KOR:{currency:'KRW',amount:'5500',pricePointId:'point'}},steam:{KRW:'5500'},[store]:{[market.code]:store==='steam'?'10':{currency:market.currency,amount:'10'}}};
        expect(PresetSchema.safeParse(preset).success,`${store}/${market.code}`).toBe(true);
      }
    }
  });
  it('Apple 환산 가격을 Google 국가와 Steam 대표 통화 가격으로 결정한다',()=>{
    const result=deriveStorePricesFromApple([
      {territory:'KOR',currency:'KRW',amount:'5500'},
      {territory:'USA',currency:'USD',amount:'3.99'},
      {territory:'JPN',currency:'JPY',amount:'600'},
      {territory:'DEU',currency:'EUR',amount:'3.99'},
      {territory:'FRA',currency:'EUR',amount:'4.49'},
      {territory:'UKR',currency:'USD',amount:'3.99'},
    ]);
    expect(result).toMatchObject({suggestedKey:'P5500',krw:'5500',google:{KR:{currency:'KRW',amount:'5500'},US:{currency:'USD',amount:'3.99'},JP:{currency:'JPY',amount:'600'},DE:{currency:'EUR',amount:'3.99'},FR:{currency:'EUR',amount:'4.49'}},steam:{EUR:'3.99',JPY:'600',KRW:'5500',USD:'3.99'}});
    expect(result.google).not.toHaveProperty('UA');expect(result.steam).not.toHaveProperty('UAH');
  });
});
