import {storeId,type Catalog,type RemoteProductScan,type Store} from './domain.js';

export type StorePresence='uploaded'|'missing'|'not_configured'|'not_connected'|'unknown';
export type ProductUploadState='uploaded'|'partial'|'not_uploaded'|'unknown';
export type ProductUploadStatus={
  productKey:string;
  state:ProductUploadState;
  stores:Record<Store,{state:StorePresence}>;
};

export const uploadState=(stores:ProductUploadStatus['stores']):ProductUploadState=>{
  const values=Object.values(stores).map(value=>value.state);
  if(values.includes('unknown')||values.includes('not_connected'))return 'unknown';
  const uploaded=values.filter(value=>value==='uploaded').length;
  return uploaded===values.length?'uploaded':uploaded>0?'partial':'not_uploaded';
};

export function uploadStatusesFromScan(catalog:Catalog,scan:RemoteProductScan):ProductUploadStatus[]{
  const stores=['google','apple','steam'] as const;
  return catalog.products.map(product=>{
    const values=stores.map(store=>{const id=storeId(product,store),source=scan.sources[store];let state:StorePresence;if(!id)state='not_configured';else if(source.state==='not_connected')state='not_connected';else if(source.state==='failed')state='unknown';else state=scan.products.some(remote=>remote.store===store&&remote.remoteId===id)?'uploaded':'missing';return [store,{state}] as const;});
    const statusStores=Object.fromEntries(values) as ProductUploadStatus['stores'];return {productKey:product.productKey,state:uploadState(statusStores),stores:statusStores};
  });
}
