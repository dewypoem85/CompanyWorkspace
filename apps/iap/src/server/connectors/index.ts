import { GoogleAuth } from 'google-auth-library';
import { DomainError,type Desired,type Game,type Remote,type Row,type Store } from '../../shared/domain.js';
import { GoogleConnector } from './google.js';
import { AppleConnector } from './apple.js';
import { SteamConnector } from './steam.js';
import { sheetWrites,type Connection } from './config.js';
import { request } from './http.js';
import type { Connector,ConnectorFactory } from './types.js';
import { ConnectorError } from './types.js';
export function connectors(config:Record<string,Connection>,reviewAssetDirectory=process.env.REVIEW_ASSET_DIR??'/app/data/review-assets'):ConnectorFactory {
  const cached=new Map<string,Connector>();return (game,store)=>{const key=game.connectorKey+':'+store;if(cached.has(key))return cached.get(key)!;const c=config[game.connectorKey];let adapter:Connector;if(store==='google'&&c?.google)adapter=new GoogleConnector(c.google);else if(store==='apple'&&c?.apple)adapter=new AppleConnector(c.apple,reviewAssetDirectory);else if(store==='steam'&&c?.steam)adapter=new SteamConnector(c.steam);else throw new DomainError('NOT_CONNECTED',`${store} 서버 연결 설정이 없습니다.`,409);cached.set(key,adapter);return adapter;};
}
export async function readSheets(game:Game,config:Record<string,Connection>){
  const c=config[game.connectorKey]?.sheets;if(!c||!game.spreadsheetId)throw new DomainError('SHEETS_NOT_CONNECTED','시트 ID 또는 서비스 계정 연결이 없습니다.');
  const auth=new GoogleAuth({keyFile:c.keyFile,scopes:[c.writesEnabled?'https://www.googleapis.com/auth/spreadsheets':'https://www.googleapis.com/auth/spreadsheets.readonly']});
  const result=await request(`https://sheets.googleapis.com/v4/spreadsheets/${game.spreadsheetId}/values:batchGet?ranges=Products&valueRenderOption=FORMATTED_VALUE`,{headers:{Authorization:'Bearer '+await auth.getAccessToken()}});
  return {products:result?.valueRanges?.[0]?.values??[]};
}
export async function appendSheetProduct(game:Game,config:Record<string,Connection>,row:string[]){
  const c=config[game.connectorKey]?.sheets;if(!c||!game.spreadsheetId)throw new DomainError('SHEETS_NOT_CONNECTED','시트 ID 또는 서비스 계정 연결이 없습니다.');sheetWrites(c);
  const auth=new GoogleAuth({keyFile:c.keyFile,scopes:['https://www.googleapis.com/auth/spreadsheets']});
  await request(`https://sheets.googleapis.com/v4/spreadsheets/${game.spreadsheetId}/values/Products!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',headers:{Authorization:'Bearer '+await auth.getAccessToken(),'Content-Type':'application/json'},body:JSON.stringify({majorDimension:'ROWS',values:[row]})});
}
export class DemoConnector implements Connector {
  fingerprint='isolated-demo-v1';items=new Map<string,Remote>();
  constructor(public store:Store){this.items.set('starter_pack',{id:'starter_pack',data:{status:'판매 중',price:'5500',name:'스타터 패키지'}});}
  async read(id:string){return structuredClone(this.items.get(id)??null);}
  async discover(){return {products:[...this.items.entries()].map(([productId,value])=>({productId,name:String(value.data.name??productId),type:'unconfigured' as const,status:String(value.data.status??'')}))};}
  async validate(_d:Desired){}
  steps(d:Desired,fields?:string[]){return fields??['prices',...(d.settings.activate?['activate']:[]),...(d.settings.submitReview?['submitReview']:[])];}
  async create(id:string,d:Desired){if(this.items.has(id))throw new ConnectorError('ALREADY_EXISTS','기존 상품','rejected');this.items.set(id,{id,data:{name:d.product.name}});return {id,receipt:{demo:true,id}};}
  async apply(step:string,row:Row){this.items.set(row.remoteId,{id:row.remoteId,data:{...this.items.get(row.remoteId)?.data,name:row.desired.product.name,price:row.desired.preset.krw,status:step==='submitReview'?'심사 대기':'등록됨'}});return {demo:true,step};}
}
