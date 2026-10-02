import type { Desired, Game, Remote, Row, Store, StorePrice } from '../../shared/domain.js';
import { DomainError } from '../../shared/domain.js';
export class ConnectorError extends DomainError {
  constructor(code:string,message:string,public certainty:'not_sent'|'rejected'|'unknown'='unknown',public retryable=false,public retryAfterMs?:number){super(code,message,502);}
}
export type ConnectorProduct = {productId:string;resourceId?:string;suggestedProductKey?:string;name:string;type:'consumable'|'nonConsumable'|'unconfigured';description?:string;localizations?:Record<string,{name:string;description:string}>;status?:string;prices?:StorePrice[];priceState?:'available'|'unavailable'|'separate_request';priceMessage?:string};
export type ConnectorDiscovery = {products:ConnectorProduct[];message?:string};
export interface Connector {
  store:Store;
  fingerprint:string;
  saleCountries?():string[];
  read(id:string):Promise<Remote|null>;
  validate(desired:Desired,fields?:string[]):Promise<void>;
  steps(desired:Desired,fields?:string[]):string[];
  create(id:string,desired:Desired):Promise<{id:string;receipt:unknown}>;
  apply(step:string,row:Row):Promise<unknown>;
  status?(row:Row):Promise<unknown>;
  discover?():Promise<ConnectorDiscovery>;
  discoverPrice?(resourceId:string):Promise<StorePrice[]>;
}
export type ConnectorFactory=(game:Game,store:Store)=>Connector;
export const EXCEPTION_FIELDS=['localizations','prices','availability','reviewNote','reviewImage','submitReview','activate'] as const;
