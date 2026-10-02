import { WorkspaceEntity } from './generated/workspace-entity';
export function ProjectIcon({ id }: { id?: number | null }) {
  if (!id) return null;
  return <WorkspaceEntity kind="project" id={id} />;
}
