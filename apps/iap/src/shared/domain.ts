import { z } from 'zod';
import {priceMarketIssue} from './price-markets.js';

export const StoreSchema = z.enum(['google','apple','steam']);
export type Store = z.infer<typeof StoreSchema>;
export const Id = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
export const Money = z.string().regex(/^\d+(\.\d{1,6})?$/).refine(v=>Number(v)>0,'가격은 양수여야 합니다.');
export const ProductSchema = z.object({
  productKey:Id, name:z.string().min(1).max(200), type:z.enum(['consumable','nonConsumable','unconfigured']),
  sourceName:z.string().optional(),description:z.string().max(4000).default(''),webManaged:z.boolean().default(false),
  googleId:z.string().regex(/^[a-z0-9][a-z0-9_.]*$/).max(148).optional(),
  appleId:z.string().regex(/^[a-zA-Z0-9_.-]+$/).max(100).optional(),
  steamId:z.string().regex(/^\d+$/).refine(v=>BigInt(v)>0n&&BigInt(v)<=4294967295n).optional(),
  pricePresetKey:Id, legacyName:z.string().optional(), saveName:z.string().optional(), assetGuid:z.string().optional(),
  legacyPrice:z.string().optional(), gameReady:z.boolean().default(false),
  sourceKind:z.enum(['sheet','json','remote']).optional(),
  localizations:z.record(z.string().regex(/^[a-z]{2,3}([-_][a-zA-Z0-9]{2,8})*$/),z.object({name:z.string().min(1).max(200),description:z.string().min(1).max(4000)})).default({}),
}).strict();
export type Product = z.infer<typeof ProductSchema>;
export const SettingsSchema = z.object({
  countries:z.array(z.string().regex(/^[A-Z]{2,3}$/)).min(1).default(['KR']),
  localizations:ProductSchema.shape.localizations,
  priceOverrides:z.record(z.string().regex(/^[A-Z]{2,3}$/),z.object({currency:z.string().regex(/^[A-Z]{3}$/),amount:Money,referenceId:z.string().optional(),sourceVersion:z.string().optional()}).strict()).default({}),
  reviewNote:z.string().max(4000).default(''), reviewImageRef:z.string().regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  submitReview:z.boolean().default(false), activate:z.boolean().default(false),
}).strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const PresetSchema = z.object({
  key:Id,name:z.string().min(1),krw:Money,
  google:z.record(z.string().regex(/^[A-Z]{2}$/),z.object({currency:z.string().regex(/^[A-Z]{3}$/),amount:Money}).strict()),
  apple:z.record(z.string().regex(/^[A-Z]{3}$/),z.object({pricePointId:z.string().min(1),selectionId:z.string().optional(),amount:Money,currency:z.string().regex(/^[A-Z]{3}$/)}).strict()),
  steam:z.record(z.string().regex(/^[A-Z]{3}$/),Money),
}).strict().superRefine((preset,ctx)=>{
  if(Object.keys(preset.apple).length!==1||!preset.apple.KOR)ctx.addIssue({code:'custom',path:['apple'],message:'App Store는 대한민국 기준 가격 포인트 하나만 선택해 주세요.'});
  for(const store of ['google','apple','steam'] as const){
    for(const [code,value] of Object.entries(preset[store])){
      const issue=priceMarketIssue(store,code,typeof value==='string'?code:value.currency);
      if(issue)ctx.addIssue({code:'custom',path:[store,code],message:issue});
    }
  }
});
export type Preset = z.infer<typeof PresetSchema> & {version:string;confirmedBy:string;confirmedAt:string};
export const GameSchema = z.object({id:Id,name:z.string().min(1).max(100),portalProjectId:z.string().regex(/^\d+$/).optional(),spreadsheetId:z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),connectorKey:Id}).strict();
export type Game = z.infer<typeof GameSchema>;
export type Actor = {id:string;name:string;permissions:string[];sid?:string};
export type Remote = {id:string;data:Record<string,unknown>};
export type Desired = {product:Product;preset:Preset;settings:Settings};
export type Step = {key:string;state:'pending'|'inflight'|'done';receipt?:unknown};
export type Row = {
  productKey:string;store:Store;remoteId:string;before:Remote|null;desired:Desired;
  action:'skip'|'create'|'update';fields?:string[];steps:Step[];
  state:'pending'|'running'|'done'|'skipped'|'needs_action'|'failed';
  created?:{id:string;at:string;receipt:unknown};message?:string;backup?:unknown;
};
export type Plan = {id:string;mode:'create'|'exception';game:Game;actorId:string;createdAt:string;sourceHash:string;connections:Record<string,string>;rows:Row[];reason?:string;hash:string};
export type Approval = {id:string;planId:string;actorId:string;planHash:string;expiresAt:string;jobId?:string};
export type Job = {id:string;plan:Plan;actor:Actor;state:'queued'|'running'|'done'|'needs_action';rows:Row[];createdAt:string;updatedAt:string;approvalExpiresAt?:string;attempts?:number;nextAttemptAt?:string};
export type Catalog = {gameId:string;snapshotId:string;products:Product[];missingKeys:string[]};
export type StorePrice = {market:string;currency:string;amount:string;availability?:string;optionId?:string};
export type RemoteProductCandidate = {
  id:string;store:Store;remoteId:string;resourceId?:string;productKey:string;name:string;type:Product['type'];description:string;
  localizations:Product['localizations'];status?:string;prices:StorePrice[];priceState:'available'|'unavailable'|'separate_request';priceMessage?:string;
  action:'new'|'attach'|'refresh'|'conflict';catalogProductKey?:string;message?:string;
};
export type RemoteProductScan = {
  id:string;gameId:string;catalogRevision:string|null;scannedAt:string;expiresAt:string;
  sources:Record<Store,{state:'ok'|'cached'|'not_connected'|'failed';count:number;message?:string}>;products:RemoteProductCandidate[];
};
export type StoreProductSnapshot = Omit<RemoteProductCandidate,'id'|'action'|'catalogProductKey'|'message'> & {gameId:string;scannedAt:string};
export type Entity<T=unknown> = {id:string;kind:string;version:number;data:T};
export function storeId(product:Product,store:Store):string|undefined {return product[`${store}Id`];}
export class DomainError extends Error { constructor(public code:string,message:string,public status=400){super(message);} }
export function requirePublish(actor:Actor){if(!actor.permissions.includes('iap.publish'))throw new DomainError('FORBIDDEN','배포 권한이 없습니다.',403);}
