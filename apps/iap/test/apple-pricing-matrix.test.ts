import {describe,expect,it} from 'vitest';
import {applePricingMatrix,applePricingMatrixSummary,applePricingMatrixTier,parseApplePricingMatrix} from '../src/server/apple-pricing-matrix.js';

describe('제공 CSV 가격 매트릭스',()=>{
  it('175개 국가와 대한민국의 680개 고유 판매가를 검증해 읽는다',async()=>{
    const matrix=await applePricingMatrixSummary();
    expect(matrix).toMatchObject({
      id:'matrix-b42d36de0bf6f1d4d69c68fd07b164b7757a0b386714dd5b3ca5ea6ce1a4882f',
      sha256:'b42d36de0bf6f1d4d69c68fd07b164b7757a0b386714dd5b3ca5ea6ce1a4882f',
      sourceFile:'pricing-matrix.csv',territoryCount:175,currencyCount:43,sourceRowCount:809,
    });
    expect(matrix.points).toHaveLength(680);expect(matrix.points[0].amount).toBe('400');expect(matrix.points.at(-1)?.amount).toBe('700000');
  });

  it('같은 행의 국가별 소비자가격을 사용하고 빈 가격은 제외한다',async()=>{
    const matrix=await applePricingMatrix(),tier=await applePricingMatrixTier(matrix.id,'matrix-KOR-5500');
    expect(tier.prices).toHaveLength(175);
    expect(tier.prices.find(price=>price.territory==='KOR')).toMatchObject({amount:'5500',currency:'KRW'});
    expect(tier.prices.find(price=>price.territory==='USA')).toMatchObject({amount:'4.9',currency:'USD'});
    expect(tier.prices.find(price=>price.territory==='JPN')).toMatchObject({amount:'640',currency:'JPY'});
    expect((await applePricingMatrixTier(matrix.id,'matrix-KOR-700000')).prices).toHaveLength(51);
  });

  it('변경된 버전과 매트릭스에 없는 가격을 거부한다',async()=>{
    const matrix=await applePricingMatrix();
    await expect(applePricingMatrixTier(`matrix-${'0'.repeat(64)}`,'matrix-KOR-5500')).rejects.toThrow('변경');
    await expect(applePricingMatrixTier(matrix.id,'matrix-KOR-999999999')).rejects.toThrow('다시 선택');
  });

  it('Windows 체크아웃의 CRLF 줄바꿈도 같은 가격 버전으로 취급한다',()=>{
    const csv='KOR (KRW),\ncustomerPrice,proceeds\n5500,3850\n';
    expect(parseApplePricingMatrix(csv.replaceAll('\n','\r\n')).sha256).toBe(parseApplePricingMatrix(csv).sha256);
  });
});
