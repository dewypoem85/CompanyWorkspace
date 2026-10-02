import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {DomainError,Id,type Actor,type Catalog} from '../shared/domain.js';
import {audit,need,type Repository} from './repository.js';

const MAX_BYTES=10*1024*1024;
const UploadName=z.string().trim().min(1).max(200).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'파일 이름을 확인해 주세요.');
export const ReviewAssetId=z.string().regex(/^review-[0-9a-f-]{36}\.(png|jpg)$/);
export type ReviewAsset={id:string;gameId:string;productKey:string;fileName:string;mimeType:'image/png'|'image/jpeg';size:number;sha256:string;createdBy:string;createdAt:string;url:string};

function validImage(bytes:Buffer,mimeType:string){
  if(mimeType==='image/png')return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return mimeType==='image/jpeg'&&bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9;
}
export function reviewAssetPath(directory:string,id:string){return path.join(path.resolve(directory),ReviewAssetId.parse(id));}
export async function saveReviewAsset(repo:Repository,directory:string,actor:Actor,gameIdValue:string,productKeyValue:string,fileNameValue:unknown,mimeTypeValue:string,body:unknown){
  const gameId=Id.parse(gameIdValue),productKey=Id.parse(productKeyValue),fileName=UploadName.parse(fileNameValue);
  await need(repo,'game',gameId);const catalog=await need<Catalog>(repo,'catalog',gameId);
  if(!catalog.products.some(product=>product.productKey===productKey))throw new DomainError('NOT_FOUND','상품을 찾을 수 없습니다.',404);
  if(!Buffer.isBuffer(body)||body.length===0||body.length>MAX_BYTES)throw new DomainError('IMAGE_SIZE','심사 이미지는 10MB 이하의 파일이어야 합니다.');
  if(!['image/png','image/jpeg'].includes(mimeTypeValue)||!validImage(body,mimeTypeValue))throw new DomainError('IMAGE_TYPE','PNG 또는 JPG 이미지 파일을 선택해 주세요.');
  const mimeType=mimeTypeValue as ReviewAsset['mimeType'];const id=`review-${randomUUID()}.${mimeType==='image/png'?'png':'jpg'}`;const destination=reviewAssetPath(directory,id);const temporary=destination+'.tmp';
  await mkdir(path.dirname(destination),{recursive:true});
  try{await writeFile(temporary,body,{flag:'wx',mode:0o600});await rename(temporary,destination);}catch(error){await rm(temporary,{force:true});throw error;}
  const asset:ReviewAsset={id,gameId,productKey,fileName,mimeType,size:body.length,sha256:createHash('sha256').update(body).digest('hex'),createdBy:actor.id,createdAt:new Date().toISOString(),url:`/api/review-images/${id}`};
  try{await repo.put('review_asset',id,asset,0);await audit(repo,actor.id,'review-image.upload',{...asset,url:undefined});}catch(error){await rm(destination,{force:true});throw error;}
  return asset;
}
export async function loadReviewAsset(repo:Repository,directory:string,idValue:string){const id=ReviewAssetId.parse(idValue);const asset=await need<ReviewAsset>(repo,'review_asset',id);if(asset.id!==id)throw new DomainError('NOT_FOUND','심사 이미지를 찾을 수 없습니다.',404);return {asset,bytes:await readFile(reviewAssetPath(directory,id))};}
