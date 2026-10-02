import {describe,expect,it} from 'vitest';
import {validateSheetWriteContext} from './sheet-write-context.js';

const valid={actorId:'9007199254740993',requestedWith:'XMLHttpRequest',requestedActor:'9007199254740993',requestedState:'analysis-hash',expectedState:'analysis-hash'};
describe('sheet write request context',()=>{
  it('accepts the exact company actor and reviewed state without numeric conversion',()=>{
    expect(validateSheetWriteContext(valid)).toBe('ok');
  });
  it('rejects missing, cross-account and non-enhanced requests',()=>{
    for(const patch of [{actorId:''},{requestedWith:undefined},{requestedWith:'fetch'},{requestedActor:undefined},{requestedActor:'9007199254740992'}])
      expect(validateSheetWriteContext({...valid,...patch})).toBe('denied');
  });
  it('treats a missing or different reviewed state as a conflict',()=>{
    for(const patch of [{expectedState:''},{requestedState:undefined},{requestedState:'older-analysis'}])
      expect(validateSheetWriteContext({...valid,...patch})).toBe('conflict');
  });
});
