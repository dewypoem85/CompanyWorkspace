import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import type { Express,Request,RequestHandler } from 'express';
import { DomainError,type Actor } from '../shared/domain.js';
import type { Repository } from './repository.js';
export type AuthConfig={demo:boolean;origin:string;secret:string;portalUrl:string;portalInternalUrl:string;secure:boolean};
type Token=Record<string,any>;
export function signToken(payload:Token,secret:string){const part=Buffer.from(JSON.stringify(payload)).toString('base64url');return part+'.'+createHmac('sha256',secret).update(part).digest('base64url');}
export function verifyToken(value:string,secret:string,issuer:string,audience:string,maxAge=86400):Token{
  const parts=value.split('.');if(parts.length!==2||value.length>16000)throw new DomainError('AUTH','로그인이 필요합니다.',401);
  const expected=createHmac('sha256',secret).update(parts[0]).digest();let actual:Buffer;try{actual=Buffer.from(parts[1],'base64url');}catch{throw new DomainError('AUTH','서명 오류',401);}
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new DomainError('AUTH','서명 오류',401);
  let p:Token;try{p=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{throw new DomainError('AUTH','본문 오류',401);}
  const now=Math.floor(Date.now()/1000);
  if(p.iss!==issuer||p.aud!==audience||!Number.isInteger(p.exp)||!Number.isInteger(p.iat)||p.exp<=now||p.iat>now+30||p.exp-p.iat>maxAge||p.exp<=p.iat||!p.sub||!p.jti||!Array.isArray(p.permissions))throw new DomainError('AUTH','토큰 만료 또는 형식 오류',401);return p;
}
export async function checkPortal(config:AuthConfig,actor:Actor,permission='iap.access',includeProjects=false){
  if(config.demo)return;
  if(!actor.sid)throw new DomainError('AUTH','포털 세션이 없습니다.',401);
  const now=Math.floor(Date.now()/1000);const token=signToken({iss:'iap',aud:'workspace-session',sid:actor.sid,sub:actor.id,permission,iat:now,exp:now+60,jti:randomUUID()},config.secret);
  let response;try{response=await fetch(config.portalInternalUrl+'/api/internal/workspace/session'+(includeProjects?'?include=projects':''),{headers:{Authorization:'Bearer '+token,Host:new URL(config.portalUrl).host},redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw new DomainError('PORTAL_UNAVAILABLE','포털 권한을 확인할 수 없습니다.',503);}
  if(!response.ok)throw new DomainError('PORTAL_DENIED','포털 세션·권한을 다시 확인하세요.',response.status===403?403:401);
  if(includeProjects){if(response.status===204)throw new DomainError('PORTAL_UPDATE_REQUIRED','포털의 프로젝트 연동 API 업데이트가 필요합니다.',503);return response.json();}
}
export function registerAuth(app:Express,repo:Repository,config:AuthConfig):RequestHandler{
  if(!config.demo&&config.secret.length<32)throw new Error('COMPANY_SSO_SHARED_SECRET must be at least 32 characters');
  const cookieName=config.secure?'__Host-IapSession':'IapSession';
  app.get('/auth/login',(_req,res)=>res.redirect(303,config.portalUrl+'/workspace/iap'));
  app.post('/auth/sso/callback',async(req,res)=>{
    if(config.demo){res.status(404).end();return;}
    const p=verifyToken(String(req.body?.token??''),config.secret,'company-portal','iap',90);
    if(!p.permissions.includes('iap.access')||!p.sid)throw new DomainError('FORBIDDEN','접근 권한 없음',403);
    await repo.put('sso_nonce',p.jti,{exp:p.exp},0);
    const now=Math.floor(Date.now()/1000);const session=signToken({...p,iss:'company-iap',aud:'iap-session',iat:now,exp:now+86400,jti:randomUUID()},config.secret);
    res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer').set('Set-Cookie',`${cookieName}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.secure?'; Secure':''}`).redirect(303,'/');
  });
  return async(req,res,next)=>{
    try{
      let actor:Actor;
      if(config.demo)actor={id:'demo',name:'로컬 데모 운영자',permissions:['iap.access','iap.publish']};
      else{const cookies=Object.fromEntries(String(req.headers.cookie??'').split(';').map(v=>v.trim().split(/=(.*)/s)));const p=verifyToken(cookies[cookieName]??'',config.secret,'company-iap','iap-session');actor={id:p.sub,name:p.name,permissions:p.permissions,sid:p.sid};if(!actor.permissions.includes('iap.access'))throw new DomainError('FORBIDDEN','접근 권한 없음',403);await checkPortal(config,actor);}
      if(!['GET','HEAD','OPTIONS'].includes(req.method)){
        const origin=req.headers.origin;
        const allowed=[config.origin,...(config.demo?['http://127.0.0.1:4181','http://localhost:4181']:[])];
        const reviewImage=req.method==='POST'&&/^\/games\/[a-zA-Z0-9_.-]{1,128}\/products\/[a-zA-Z0-9_.-]{1,128}\/review-images$/.test(req.path)&&!!req.is(['image/png','image/jpeg']);
        if(!origin||!allowed.includes(origin)||(!req.is('application/json')&&!reviewImage))throw new DomainError('CSRF','동일 사이트의 JSON 또는 심사 이미지 요청만 허용합니다.',403);
      }
      res.locals.actor=actor;next();
    }catch(error){next(error);}
  };
}
export function actorOf(response:{locals:Record<string,any>}):Actor{return response.locals.actor as Actor;}
