export type NodeStageRateInput={id?:string|number;runs?:unknown;selectionRate?:unknown};

function positive(value:unknown){
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>0?parsed:0;
}

// 한 단계에서 실제로 기록된 선택만 분모로 삼고, 표시값 합계가 100.0%가 되도록
// 0.1% 단위의 최대 나머지 방식으로 반올림 오차를 배분한다.
export function nodeStageSelectionRates(items:NodeStageRateInput[]){
  let weights=items.map(item=>positive(item.runs));
  if(!weights.some(Boolean))weights=items.map(item=>positive(item.selectionRate));
  const total=weights.reduce((sum,value)=>sum+value,0);
  if(total<=0)return items.map(()=>0);

  const exact=weights.map(value=>value/total*1000);
  const units=exact.map(Math.floor);
  const remaining=1000-units.reduce((sum,value)=>sum+value,0);
  const order=exact.map((value,index)=>({
    index,
    remainder:value-units[index],
    id:Number(items[index]?.id)
  })).sort((left,right)=>right.remainder-left.remainder||(Number.isFinite(left.id)?left.id:left.index)-(Number.isFinite(right.id)?right.id:right.index)||left.index-right.index);
  for(let index=0;index<remaining;index+=1)units[order[index].index]+=1;
  return units.map(value=>value/10);
}
