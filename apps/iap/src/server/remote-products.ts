import {randomUUID} from 'node:crypto';
import {DomainError,Id,ProductSchema,type Catalog,type Game,type Product,type RemoteProductCandidate,type RemoteProductScan,type Store,type StoreProductSnapshot} from '../shared/domain.js';
import {audit,hash,need,type Repository} from './repository.js';
import {ConnectorError,type ConnectorFactory,type ConnectorProduct} from './connectors/types.js';
import {validateProducts} from './catalog.js';
import {applePricingMatrix,priceSnapshotFromMatrix} from './apple-pricing-matrix.js';

const stores=['google','apple','steam'] as const;
const storeField={google:'googleId',apple:'appleId',steam:'steamId'} as const;
const storeOrder:Record<Store,number>={google:0,apple:1,steam:2};
const canonicalLocale=(locale:string)=>locale==='ko'?'ko-KR':locale;

function importedContent(group:RemoteProductCandidate[]){
  const localizations:Product['localizations']={};
  for(const candidate of [...group].sort((a,b)=>storeOrder[a.store]-storeOrder[b.store]))for(const [locale,text] of Object.entries(candidate.localizations)){const key=canonicalLocale(locale);if(!localizations[key])localizations[key]=text;}
  return {localizations,preferred:localizations['ko-KR']??Object.values(localizations)[0]};
}

function currentKrw(group:RemoteProductCandidate[]){
  const basePriceOrder:Record<Store,number>={apple:0,google:1,steam:2};return [...group].sort((a,b)=>basePriceOrder[a.store]-basePriceOrder[b.store]).flatMap(candidate=>candidate.prices.map(price=>({store:candidate.store,...price}))).find(price=>price.currency==='KRW'&&['KR','KOR','KRW'].includes(price.market));
}

function cleanProduct(store:Store,value:ConnectorProduct){
  const suggested=value.suggestedProductKey??value.productId;
  const productKey=Id.safeParse(suggested).success?suggested:`remote_${hash({store,id:value.productId}).slice(0,24)}`;
  const localizations=Object.fromEntries(Object.entries(value.localizations??{}).filter(([locale,text])=>/^[a-z]{2,3}([-_][a-zA-Z0-9]{2,8})*$/.test(locale)&&!!text.name.trim()&&!!text.description.trim()).map(([locale,text])=>[locale,{name:text.name.trim().slice(0,200),description:text.description.trim().slice(0,4000)}]));
  const prices=(value.prices??[]).filter(price=>/^[A-Z]{2,3}$/.test(price.market)&&/^[A-Z]{3}$/.test(price.currency)&&/^\d+(\.\d{1,9})?$/.test(price.amount)&&Number(price.amount)>=0);
  return {productId:value.productId,resourceId:value.resourceId,productKey,name:(value.name.trim()||productKey).slice(0,200),type:value.type,description:(value.description??'').slice(0,4000),localizations,status:value.status,prices,priceState:value.priceState??(prices.length?'available' as const:'unavailable' as const),priceMessage:value.priceMessage};
}

function candidateFor(store:Store,value:ReturnType<typeof cleanProduct>,catalog:Catalog|null):RemoteProductCandidate{
  const field=storeField[store],byId=catalog?.products.find(product=>product[field]===value.productId),byKey=catalog?.products.find(product=>product.productKey===value.productKey);
  let action:RemoteProductCandidate['action']='new',catalogProductKey:string|undefined,message:string|undefined;
  if(byId){action='refresh';catalogProductKey=byId.productKey;message='이 스토어의 현재 값을 플랫폼별 스냅샷으로 저장합니다.';}
  else if(byKey){catalogProductKey=byKey.productKey;if(!byKey[field]){action='attach';message=`기존 상품에 ${store==='google'?'Google Play':store==='apple'?'App Store':'Steam'} ID를 연결하고 이 스토어의 값을 저장합니다.`;}else{action='conflict';message=`같은 상품 키에 다른 ${store==='google'?'Google Play':store==='apple'?'App Store':'Steam'} ID가 있습니다.`;}}
  return {id:hash({store,remoteId:value.productId}),store,remoteId:value.productId,resourceId:value.resourceId,productKey:value.productKey,name:value.name,type:value.type,description:value.description,localizations:value.localizations,status:value.status,prices:value.prices,priceState:value.priceState,priceMessage:value.priceMessage,action,catalogProductKey,message};
}

async function discoverWithOneRetry(factory:ConnectorFactory,game:Game,store:Store){
  const connector=factory(game,store);if(!connector.discover)throw new DomainError('DISCOVERY_UNSUPPORTED','이 연결은 상품 목록 조회를 지원하지 않습니다.');
  try{return await connector.discover();}catch(error){if(!(error instanceof ConnectorError&&error.retryable))throw error;const delay=Math.min(5000,Math.max(1000,error.retryAfterMs??1500));await new Promise(resolve=>setTimeout(resolve,delay));return connector.discover();}
}

async function cachedProducts(repo:Repository,gameId:string,store:Store,catalog:Catalog|null){
  const scans=(await repo.list<RemoteProductScan>('remote_scan')).map(row=>row.data).filter(scan=>scan.gameId===gameId&&['ok','cached'].includes(scan.sources?.[store]?.state)&&Date.now()-Date.parse(scan.scannedAt)<24*60*60_000).sort((a,b)=>b.scannedAt.localeCompare(a.scannedAt));
  const values=scans[0]?.products.filter(product=>product.store===store)??[];
  return values.map(product=>candidateFor(store,cleanProduct(store,{...product,productId:product.remoteId,prices:product.prices??[],priceState:product.priceState??'unavailable'}),catalog));
}

export async function scanRemoteProducts(repo:Repository,factory:ConnectorFactory,gameId:string,actor:string):Promise<RemoteProductScan>{
  const game=await need<Game>(repo,'game',gameId),catalog=(await repo.get<Catalog>('catalog',gameId))?.data??null;
  const sources={} as RemoteProductScan['sources'],products:RemoteProductCandidate[]=[];
  await Promise.all(stores.map(async store=>{try{const discovery=await discoverWithOneRetry(factory,game,store),found=discovery.products,ids=found.map(value=>value.productId);if(new Set(ids).size!==ids.length)throw new DomainError('DUPLICATE_REMOTE_ID','스토어 상품 목록에 중복 ID가 있습니다.');sources[store]={state:'ok',count:found.length,...(discovery.message?{message:discovery.message}:{})};products.push(...found.map(value=>candidateFor(store,cleanProduct(store,value),catalog)));}catch(error){const known=error instanceof DomainError;if(known&&error.code!=='NOT_CONNECTED'){const cached=await cachedProducts(repo,gameId,store,catalog);if(cached.length){sources[store]={state:'cached',count:cached.length,message:`현재 조회 실패: ${error.message} 24시간 이내 마지막 성공 결과를 표시합니다.`};products.push(...cached);return;}}sources[store]={state:known&&error.code==='NOT_CONNECTED'?'not_connected':'failed',count:0,message:known?error.message:'스토어 상품 목록을 확인하지 못했습니다.'};}}));
  for(const candidate of products){if(products.some(other=>other!==candidate&&other.store===candidate.store&&other.productKey===candidate.productKey&&other.remoteId!==candidate.remoteId)){candidate.action='conflict';candidate.message='같은 스토어의 여러 상품이 동일한 게임 상품 키를 사용합니다.';}}
  const scannedAt=new Date(),scan:RemoteProductScan={id:randomUUID(),gameId,catalogRevision:catalog?.snapshotId??null,scannedAt:scannedAt.toISOString(),expiresAt:new Date(scannedAt.getTime()+10*60_000).toISOString(),sources,products:products.sort((a,b)=>a.productKey.localeCompare(b.productKey)||storeOrder[a.store]-storeOrder[b.store])};
  await repo.put('remote_scan',scan.id,scan,0);await audit(repo,actor,'remote-products.scan',{gameId,scanId:scan.id,sources,productCount:products.length});return scan;
}

export async function scanRemoteProductPrice(repo:Repository,factory:ConnectorFactory,gameId:string,scanId:string,candidateId:string,actor:string){
  const game=await need<Game>(repo,'game',gameId),scan=await need<RemoteProductScan>(repo,'remote_scan',scanId);if(scan.gameId!==gameId)throw new DomainError('SCAN_SCOPE','다른 프로젝트의 조회 결과는 사용할 수 없습니다.',403);if(Date.parse(scan.expiresAt)<=Date.now())throw new DomainError('SCAN_EXPIRED','조회 후 10분이 지났습니다. 스토어 상품을 다시 확인하세요.',409);const candidate=scan.products.find(product=>product.id===candidateId);if(!candidate)throw new DomainError('NOT_FOUND','조회 결과에서 상품을 찾을 수 없습니다.',404);if(!candidate.resourceId)throw new DomainError('PRICE_UNAVAILABLE','이 스토어 상품의 가격 조회 식별값이 없습니다.');const connector=factory(game,candidate.store);if(!connector.discoverPrice)throw new DomainError('PRICE_UNAVAILABLE','이 스토어는 별도 가격 조회가 필요하지 않습니다.');const prices=await connector.discoverPrice(candidate.resourceId),result={gameId,scanId,candidateId,store:candidate.store,remoteId:candidate.remoteId,prices,priceState:prices.length?'available' as const:'unavailable' as const,priceMessage:prices.length?undefined:'현재 적용 중인 대한민국 기준 가격을 찾지 못했습니다.',scannedAt:new Date().toISOString()};await repo.put('remote_price',`${scanId}:${candidateId}`,result);await audit(repo,actor,'remote-products.price',{gameId,scanId,candidateId,store:candidate.store,priceCount:prices.length});return result;
}

export async function importRemoteProducts(repo:Repository,gameId:string,scanId:string,actor:string):Promise<Catalog>{
  const scan=await need<RemoteProductScan>(repo,'remote_scan',scanId);if(scan.gameId!==gameId)throw new DomainError('SCAN_SCOPE','다른 프로젝트의 조회 결과는 사용할 수 없습니다.',403);if(Date.parse(scan.expiresAt)<=Date.now())throw new DomainError('SCAN_EXPIRED','조회 후 10분이 지났습니다. 스토어 상품을 다시 확인하세요.',409);
  const priceRows=(await repo.list<{scanId:string;candidateId:string;prices:RemoteProductCandidate['prices'];priceState:RemoteProductCandidate['priceState'];priceMessage?:string}>('remote_price')).map(row=>row.data).filter(row=>row.scanId===scanId),priceByCandidate=new Map(priceRows.map(row=>[row.candidateId,row]));
  const candidates=scan.products.filter(product=>product.action!=='conflict').map(product=>{const price=priceByCandidate.get(product.id);return price?{...product,prices:price.prices,priceState:price.priceState,priceMessage:price.priceMessage}:product;});if(!candidates.length)throw new DomainError('IMPORT_EMPTY','저장할 수 있는 스토어 상품이 없습니다.');
  const matrix=await applePricingMatrix();
  return repo.lock('catalog:'+gameId,async()=>{const previous=await repo.get<Catalog>('catalog',gameId),current=previous?.data??null;if((current?.snapshotId??null)!==scan.catalogRevision)throw new DomainError('STALE_CATALOG','상품 목록이 변경되었습니다. 스토어 상품을 다시 확인하세요.',409);const products:Product[]=structuredClone(current?.products??[]),activated=new Set<string>();
    const groups=new Map<string,RemoteProductCandidate[]>();for(const candidate of candidates){const key=candidate.catalogProductKey??candidate.productKey,group=groups.get(key)??[];group.push(candidate);groups.set(key,group);}
    for(const [targetKey,group] of groups){let product=products.find(value=>value.productKey===targetKey)||products.find(value=>group.some(candidate=>value[storeField[candidate.store]]===candidate.remoteId));const canonical=[...group].sort((a,b)=>storeOrder[a.store]-storeOrder[b.store])[0],content=importedContent(group);if(!product){const types=[...new Set(group.map(value=>value.type).filter(value=>value!=='unconfigured'))];product=ProductSchema.parse({productKey:targetKey,name:content.preferred?.name??canonical.name,type:types.length===1?types[0]:'unconfigured',description:content.preferred?.description??canonical.description,localizations:content.localizations,webManaged:true,sourceKind:'remote',pricePresetKey:'UNCONFIGURED'});products.push(product);}for(const candidate of group){const field=storeField[candidate.store];if(product[field]&&product[field]!==candidate.remoteId)throw new DomainError('IDENTITY_CHANGED',`기존 식별값 변경 불가: ${product.productKey}/${field}`);product[field]=candidate.remoteId as never;}if(Object.keys(product.localizations).length===0&&!product.description.trim()&&content.preferred){product.name=content.preferred.name;product.description=content.preferred.description;product.localizations=content.localizations;}if(product.type==='unconfigured'){const types=[...new Set(group.map(value=>value.type).filter(value=>value!=='unconfigured'))];if(types.length===1)product.type=types[0];}if(product.pricePresetKey==='UNCONFIGURED'){const price=currentKrw(group),point=price&&matrix.points.find(value=>Number(value.amount)===Number(price.amount));if(point){const preset=await priceSnapshotFromMatrix(repo,gameId,actor,matrix.id,point.id);product.pricePresetKey=preset.key;}}product.webManaged=true;activated.add(product.productKey);}
    validateProducts(products);const snapshotId=randomUUID(),catalog:Catalog={gameId,snapshotId,products,missingKeys:(current?.missingKeys??[]).filter(key=>!activated.has(key))};await repo.put('snapshot',snapshotId,{id:snapshotId,gameId,at:new Date().toISOString(),source:{type:'remote-products',scanId},hash:hash(products),products},0);await repo.put('catalog',gameId,catalog,previous?.version??0);
    for(const candidate of candidates){const productKey=candidate.catalogProductKey??candidate.productKey,snapshot:StoreProductSnapshot={gameId,productKey,store:candidate.store,remoteId:candidate.remoteId,resourceId:candidate.resourceId,name:candidate.name,type:candidate.type,description:candidate.description,localizations:candidate.localizations,status:candidate.status,prices:candidate.prices??[],priceState:candidate.priceState??'unavailable',priceMessage:candidate.priceMessage,scannedAt:scan.scannedAt};await repo.put('store_detail',`${gameId}:${productKey}:${candidate.store}`,snapshot);}
    await audit(repo,actor,'remote-products.import',{gameId,scanId,productKeys:[...activated],storeSnapshotCount:candidates.length});return catalog;
  });
}
