import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProductSchema, type Product, type Catalog, type Game, DomainError } from '../shared/domain.js';
import { type Repository, hash, need, audit } from './repository.js';

export const SheetProductSchema = ProductSchema.pick({productKey:true,name:true,googleId:true,appleId:true,steamId:true}).strict();
export type SheetProduct = import('zod').infer<typeof SheetProductSchema>;
export const NewSheetProductSchema=SheetProductSchema.required({googleId:true,appleId:true,steamId:true}).extend({type:z.enum(['consumable','nonConsumable']),revision:z.string().nullable()}).strict();
export type NewSheetProduct=z.infer<typeof NewSheetProductSchema>;
export function parseSheets(products:unknown[][],_legacyLocalizations?:unknown[][]):SheetProduct[]{
  const expected=['productKey','name','googleId','appleId','steamId'];
  if(!products.length)throw new DomainError('EMPTY_SHEET','Products 헤더가 없습니다.');
  const headers=products[0].map(v=>String(v).trim());
  if(headers.length!==5||new Set(headers).size!==5||expected.some(h=>!headers.includes(h)))throw new DomainError('SHEET_SCHEMA','Products에는 productKey, name, googleId, appleId, steamId 5개 열만 사용하세요. 이전 시트는 먼저 백업한 뒤 이관하세요.');
  return products.slice(1).filter(row=>row.some(v=>String(v??'').trim())).map(row=>{
    if(row.slice(5).some(v=>String(v??'').trim()))throw new DomainError('SHEET_SCHEMA','헤더 밖 데이터가 있습니다.');
    return SheetProductSchema.parse(Object.fromEntries(headers.flatMap((key,i)=>String(row[i]??'').trim()?[[key,String(row[i]).trim()]]:[])));
  });
}
function sameSheetProduct(left:SheetProduct,right:SheetProduct){return ['productKey','name','googleId','appleId','steamId'].every(field=>(left as Record<string,unknown>)[field]===(right as Record<string,unknown>)[field]);}
function mergeSheetRows(previous:Catalog|undefined,rows:SheetProduct[]){
  const products=rows.map(row=>{
    const old=previous?.products.find(p=>p.productKey===row.productKey);
    for(const field of ['googleId','appleId','steamId'] as const)if(old?.[field]!==undefined&&old[field]!==row[field])throw new DomainError('IDENTITY_CHANGED',`기존 식별값 변경 불가: ${row.productKey}/${field}`);
    return ProductSchema.parse({...row,type:'unconfigured',pricePresetKey:'UNCONFIGURED',...old,...Object.fromEntries(Object.entries(row).filter(([k])=>k!=='name')),sourceName:row.name,name:old?.name??row.name,sourceKind:'sheet'});
  });
  const sheetKeys=new Set(products.map(product=>product.productKey));products.push(...(previous?.products??[]).filter(product=>product.sourceKind==='remote'&&!sheetKeys.has(product.productKey)));validateProducts(products);return products;
}
export async function importSheetCatalog(repo:Repository,gameId:string,rows:SheetProduct[],actor:string,source:unknown){
  await need<Game>(repo,'game',gameId);
  return repo.lock('catalog:'+gameId,async()=>{
    const previous=await repo.get<Catalog>('catalog',gameId);
    const products=mergeSheetRows(previous?.data,rows);
    return saveCatalog(repo,gameId,products,previous,actor,source);
  });
}
export async function createSheetProduct(repo:Repository,gameId:string,input:NewSheetProduct,actor:string,read:()=>Promise<unknown[][]>,append:(row:string[])=>Promise<void>){
  const game=await need<Game>(repo,'game',gameId);return repo.lock('catalog:'+gameId,async()=>{
    const previous=await repo.get<Catalog>('catalog',gameId),catalog=previous?.data;
    if((catalog?.snapshotId??null)!==input.revision)throw new DomainError('STALE_CATALOG','다른 변경이 있습니다. 상품 목록을 새로 불러오세요.',409);
    const desired=SheetProductSchema.parse({productKey:input.productKey,name:input.name,googleId:input.googleId,appleId:input.appleId,steamId:input.steamId}),before=parseSheets(await read()),same=before.find(row=>row.productKey===desired.productKey);
    if(same&&!sameSheetProduct(same,desired))throw new DomainError('SHEET_PRODUCT_CONFLICT','같은 결제 키의 시트 행이 다른 값으로 존재합니다.',409);
    mergeSheetRows(catalog,same?before:[...before,desired]);
    let appendError:unknown;
    if(!same)try{await append([desired.productKey,desired.name,desired.googleId!,desired.appleId!,desired.steamId!]);}catch(error){appendError=error;}
    let after:SheetProduct[];try{after=parseSheets(await read());}catch(error){throw appendError??error;}
    const matches=after.filter(row=>row.productKey===desired.productKey);
    if(matches.length!==1||!sameSheetProduct(matches[0],desired)){if(appendError)throw appendError;throw new DomainError('SHEET_APPEND_UNCONFIRMED','시트에 추가한 상품 행을 확인할 수 없습니다.',409);}
    const products=mergeSheetRows(catalog,after).map(product=>product.productKey===desired.productKey?{...product,type:input.type,webManaged:true}:product);
    const saved=await saveCatalog(repo,game.id,products,previous,actor,{type:'sheet-product-create',spreadsheetId:game.spreadsheetId,productKey:desired.productKey,recovered:!!same||!!appendError});
    await audit(repo,actor,'product.sheet.create',{gameId,productKey:desired.productKey,recovered:!!same||!!appendError});
    return {catalog:saved,product:saved.products.find(product=>product.productKey===desired.productKey)!,sheet:{range:'Products!A:E',row:[desired.productKey,desired.name,desired.googleId,desired.appleId,desired.steamId]}};
  });
}
async function saveCatalog(repo:Repository,gameId:string,products:Product[],previous:Awaited<ReturnType<Repository['get']>>|null,actor:string,source:unknown){
  const old=(previous?.data as Catalog|undefined)?.products??[];
  const snapshotId=randomUUID();
  await repo.put('snapshot',snapshotId,{id:snapshotId,gameId,at:new Date().toISOString(),source,hash:hash(products),products},0);
  const keys=new Set(products.map(p=>p.productKey));const missing=old.filter(p=>!keys.has(p.productKey));
  validateProducts([...products,...missing]);const catalog:Catalog={gameId,snapshotId,products:[...products,...missing],missingKeys:missing.map(p=>p.productKey)};
  await repo.put('catalog',gameId,catalog,previous?.version??0);
  await audit(repo,actor,'catalog.save',{gameId,snapshotId,source,count:products.length,missing:catalog.missingKeys});return catalog;
}
export const ProductContentSchema=ProductSchema.pick({name:true,description:true,type:true,localizations:true}).strict();
export async function saveProductContent(repo:Repository,gameId:string,key:string,revision:string,input:unknown,actor:string,selectedPriceKey?:string){
  const content=ProductContentSchema.parse(input);
  if(content.type==='unconfigured')throw new DomainError('PRODUCT_UNCONFIGURED','상품 유형을 선택하세요.');
  return repo.lock('catalog:'+gameId,async()=>{
    const previous=await repo.get<Catalog>('catalog',gameId);const catalog=previous?.data;
    if(!catalog||catalog.snapshotId!==revision)throw new DomainError('STALE_CATALOG','다른 변경이 있습니다. 상품 목록을 새로 불러오세요.',409);
    const existing=catalog.products.find(p=>p.productKey===key);
    if(!existing||catalog.missingKeys.includes(key))throw new DomainError('NOT_FOUND','현재 시트의 상품이 아닙니다.');
    if(existing.type!=='unconfigured'&&existing.type!==content.type)throw new DomainError('IDENTITY_CHANGED','확정한 상품 유형은 변경할 수 없습니다.');
    const pricePresetKey=selectedPriceKey??existing.pricePresetKey;
    if(pricePresetKey!=='UNCONFIGURED'&&!(await repo.list<import('../shared/domain.js').Preset>('preset')).some(p=>p.data.key===pricePresetKey))throw new DomainError('PRESET_MISSING','CSV 가격을 선택하세요.');
    const products=catalog.products.filter(p=>!catalog.missingKeys.includes(p.productKey)).map(p=>p.productKey===key?{...p,...content,pricePresetKey,webManaged:true}:p);
    return saveCatalog(repo,gameId,products,previous,actor,{type:'web-content',productKey:key});
  });
}
export function validateProducts(products:Product[]){
  if(products.length===0)throw new DomainError('EMPTY_CATALOG','비어 있는 상품 목록은 가져올 수 없습니다.');
  for(const field of ['productKey','googleId','appleId','steamId'] as const){const seen=new Set<string>();for(const p of products){const value=p[field];if(value&&seen.has(value))throw new DomainError('DUPLICATE_ID',`중복 ${field}: ${value}`);if(value)seen.add(value);}}
}
export async function importCatalog(repo:Repository,gameId:string,products:Product[],actor:string,source:unknown){
  await need<Game>(repo,'game',gameId);validateProducts(products);
  return repo.lock('catalog:'+gameId,async()=>{
    const previous=await repo.get<Catalog>('catalog',gameId);
    const old=previous?.data.products??[];
    products=products.map(product=>{const existing=old.find(p=>p.productKey===product.productKey);return existing?.webManaged?{...product,name:existing.name,description:existing.description,localizations:existing.localizations,pricePresetKey:existing.pricePresetKey,webManaged:true,sourceName:existing.sourceName}:{...product,sourceName:existing?.sourceName??product.sourceName};});
    for(const product of products){const existing=old.find(p=>p.productKey===product.productKey);if(existing){for(const field of ['type','googleId','appleId','steamId','saveName','assetGuid','legacyName'] as const){const sameBlankHistory=field==='saveName'&&(existing.saveName??'')===(product.saveName??'');if(sameBlankHistory&&existing.saveName!==undefined)product.saveName=existing.saveName;if(existing[field]!==undefined&&existing[field]!==product[field]&&!sameBlankHistory)throw new DomainError('IDENTITY_CHANGED',`기존 식별값 변경 불가: ${product.productKey}/${field}`);}}}
    const snapshotId=randomUUID();const contentHash=hash(products);
    await repo.put('snapshot',snapshotId,{id:snapshotId,gameId,at:new Date().toISOString(),source,hash:contentHash,products},0);
    const keys=new Set(products.map(p=>p.productKey));const missing=old.filter(p=>!keys.has(p.productKey));
    validateProducts([...products,...missing]);const catalog:Catalog={gameId,snapshotId,products:[...products,...missing],missingKeys:missing.map(p=>p.productKey)};
    await repo.put('catalog',gameId,catalog,previous?.version??0);await audit(repo,actor,'catalog.import',{gameId,snapshotId,count:products.length,missing:catalog.missingKeys});return catalog;
  });
}
export async function manifest(repo:Repository,gameId:string){
  const catalog=await need<Catalog>(repo,'catalog',gameId);
  return {schemaVersion:1,gameId,revision:catalog.snapshotId,products:catalog.products.filter(p=>!catalog.missingKeys.includes(p.productKey)&&p.type!=='unconfigured').map(p=>({...p,gameReady:undefined,sourceKind:undefined}))};
}
