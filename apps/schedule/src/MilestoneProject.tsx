import { ProjectIcon } from './ProjectIcon';
import type { Project } from './types';

export function MilestoneProject({ project }: { project?: Project }) {
  const name = project?.name || '프로젝트 미지정';
  return <span className="milestone-project" title={name}>
    {project && <ProjectIcon id={project.id} />}
    <span className="milestone-project-name">{name}</span>
  </span>;
}
