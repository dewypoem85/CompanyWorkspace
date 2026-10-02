import React,{useEffect,useRef,useState} from 'react';

export type ReviewImageAsset={id:string;fileName:string;mimeType:string;size:number;sha256:string;url:string};

function sizeLabel(bytes:number){return bytes<1024*1024?`${Math.ceil(bytes/1024)}KB`:`${(bytes/1024/1024).toFixed(1)}MB`;}
function isUploadedRef(value:string){return /^review-[0-9a-f-]{36}\.(png|jpg)$/.test(value);}

export function ReviewImageUpload({value,onChange,upload,metadata}:{value?:string;onChange:(next:string|undefined)=>void;upload:(file:File)=>Promise<ReviewImageAsset>;metadata:(id:string)=>Promise<ReviewImageAsset>}){
  const input=useRef<HTMLInputElement>(null);
  const [asset,setAsset]=useState<ReviewImageAsset|null>(null);
  const [preview,setPreview]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;if(!value||!isUploadedRef(value)){setAsset(null);return;}metadata(value).then(next=>{if(active)setAsset(next);}).catch(()=>{if(active)setAsset(null);});return()=>{active=false;};},[value]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  async function choose(file?:File){
    if(!file)return;
    setError('');setAsset(null);
    if(!['image/png','image/jpeg'].includes(file.type)){setError('PNG 또는 JPG 이미지를 선택해 주세요.');return;}
    if(file.size===0||file.size>10*1024*1024){setError('이미지는 10MB 이하의 파일이어야 합니다.');return;}
    if(preview)URL.revokeObjectURL(preview);setPreview(URL.createObjectURL(file));setBusy(true);
    try{const saved=await upload(file);setAsset(saved);onChange(saved.id);setPreview('');}
    catch(e){setPreview('');setError((e as Error).message);}
    finally{setBusy(false);}
  }
  const imageUrl=preview||(asset?.url??(value&&isUploadedRef(value)?`/api/review-images/${encodeURIComponent(value)}`:''));
  return <section className="review-image-upload">
    <div className="review-image-heading"><div><strong>App Store 심사 이미지</strong><p>PNG 또는 JPG · 최대 10MB. 파일을 선택하면 서버에 바로 업로드합니다.</p></div><button className="cw-button" type="button" disabled={busy} onClick={()=>input.current?.click()}>{busy?'업로드 중…':value?'이미지 바꾸기':'이미지 선택'}</button></div>
    <input ref={input} className="sr-only" aria-label="App Store 심사 이미지 선택" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void choose(file);}}/>
    {imageUrl&&<div className="review-image-preview"><img src={imageUrl} alt="선택한 App Store 심사 이미지 미리보기"/><div><strong>{asset?.fileName??(value&&!isUploadedRef(value)?value:'업로드된 심사 이미지')}</strong>{asset&&<small>{sizeLabel(asset.size)} · {asset.mimeType}</small>}<button className="cw-button" type="button" data-variant="quiet" onClick={()=>{setAsset(null);setPreview('');onChange(undefined);}}>선택 해제</button></div></div>}
    {value&&!isUploadedRef(value)&&<p className="muted">서버 연결 프로필에 등록된 기존 이미지: {value}</p>}
    {error&&<p className="price-error" role="alert">{error}</p>}
  </section>;
}
