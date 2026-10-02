import {DomainError,storeId,type Catalog,type Game,type Store} from '../shared/domain.js';
import {uploadState,type ProductUploadStatus,type StorePresence} from '../shared/product-status.js';
import {need,type Repository} from './repository.js';
import type {ConnectorFactory} from './connectors/types.js';

export async function productUploadStatuses(repo:Repository,factory:ConnectorFactory,gameId:string):Promise<ProductUploadStatus[]>{
  const game=await need<Game>(repo,'game',gameId),catalog=await need<Catalog>(repo,'catalog',gameId),stores=['google','apple','steam'] as const;
  const discoveries=Object.fromEntries(await Promise.all(stores.map(async store=>{
    try{
      const connector=factory(game,store);if(!connector.discover)throw new DomainError('DISCOVERY_UNSUPPORTED','상품 목록 조회를 지원하지 않는 연결입니다.');
      const products=(await connector.discover()).products,ids=products.map(product=>product.productId);
      if(new Set(ids).size!==ids.length)throw new DomainError('DUPLICATE_REMOTE_ID','스토어 상품 목록에 중복 ID가 있습니다.');
      return [store,{ids:new Set(ids)}] as const;
    }catch(error){return [store,{error:error instanceof DomainError&&error.code==='NOT_CONNECTED'?'not_connected' as const:'unknown' as const}] as const;}
  }))) as Record<Store,{ids?:Set<string>;error?:Extract<StorePresence,'not_connected'|'unknown'>}>;
  return catalog.products.map(product=>{
    const values=stores.map(store=>{const id=storeId(product,store),discovery=discoveries[store];const state:StorePresence=!id?'not_configured':discovery.error??(discovery.ids?.has(id)?'uploaded':'missing');return [store,{state}] as const;});
    const statusStores=Object.fromEntries(values) as ProductUploadStatus['stores'];
    return {productKey:product.productKey,state:uploadState(statusStores),stores:statusStores};
  });
}
