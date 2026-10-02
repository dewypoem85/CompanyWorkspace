import { readFile } from 'node:fs/promises';
import { DomainError, type Desired, type Remote, type Row } from '../../shared/domain.js';
import { hash } from '../repository.js';
import type { Connector,ConnectorProduct } from './types.js';
import { ConnectorError } from './types.js';
import { fingerprint,type Connection } from './config.js';
import { request,body,exactMinor,type Json } from './http.js';

export function steamPrice(amount:string,currency:string){
  // 기존 CloudScript는 KRW만 원→전 변환한다. 나머지는 Steam 최소 단위 정수를 읽는다.
  if(currency==='KRW'){const won=BigInt(exactMinor(amount,0));if(won>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError('PRICE_OVERFLOW','가격 범위 초과');if(won%10n!==0n)throw new DomainError('STEAM_KRW_UNIT','Steam 원화는 10원 단위여야 합니다.');return Number(won);}
  const minor=BigInt(exactMinor(amount,2));if(minor>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError('PRICE_OVERFLOW','가격 범위 초과');
  if(['JPY','VND','CLP','TWD','UAH'].includes(currency)&&minor%100n!==0n)throw new DomainError('STEAM_CURRENCY_UNIT',`${currency} 정수 가격을 확인하세요.`);
  return Number(minor);
}
function steamAmount(value:unknown,currency:string){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return;const divisor=currency==='KRW'?1:100,whole=Math.floor(value/divisor),fraction=value%divisor;return `${whole}${fraction?'.'+String(fraction).padStart(2,'0').replace(/0+$/,''):''}`;}
export function mergeSteam(raw:string,rows:{id:string;desired:Desired}[]):string{
  const parsed=JSON.parse(raw||'{"products":[]}');
  if(!parsed||typeof parsed!=='object')throw new DomainError('BAD_CATALOG','Steam 카탈로그 구조 오류');
  const products=parsed.products??parsed;
  for(const {id,desired:d}of rows){
    const match=(p:Json)=>String(p.itemId??p.steamItemDefId??'')===id||(Array.isArray(p.storeSpecificIds)&&p.storeSpecificIds.some((v:Json)=>String(v.store).toLowerCase()==='steam'&&String(v.id)===id));
    const matches=Array.isArray(products)?products.map((p:Json,i:number)=>match(p)?i:-1).filter((i:number)=>i>=0):Object.keys(products).filter(k=>k===id||match(products[k]));
    if(matches.length>1)throw new DomainError('DUPLICATE_STEAM_ID','기존 Steam 카탈로그에 중복 ID가 있습니다.');
    const key=matches[0]??(Array.isArray(products)?products.length:id);const old=products[key]??{};
    const prices=Object.fromEntries(Object.entries(d.preset.steam).map(([currency,amount])=>[currency,steamPrice(amount,currency)]));
    products[key]={...old,itemId:id,name:d.product.name,description:d.product.localizations['ko-KR']?.description??d.product.name,amount:prices.KRW,currency:'KRW',prices,productId:old.productId??d.product.googleId??d.product.appleId??d.product.productKey,saveName:old.saveName??d.product.saveName??''};
  }
  return JSON.stringify(parsed);
}
export class SteamConnector implements Connector {
  store='steam' as const;fingerprint:string;
  constructor(private config:NonNullable<Connection['steam']>){this.fingerprint=fingerprint(config);}
  private async api(method:string,data:unknown){const key=(await readFile(this.config.secretKeyFile,'utf8')).trim();const result=await request(`https://${this.config.titleId}.playfabapi.com/Admin/${method}`,{method:'POST',headers:{'Content-Type':'application/json','X-SecretKey':key},body:body(data)});if(result?.code!==200)throw new ConnectorError('PLAYFAB_ERROR','PlayFab 카탈로그 요청 실패');return result.data as Json;}
  async read(_id:string):Promise<Remote|null>{const result=await this.api('GetTitleInternalData',{Keys:['SteamMicroTxnProductsJson']});if(!result?.Data||typeof result.Data!=='object')throw new ConnectorError('INVALID_RESPONSE','PlayFab 조회 데이터가 없습니다.');return {id:'SteamMicroTxnProductsJson',data:{raw:result.Data.SteamMicroTxnProductsJson??'{"products":[]}'}};}
  async discover(){const remote=await this.read('SteamMicroTxnProductsJson'),parsed=JSON.parse(String(remote?.data.raw??'{"products":[]}'));if(!parsed||typeof parsed!=='object')throw new DomainError('BAD_CATALOG','Steam 카탈로그 구조 오류');const source=parsed.products??parsed;const rows=Array.isArray(source)?source.map((value:any,index:number)=>[String(value?.itemId??value?.steamItemDefId??index),value]):Object.entries(source);return {products:rows.map(([key,value]:any):ConnectorProduct=>{const productId=String(value?.itemId??value?.steamItemDefId??key),suggestedProductKey=String(value?.productId??productId);if(!/^\d+$/.test(productId)||BigInt(productId)>4294967295n)throw new DomainError('STEAM_PRODUCT_RESPONSE','Steam 상품 ID 응답이 올바르지 않습니다.');const rawPrices=value?.prices&&typeof value.prices==='object'?value.prices:{...(typeof value?.currency==='string'&&value?.amount!==undefined?{[value.currency]:value.amount}:{})};const prices=Object.entries(rawPrices).flatMap(([currency,raw])=>{const amount=steamAmount(raw,currency);return amount&&/^[A-Z]{3}$/.test(currency)?[{market:currency,currency,amount}]:[]});return {productId,suggestedProductKey,name:typeof value?.name==='string'&&value.name.trim()?value.name.trim():suggestedProductKey,type:'unconfigured',description:typeof value?.description==='string'?value.description:'',localizations:{},status:typeof value?.status==='string'?value.status:undefined,prices,priceState:prices.length?'available':'unavailable',...(!prices.length?{priceMessage:'카탈로그에 통화별 가격이 없습니다.'}:{})};}).sort((a,b)=>a.productId.localeCompare(b.productId))};}
  async validate(d:Desired){if(!this.config.writesEnabled)throw new DomainError('WRITES_DISABLED','Steam 쓰기가 비활성화되어 있습니다.');if(!d.preset.steam.KRW||Number(d.preset.steam.KRW)!==Number(d.preset.krw))throw new DomainError('KR_PRICE_MISMATCH','Steam 한국 가격 누락 또는 불일치');for(const [currency,amount]of Object.entries(d.preset.steam))steamPrice(amount,currency);}
  steps(){return ['catalog','verify'];}
  async create():Promise<never>{throw new DomainError('WRONG_ROUTE','Steam은 카탈로그 병합 경로를 사용합니다.');}
  async apply(step:string,row:Row){
    await this.validate(row.desired);
    if(step==='verify'){const current=await this.read(row.remoteId);const receipt=row.steps.find(s=>s.key==='catalog')?.receipt as {hash?:string}|undefined;if(hash(current?.data.raw)!==receipt?.hash)throw new ConnectorError('VERIFY_CHANGED','Steam 반영값이 예상과 다릅니다.');return {verified:true};}
    if(step!=='catalog')throw new DomainError('INVALID_STEP','Steam 단계 오류');
    const current=await this.read(row.remoteId);if(hash(current)!==hash(row.backup))throw new DomainError('REMOTE_CHANGED','Steam 외부 변경 감지');
    const raw=mergeSteam(String(current?.data.raw??''),[{id:row.remoteId,desired:row.desired}]);
    if(Buffer.byteLength(raw,'utf8')>this.config.maxCatalogBytes)throw new DomainError('CATALOG_TOO_LARGE','카탈로그가 설정된 PlayFab 크기 제한을 초과합니다.');
    await this.api('SetTitleInternalData',{Key:'SteamMicroTxnProductsJson',Value:raw});return {hash:hash(raw)};
  }
}
