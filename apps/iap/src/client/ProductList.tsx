import React from 'react';
import type {Preset,Product,Store} from '../shared/domain';
import type {ProductUploadState,ProductUploadStatus,StorePresence} from '../shared/product-status';

const groups:{state:ProductUploadState;title:string;description:string}[]=[
  {state:'not_uploaded',title:'업로드 필요',description:'세 플랫폼에 아직 등록되지 않은 상품'},
  {state:'partial',title:'일부 플랫폼 업로드',description:'Google Play·App Store·Steam 중 일부만 등록된 상품'},
  {state:'unknown',title:'상태 확인 필요',description:'연결 또는 권한 문제로 실제 등록 상태를 확정할 수 없는 상품'},
  {state:'uploaded',title:'업로드 완료',description:'세 플랫폼에 모두 등록된 상품'},
];
const storeNames:Record<Store,string>={google:'Google Play',apple:'App Store',steam:'Steam'};
const presenceLabels:Record<StorePresence|'checking',string>={uploaded:'등록됨',missing:'미등록',not_configured:'ID 없음',not_connected:'미연결',unknown:'확인 실패',checking:'확인 중'};

type Props={
  products:Product[];hiddenProducts:Product[];statuses:ProductUploadStatus[];presets:Preset[];missingKeys:string[];selected:string[];showHidden:boolean;loading:boolean;
  onToggle:(key:string)=>void;onToggleAll:(products:Product[],checked:boolean)=>void;onInspect:(product:Product)=>void;onHide:(product:Product,hidden:boolean)=>void;
};

export function ProductList({products,hiddenProducts,statuses,presets,missingKeys,selected,showHidden,loading,onToggle,onToggleAll,onInspect,onHide}:Props){
  const statusMap=new Map(statuses.map(status=>[status.productKey,status]));
  const stateOf=(product:Product):ProductUploadState=>statusMap.get(product.productKey)?.state??'unknown';
  const cards=(rows:Product[],hidden=false)=>{
    const selectable=rows.filter(product=>!missingKeys.includes(product.productKey));
    return <><div className="product-group-tools">{!hidden&&<label className="check"><input aria-label="그룹 상품 전체 선택" type="checkbox" checked={selectable.length>0&&selectable.every(product=>selected.includes(product.productKey))} onChange={event=>onToggleAll(selectable,event.target.checked)}/>이 그룹 전체 선택</label>}</div><div className="product-card-list">{rows.map(product=>{
      const price=presets.find(value=>value.key===product.pricePresetKey),status=statusMap.get(product.productKey);
      const missing=missingKeys.includes(product.productKey);
      return <article key={product.productKey} className={`product-card ${selected.includes(product.productKey)?'selected':''}`}><div className="product-card-heading">{!hidden&&<input aria-label={`${product.name} 선택`} type="checkbox" disabled={missing} checked={selected.includes(product.productKey)} onChange={()=>onToggle(product.productKey)}/>}<div><strong>{product.name}</strong><small>{product.productKey}{missing&&' · 시트 누락'}</small></div><span className={`product-config-state ${product.type==='unconfigured'||!price?'incomplete':'complete'}`}>{product.type==='unconfigured'||!price?'설정 필요':'기본 설정 완료'}</span></div><dl className="product-card-facts"><div><dt>유형</dt><dd>{product.type==='unconfigured'?'설정 필요':product.type==='consumable'?'소모성':'비소모성'}</dd></div><div><dt>기본 가격</dt><dd>{price?`₩${Number(price.krw).toLocaleString('ko-KR')}`:'선택 필요'}</dd></div></dl><div className="product-card-platforms"><span>플랫폼 등록 상태</span><div className="store-statuses">{(['google','apple','steam'] as Store[]).map(store=>{const presence:StorePresence|'checking'=status?.stores[store]?.state??(loading?'checking':'unknown');return <span key={store} className={`store-presence ${presence}`} title={`${storeNames[store]} · ${presenceLabels[presence]}`}><b>{store==='google'?'G':store==='apple'?'A':'S'}</b>{presenceLabels[presence]}</span>;})}</div></div><div className="product-card-actions">{!hidden&&<button className="cw-button" data-variant="primary" onClick={()=>onInspect(product)}>상품 설정 열기</button>}<button className="cw-button" data-variant="quiet" onClick={()=>onHide(product,!hidden)}>{hidden?'다시 표시':'목록에서 숨기기'}</button></div></article>;
    })}</div></>;
  };
  return <div className="product-groups">
    {loading&&<p className="status-loading" role="status">스토어 등록 상태를 확인하고 있습니다.</p>}
    {groups.map(group=>{const rows=products.filter(product=>stateOf(product)===group.state);if(!rows.length)return null;return <section className={`product-group ${group.state}`} key={group.state}><div className="product-group-heading"><div><h3>{group.title}</h3><p>{group.description}</p></div><span className="badge">{rows.length}개</span></div>{cards(rows)}</section>;})}
    {!products.length&&!hiddenProducts.length&&<div className="empty">검색 결과가 없습니다.</div>}
    {showHidden&&hiddenProducts.length>0&&<section className="product-group hidden-products"><div className="product-group-heading"><div><h3>숨긴 상품</h3><p>웹 상품 목록에서만 숨긴 상품입니다. 스토어와 시트 데이터는 그대로 유지됩니다.</p></div><span className="badge">{hiddenProducts.length}개</span></div>{cards(hiddenProducts,true)}</section>}
  </div>;
}
