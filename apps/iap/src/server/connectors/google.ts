import { GoogleAuth } from 'google-auth-library';
import { DomainError, type Desired, type Remote, type Row } from '../../shared/domain.js';
import type { Connector,ConnectorProduct } from './types.js';
import { ConnectorError } from './types.js';
import { fingerprint, mobileWrites, type Connection } from './config.js';
import { request, body, moneyMicros, type Json } from './http.js';
export class GoogleConnector implements Connector {
  store='google' as const;fingerprint:string;auth:GoogleAuth;
  constructor(private config:NonNullable<Connection['google']>){this.fingerprint=fingerprint(config);this.auth=new GoogleAuth({keyFile:config.keyFile,scopes:['https://www.googleapis.com/auth/androidpublisher']});}
  saleCountries(){return [...new Set(this.config.legacySaleCountries)].sort();}
  private async api(path:string,method='GET',data?:unknown,allow404=false){const token=await this.auth.getAccessToken();return request('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+this.config.packageName+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data===undefined?undefined:body(data)},allow404);}
  async read(id:string):Promise<Remote|null>{
    // 신·구 카탈로그 조회 실패를 미등록으로 오판하지 않는다.
    const modern=await this.api('/oneTimeProducts/'+encodeURIComponent(id),'GET',undefined,true);
    if(modern)return {id,data:{model:'onetimeproduct',product:modern}};
    const legacy=await this.api('/inappproducts/'+encodeURIComponent(id),'GET',undefined,true);
    return legacy?{id,data:{model:'legacy',product:legacy}}:null;
  }
  private money(price:any){const currency=String(price?.currencyCode??price?.currency??''),units=String(price?.units??'0'),nanos=Number(price?.nanos??0);if(!/^[A-Z]{3}$/.test(currency)||!/^\d+$/.test(units)||!Number.isInteger(nanos)||nanos<0||nanos>=1_000_000_000)return;const fraction=String(nanos).padStart(9,'0').replace(/0+$/,'');return {currency,amount:`${BigInt(units)}${fraction?'.'+fraction:''}`};}
  private legacyMoney(price:any){const currency=String(price?.currency??''),micros=String(price?.priceMicros??'');if(!/^[A-Z]{3}$/.test(currency)||!/^\d+$/.test(micros))return;const padded=micros.padStart(7,'0'),whole=padded.slice(0,-6),fraction=padded.slice(-6).replace(/0+$/,'');return {currency,amount:`${BigInt(whole)}${fraction?'.'+fraction:''}`};}
  private discovered(product:any,modern:boolean):ConnectorProduct{
    const productId=String(modern?product?.productId:product?.sku??'');
    if(!/^[a-z0-9][a-z0-9_.]*$/.test(productId))throw new DomainError('GOOGLE_PRODUCT_RESPONSE','Google 상품 ID 응답이 올바르지 않습니다.');
    const entries=modern?(Array.isArray(product?.listings)?product.listings.map((value:any)=>[value?.languageCode,value]):[]):Object.entries(product?.listings??{});
    const localizations=Object.fromEntries(entries.flatMap(([locale,value]:any)=>typeof locale==='string'&&typeof value?.title==='string'&&value.title.trim()&&typeof value?.description==='string'&&value.description.trim()?[[locale,{name:value.title.trim(),description:value.description.trim()}]]:[]));
    const preferred=localizations[this.config.defaultLanguage]??Object.values(localizations)[0];
    const prices=modern?(Array.isArray(product?.purchaseOptions)?product.purchaseOptions.flatMap((option:any)=>Array.isArray(option?.regionalPricingAndAvailabilityConfigs)?option.regionalPricingAndAvailabilityConfigs.flatMap((regional:any)=>{const price=this.money(regional?.price),market=regional?.regionCode;if(!price||typeof market!=='string'||!/^[A-Z]{2}$/.test(market))return [];return [{market,...price,availability:typeof regional?.availability==='string'?regional.availability:undefined,optionId:typeof option?.purchaseOptionId==='string'?option.purchaseOptionId:undefined}];}):[]):[]):Object.entries(product?.prices??{}).flatMap(([market,price])=>{const value=this.legacyMoney(price);return value&&/^[A-Z]{2}$/.test(market)?[{market,...value}]:[]});
    return {productId,name:preferred?.name??productId,type:'unconfigured',description:preferred?.description??'',localizations,status:String(product?.state??product?.status??''),prices,priceState:prices.length?'available':'unavailable',...(!prices.length?{priceMessage:'스토어 응답에 국가별 가격이 없습니다.'}:{})};
  }
  async discover(){
    const found=new Map<string,ConnectorProduct>(),failures:string[]=[];
    try{let token='';const seen=new Set<string>();do{if(seen.has(token)||seen.size>200)throw new DomainError('PAGINATION','Google 최신 상품 목록 페이지 제한');seen.add(token);const result=await this.api('/oneTimeProducts?pageSize=1000'+(token?'&pageToken='+encodeURIComponent(token):'')),rows=result?.oneTimeProducts??[];if(!Array.isArray(rows))throw new DomainError('GOOGLE_PRODUCT_RESPONSE','Google 최신 상품 목록 응답이 올바르지 않습니다.');for(const product of rows){const value=this.discovered(product,true);found.set(value.productId,value);}token=typeof result?.nextPageToken==='string'?result.nextPageToken:'';}while(token);}catch(error){failures.push(`최신 상품: ${error instanceof Error?error.message:'조회 실패'}`);}
    try{let token='';const seen=new Set<string>();do{if(seen.has(token)||seen.size>200)throw new DomainError('PAGINATION','Google 기존 상품 목록 페이지 제한');seen.add(token);const result=await this.api('/inappproducts'+(token?'?token='+encodeURIComponent(token):'')),rows=result?.inappproduct??[];if(!Array.isArray(rows))throw new DomainError('GOOGLE_PRODUCT_RESPONSE','Google 기존 상품 목록 응답이 올바르지 않습니다.');for(const product of rows){if(product?.purchaseType==='subscription')continue;const value=this.discovered(product,false);if(!found.has(value.productId))found.set(value.productId,value);}token=typeof result?.tokenPagination?.nextPageToken==='string'?result.tokenPagination.nextPageToken:'';}while(token);}catch(error){failures.push(`기존 상품: ${error instanceof Error?error.message:'조회 실패'}`);}
    if(failures.length===2)throw new DomainError('GOOGLE_DISCOVERY_FAILED',failures.join(' / '));
    return {products:[...found.values()].sort((a,b)=>a.productId.localeCompare(b.productId)),...(failures.length?{message:`일부 조회 경로를 사용할 수 없습니다. ${failures[0]}`}:{})};
  }
  async validate(d:Desired,fields?:string[]){
    mobileWrites(this.config);
    if(fields?.some(f=>['availability','reviewImage','reviewNote','submitReview'].includes(f)))throw new DomainError('GOOGLE_UNSUPPORTED_FIELD','이 Google 연결은 번역·가격·활성화만 예외 수정할 수 있습니다.');
    if(!fields||fields.includes('activate')){
      const countries=this.saleCountries();
      if(!countries.length||JSON.stringify(countries)!==JSON.stringify([...new Set(d.settings.countries)].sort()))throw new DomainError('GOOGLE_AVAILABILITY_UNVERIFIED','구형 API의 앱 판매 국가와 요청 국가가 일치해야 합니다. 서버에서 실제 판매 국가를 검증한 뒤 연결하세요.');
    }
    const locales={...d.product.localizations,...d.settings.localizations};
    if(!locales[this.config.defaultLanguage])throw new DomainError('DEFAULT_LOCALE_MISSING','Google 기본 언어 번역이 없습니다.');
    for(const l of Object.values(locales))if(l.name.length>55||l.description.length>200)throw new DomainError('GOOGLE_TEXT_LENGTH','Google 제목 55자·설명 200자 제한을 확인하세요.');
    if(!d.preset.google.KR||d.preset.google.KR.currency!=='KRW'||Number(d.preset.google.KR.amount)!==Number(d.preset.krw))throw new DomainError('KR_PRICE_MISMATCH','한국 판매가와 가격표가 일치하지 않습니다.');
    for(const country of d.settings.countries)if(!d.preset.google[country])throw new DomainError('MISSING_REGION_PRICE',`${country} 가격 누락`);
  }
  steps(d:Desired,fields?:string[]){return fields?[...fields.filter(f=>f==='localizations'||f==='prices'),...(fields.includes('activate')?['activate']:[]),'verify']: [...(d.settings.activate?['activate']:[]),'verify'];}
  private payload(id:string,d:Desired):Json{
    const listings=Object.fromEntries(Object.entries({...d.product.localizations,...d.settings.localizations}).map(([locale,l])=>[locale,{title:l.name,description:l.description}]));
    const prices=Object.fromEntries(Object.entries(d.preset.google).map(([country,p])=>[country,{currency:p.currency,priceMicros:moneyMicros(p.amount)}]));
    return {packageName:this.config.packageName,sku:id,status:'inactive',purchaseType:'managedUser',defaultLanguage:this.config.defaultLanguage,listings,defaultPrice:prices.KR,prices};
  }
  async create(id:string,d:Desired){await this.validate(d);const result=await this.api('/inappproducts?autoConvertMissingPrices=false','POST',this.payload(id,d));if(result?.sku!==id)throw new ConnectorError('CREATE_UNCONFIRMED','Google 생성 응답의 ID가 일치하지 않습니다.');return {id,receipt:{sku:id,method:'inappproducts.insert'}};}
  async apply(step:string,row:Row){
    mobileWrites(this.config);
    if(step==='verify'){const value=await this.read(row.remoteId);if(!value)throw new ConnectorError('VERIFY_MISSING','등록 후 상품이 조회되지 않습니다.');return value;}
    const legacy=await this.api('/inappproducts/'+encodeURIComponent(row.remoteId),'GET',undefined,true);
    if(!legacy)throw new DomainError('LEGACY_UNAVAILABLE','Google 상품이 새 모델로 전환되어 이 경로로 수정할 수 없습니다. 수동 작업이 필요합니다.');
    const desired=this.payload(row.remoteId,row.desired);
    const update:Json=step==='prices'?{prices:desired.prices,defaultPrice:desired.defaultPrice}:step==='localizations'?{listings:desired.listings}:step==='activate'?{status:row.desired.settings.activate?'active':'inactive'}:{};
    if(!Object.keys(update).length)throw new DomainError('INVALID_STEP','허용되지 않은 Google 단계');
    // PATCH는 신규 작업 소유 증거 또는 단일 상품 예외 승인 경로에서만 도달한다. upsert 사용 금지.
    await this.api('/inappproducts/'+encodeURIComponent(row.remoteId)+'?autoConvertMissingPrices=false','PATCH',update);
    return {step,applied:update};
  }
  async priceSuggestions(taxExclusiveKrw:string){return this.api('/pricing:convertRegionPrices','POST',{price:{currencyCode:'KRW',units:taxExclusiveKrw,nanos:0}});}
}
