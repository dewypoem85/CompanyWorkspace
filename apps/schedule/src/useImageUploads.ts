import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {workspaceDocumentFormSession,createWorkspaceWriteTransport,type FormLease,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {captureImageUpload,confirmImageUploadReceipt,type ImageUploadIntent} from './imageUploads';
import {scheduleActorScope} from './scheduleReads';
import type {Attachment,Bootstrap} from './types';

type Options={boot:Bootstrap;refreshIdentity:()=>Promise<Bootstrap>;images:Attachment[];setImages:(images:Attachment[])=>void;disabled:boolean;label:string;busyChanged?:(busy:boolean)=>void};
type Active={intent:ImageUploadIntent;file:File;lease:FormLease;receipt?:Attachment};
let ownerSequence=0,resourceSequence=0;
const imageSignature=(images:Attachment[])=>JSON.stringify(images.map(image=>[image.id,image.taskId,image.commentId,image.name,image.contentType,image.size]));

export function useImageUploads(options:Options){
  const live=useRef(options);live.current=options;
  const owner=useRef(`schedule-image-upload-${++ownerSequence}`),actor=useRef(scheduleActorScope(options.boot.me));
  const mounted=useRef(false),batch=useRef(false),session=useRef<WorkspaceFormSession|undefined>(undefined),transport=useRef<WorkspaceWriteTransport|undefined>(undefined),active=useRef<Active|null>(null);
  const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[outcome,setOutcome]=useState<WorkspaceStateProps|null>(null);
  const sameOwner=useCallback(()=>mounted.current&&scheduleActorScope(live.current.boot.me)===actor.current&&!session.current?.invalid,[]);
  const current=useCallback((command:Active)=>sameOwner()&&command.lease.current&&active.current===command&&!live.current.disabled,[sameOwner]);

  useEffect(()=>{
    mounted.current=true;let untrack:(()=>void)|undefined,unsubscribe:(()=>void)|undefined;
    try{
      const forms=workspaceDocumentFormSession('schedule-image-uploads');session.current=forms;untrack=forms.track(owner.current);
      const sync=()=>{if(mounted.current)setLocked(forms.invalid);};unsubscribe=forms.subscribe(sync);sync();
      transport.current=createWorkspaceWriteTransport({timeoutMs:60000,isConnected:()=>mounted.current,onState:setOutcome,
        onSaved:(value,sent,context)=>{const command=active.current;if(!command||!current(command)||!context.isCurrent())throw Error('업로드 중 계정 또는 편집기가 변경되었습니다.');command.receipt=confirmImageUploadReceipt(value,command.intent,sent);}});
    }catch(error){setLocked(true);setOutcome({kind:'error',title:'이미지 업로드 도구를 준비하지 못했습니다.',message:(error as Error).message});}
    return()=>{mounted.current=false;active.current?.lease.finish('unknown');active.current=null;transport.current?.dispose();untrack?.();unsubscribe?.();};
  },[current]);
  useEffect(()=>{if(scheduleActorScope(options.boot.me)!==actor.current)session.current?.invalidate();},[options.boot]);

  async function upload(files:File[]){
    const start=live.current,forms=session.current,writer=transport.current;
    if(!files.length||batch.current||busy||locked||start.disabled||!forms||!writer||!sameOwner())return;
    if(start.images.length+files.length>10){setOutcome({kind:'error',title:'이미지를 선택하지 못했습니다.',message:'이미지는 최대 10개까지 첨부할 수 있습니다.'});return;}
    if(files.some(file=>file.size===0||file.size>10*1024*1024)){setOutcome({kind:'error',title:'이미지를 선택하지 못했습니다.',message:'이미지는 파일당 10MB까지 첨부할 수 있습니다.'});return;}
    const originalImages=imageSignature(start.images),scope=actor.current;batch.current=true;setBusy(true);start.busyChanged?.(true);setOutcome({kind:'loading',title:'이미지와 계정을 확인합니다.'});
    try{
      const directory=await start.refreshIdentity();
      if(!sameOwner()||scheduleActorScope(directory.me)!==scope||imageSignature(live.current.images)!==originalImages)throw new ApiError(409,'확인 중 계정 또는 첨부 목록이 변경되었습니다.');
      const intents:ImageUploadIntent[]=[];for(const file of files){intents.push(await captureImageUpload(file,directory));if(!sameOwner()||imageSignature(live.current.images)!==originalImages)throw Error('확인 중 계정 또는 첨부 목록이 변경되었습니다.');}
      const stable=()=>sameOwner()&&!live.current.disabled&&imageSignature(live.current.images)===originalImages;
      const names=files.map(file=>file.name).join(', '),bytes=files.reduce((total,file)=>total+file.size,0);
      setOutcome(null);
      const intent=await confirmWorkspaceAction({title:'이미지를 업로드할까요?',message:'선택한 파일을 임시 첨부로 저장합니다. 업무나 댓글을 저장하기 전에는 다른 직원에게 공개되지 않습니다.',confirmLabel:'업로드',
        details:[{label:'편집 위치',value:start.label},{label:'파일',value:names},{label:'크기',value:`${files.length}개 · ${(bytes/1024/1024).toFixed(2)}MB`}],validate:()=>stable()?null:'확인 중 계정 또는 첨부 목록이 변경되었습니다. 취소 후 다시 선택해 주세요.'});
      if(!intent||!stable()){setOutcome(null);return;}
      const next=[...start.images];let allSaved=true;
      for(let index=0;index<files.length;index++){
        const uploadIntent=intents[index],file=files[index],lease=forms.begin(owner.current,[`upload:${++resourceSequence}:${uploadIntent.sha256}`]);
        if(!lease)throw Error('다른 첨부 저장이 진행 중이거나 업로드 문서가 잠겼습니다. 새 화면에서 확인해 주세요.');
        const command:Active={intent:uploadIntent,file,lease};active.current=command;let attempted=false,finished=false;
        try{
          if(!current(command))throw Error('업로드 직전 계정 또는 편집기가 변경되었습니다.');
          attempted=true;if(!lease.markSent())throw Error('업로드 직전 계정 범위가 변경되었습니다.');
          const formData=new FormData();formData.append('file',file);
          const result=await writer.send({url:'/api/images',method:'POST',formData,signal:lease.signal,headers:{'X-CSRF-TOKEN':directory.csrfToken,'X-Workspace-Actor':uploadIntent.actorId}});
          if(result.saved&&command.receipt&&current(command)){
            finished=true;lease.finish('saved');next.push(command.receipt);live.current.setImages([...next]);
          }else{
            finished=true;lease.finish(result.outcome==='invalid'?'invalid':result.outcome==='conflict'?'conflict':result.outcome==='not-sent'?'cancelled':'unknown');
            allSaved=false;if(result.outcome==='denied'){document.dispatchEvent(new Event('workspace-entity-scope-change'));}
            break;
          }
        }finally{if(!finished)lease.finish(attempted?'unknown':'cancelled');if(active.current===command)active.current=null;}
      }
      if(allSaved&&sameOwner()&&next.length>start.images.length)setOutcome({kind:'success',title:'이미지를 첨부했습니다.',message:`${next.length-start.images.length}개 파일을 초안에 추가했습니다. 업무나 댓글 저장을 완료해 주세요.`});
    }catch(error){
      if(error instanceof ApiError&&[401,403].includes(error.status))document.dispatchEvent(new Event('workspace-entity-scope-change'));
      if(mounted.current)setOutcome({kind:'error',title:active.current?'업로드 결과를 확인해 주세요.':'이미지를 업로드하지 못했습니다.',message:(error as Error).message});
    }finally{active.current=null;batch.current=false;if(mounted.current){setBusy(false);live.current.busyChanged?.(false);}}
  }
  return {upload,busy,locked,outcome};
}
