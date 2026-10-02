import React,{useEffect,useState} from 'react';
import {getJson,type AppleMatrixSummary} from './ApplePriceSelect';

export function PricingMatrixVersion(){
  const [matrix,setMatrix]=useState<AppleMatrixSummary|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;getJson('/price-matrix').then(value=>{if(active)setMatrix(value);}).catch(reason=>{if(active)setError(reason.message);});return()=>{active=false;};},[]);
  return <>
    <div className="guard"><span className="shield">✓</span><div><strong>상품 가격은 제공된 CSV에서 직접 선택합니다</strong><p>가격을 만들거나 별도로 확정하는 단계는 없습니다. 상품 목록에서 상품을 열어 가격을 선택하세요.</p></div></div>
    <section className="panel form-panel"><div className="panel-head"><div><h2>현재 적용 중인 가격 데이터</h2><p>배포 서버에 포함된 CSV의 버전과 검증 결과입니다.</p></div>{matrix&&<span className="badge protected">현재 적용 중</span>}</div>
      {error&&<p className="price-error" role="alert">{error}</p>}
      {!matrix&&!error&&<p role="status">가격 데이터 버전을 확인하는 중입니다.</p>}
      {matrix&&<dl className="matrix-version"><div><dt>원본 파일</dt><dd>{matrix.sourceFile}</dd></div><div><dt>대한민국 가격</dt><dd>{matrix.points.length.toLocaleString('ko-KR')}개</dd></div><div><dt>국가</dt><dd>{matrix.territoryCount.toLocaleString('ko-KR')}개</dd></div><div><dt>통화</dt><dd>{matrix.currencyCount.toLocaleString('ko-KR')}개</dd></div><div><dt>원본 데이터 행</dt><dd>{matrix.sourceRowCount.toLocaleString('ko-KR')}개</dd></div><div><dt>SHA-256</dt><dd><code>{matrix.sha256}</code></dd></div></dl>}
      <p className="muted">CSV 교체 시 형식과 전체 금액을 검증한 새 빌드를 배포합니다. 상품에 저장된 이전 버전의 가격 스냅샷은 업로드 재현과 감사 기록을 위해 유지됩니다.</p>
    </section>
  </>;
}
