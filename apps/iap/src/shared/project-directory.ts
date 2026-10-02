import {z} from 'zod';
import type {Game} from './domain';

export const ProjectDirectorySchema=z.array(z.object({id:z.string().regex(/^\d+$/),name:z.string().min(1),archived:z.boolean()})).refine(items=>new Set(items.map(p=>p.id)).size===items.length,'프로젝트 ID가 중복되었습니다.');
export type CompanyProject=z.infer<typeof ProjectDirectorySchema>[number];
export function activeProjectsFirst<T extends {archived:boolean}>(projects:T[]){return [...projects].sort((a,b)=>Number(a.archived)-Number(b.archived));}
export function projectChoices(projects:CompanyProject[],games:Game[]){
  const company=activeProjectsFirst(projects.filter(p=>!p.archived||games.some(g=>g.portalProjectId===p.id))).map(p=>({value:p.id,name:p.name,archived:p.archived,game:games.find(g=>g.portalProjectId===p.id)}));
  const legacy=games.filter(g=>!g.portalProjectId).map(g=>({value:`legacy:${g.id}`,name:g.name,archived:false,game:g}));
  const active=company.filter(project=>!project.archived);
  return [...active.filter(project=>project.game),...active.filter(project=>!project.game),...legacy,...company.filter(project=>project.archived)];
}
export type ProjectChoice=ReturnType<typeof projectChoices>[number];
export function preferredProjectValue(choices:ProjectChoice[],previous='',routeGameId=''){
  return choices.find(choice=>choice.game?.id===routeGameId)?.value
    ||(previous&&choices.some(choice=>choice.value===previous)?previous:'')
    ||choices.find(choice=>choice.game)?.value
    ||'';
}
