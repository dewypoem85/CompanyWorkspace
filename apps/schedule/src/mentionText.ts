const pattern=/@\[([^\]\r\n]{1,100})\]\((\d+)\)/g;
type Span={start:number;end:number;token:string};
export function parseMentionText(value:string){
  let text='',offset=0;const spans:Span[]=[];
  for(const match of value.matchAll(pattern)){
    text+=value.slice(offset,match.index);const start=text.length;text+='@'+match[1];
    spans.push({start,end:text.length,token:match[0]});offset=match.index!+match[0].length;
  }
  return {text:text+value.slice(offset),spans};
}
function serialize(text:string,spans:Span[]){
  let value='',offset=0;
  for(const span of spans.sort((a,b)=>a.start-b.start)){value+=text.slice(offset,span.start)+span.token;offset=span.end;}
  return value+text.slice(offset);
}
function retain(spans:Span[],start:number,end:number,delta:number){
  return spans.flatMap(span=>span.end<=start?[span]:span.start>=end?[{...span,start:span.start+delta,end:span.end+delta}]:[]);
}
export function editMentionText(value:string,next:string,hint?:{start:number;end:number;type:string}){
  const {text,spans}=parseMentionText(value);if(text===next)return value;
  let start=0,end=text.length,newEnd=next.length;
  while(start<text.length&&start<next.length&&text[start]===next[start])start++;
  while(end>start&&newEnd>start&&text[end-1]===next[newEnd-1]){end--;newEnd--;}
  if(hint){
    let a=hint.start,b=hint.end;const delta=next.length-text.length;
    if(a===b&&delta<0){if(hint.type==='deleteContentBackward')a=Math.max(0,a+delta);else if(hint.type==='deleteContentForward')b=Math.min(text.length,b-delta);}
    const insertedLength=next.length-(text.length-(b-a));
    if(insertedLength>=0&&next.slice(0,a)===text.slice(0,a)&&next.slice(a+insertedLength)===text.slice(b)){start=a;end=b;}
  }
  return serialize(next,retain(spans,start,end,next.length-text.length));
}
export function insertMentionText(value:string,start:number,end:number,label:string,id:number){
  if(!Number.isSafeInteger(id)||id<1)throw Error('잘못된 멘션 직원 ID입니다.');
  const name=label.replace(/[\]\r\n]/g,' ').trim().slice(0,100)||'직원';
  const {text,spans}=parseMentionText(value),display='@'+name;
  const next=text.slice(0,start)+display+' '+text.slice(end);
  const remaining=retain(spans,start,end,display.length+1-(end-start));
  remaining.push({start,end:start+display.length,token:`@[${name}](${id})`});
  return {value:serialize(next,remaining),caret:start+display.length+1};
}
