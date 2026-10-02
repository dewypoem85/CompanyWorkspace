import {describe,expect,it} from 'vitest';
import {matchesWorkspacePath,workspacePathParams} from '../src/client/generated/workspace-navigation.js';

describe('공용 workspace 문자열 경로',()=>{
  it('프로젝트와 상품 키를 추출하고 숫자 ID 경로의 제약을 유지한다',()=>{
    const pattern='/projects/:gameId/products/:productKey';
    const path='/projects/dungeon-slasher/products/pack_monthly.1';
    expect(matchesWorkspacePath(pattern,path)).toBe(true);
    expect(workspacePathParams(pattern,path)).toEqual({gameId:'dungeon-slasher',productKey:'pack_monthly.1'});
    expect(matchesWorkspacePath(pattern,'/projects/../products/pack')).toBe(false);
    expect(matchesWorkspacePath('/tasks/:id','/tasks/12')).toBe(true);
    expect(matchesWorkspacePath('/tasks/:id','/tasks/not-a-number')).toBe(false);
  });
});
