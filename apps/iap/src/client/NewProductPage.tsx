import React,{useMemo,useState} from 'react';
import type {Game,Product} from '../shared/domain';

export type NewProductInput={revision:string|null;productKey:string;name:string;type:'consumable'|'nonConsumable';googleId:string;appleId:string;steamId:string};
const empty:Omit<NewProductInput,'revision'>={productKey:'',name:'',type:'consumable',googleId:'',appleId:'',steamId:''};

export function NewProductPage({game,revision,canPublish,sheetsWritable,busy,onBack,onCreate}:{game:Game;revision:string|null;canPublish:boolean;sheetsWritable:boolean;busy:boolean;onBack:()=>void;onCreate:(input:NewProductInput)=>Promise<boolean>}){
  const [draft,setDraft]=useState(empty),[review,setReview]=useState(false),[error,setError]=useState('');
  const issue=useMemo(()=>{
    if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(draft.productKey))return '결제 키는 영문·숫자·점·밑줄·하이픈으로 입력하세요.';
    if(!draft.name.trim())return '시트 식별용 이름을 입력하세요.';
    if(!/^[a-z0-9][a-z0-9_.]*$/.test(draft.googleId))return 'Google Play ID는 소문자·숫자·점·밑줄로 입력하세요.';
    if(!/^[a-zA-Z0-9_.-]+$/.test(draft.appleId))return 'App Store ID 형식을 확인하세요.';
    if(!/^\d+$/.test(draft.steamId)||BigInt(draft.steamId||0)<1n||BigInt(draft.steamId||0)>4294967295n)return 'Steam ID는 1~4294967295 숫자로 입력하세요.';
    return '';
  },[draft]);
  const change=(field:keyof typeof draft,value:string)=>setDraft(current=>({...current,[field]:value}));
  async function submit(){if(issue){setError(issue);return;}setError('');if(await onCreate({...draft,name:draft.name.trim(),revision}))setReview(false);}
  return <section className="product-workspace">
    <div className="detail-heading"><div><button className="cw-button" data-variant="quiet" type="button" onClick={onBack}>← 상품 목록</button><h2>새 상품 추가</h2><p>{game.name}의 <code>Products</code> 탭에 식별자 행을 추가한 뒤 상세 설정을 이어갑니다.</p></div><span className="cw-state-pill" data-tone={sheetsWritable?'success':'warning'}>{sheetsWritable?'시트 쓰기 가능':'시트 쓰기 비활성'}</span></div>
    {!canPublish&&<section className="cw-callout" role="note" data-tone="warning"><strong>배포 권한이 필요합니다</strong><p>상품 원본 행을 추가하려면 <code>iap.publish</code> 권한이 필요합니다.</p></section>}
    {!sheetsWritable&&<section className="cw-callout" role="note" data-tone="warning"><strong>상품 시트 쓰기가 비활성화되어 있습니다</strong><p>대상 시트에 서비스 계정 편집자 권한을 부여하고 서버 연결 프로필의 <code>sheets.writesEnabled</code>를 활성화하세요.</p></section>}
    {!review?<section className="panel form-panel product-create-form"><h3>상품 식별 정보</h3><p>아래 값은 생성 후 웹에서 변경할 수 없습니다. 세 스토어 ID를 직접 확인해 입력하세요.</p><div className="form-grid two-column">
      <label>결제 키<small>게임과 웹에서 사용하는 공통 키</small><input className="cw-form-control" value={draft.productKey} onChange={event=>change('productKey',event.target.value.trim())} placeholder="pack_monthly_product_1"/></label>
      <label>시트 식별용 이름<small>스토어에 표시할 이름은 상세에서 별도로 설정</small><input className="cw-form-control" value={draft.name} onChange={event=>change('name',event.target.value)} placeholder="월간 계약 상품"/></label>
      <label>상품 유형<select className="cw-form-control" value={draft.type} onChange={event=>change('type',event.target.value)}><option value="consumable">소모성</option><option value="nonConsumable">비소모성</option></select></label>
      <label>Google Play 상품 ID<input className="cw-form-control" value={draft.googleId} onChange={event=>change('googleId',event.target.value.trim())} placeholder="pack_monthly_product_1"/></label>
      <label>App Store 상품 ID<input className="cw-form-control" value={draft.appleId} onChange={event=>change('appleId',event.target.value.trim())} placeholder="pack_monthly_product_1"/></label>
      <label>Steam 숫자 ID<input className="cw-form-control" inputMode="numeric" value={draft.steamId} onChange={event=>change('steamId',event.target.value.trim())} placeholder="1001"/></label>
    </div>{(error||issue)&&<p className="form-error" role="alert">{error||issue}</p>}<div className="actions"><button className="cw-button" type="button" onClick={onBack}>취소</button><button className="cw-button" data-variant="primary" type="button" disabled={!!issue||!canPublish||!sheetsWritable||busy} onClick={()=>setReview(true)}>추가 내용 확인 →</button></div></section>:
    <section className="panel form-panel product-create-review"><h3>시트에 추가할 행 확인</h3><p><strong>{game.name}</strong>의 <code>Products!A:E</code> 마지막 행에 아래 값을 추가합니다.</p><div className="sheet-row-preview" role="table" aria-label="추가할 상품 시트 행">{(['productKey','name','googleId','appleId','steamId'] as const).map(field=><div role="row" key={field}><strong role="rowheader">{field}</strong><code role="cell">{draft[field]}</code></div>)}</div><section className="cw-callout" role="note" data-tone="warning"><strong>생성 후 식별자와 유형은 변경할 수 없습니다</strong><p>오타가 없는지 다시 확인하세요. 이 작업은 스토어 상품을 생성하거나 수정하지 않습니다.</p></section><div className="actions"><button className="cw-button" type="button" disabled={busy} onClick={()=>setReview(false)}>입력으로 돌아가기</button><button className="cw-button" data-variant="primary" type="button" disabled={busy} onClick={()=>void submit()}>{busy?'시트에 추가 중…':'상품 원본 추가'}</button></div></section>}
  </section>;
}
