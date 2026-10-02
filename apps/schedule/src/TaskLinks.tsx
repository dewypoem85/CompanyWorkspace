import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ProjectIcon } from './ProjectIcon';
import type { Project } from './types';
import { taskLink } from './textLinks';
import { createWorkspaceReadSession, type WorkspaceReadSession } from './generated/workspace-read';
import { scheduleGet, taskReferenceResponse, type TaskReference as Reference } from './scheduleReads';

type LinkContext = { open: (id: number, commentId?: number) => void; projects: Project[]; load: (id: number) => Promise<Reference>; scope: number };
const Context = createContext<LinkContext | null>(null);

export function TaskLinkProvider({ open, projects, enabled = true, children }: Omit<LinkContext, 'load' | 'scope'> & { enabled?: boolean; children: ReactNode }) {
  // Scope deduplication to this panel, never share titles across sessions/users.
  const requests = useRef(new Map<number, Promise<Reference>>());
  const session = useRef<WorkspaceReadSession | undefined>(undefined);
  const generation = useRef(0);
  const revoked = useRef(!enabled);
  const previousEnabled = useRef(enabled);
  const [scope, setScope] = useState(0);
  const cancelRequests = useCallback(() => {
    generation.current++;
    for (const id of requests.current.keys()) session.current?.cancel(`task-reference:${id}`);
    requests.current.clear();
  }, []);
  useEffect(() => {
    const invalidate = () => {
      revoked.current = true;
      cancelRequests();
      setScope(value => value + 1);
    };
    document.addEventListener('workspace-entity-scope-change', invalidate);
    return () => {
      document.removeEventListener('workspace-entity-scope-change', invalidate);
      cancelRequests();
      session.current?.dispose();
      session.current = undefined;
    };
  }, [cancelRequests]);
  useEffect(() => {
    if (previousEnabled.current === enabled) return;
    previousEnabled.current = enabled;
    revoked.current = !enabled;
    cancelRequests();
    if (!enabled) {
      session.current?.dispose();
      session.current = undefined;
    }
    setScope(value => value + 1);
  }, [cancelRequests, enabled]);
  const load = useCallback((id: number) => {
    if (revoked.current || !enabled) return Promise.reject(Error('로그인·권한이 변경되어 참조 업무를 조회하지 않았습니다.'));
    if (!requests.current.has(id)) {
      try { session.current ??= createWorkspaceReadSession(); }
      catch (error) { return Promise.reject(error); }
      const owner = generation.current;
      const reader = session.current;
      let request: Promise<Reference>;
      request = reader.run(
        `task-reference:${id}`,
        signal => scheduleGet(`/api/tasks/${id}/reference`, signal, value => taskReferenceResponse(value, id))
      ).then(result => {
        if (result.status === 'cancelled' || owner !== generation.current || !result.isCurrent()) {
          throw Error('참조 업무 조회 중 계정 또는 화면이 변경되었습니다.');
        }
        if (result.status === 'error') throw result.error;
        return result.value;
      }).catch(error => {
        if (requests.current.get(id) === request) requests.current.delete(id);
        throw error;
      });
      requests.current.set(id, request);
    }
    return requests.current.get(id)!;
  }, [enabled]);
  return <Context.Provider value={{ open, projects, load, scope }}>{children}</Context.Provider>;
}

export function TextLink({ href, children }: { href: string; children: string }) {
  const context = useContext(Context);
  const target = taskLink(href, typeof location === 'undefined' ? 'https://schedule.example.com' : location.origin);
  if (context && target) return <TaskReference key={target.id} context={context} target={target} />;
  return <a className="text-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function TaskReference({ context, target }: { context: LinkContext; target: NonNullable<ReturnType<typeof taskLink>> }) {
  const [record, setRecord] = useState<Reference>(); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setFailed(false);
    void context.load(target.id).then(data => { if (active) setRecord(data); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [context.load, context.scope, target.id]);
  const project = context.projects.find(p => p.id === record?.projectId);
  const label = record?.title || (failed ? `확인할 수 없는 일정 #${target.id}` : `일정 #${target.id}`);
  return <a className="task-reference" href={target.href} title={record ? `${project?.name || '프로젝트 미지정'} · ${label}${record.archived ? ' · 보관됨' : ''}` : label} onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); context.open(target.id, target.commentId);
  }}><span aria-hidden="true">↗</span>{record?.projectId && <ProjectIcon id={record.projectId} />}<span className="task-reference-title">{label}</span>{target.commentId && <small>댓글</small>}{record?.archived && <small>보관됨</small>}</a>;
}
