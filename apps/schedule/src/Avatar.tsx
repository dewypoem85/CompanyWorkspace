import { WorkspaceEntity } from './generated/workspace-entity';

/** Uses the same live profile directory as the company header, not a copied SSO photo. */
export function Avatar({ id, name = '이전 직원' }: { id?: number; name?: string }) {
  return <WorkspaceEntity kind="employee" id={id} name={name} className="avatar" />;
}
