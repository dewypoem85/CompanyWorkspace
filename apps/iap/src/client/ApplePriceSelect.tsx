import React,{useEffect,useId,useMemo,useRef,useState} from 'react';

export type AppleMatrixSummary={
  id:string;sha256:string;sourceFile:string;territoryCount:number;currencyCount:number;sourceRowCount:number;
  points:{id:string;amount:string;currency:'KRW'}[];
};
export type PriceMatrixChoice={pricePointId:string;selectionId?:string;amount:string;currency:string};

export async function getJson(url:string){const response=await fetch('/api'+url);const data=await response.json();if(!response.ok)throw new Error(data.error??'조회 실패');return data;}

export function ApplePriceSelect({value,onChange,source,sourceLabel='제공 CSV'}:{value:PriceMatrixChoice;onChange:(value:PriceMatrixChoice)=>void;source?:AppleMatrixSummary;sourceLabel?:string}){
  const listId=useId(),root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),autoApplied=useRef('');
  const [matrix,setMatrix]=useState<AppleMatrixSummary|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[query,setQuery]=useState(''),[open,setOpen]=useState(false),[activeIndex,setActiveIndex]=useState(0);
  useEffect(()=>{let cancelled=false;setError('');if(source){setMatrix(source);setBusy(false);return;}setBusy(true);getJson('/price-matrix').then(data=>{if(!cancelled)setMatrix(data);}).catch(error=>{if(!cancelled)setError(error.message);}).finally(()=>{if(!cancelled)setBusy(false);});return()=>{cancelled=true;};},[source?.id]);
  useEffect(()=>{const dismiss=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)){setOpen(false);setQuery('');}};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[]);
  useEffect(()=>{if(open)document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({block:'nearest'});},[activeIndex,listId,open]);
  const digits=query.replace(/[^0-9]/g,''),points=useMemo(()=>{
    const matches=matrix?.points.filter(point=>!digits||point.amount.includes(digits))??[];
    if(!digits)return matches;
    return [...matches].sort((a,b)=>Number(b.amount===digits)-Number(a.amount===digits)||Number(a.amount.startsWith(digits)?0:1)-Number(b.amount.startsWith(digits)?0:1)||Number(a.amount)-Number(b.amount));
  },[matrix,digits]);
  const selected=matrix&&matrix.id===value.selectionId&&matrix.points.some(point=>point.id===value.pricePointId&&point.amount===value.amount)?value.pricePointId:'';
  const selectedIndex=points.findIndex(point=>point.id===selected),displayValue=value.amount?`${Number(value.amount).toLocaleString('ko-KR')}원`:'';
  useEffect(()=>{if(!matrix||value.pricePointId||!value.amount)return;const point=matrix.points.find(candidate=>Number(candidate.amount)===Number(value.amount));if(!point)return;const signature=`${matrix.id}:${point.id}`;if(autoApplied.current===signature)return;autoApplied.current=signature;onChange({pricePointId:point.id,selectionId:matrix.id,amount:point.amount,currency:point.currency});},[matrix,value.pricePointId,value.amount,onChange]);
  function show(){if(open||!matrix||busy)return;setQuery('');setOpen(true);setActiveIndex(selectedIndex>=0?selectedIndex:0);}
  function choose(point:AppleMatrixSummary['points'][number]){if(!matrix)return;onChange({pricePointId:point.id,selectionId:matrix.id,amount:point.amount,currency:point.currency});setOpen(false);setQuery('');input.current?.focus();}
  function keyDown(event:React.KeyboardEvent<HTMLInputElement>){
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      if(!open){show();return;}
      setActiveIndex(index=>points.length?(index+(event.key==='ArrowDown'?1:-1)+points.length)%points.length:0);
    }else if(event.key==='Enter'&&open&&points[activeIndex]){event.preventDefault();choose(points[activeIndex]);}
    else if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);setQuery('');}
  }
  return <div className="apple-price-select">
    <div className="price-combobox" ref={root}>
      <label htmlFor={`${listId}-input`}>대한민국 판매가</label>
      <input ref={input} id={`${listId}-input`} className="cw-form-control" type="text" inputMode="numeric" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&points[activeIndex]?`${listId}-${activeIndex}`:undefined} aria-label="대한민국 판매 가격" disabled={!matrix||busy} placeholder={busy?'가격 데이터 불러오는 중…':open&&displayValue?`현재 ${displayValue} · 가격 검색`:'가격 검색 (예: 5,500)'} value={open?query:displayValue} onFocus={show} onClick={show} onChange={event=>{setQuery(event.target.value);setOpen(true);setActiveIndex(0);}} onKeyDown={keyDown}/>
      {open&&<div className="price-combobox-menu">
        <div id={listId} role="listbox" aria-label="대한민국 판매 가격 검색 결과">
          {points.map((point,index)=><button type="button" id={`${listId}-${index}`} role="option" aria-selected={point.id===selected} className={`cw-button price-combobox-option${index===activeIndex?' active':''}`} key={point.id} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActiveIndex(index)} onClick={()=>choose(point)}><span>{Number(point.amount).toLocaleString('ko-KR')}원</span>{point.id===selected&&<small>현재 선택</small>}</button>)}
        </div>
        {points.length===0&&<p role="status">일치하는 가격이 없습니다.</p>}
        <small>{digits?`${points.length}개 검색 결과`:`전체 ${matrix?.points.length??0}개 가격`} · ↑↓ 이동 · Enter 선택</small>
      </div>}
    </div>
    {matrix&&<small>{sourceLabel} · {matrix.points.length}개 가격{matrix.territoryCount>1&&<> · {matrix.territoryCount}개 국가 · {matrix.currencyCount}개 통화</>} · 버전 {matrix.sha256.slice(0,12)}</small>}
    {error&&<small role="alert" className="price-error">{error}</small>}
  </div>;
}
