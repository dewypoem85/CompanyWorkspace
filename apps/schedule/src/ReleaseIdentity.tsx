import { Avatar } from './Avatar';
import { ProjectIcon } from './ProjectIcon';
import type { Bootstrap, Project } from './types';
import './releaseIdentity.css';

export function ReleaseActor({actorId,employees,imported=false}:{actorId:number;employees:Bootstrap['employees'];imported?:boolean}) {
  if(actorId===0&&imported)return <span className="release-actor">기존 시트에서 이전</span>;
  // Only the authorized directory may connect an audit actor to a live profile.
  const actor=employees.find(employee=>employee.id===actorId);
  const name=actor?.name||'이전 직원';
  return <span className="release-actor"><Avatar id={actor?.id} name={name}/><span>{name}{actor?.isPrivate&&<small> · 비공개</small>}</span></span>;
}

export function ReleaseProject({project}:{project?:Project}) {
  return <span className="release-project-identity"><ProjectIcon id={project?.id}/><span>{project?.name||'프로젝트 정보 없음'}{project?.isPrivate&&<small> · 비공개</small>}</span></span>;
}
