import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {DomainError,PresetSchema,type Preset} from '../shared/domain.js';
import {appleTerritoryMarket,deriveStorePricesFromApple} from '../shared/price-markets.js';
import {audit,hash,need,type Repository} from './repository.js';

export type AppleMatrixPoint={id:string;amount:string;currency:'KRW'};
export type AppleMatrixPrice={territory:string;name:string;englishName:string;amount:string;currency:string};
export type ApplePricingMatrix={
  id:string;sha256:string;sourceFile:string;territoryCount:number;currencyCount:number;sourceRowCount:number;
  points:AppleMatrixPoint[];tiers:Map<string,{point:AppleMatrixPoint;prices:AppleMatrixPrice[]}>;
};

let cached:Promise<ApplePricingMatrix>|undefined;

function csvLine(line:string){
  const cells:string[]=[];let value='',quoted=false;
  for(let index=0;index<line.length;index++){
    const char=line[index];
    if(char==='"'){
      if(quoted&&line[index+1]==='"'){value+='"';index++;}else quoted=!quoted;
    }else if(char===','&&!quoted){cells.push(value);value='';}else value+=char;
  }
  if(quoted)throw new DomainError('APPLE_MATRIX_FORMAT','Apple 가격 매트릭스의 따옴표가 닫히지 않았습니다.');
  cells.push(value);return cells;
}

function decimal(value:string,location:string){
  const trimmed=value.trim();if(!trimmed)return undefined;
  if(!/^\d+(\.\d{1,6})?$/.test(trimmed))throw new DomainError('APPLE_MATRIX_FORMAT',`${location} 금액 형식이 올바르지 않습니다.`);
  const [whole,fraction='']=trimmed.split('.'),cleanFraction=fraction.replace(/0+$/,'');
  return `${BigInt(whole)}${cleanFraction?`.${cleanFraction}`:''}`;
}

export function parseApplePricingMatrix(raw:string,sourceFile='pricing-matrix.csv'):ApplePricingMatrix{
  const canonicalRaw=raw.replace(/\r\n/g,'\n'),lines=canonicalRaw.replace(/^\uFEFF/,'').trimEnd().split('\n');if(lines.length<3)throw new DomainError('APPLE_MATRIX_FORMAT','가격 CSV가 비어 있습니다.');
  const headers=csvLine(lines[0]),kinds=csvLine(lines[1]);
  if(headers.length!==kinds.length||headers.length%2!==0)throw new DomainError('APPLE_MATRIX_FORMAT','가격 CSV 열 구성이 올바르지 않습니다.');
  const territories:{code:string;currency:string;customer:number;proceeds:number}[]=[],seenTerritories=new Set<string>();
  for(let index=0;index<headers.length;index+=2){
    const match=/^([A-Z]{3}) \(([A-Z]{3})\)$/.exec(headers[index]);
    if(!match||headers[index+1]!==''||kinds[index]!=='customerPrice'||kinds[index+1]!=='proceeds')throw new DomainError('APPLE_MATRIX_FORMAT',`Apple 가격 매트릭스 ${index+1}번째 열 구성이 올바르지 않습니다.`);
    if(seenTerritories.has(match[1]))throw new DomainError('APPLE_MATRIX_FORMAT',`${match[1]} 국가가 중복되었습니다.`);
    seenTerritories.add(match[1]);territories.push({code:match[1],currency:match[2],customer:index,proceeds:index+1});
  }
  const kor=territories.find(territory=>territory.code==='KOR');
  if(!kor||kor.currency!=='KRW')throw new DomainError('APPLE_MATRIX_FORMAT','대한민국 KRW 가격 열이 없습니다.');
  const tiers=new Map<string,{point:AppleMatrixPoint;prices:AppleMatrixPrice[]}>(),currencies=new Set(territories.map(territory=>territory.currency));
  for(let row=2;row<lines.length;row++){
    const cells=csvLine(lines[row]);if(cells.length!==headers.length)throw new DomainError('APPLE_MATRIX_FORMAT',`${row+1}행의 열 개수가 올바르지 않습니다.`);
    for(const territory of territories){
      const customer=decimal(cells[territory.customer],`${row+1}행 ${territory.code} customerPrice`),proceeds=decimal(cells[territory.proceeds],`${row+1}행 ${territory.code} proceeds`);
      if((customer===undefined)!==(proceeds===undefined))throw new DomainError('APPLE_MATRIX_FORMAT',`${row+1}행 ${territory.code} 가격 쌍이 불완전합니다.`);
    }
    const amount=decimal(cells[kor.customer],`${row+1}행 KOR customerPrice`);if(!amount||Number(amount)===0)continue;
    if(!/^\d+$/.test(amount))throw new DomainError('APPLE_MATRIX_FORMAT','대한민국 소비자가격은 원 단위 정수여야 합니다.');
    const id=`matrix-KOR-${amount}`;if(tiers.has(id))throw new DomainError('APPLE_MATRIX_FORMAT',`대한민국 ${amount}원 가격이 중복되었습니다.`);
    const prices=territories.flatMap(territory=>{
      const customer=decimal(cells[territory.customer],`${row+1}행 ${territory.code} customerPrice`);if(!customer||Number(customer)===0)return [];
      const market=appleTerritoryMarket(territory.code,territory.currency);
      return [{territory:territory.code,name:market.name,englishName:market.englishName,amount:customer,currency:territory.currency}];
    }).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    const point:AppleMatrixPoint={id,amount,currency:'KRW'};tiers.set(id,{point,prices});
  }
  if(!tiers.size)throw new DomainError('APPLE_MATRIX_FORMAT','선택 가능한 대한민국 가격이 없습니다.');
  const sha256=createHash('sha256').update(canonicalRaw).digest('hex'),id=`matrix-${sha256}`;
  const points=[...tiers.values()].map(tier=>tier.point).sort((a,b)=>Number(a.amount)-Number(b.amount));
  return {id,sha256,sourceFile:path.basename(sourceFile),territoryCount:territories.length,currencyCount:currencies.size,sourceRowCount:lines.length-2,points,tiers};
}

export async function applePricingMatrix(){
  const file=process.env.APPLE_PRICING_MATRIX_FILE??path.resolve(process.cwd(),'resources/pricing-matrix.csv');
  cached??=readFile(file,'utf8').then(raw=>parseApplePricingMatrix(raw,file));return cached;
}

export async function applePricingMatrixSummary(){
  const {tiers,...matrix}=await applePricingMatrix();return matrix;
}

export async function applePricingMatrixTier(matrixVersion:string,tierId:string){
  const matrix=await applePricingMatrix();
  if(matrixVersion!==matrix.id)throw new DomainError('APPLE_MATRIX_CHANGED','가격 CSV가 변경되었습니다. 가격을 다시 선택하세요.',409);
  const tier=matrix.tiers.get(tierId);if(!tier)throw new DomainError('APPLE_MATRIX_PRICE','가격 CSV에서 가격을 다시 선택하세요.');
  return {matrixVersion:matrix.id,sha256:matrix.sha256,sourceFile:matrix.sourceFile,...tier.point,prices:tier.prices};
}

export async function priceSnapshotFromMatrix(repo:Repository,gameId:string,actorId:string,matrixVersion:string,tierId:string){
  await need(repo,'game',gameId);
  const tier=await applePricingMatrixTier(matrixVersion,tierId),generated=deriveStorePricesFromApple(tier.prices),base=tier.prices.find(price=>price.territory==='KOR');
  if(!base)throw new DomainError('APPLE_MATRIX_PRICE','가격 CSV에서 대한민국 가격을 다시 선택하세요.');
  const data=PresetSchema.parse({key:`CSV_${generated.krw}_${tier.sha256}`,name:`${Number(generated.krw).toLocaleString('ko-KR')}원`,krw:generated.krw,google:generated.google,apple:{KOR:{pricePointId:tierId,selectionId:matrixVersion,amount:base.amount,currency:base.currency}},steam:generated.steam});
  const signature=(preset:typeof data|Preset)=>hash({krw:preset.krw,google:preset.google,steam:preset.steam,pricePointId:preset.apple.KOR?.pricePointId,selectionId:preset.apple.KOR?.selectionId});
  return repo.lock(`matrix-price:${data.key}`,async()=>{
    const existing=(await repo.list<Preset>('preset')).map(row=>row.data).filter(preset=>preset.key===data.key&&signature(preset)===signature(data)).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt))[0];
    if(existing)return existing;
    const preset:Preset={...data,version:randomUUID(),confirmedAt:new Date().toISOString(),confirmedBy:actorId};
    await repo.put('preset',preset.version,preset,0);await audit(repo,actorId,'price.matrix.snapshot',{gameId,matrixVersion,tierId,presetVersion:preset.version});return preset;
  });
}
