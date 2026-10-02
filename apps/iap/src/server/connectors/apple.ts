import { access,readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { DomainError, type Desired, type Remote, type Row } from '../../shared/domain.js';
import { fingerprint, mobileWrites, type Connection } from './config.js';
import { request, body, type Json } from './http.js';
import { ConnectorError, type Connector,type ConnectorProduct } from './types.js';

const relation=(type:string,id:string)=>({data:{type,id}});
const apiBody=(type:string,attributes?:unknown,relationships?:unknown,id?:string)=>({data:{type,...(id?{id}:{}),...(attributes?{attributes}:{}),...(relationships?{relationships}:{})}});
export class AppleConnector implements Connector {
  store='apple' as const;fingerprint:string;
  private discoveryCache?:{at:number;value:Awaited<ReturnType<AppleConnector['discoverFresh']>>};private discoveryRequest?:Promise<Awaited<ReturnType<AppleConnector['discoverFresh']>>>;private tokenCache?:{expiresAt:number;value:string};
  constructor(private config:NonNullable<Connection['apple']>,private reviewAssetDirectory=process.env.REVIEW_ASSET_DIR??'/app/data/review-assets'){this.fingerprint=fingerprint({config,reviewAssetDirectory});}
  private reviewImageFile(reference:string|undefined){if(!reference)return;const configured=this.config.reviewImages[reference];if(configured)return configured;if(/^review-[0-9a-f-]{36}\.(png|jpg)$/.test(reference))return path.join(path.resolve(this.reviewAssetDirectory),reference);}
  async priceProducts(){
    const products=await this.list(`/v1/apps/${this.config.appId}/inAppPurchasesV2?limit=200`);
    return products.map(p=>{if(typeof p.id!=='string'||typeof p.attributes?.productId!=='string')throw new DomainError('APPLE_PRODUCT_RESPONSE','Apple 상품 목록 응답을 확인할 수 없습니다.');return {id:p.id,productId:p.attributes.productId,name:String(p.attributes?.name??p.attributes.productId)};});
  }
  private async discoverFresh(){
    const path=`/v1/apps/${this.config.appId}/inAppPurchasesV2?include=inAppPurchaseLocalizations&fields[inAppPurchases]=name,productId,inAppPurchaseType,state,inAppPurchaseLocalizations&fields[inAppPurchaseLocalizations]=name,locale,description,state,inAppPurchaseV2&limit=200&limit[inAppPurchaseLocalizations]=50`,collection=await this.collection(path),localizationsById=new Map<string,{locale:string;name:string;description:string}>(),byProduct=new Map<string,Record<string,{name:string;description:string}>>();
    for(const localization of collection.included){if(localization?.type!=='inAppPurchaseLocalizations')continue;const id=localization?.id,locale=localization?.attributes?.locale,name=localization?.attributes?.name,description=localization?.attributes?.description;if(typeof id!=='string'||typeof locale!=='string'||typeof name!=='string'||!name.trim()||typeof description!=='string'||!description.trim())continue;localizationsById.set(id,{locale,name:name.trim(),description:description.trim()});const parent=localization?.relationships?.inAppPurchaseV2?.data?.id;if(typeof parent==='string'){const values=byProduct.get(parent)??{};values[locale]={name:name.trim(),description:description.trim()};byProduct.set(parent,values);}}
    for(const product of collection.data){if(typeof product?.id!=='string')continue;const values=byProduct.get(product.id)??{};for(const relation of product?.relationships?.inAppPurchaseLocalizations?.data??[]){const localization=localizationsById.get(relation?.id);if(localization)values[localization.locale]={name:localization.name,description:localization.description};}byProduct.set(product.id,values);}
    const products=collection.data.map(product=>{const productId=product?.attributes?.productId,referenceName=product?.attributes?.name,type=product?.attributes?.inAppPurchaseType;if(typeof productId!=='string'||!/^[a-zA-Z0-9_.-]+$/.test(productId)||typeof product?.id!=='string')throw new DomainError('APPLE_PRODUCT_RESPONSE','Apple 상품 ID 응답이 올바르지 않습니다.');const localizations=byProduct.get(product.id)??{},preferred=localizations['ko-KR']??localizations.ko??Object.values(localizations)[0];return {productId,resourceId:product.id,name:preferred?.name??(typeof referenceName==='string'&&referenceName.trim()?referenceName.trim():productId),type:type==='CONSUMABLE'?'consumable' as const:type==='NON_CONSUMABLE'?'nonConsumable' as const:'unconfigured' as const,description:preferred?.description??'',localizations,status:typeof product?.attributes?.state==='string'?product.attributes.state:undefined,prices:[],priceState:'separate_request' as const,priceMessage:'Apple 현재 가격은 상품별 가격 일정 API에서 별도로 확인합니다.'};}).sort((a,b)=>a.productId.localeCompare(b.productId));
    return {products};
  }
  async discover(){if(this.discoveryCache&&Date.now()-this.discoveryCache.at<5*60_000)return {...this.discoveryCache.value,message:'5분 이내 App Store 조회 결과를 재사용했습니다.'};if(!this.discoveryRequest)this.discoveryRequest=this.discoverFresh().then(value=>{this.discoveryCache={at:Date.now(),value};return value;}).finally(()=>{this.discoveryRequest=undefined;});return this.discoveryRequest;}
  async discoverPrice(resourceId:string){
    const result=await this.api(`/v1/inAppPurchasePriceSchedules/${encodeURIComponent(resourceId)}/manualPrices?filter[territory]=KOR&include=inAppPurchasePricePoint,territory&fields[inAppPurchasePrices]=startDate,endDate,inAppPurchasePricePoint,territory&fields[inAppPurchasePricePoints]=customerPrice,territory&fields[territories]=currency&limit=200`,'GET',undefined,true);
    if(!result)return [];if(!Array.isArray(result.data)||!Array.isArray(result.included??[]))throw new DomainError('APPLE_PRICE_RESPONSE','Apple 현재 가격 응답이 올바르지 않습니다.');const included=result.included??[],now=Date.now(),current=result.data.filter((price:Json)=>{const start=price.attributes?.startDate?Date.parse(price.attributes.startDate):-Infinity,end=price.attributes?.endDate?Date.parse(price.attributes.endDate):Infinity;return start<=now&&now<end;});if(current.length!==1)return [];
    const pointId=current[0].relationships?.inAppPurchasePricePoint?.data?.id,point=included.find((value:Json)=>value.type==='inAppPurchasePricePoints'&&value.id===pointId),territoryId=point?.relationships?.territory?.data?.id??current[0].relationships?.territory?.data?.id,territory=included.find((value:Json)=>value.type==='territories'&&value.id===territoryId),amount=point?.attributes?.customerPrice,currency=territory?.attributes?.currency;if(territoryId!=='KOR'||typeof amount!=='string'||!/^\d+(\.\d+)?$/.test(amount)||currency!=='KRW')throw new DomainError('APPLE_PRICE_RESPONSE','Apple 대한민국 현재 가격을 확인할 수 없습니다.');return [{market:'KOR',currency:'KRW',amount,optionId:pointId}];
  }
  async territories(){
    const values=await this.list('/v1/territories?fields[territories]=currency&limit=200');
    return values.map(value=>{const id=value.id,currency=value.attributes?.currency;if(typeof id!=='string'||!/^[A-Z]{3}$/.test(id)||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw new DomainError('APPLE_TERRITORY_RESPONSE','Apple 판매 지역 응답이 올바르지 않습니다.');return {id,currency};}).sort((a,b)=>a.id.localeCompare(b.id));
  }
  async pricePoints(productId:string,territory:string){
    if(!(await this.priceProducts()).some(p=>p.id===productId))throw new DomainError('APPLE_PRODUCT','해당 프로젝트의 Apple 상품을 선택하세요.');
    const region=await this.api(`/v1/territories/${encodeURIComponent(territory)}`);
    const currency=region?.data?.attributes?.currency;
    if(region?.data?.id!==territory||typeof currency!=='string')throw new DomainError('APPLE_TERRITORY','Apple 국가·통화를 확인할 수 없습니다.');
    const points=await this.list(`/v2/inAppPurchases/${encodeURIComponent(productId)}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`);
    return points.map(p=>{
      if(typeof p.id!=='string'||typeof p.attributes?.customerPrice!=='string'||!/^\d+(\.\d+)?$/.test(p.attributes.customerPrice))throw new DomainError('APPLE_PRICE_RESPONSE','Apple 가격 응답이 올바르지 않습니다.');
      return {id:p.id,amount:p.attributes.customerPrice,currency};
    }).filter(p=>Number(p.amount)>0).sort((a,b)=>Number(a.amount)-Number(b.amount));
  }
  async equalizations(pricePointId:string){
    let next=`/v1/inAppPurchasePricePoints/${encodeURIComponent(pricePointId)}/equalizations?include=territory&fields[territories]=currency&limit=8000`;const prices:Json[]=[];const territories=new Map<string,string>();const seen=new Set<string>();
    while(next){if(seen.has(next)||seen.size>200)throw new DomainError('PAGINATION','Apple 자동 가격 페이지 조회 제한');seen.add(next);const result=await this.api(next);if(!Array.isArray(result?.data)||(result?.included!==undefined&&!Array.isArray(result.included)))throw new DomainError('APPLE_EQUALIZATION_RESPONSE','Apple 자동 가격 응답이 올바르지 않습니다.');prices.push(...result.data);for(const included of result.included??[]){if(included?.type==='territories'&&typeof included.id==='string'&&typeof included.attributes?.currency==='string')territories.set(included.id,included.attributes.currency);}const linked=result?.links?.next;if(!linked)break;const url=new URL(linked);if(url.origin!=='https://api.appstoreconnect.apple.com')throw new DomainError('BAD_NEXT_URL','Apple 페이지 주소 오류');next=url.pathname+url.search;}
    return prices.map(value=>{const territory=value.relationships?.territory?.data?.id,amount=value.attributes?.customerPrice,currency=territories.get(territory);if(typeof territory!=='string'||!/^[A-Z]{3}$/.test(territory)||typeof amount!=='string'||!/^\d+(\.\d+)?$/.test(amount)||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw new DomainError('APPLE_EQUALIZATION_RESPONSE','Apple 자동 가격의 국가·통화를 확인할 수 없습니다.');return {territory,amount,currency};}).sort((a,b)=>a.territory.localeCompare(b.territory));
  }
  private async token(){if(this.tokenCache&&this.tokenCache.expiresAt>Date.now()+30_000)return this.tokenCache.value;const now=Math.floor(Date.now()/1000);const head=Buffer.from(JSON.stringify({alg:'ES256',kid:this.config.keyId,typ:'JWT'})).toString('base64url');const payload=Buffer.from(JSON.stringify({iss:this.config.issuerId,iat:now,exp:now+300,aud:'appstoreconnect-v1'})).toString('base64url');const message=head+'.'+payload,value=message+'.'+sign('sha256',Buffer.from(message),{key:createPrivateKey(await readFile(this.config.keyFile)),dsaEncoding:'ieee-p1363'}).toString('base64url');this.tokenCache={expiresAt:(now+300)*1000,value};return value;}
  private async api(path:string,method='GET',data?:unknown,allow404=false){if(!path.startsWith('/'))throw new DomainError('BAD_PATH','Apple API 경로 오류');return request('https://api.appstoreconnect.apple.com'+path,{method,headers:{Authorization:'Bearer '+await this.token(),'Content-Type':'application/json'},body:data===undefined?undefined:body(data)},allow404);}
  private async collection(path:string){const data:Json[]=[],included:Json[]=[];const seen=new Set<string>();while(path){if(seen.has(path)||seen.size>200)throw new DomainError('PAGINATION','Apple 페이지 조회 제한');seen.add(path);const result=await this.api(path);if(!Array.isArray(result?.data)||(result?.included!==undefined&&!Array.isArray(result.included)))throw new ConnectorError('INVALID_RESPONSE','Apple 목록 응답 오류');data.push(...result.data);included.push(...(result.included??[]));const next=result?.links?.next;if(!next)break;const url=new URL(next);if(url.origin!=='https://api.appstoreconnect.apple.com')throw new DomainError('BAD_NEXT_URL','Apple 페이지 주소 오류');path=url.pathname+url.search;}return {data,included};}
  private async list(path:string){return (await this.collection(path)).data;}
  async read(id:string):Promise<Remote|null>{
    const all=await this.list(`/v1/apps/${this.config.appId}/inAppPurchasesV2?limit=200`);const product=all.find(p=>p.attributes?.productId===id);if(!product)return null;
    const versions=await this.list(`/v2/inAppPurchases/${product.id}/versions?limit=200`);
    const metadata=[];for(const version of versions){metadata.push({version,localizations:await this.list(`/v1/inAppPurchaseVersions/${version.id}/localizations?limit=200`)});}
    const prices=await this.api(`/v1/inAppPurchasePriceSchedules/${product.id}/manualPrices?include=inAppPurchasePricePoint&limit=200`,'GET',undefined,true);
    if(prices?.links?.next)throw new DomainError('PRICE_PAGINATION','가격 스냅샷이 한 페이지를 초과합니다. 자동 변경을 차단합니다.');
    const availability=await this.api(`/v2/inAppPurchases/${product.id}/inAppPurchaseAvailability`,'GET',undefined,true);
    const territories=availability?.data?.id?await this.list(`/v1/inAppPurchaseAvailabilities/${availability.data.id}/availableTerritories?limit=200`):[];
    const screenshot=await this.api(`/v2/inAppPurchases/${product.id}/appStoreReviewScreenshot`,'GET',undefined,true);
    return {id:product.id,data:{product,versions:metadata,prices,availability,territories,screenshot}};
  }
  async validate(d:Desired,fields?:string[]){
    mobileWrites(this.config);const has=(f:string)=>!fields||fields.includes(f);
    if(fields?.includes('activate'))throw new DomainError('APPLE_ACTIVATE','Apple 판매 지역 변경은 availability를 선택하세요.');
    if(has('localizations')){const locales={...d.product.localizations,...d.settings.localizations};if(!Object.keys(locales).length)throw new DomainError('MISSING_LOCALE','Apple 번역이 없습니다.');for(const l of Object.values(locales))if(l.name.length>30||l.description.length>45)throw new DomainError('APPLE_TEXT_LENGTH','Apple 상품명 30자·설명 45자 제한을 확인하세요.');}
    if(has('prices')){if(Object.keys(d.preset.apple).length!==1||!d.preset.apple.KOR||Number(d.preset.apple.KOR.amount)!==Number(d.preset.krw))throw new DomainError('KR_PRICE_MISMATCH','Apple 대한민국 기준 가격 포인트 하나를 선택하세요.');if(!d.preset.apple.KOR.selectionId)throw new DomainError('APPLE_PRICE_SELECTION','가격표에서 Apple 가격 포인트를 조회·선택한 새 버전을 확정하세요.');}
    if(has('availability')){const available=new Set((await this.territories()).map(territory=>territory.id));for(const territory of d.settings.countries)if(!available.has(territory))throw new DomainError('APPLE_TERRITORY','Apple이 제공하는 판매 지역만 선택할 수 있습니다.');}
    if(has('reviewImage')&&d.settings.reviewImageRef){const file=this.reviewImageFile(d.settings.reviewImageRef);if(!file)throw new DomainError('IMAGE_MISSING','등록된 심사 이미지 파일이 없습니다.');try{await access(file);}catch{throw new DomainError('IMAGE_MISSING','등록된 심사 이미지 파일이 없습니다.');}}
    if(has('submitReview')&&d.settings.submitReview&&!d.settings.reviewImageRef&&!fields)throw new DomainError('REVIEW_IMAGE_REQUIRED','신규 심사 제출에는 심사 이미지가 필요합니다.');
    if(fields?.includes('submitReview')&&!fields.includes('localizations'))throw new DomainError('VERSION_REQUIRED','예외 심사 제출은 새 번역 버전과 함께 계획하세요.');
  }
  steps(d:Desired,fields?:string[]){
    const has=(f:string)=>!fields||fields.includes(f);const steps:string[]=[];
    if(has('localizations'))steps.push('version',...Object.keys({...d.product.localizations,...d.settings.localizations}).sort().map(l=>'locale:'+l));
    if(has('reviewNote')&&fields)steps.push('reviewNote');
    if(has('prices'))steps.push('prices');if(has('availability'))steps.push('availability');
    if(has('reviewImage')&&d.settings.reviewImageRef)steps.push('image.reserve','image.upload','image.commit','image.verify');
    if(has('submitReview')&&d.settings.submitReview)steps.push('review.check','review.create','review.item','review.submit');
    return [...steps,'verify'];
  }
  async create(id:string,d:Desired){await this.validate(d);const result=await this.api('/v2/inAppPurchases','POST',apiBody('inAppPurchases',{name:d.product.name,productId:id,inAppPurchaseType:d.product.type==='consumable'?'CONSUMABLE':'NON_CONSUMABLE',reviewNote:d.settings.reviewNote},{app:relation('apps',this.config.appId)}));if(!result?.data?.id||result.data.attributes?.productId!==id)throw new ConnectorError('CREATE_UNCONFIRMED','Apple 생성 ID 확인 실패');return {id:result.data.id,receipt:{id:result.data.id,productId:id}};}
  async apply(step:string,row:Row):Promise<unknown>{
    mobileWrites(this.config);const id=row.created?.id??row.before?.id;if(!id)throw new DomainError('NO_REMOTE_ID','Apple 원격 ID 누락');
    const d=row.desired;const receipt=(key:string)=>row.steps.find(s=>s.key===key&&s.state==='done')?.receipt as Json|undefined;
    if(step==='version')return (await this.api('/v1/inAppPurchaseVersions','POST',apiBody('inAppPurchaseVersions',undefined,{inAppPurchase:relation('inAppPurchases',id)})))?.data;
    if(step.startsWith('locale:')){const locale=step.slice(7);const version=receipt('version')?.id;if(!version)throw new DomainError('NO_VERSION','버전 생성 증거 누락');const text={...d.product.localizations,...d.settings.localizations}[locale];return (await this.api('/v2/inAppPurchaseLocalizations','POST',apiBody('inAppPurchaseLocalizations',{locale,...text},{version:relation('inAppPurchaseVersions',version)})))?.data;}
    if(step==='reviewNote')return this.api('/v2/inAppPurchases/'+id,'PATCH',apiBody('inAppPurchases',{reviewNote:d.settings.reviewNote},undefined,id));
    if(step==='prices'){
      const territory='KOR',price=d.preset.apple.KOR;if(!price)throw new DomainError('APPLE_BASE_PRICE','Apple 대한민국 기준 가격이 없습니다.');
      const currentTerritory=await this.api('/v1/territories/KOR');
      if(currentTerritory?.data?.id!==territory||currentTerritory.data.attributes?.currency!==price.currency)throw new DomainError('APPLE_CURRENCY_CHANGED','Apple 통화가 변경되었습니다. 가격을 다시 확인하세요.');
      const points=await this.list(`/v2/inAppPurchases/${id}/pricePoints?filter[territory]=KOR&limit=8000`);
      // 가격 포인트 ID는 상품별이다. 참조 상품 ID를 재사용하지 않고 새 상품의 같은 원화 가격을 다시 찾는다.
      const matches=points.filter(p=>Number(p.attributes?.customerPrice)===Number(price.amount));
      if(matches.length!==1)throw new DomainError('PRICE_POINT_UNRESOLVED',`KOR ${price.amount}: 정확한 가격 포인트를 확인할 수 없습니다.`);
      const included=[{type:'inAppPurchasePrices',id:'${basePrice}',attributes:{startDate:null},relationships:{inAppPurchaseV2:relation('inAppPurchases',id),inAppPurchasePricePoint:relation('inAppPurchasePricePoints',matches[0].id)}}];
      return this.api('/v1/inAppPurchasePriceSchedules','POST',{data:{type:'inAppPurchasePriceSchedules',relationships:{inAppPurchase:relation('inAppPurchases',id),baseTerritory:relation('territories','KOR'),manualPrices:{data:[{type:'inAppPurchasePrices',id:'${basePrice}'}]}}},included});
    }
    if(step==='availability')return this.api('/v1/inAppPurchaseAvailabilities','POST',apiBody('inAppPurchaseAvailabilities',{availableInNewTerritories:false},{inAppPurchase:relation('inAppPurchases',id),availableTerritories:{data:d.settings.countries.map(id=>({type:'territories',id}))}}));
    if(step.startsWith('image.')){
      const file=this.reviewImageFile(d.settings.reviewImageRef);if(!file)throw new DomainError('IMAGE_MISSING','심사 이미지 누락');const bytes=await readFile(file).catch(()=>{throw new DomainError('IMAGE_MISSING','심사 이미지 누락');});
      if(bytes.length>10*1024*1024)throw new DomainError('IMAGE_SIZE','심사 이미지가 10MB를 초과합니다.');
      if(step==='image.reserve')return (await this.api('/v1/inAppPurchaseAppStoreReviewScreenshots','POST',apiBody('inAppPurchaseAppStoreReviewScreenshots',{fileName:d.settings.reviewImageRef,fileSize:bytes.length},{inAppPurchaseV2:relation('inAppPurchases',id)})))?.data;
      const reservation=receipt('image.reserve');if(!reservation?.id)throw new DomainError('NO_RESERVATION','이미지 예약 증거 누락');
      if(step==='image.upload'){
        for(const operation of reservation.attributes.uploadOperations){const url=new URL(operation.url);if(url.protocol!=='https:'||!['apple.com','apple.com.cn','icloud.com','icloud-content.com'].some(domain=>url.hostname.endsWith('.'+domain)))throw new DomainError('UPLOAD_HOST','Apple 업로드 호스트를 확인하세요.');
          const headers=Object.fromEntries(operation.requestHeaders.map((h:Json)=>[h.name,h.value]));const data=bytes.subarray(operation.offset,operation.offset+operation.length);
          let response;try{response=await fetch(url,{method:operation.method,headers,body:data,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new ConnectorError('IMAGE_UPLOAD_UNKNOWN','이미지 업로드 결과 미확정');}if(!response.ok)throw new ConnectorError('IMAGE_UPLOAD_ERROR','이미지 업로드 실패');
        }return {uploadedBytes:bytes.length,md5:createHash('md5').update(bytes).digest('hex')};
      }
      if(step==='image.commit')return this.api('/v1/inAppPurchaseAppStoreReviewScreenshots/'+reservation.id,'PATCH',apiBody('inAppPurchaseAppStoreReviewScreenshots',{uploaded:true,sourceFileChecksum:receipt('image.upload')?.md5},undefined,reservation.id));
      const current=await this.api('/v1/inAppPurchaseAppStoreReviewScreenshots/'+reservation.id);if(current?.data?.attributes?.assetDeliveryState?.state!=='COMPLETE')throw new ConnectorError('IMAGE_PROCESSING','Apple 이미지 처리가 완료되지 않았습니다.','rejected',true);return {state:'COMPLETE'};
    }
    if(step==='review.check'){
      const products=await this.list(`/v1/apps/${this.config.appId}/inAppPurchasesV2?limit=200`);const type=d.product.type==='consumable'?'CONSUMABLE':'NON_CONSUMABLE';
      if(!products.some(p=>p.id!==id&&p.attributes?.inAppPurchaseType===type&&p.attributes?.state==='APPROVED'))throw new DomainError('APP_VERSION_REQUIRED','동일 유형 최초 심사는 App Store Connect에서 새 앱 버전과 함께 제출해야 합니다.');
      return {eligible:true};
    }
    if(step==='review.create')return (await this.api('/v1/reviewSubmissions','POST',apiBody('reviewSubmissions',{platform:'IOS'},{app:relation('apps',this.config.appId)})))?.data;
    if(step==='review.item'){const submission=receipt('review.create')?.id,version=receipt('version')?.id;if(!submission||!version)throw new DomainError('REVIEW_EVIDENCE','심사 작업 증거 누락');return (await this.api('/v1/reviewSubmissionItems','POST',apiBody('reviewSubmissionItems',undefined,{reviewSubmission:relation('reviewSubmissions',submission),inAppPurchaseVersion:relation('inAppPurchaseVersions',version)})))?.data;}
    if(step==='review.submit'){const submission=receipt('review.create')?.id;if(!submission)throw new DomainError('REVIEW_EVIDENCE','심사 생성 증거 누락');return this.api('/v1/reviewSubmissions/'+submission,'PATCH',apiBody('reviewSubmissions',{submitted:true},undefined,submission));}
    if(step==='verify')return this.status(row);
    throw new DomainError('INVALID_STEP','Apple 단계 오류');
  }
  async status(row:Row){const version=row.steps.find(s=>s.key==='version')?.receipt as Json|undefined;return version?.id?this.api('/v1/inAppPurchaseVersions/'+version.id):this.read(row.remoteId);}
}
