// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
import {api} from './api';
import {analysis,config,preview,snapshots} from '../test/sheetFixtures';
afterEach(()=>vi.unstubAllGlobals());
test('read endpoints preserve methods and use no-store authenticated JSON validation',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(Response.json(config)).mockResolvedValueOnce(Response.json(analysis)).mockResolvedValueOnce(Response.json(snapshots)).mockResolvedValueOnce(Response.json(preview));vi.stubGlobal('fetch',fetch);
  const controller=new AbortController();
  expect(await api.config(controller.signal)).toEqual(config);expect(await api.analyze('sheet',controller.signal)).toEqual(analysis);
  expect(await api.snapshots(controller.signal)).toEqual(snapshots);expect(await api.previewKoreanSync('sheet',controller.signal)).toEqual(preview);
  for(const [,options] of fetch.mock.calls)expect(options).toMatchObject({credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal});
  expect(fetch.mock.calls[1][1]).toMatchObject({method:'POST',body:JSON.stringify({spreadsheet:'sheet'})});
  expect(fetch.mock.calls[3][1].method).toBe('POST');
});
test('HTML, malformed JSON, incomplete success and denied bodies are not accepted as data',async()=>{
  const denied=vi.fn();document.addEventListener('sheet-access-denied',denied);
  try {
    for(const response of [new Response('<html>login</html>'),new Response('{',{headers:{'content-type':'application/json'}}),Response.json({}),Response.json(null)]){
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));await expect(api.config()).rejects.toThrow();
    }
    for(const status of [401,403]){
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{',{status,headers:{'content-type':'application/json'}})));
      await expect(api.config()).rejects.toMatchObject({status});
    }
    expect(denied).toHaveBeenCalledTimes(2);
  } finally {document.removeEventListener('sheet-access-denied',denied);}
});
test('abort during delayed JSON prevents data and stale authentication side effects',async()=>{
  let finish:(value:unknown)=>void;
  const denied=vi.fn();document.addEventListener('sheet-access-denied',denied);
  try {
    const response={ok:false,status:401,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(resolve=>{finish=resolve;})};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));const controller=new AbortController();const pending=api.config(controller.signal);
    await Promise.resolve();controller.abort();finish!({error:'old',loginUrl:'/login'});
    await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(denied).not.toHaveBeenCalled();
  } finally {document.removeEventListener('sheet-access-denied',denied);}
});
