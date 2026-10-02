import { ConnectorError } from './types.js';
export type Json = Record<string,any>;
function remoteErrorDetail(value:unknown){
  if(!value||typeof value!=='object')return '';
  const root=value as any,parts:string[]=[];
  if(typeof root.error?.status==='string')parts.push(root.error.status);
  if(typeof root.error?.errors?.[0]?.reason==='string')parts.push(root.error.errors[0].reason);
  if(typeof root.error?.message==='string')parts.push(root.error.message);
  if(Array.isArray(root.errors))for(const error of root.errors.slice(0,2)){if(typeof error?.code==='string')parts.push(error.code);if(typeof error?.title==='string')parts.push(error.title);if(typeof error?.detail==='string')parts.push(error.detail);}
  return [...new Set(parts)].map(part=>part.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/Bearer\s+\S+/gi,'Bearer [숨김]').replace(/[A-Za-z0-9_-]{80,}/g,'[긴 값 숨김]').trim()).filter(Boolean).join(' · ').slice(0,500);
}
export async function request(url:string,options:RequestInit={},allow404=false):Promise<Json|null>{
  let response:Response;
  try{response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new ConnectorError('NETWORK_UNKNOWN','외부 요청의 결과를 확인하지 못했습니다.');}
  if(response.status===404&&allow404)return null;
  if(!response.ok){const status=response.status;let detail='';try{detail=remoteErrorDetail(JSON.parse(await response.text()));}catch{}const retryAfter=response.headers.get('retry-after'),seconds=retryAfter&&/^\d+$/.test(retryAfter)?Number(retryAfter):undefined;throw new ConnectorError(status===409?'ALREADY_EXISTS':status===429?'RATE_LIMIT':`REMOTE_${status}`,`외부 API HTTP ${status}${detail?' · '+detail:''}.${status===429?' 잠시 후 다시 확인하세요.':''}`,status>=500?'unknown':'rejected',status>=500||(status===429&&seconds!==undefined),seconds===undefined?undefined:seconds*1000);}
  if(response.status===204)return {};
  try{const value=await response.json();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Json;}catch{throw new ConnectorError('INVALID_RESPONSE','외부 API 응답을 해석하지 못했습니다.');}
}
export function body(data:unknown){return JSON.stringify(data);}
export function exactMinor(amount:string,digits:number):string{
  const [whole,fraction='']=amount.split('.');if(fraction.length>digits&&/[1-9]/.test(fraction.slice(digits)))throw new ConnectorError('PRICE_PRECISION','통화가 지원하지 않는 소수점입니다.','not_sent');return (BigInt(whole)*10n**BigInt(digits)+BigInt(fraction.slice(0,digits).padEnd(digits,'0')||'0')).toString();
}
export function moneyMicros(amount:string){return exactMinor(amount,6);}
