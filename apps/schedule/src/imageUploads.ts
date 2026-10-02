import type {Attachment,Bootstrap} from './types';
import {scheduleActorScope} from './scheduleReads';

export type ImageUploadIntent={actorId:string;actorScope:string;name:string;size:number;sha256:string};
export type ImageUploadReceipt={operation:'upload';actorId:string;sha256:string;attachment:Attachment};
const allowed=new Set(['image/jpeg','image/png','image/webp','image/gif']);
const requireValue=(value:unknown,message='이미지 업로드 응답이 올바르지 않습니다. 같은 파일을 다시 보내지 말고 새 화면에서 확인해 주세요.')=>{if(!value)throw Error(message);};

export async function captureImageUpload(file:File,boot:Bootstrap):Promise<ImageUploadIntent>{
  requireValue(Number.isSafeInteger(boot.me.id)&&boot.me.id>0&&boot.me.active&&boot.me.access&&!boot.me.shared,'현재 계정으로 이미지를 업로드할 수 없습니다.');
  requireValue(file.size>0&&file.size<=10*1024*1024,'이미지는 파일당 10MB까지 첨부할 수 있습니다.');
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  const sha256=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  return {actorId:String(boot.me.id),actorScope:scheduleActorScope(boot.me),name:file.name.slice(0,200),size:file.size,sha256};
}

export function confirmImageUploadReceipt(value:unknown,intent:ImageUploadIntent,sent:unknown):Attachment{
  const data=value as ImageUploadReceipt;
  requireValue(data?.operation==='upload'&&data.actorId===intent.actorId&&data.sha256===intent.sha256&&/^[a-f0-9]{64}$/.test(data.sha256));
  if(!(sent instanceof FormData))throw Error('이미지 업로드 요청을 확인할 수 없습니다.');
  const file=sent.get('file');requireValue(file instanceof File&&file.size===intent.size&&file.name.slice(0,200)===intent.name);
  const image=data.attachment;
  requireValue(image&&typeof image.id==='string'&&/^[a-f0-9]{32}$/.test(image.id)&&image.ownerId===Number(intent.actorId));
  requireValue(image.taskId===null&&image.commentId===null&&image.name===intent.name&&image.size===intent.size&&allowed.has(image.contentType));
  requireValue(typeof image.createdAt==='string'&&Number.isFinite(Date.parse(image.createdAt)));
  return image;
}
