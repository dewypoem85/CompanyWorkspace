import React,{type ReactNode} from 'react';
import type {Preset,Product,Store} from '../shared/domain';
import type {ProductUploadStatus} from '../shared/product-status';

export type ProductSection='overview'|'content'|'price'|'stores'|'release';
const sections:{id:ProductSection;label:string;description:string}[]=[
  {id:'overview',label:'개요',description:'식별자와 준비 상태'},
  {id:'content',label:'상품 내용',description:'이름·설명·번역'},
  {id:'price',label:'가격',description:'기본값과 플랫폼 예외'},
  {id:'stores',label:'스토어 설정',description:'지역·심사·활성화'},
  {id:'release',label:'등록 검토',description:'누락 확인과 업로드 계획'},
];
const stores:{key:Store;label:string;short:string}[]=[{key:'google',label:'Google Play',short:'G'},{key:'apple',label:'App Store',short:'A'},{key:'steam',label:'Steam',short:'S'}];
const stateLabel:Record<string,string>={uploaded:'등록됨',missing:'미등록',not_configured:'ID 없음',not_connected:'미연결',unknown:'확인 실패'};

export function ProductDetailLayout({product,preset,status,section,dirty,onBack,onSectionChange,children}:{product:Product;preset?:Preset;status?:ProductUploadStatus;section:ProductSection;dirty:boolean;onBack:()=>void;onSectionChange:(section:ProductSection)=>void;children:ReactNode}){
  const complete={content:!!product.description&&product.type!=='unconfigured',price:!!preset,ids:!!product.googleId&&!!product.appleId&&!!product.steamId};
  return <section className="product-workspace">
    <div className="detail-heading"><div><button className="cw-button" data-variant="quiet" type="button" onClick={onBack}>← 상품 목록</button><div className="eyebrow">{product.productKey}</div><h2>{product.name}</h2><p>{product.sourceName&&product.sourceName!==product.name?`시트 식별명: ${product.sourceName}`:'상품 원본과 스토어 등록 준비 상태를 확인합니다.'}</p></div><div className="detail-heading-status"><span className="cw-state-pill" data-tone={complete.content&&complete.price&&complete.ids?'success':'warning'}>{complete.content&&complete.price&&complete.ids?'기본 설정 완료':'설정 필요'}</span>{dirty&&<span className="cw-state-pill" data-tone="warning">저장하지 않은 변경</span>}</div></div>
    <div className="product-detail-shell">
      <nav className="detail-section-tabs" aria-label="상품 상세 설정">{sections.map((item,index)=><button className="cw-button" data-variant={section===item.id?'primary':'quiet'} aria-label={item.label} aria-current={section===item.id?'page':undefined} type="button" key={item.id} onClick={()=>onSectionChange(item.id)}><span>{index+1}</span><strong>{item.label}</strong><small>{item.description}</small></button>)}</nav>
      <div className="product-detail-body">{section==='overview'?<div className="detail-overview-grid">
      <section className="panel form-panel"><h3>상품 식별자</h3><dl className="identifier-list"><div><dt>결제 키</dt><dd><code>{product.productKey}</code></dd></div><div><dt>유형</dt><dd>{product.type==='consumable'?'소모성':product.type==='nonConsumable'?'비소모성':'설정 필요'}</dd></div><div><dt>Google Play</dt><dd><code>{product.googleId??'미설정'}</code></dd></div><div><dt>App Store</dt><dd><code>{product.appleId??'미설정'}</code></dd></div><div><dt>Steam</dt><dd><code>{product.steamId??'미설정'}</code></dd></div></dl><p className="muted">상품 ID와 확정한 유형은 변경할 수 없습니다.</p></section>
      <section className="panel form-panel"><h3>플랫폼 등록 상태</h3><div className="platform-summary">{stores.map(store=>{const state=status?.stores[store.key]?.state??'unknown';return <div key={store.key}><b>{store.short}</b><span>{store.label}</span><strong>{stateLabel[state]??state}</strong></div>;})}</div><p className="muted">Google·Apple 기존 상품은 일반 업로드에서 변경 없이 건너뜁니다.</p></section>
      <section className="panel form-panel"><h3>등록 준비 상태</h3><ul className="readiness-checklist"><li className={complete.ids?'complete':''}>세 플랫폼 상품 ID</li><li className={complete.content?'complete':''}>상품명·설명·유형</li><li className={complete.price?'complete':''}>CSV 기본 가격</li></ul></section>
    </div>:children}</div>
    </div>
  </section>;
}
