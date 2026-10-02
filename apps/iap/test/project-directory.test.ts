import {describe,it,expect} from 'vitest';
import {activeProjectsFirst,preferredProjectValue,ProjectDirectorySchema,projectChoices} from '../src/shared/project-directory';
const projects=[{id:'12',name:'던전슬래셔',archived:false},{id:'34',name:'두 번째 프로젝트',archived:false}];
describe('회사 프로젝트와 IAP 연결의 구분',()=>{
  it('IAP 연결이 없어도 회사 프로젝트 두 개를 선택할 수 있다',()=>{
    expect(projectChoices(projects,[]).map(p=>[p.value,p.name,p.game])).toEqual([['12','던전슬래셔',undefined],['34','두 번째 프로젝트',undefined]]);
  });
  it('이름으로 추측하지 않고 실제 연결 ID만 사용하며 레거시 이력을 유지한다',()=>{
    const games=[{id:'old',name:'던전슬래셔',connectorKey:'old'},{id:'linked',name:'이전 이름',portalProjectId:'34',connectorKey:'live'}];
    const choices=projectChoices(projects,games);
    expect(choices[0].game?.id).toBe('linked');expect(choices[0].name).toBe('두 번째 프로젝트');expect(choices[1].game).toBeUndefined();expect(choices[2].value).toBe('legacy:old');
  });
  it('첫 회사 프로젝트가 미연결이어도 연결된 프로젝트를 초기 선택하고 미연결만 있으면 선택하지 않는다',()=>{
    const games=[{id:'linked',name:'던전슬래셔',portalProjectId:'34',connectorKey:'live'}];
    const choices=projectChoices(projects,games);
    expect(preferredProjectValue(choices)).toBe('34');
    expect(preferredProjectValue(projectChoices(projects,[]))).toBe('');
    expect(preferredProjectValue(choices,'12')).toBe('12');
  });
  it('새 보관 프로젝트와 서버가 반환하지 않은 연결 프로젝트를 노출하지 않는다',()=>{
    const directory=[...projects,{id:'56',name:'보관',archived:true}];
    expect(projectChoices(directory,[{id:'hidden',name:'비공개',portalProjectId:'78',connectorKey:'live'}])).toHaveLength(2);
    expect(projectChoices(directory,[{id:'archive',name:'보관',portalProjectId:'56',connectorKey:'live'}])[2].archived).toBe(true);
  });
  it('회사 목록 순서와 관계없이 활성 프로젝트와 레거시 연결을 보관 프로젝트보다 먼저 표시한다',()=>{
    const directory=[{id:'56',name:'보관',archived:true},...projects];
    expect(activeProjectsFirst(directory).map(project=>project.id)).toEqual(['12','34','56']);
    expect(projectChoices(directory,[{id:'archive',name:'보관',portalProjectId:'56',connectorKey:'live'},{id:'legacy',name:'레거시',connectorKey:'live'}]).map(project=>project.value)).toEqual(['12','34','legacy:legacy','56']);
  });
  it('잘못된 ID와 중복 목록은 빈 프로젝트 목록으로 오인하지 않고 거부한다',()=>{
    expect(()=>ProjectDirectorySchema.parse([...projects,projects[0]])).toThrow();
    expect(()=>ProjectDirectorySchema.parse([{id:12,name:'프로젝트',archived:false}])).toThrow();
  });
});
