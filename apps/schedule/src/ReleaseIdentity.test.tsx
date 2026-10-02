import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReleaseActor,ReleaseProject} from './ReleaseIdentity';
import type {Bootstrap,Project} from './types';

describe('release identities use authorized IDs and common profile mounts',()=>{
  const people=[{id:11,name:'동명이인',isPrivate:false},{id:22,name:'동명이인',isPrivate:true}] as Bootstrap['employees'];
  it('uses the exact audit actor ID, including private labels returned by the server',()=>{
    const html=renderToStaticMarkup(<ReleaseActor actorId={22} employees={people}/>);
    expect(html).toContain('data-workspace-entity="employee"');
    expect(html).toContain('data-workspace-entity-id="22"');
    expect(html).not.toContain('data-workspace-entity-id="11"');
    expect(html).toContain('비공개');
  });
  it('does not request a profile for an actor absent from the allowed directory',()=>{
    const html=renderToStaticMarkup(<ReleaseActor actorId={99} employees={people}/>);
    expect(html).toContain('이전 직원');expect(html).not.toContain('data-workspace-entity-id=');
  });
  it('distinguishes imported system records from employee identities',()=>{
    const html=renderToStaticMarkup(<ReleaseActor actorId={0} employees={people} imported/>);
    expect(html).toContain('기존 시트에서 이전');expect(html).not.toContain('data-workspace-entity');
  });
  it('uses the common project icon and escapes project names',()=>{
    const project={id:10,name:'<프로젝트>',isPrivate:true} as Project;
    const html=renderToStaticMarkup(<ReleaseProject project={project}/>);
    expect(html).toContain('data-workspace-entity="project"');expect(html).toContain('data-workspace-entity-id="10"');
    expect(html).toContain('&lt;프로젝트&gt;');expect(html).toContain('비공개');
    expect(renderToStaticMarkup(<ReleaseProject/>)).toContain('프로젝트 정보 없음');
  });
});
