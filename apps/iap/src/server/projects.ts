import {z} from 'zod';
import {DomainError,type Actor,type Game} from '../shared/domain.js';
import {checkPortal,type AuthConfig} from './auth.js';
import {audit,need,type Repository} from './repository.js';
const Directory=z.object({projects:z.array(z.object({id:z.string().regex(/^\d+$/),name:z.string().min(1),archived:z.boolean()}))});
export async function portalProjects(auth:AuthConfig,actor:Actor){
  if(auth.demo)return [{id:'1',name:'던전슬래셔',archived:false}];
  return Directory.parse(await checkPortal(auth,actor,'iap.access',true)).projects;
}
export async function bindProject(repo:Repository,auth:AuthConfig,actor:Actor,gameId:string,projectId:string){
  const project=(await portalProjects(auth,actor)).find(p=>p.id===projectId&&!p.archived);
  if(!project)throw new DomainError('PROJECT_MISSING','사용 중인 회사 프로젝트를 선택하세요.');
  return repo.lock('project-bindings',async()=>{
    const game=await need<Game>(repo,'game',gameId);
    if(game.portalProjectId&&game.portalProjectId!==project.id)throw new DomainError('PROJECT_REBIND','기존 프로젝트 연결을 다른 프로젝트로 바꿀 수 없습니다.');
    if((await repo.list<Game>('game')).some(r=>r.id!==gameId&&r.data.portalProjectId===projectId))throw new DomainError('PROJECT_DUPLICATE','이미 연결된 프로젝트입니다.');
    const result={...game,portalProjectId:project.id,name:project.name};await repo.put('game',gameId,result);await audit(repo,actor.id,'project.bind',{gameId,projectId});return result;
  });
}
