import {randomUUID} from 'node:crypto';
import {DomainError,type Catalog,type Game,type Preset,type StoreProductSnapshot} from '../shared/domain.js';
import {PRICE_MARKETS,appleTerritoryMarket} from '../shared/price-markets.js';
import {hash,need,type Repository} from './repository.js';
import type {ConnectorFactory} from './connectors/types.js';
import {AppleConnector} from './connectors/apple.js';

export type ApplePriceList={id:string;gameId:string;productId:string;territory:'KOR';fingerprint:string;fetchedAt:string;expiresAt:string;demo:boolean;points:{id:string;amount:string;currency:string}[]};
export type AppleTerritoryCatalog={id:string;gameId:string;fingerprint:string;fetchedAt:string;expiresAt:string;demo:boolean;territories:ReturnType<typeof appleTerritoryMarket>[]};
export type AppleEqualizationList={id:string;gameId:string;productId:string;selectionId:string;pricePointId:string;fingerprint:string;fetchedAt:string;expiresAt:string;demo:boolean;prices:{territory:string;name:string;englishName:string;amount:string;currency:string}[]};

const expiration=()=>new Date(Date.now()+86400000).toISOString();
async function adapterFor(repo:Repository,factory:ConnectorFactory,gameId:string,demo:boolean){
  const game=await need<Game>(repo,'game',gameId),adapter=factory(game,'apple');
  if(!demo&&!(adapter instanceof AppleConnector))throw new DomainError('APPLE_CONNECTION','Apple 연결 설정이 필요합니다.');
  return {game,adapter};
}

export async function applePriceProducts(repo:Repository,factory:ConnectorFactory,gameId:string,demo:boolean){
  const {adapter}=await adapterFor(repo,factory,gameId,demo);
  if(demo)return [{id:'demo-reference',productId:'starter_pack',name:'로컬 예시 상품 (Apple 실데이터 아님)'}];
  return (adapter as AppleConnector).priceProducts();
}

export async function appleProductResourceId(repo:Repository,factory:ConnectorFactory,gameId:string,productKey:string,demo:boolean){
  const catalog=await need<Catalog>(repo,'catalog',gameId),product=catalog.products.find(value=>value.productKey===productKey);
  if(!product?.appleId)throw new DomainError('APPLE_PRODUCT','이 상품에는 App Store ID가 없습니다.');
  const stored=(await repo.get<StoreProductSnapshot>('store_detail',`${gameId}:${productKey}:apple`))?.data;
  if(stored?.remoteId===product.appleId&&stored.resourceId)return stored.resourceId;
  const remote=(await applePriceProducts(repo,factory,gameId,demo)).find(value=>value.productId===product.appleId);
  if(!remote)throw new DomainError('APPLE_PRODUCT','App Store에서 이 상품을 찾을 수 없습니다.');return remote.id;
}

export async function applePriceListForProduct(repo:Repository,factory:ConnectorFactory,gameId:string,productKey:string,demo:boolean,refresh=false){
  return applePriceList(repo,factory,gameId,await appleProductResourceId(repo,factory,gameId,productKey,demo),demo,refresh);
}

export async function appleTerritories(repo:Repository,factory:ConnectorFactory,gameId:string,demo:boolean,refresh=false){
  const {adapter}=await adapterFor(repo,factory,gameId,demo),fingerprint=hash({connection:adapter.fingerprint,demo,gameId});
  const cached=(await repo.list<AppleTerritoryCatalog>('apple_territories')).map(record=>record.data).find(value=>value.gameId===gameId&&value.fingerprint===fingerprint&&Date.parse(value.expiresAt)>Date.now());
  if(cached&&!refresh)return cached;
  const source=demo?PRICE_MARKETS.apple.map(({code,currency})=>({id:code,currency})):await (adapter as AppleConnector).territories();
  const territories=source.map(value=>appleTerritoryMarket(value.id,value.currency));
  if(new Set(territories.map(value=>value.code)).size!==territories.length||!territories.some(value=>value.code==='KOR'&&value.currency==='KRW'))throw new DomainError('APPLE_TERRITORY_RESPONSE','Apple 판매 지역 목록을 확인할 수 없습니다.');
  const catalog:AppleTerritoryCatalog={id:randomUUID(),gameId,fingerprint,demo,territories,fetchedAt:new Date().toISOString(),expiresAt:expiration()};
  await repo.put('apple_territories',catalog.id,catalog,0);return catalog;
}

export async function applePriceList(repo:Repository,factory:ConnectorFactory,gameId:string,productId:string,demo:boolean,refresh=false){
  const territory='KOR' as const,{adapter}=await adapterFor(repo,factory,gameId,demo),fingerprint=hash({connection:adapter.fingerprint,demo,gameId});
  const cached=(await repo.list<ApplePriceList>('apple_prices')).map(record=>record.data).find(value=>value.fingerprint===fingerprint&&value.productId===productId&&value.territory===territory&&Date.parse(value.expiresAt)>Date.now());
  if(cached&&!refresh)return cached;
  let points:ApplePriceList['points'];
  if(demo){
    if(productId!=='demo-reference')throw new DomainError('APPLE_PRODUCT','예시 기준 상품을 선택하세요.');
    points=['1100','5500','11000'].map((amount,index)=>({id:`demo-KOR-${index}`,amount,currency:'KRW'}));
  }else points=await (adapter as AppleConnector).pricePoints(productId,territory);
  if(points.some(point=>point.currency!=='KRW'))throw new DomainError('APPLE_CURRENCY_CHANGED','Apple 대한민국 통화가 KRW가 아닙니다. 가격 목록을 갱신하세요.');
  const list:ApplePriceList={id:randomUUID(),gameId,productId,territory,fingerprint,demo,points,fetchedAt:new Date().toISOString(),expiresAt:expiration()};
  await repo.put('apple_prices',list.id,list,0);return list;
}

export async function applePriceEqualizations(repo:Repository,factory:ConnectorFactory,gameId:string,selectionId:string,pricePointId:string,demo:boolean,refresh=false){
  const selection=(await repo.get<ApplePriceList>('apple_prices',selectionId))?.data;
  if(!selection||selection.gameId!==gameId||selection.demo!==demo||selection.territory!=='KOR'||Date.parse(selection.expiresAt)<=Date.now())throw new DomainError('APPLE_PRICE_SELECTION','Apple 대한민국 가격 목록을 다시 조회해 주세요.');
  const selected=selection.points.find(point=>point.id===pricePointId);
  if(!selected)throw new DomainError('APPLE_PRICE_SELECTION','조회한 Apple 가격 포인트를 선택해 주세요.');
  const {adapter}=await adapterFor(repo,factory,gameId,demo),fingerprint=hash({connection:adapter.fingerprint,demo,gameId});
  if(selection.fingerprint!==fingerprint)throw new DomainError('APPLE_PRICE_CONNECTION','Apple 연결이 변경되어 가격을 다시 조회해야 합니다.');
  const cached=(await repo.list<AppleEqualizationList>('apple_equalizations')).map(record=>record.data).find(value=>value.selectionId===selectionId&&value.pricePointId===pricePointId&&value.fingerprint===fingerprint&&Date.parse(value.expiresAt)>Date.now());
  if(cached&&!refresh)return cached;
  const catalog=await appleTerritories(repo,factory,gameId,demo,refresh),markets=new Map(catalog.territories.map(market=>[market.code,market]));
  let source:{territory:string;amount:string;currency:string}[];
  if(demo){
    const index=selection.points.indexOf(selected),samples=[['1100','0.99','160'],['5500','3.99','600'],['11000','7.99','1200']][index];
    source=[{territory:'KOR',amount:samples[0],currency:'KRW'},{territory:'USA',amount:samples[1],currency:'USD'},{territory:'JPN',amount:samples[2],currency:'JPY'}];
  }else source=await (adapter as AppleConnector).equalizations(pricePointId);
  if(!source.some(value=>value.territory==='KOR'))source.push({territory:'KOR',amount:selected.amount,currency:selected.currency});
  if(new Set(source.map(value=>value.territory)).size!==source.length)throw new DomainError('APPLE_EQUALIZATION_RESPONSE','Apple 자동 환산 결과에 국가가 중복되었습니다.');
  const prices=source.map(value=>{const market=markets.get(value.territory);if(!market||market.currency!==value.currency)throw new DomainError('APPLE_CURRENCY_CHANGED',`${value.territory}의 Apple 통화를 확인할 수 없습니다.`);return {...value,name:market.name,englishName:market.englishName};}).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  if(!prices.some(value=>value.territory==='KOR'&&value.currency==='KRW'&&Number(value.amount)===Number(selected.amount)))throw new DomainError('APPLE_EQUALIZATION_RESPONSE','Apple 자동 환산 결과의 대한민국 기준 가격이 선택 값과 다릅니다.');
  const list:AppleEqualizationList={id:randomUUID(),gameId,productId:selection.productId,selectionId,pricePointId,fingerprint,demo,prices,fetchedAt:new Date().toISOString(),expiresAt:expiration()};
  await repo.put('apple_equalizations',list.id,list,0);return list;
}

export async function verifyAppleSelections(repo:Repository,factory:ConnectorFactory,prices:Preset['apple'],demo:boolean){
  const entries=Object.entries(prices);
  if(entries.length!==1||entries[0][0]!=='KOR')throw new DomainError('APPLE_PRICE_SELECTION','App Store는 대한민국 기준 가격 포인트 하나만 선택해 주세요.');
  const [territory,price]=entries[0],list=price.selectionId?(await repo.get<ApplePriceList>('apple_prices',price.selectionId))?.data:undefined;
  if(!list||list.demo!==demo||list.territory!==territory||Date.parse(list.expiresAt)<=Date.now())throw new DomainError('APPLE_PRICE_SELECTION','Apple 가격 목록을 다시 조회하고 가격 포인트를 선택하세요.');
  const game=await need<Game>(repo,'game',list.gameId);
  if(list.fingerprint!==hash({connection:factory(game,'apple').fingerprint,demo,gameId:game.id}))throw new DomainError('APPLE_PRICE_CONNECTION','Apple 연결이 변경되어 가격을 다시 조회해야 합니다.');
  if(!list.points.some(point=>point.id===price.pricePointId&&point.amount===price.amount&&point.currency===price.currency))throw new DomainError('APPLE_PRICE_SELECTION','조회한 Apple 가격 포인트와 선택 값이 다릅니다.');
  return list;
}
