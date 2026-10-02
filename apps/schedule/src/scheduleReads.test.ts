import {afterEach,expect,test,vi} from 'vitest';
import {bootstrapResponse,taskListResponse,taskReferenceResponse,archivedTaskPageResponse,mergeTaskListPages,absencesResponse,milestoneResponse,milestonePageResponse,milestoneRevisionResponse,milestonesForProject,readScheduleBoard,scheduleGet,type BoardQuery} from './scheduleReads';
import type {Task} from './types';
const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[10],role:'employee',active:true,access:true,shared:false,isAdmin:false};
const boot={me,employees:[me],departments:[{id:1,name:'개발',archived:false}],projects:[{id:10,name:'프로젝트',color:'#5563d8',archived:false,version:1}],leads:[],csrfToken:'test',demo:false};
const task:Task={id:1,title:'업무',body:'원문 9223372036854775807',assigneeId:1,createdBy:1,projectId:10,startDate:'2026-09-07',endDate:'2026-09-11',status:'planned',archived:false,version:1,createdAt:'2026-09-01T00:00:00',updatedAt:'2026-09-01T00:00:00'};
const list=(items=[task],total=items.length)=>({items,total,editableIds:items.map(t=>t.id),commentCounts:[],attachmentCounts:[]});
const absence={items:[],holidays:[],available:true,holidaysAvailable:true,updatedAt:null};
const query:BoardQuery={view:'week',unscheduled:false,onlyWeek:false,week:'2026-09-07',loadedWeeks:2,limit:50,department:'',project:'',person:'',goal:''};
afterEach(()=>vi.unstubAllGlobals());
test('directory and list validation preserves source text but rejects missing fields, unsafe IDs and contradictory metadata',()=>{
  expect(bootstrapResponse(boot)).toEqual(boot);expect(taskListResponse(list()).items[0].body).toBe(task.body);
  const milestone={id:1,title:'검수',description:'',date:'2026-09-08',projectId:10,version:1,type:'review'};const page={items:[milestone],editing:{actorId:'1',createStateToken:'a'.repeat(64),milestones:[{id:1,stateToken:'b'.repeat(64)},{id:2,stateToken:'c'.repeat(64)}]}};expect(milestonePageResponse(page)).toEqual(page);
  const snapshot={type:'review',title:'검수',description:'',date:'2026-09-08',endDate:null,additionalSchedules:[],projectId:10};const revision={id:1,milestoneId:1,actorId:1,action:'create',beforeSnapshot:'',afterSnapshot:JSON.stringify(snapshot),createdAt:'2026-09-01T00:00:00Z'};expect(milestoneRevisionResponse([revision],1)).toEqual([revision]);expect(()=>milestoneRevisionResponse([{...revision,milestoneId:2}],1)).toThrow();
  for(const value of [null,{...boot,csrfToken:''},{...boot,employees:[me,me]},{...boot,projects:[{...boot.projects[0],color:'url(bad)'}]},{...boot,me:{...me,active:false}}])expect(()=>bootstrapResponse(value)).toThrow();
  for(const value of [null,{...list(),total:0},{...list(),items:[{...task,id:9007199254740992}]},{...list(),editableIds:[9]},{...list(),commentCounts:[{taskId:9,count:1}]},list([{...task,body:undefined} as unknown as Task]),list([{...task,startDate:'2026-02-30'}]),list([{...task,endDate:'2026-09-01'}]),list([task,task])])expect(()=>taskListResponse(value)).toThrow();
  expect(absencesResponse(absence)).toEqual(absence);expect(()=>absencesResponse({...absence,items:[{employeeId:1,date:'2026-02-30',portion:'오전'}]})).toThrow();
  expect(()=>milestoneResponse([{id:1,title:'',description:'',date:'2026-09-10',projectId:null,version:1,type:'unknown'}])).toThrow();
});
test('GET transport uses no-store, distinguishes non-JSON denial and never applies late decoded data',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('login',{status:401}));vi.stubGlobal('fetch',fetch);
  const controller=new AbortController();await expect(scheduleGet('/api/bootstrap',controller.signal,bootstrapResponse)).rejects.toMatchObject({status:401});
  expect(fetch.mock.calls[0][1]).toMatchObject({cache:'no-store',credentials:'same-origin'});
  let release!:(value:unknown)=>void;fetch.mockResolvedValue({ok:true,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(done=>release=done)});
  const parse=vi.fn(),pending=scheduleGet('/api/x',controller.signal,parse);await Promise.resolve();controller.abort();release(boot);await expect(pending).rejects.toThrow();expect(parse).not.toHaveBeenCalled();
});
test('weekly reads retain bounded cache and merge multi-week identities without partial cache mutation',async()=>{
  const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>{calls.push(path);return Response.json(path.startsWith('/api/tasks')?list():path.startsWith('/api/milestones')?[]:absence);}));
  const first=await readScheduleBoard(query,new Map(),false,new AbortController().signal);expect(first.tasks.items).toHaveLength(1);expect(first.cache.size).toBe(2);expect(calls).toHaveLength(6);
  await readScheduleBoard({...query,loadedWeeks:3},first.cache,false,new AbortController().signal);expect(calls).toHaveLength(9);expect(calls.every(p=>!p.includes('dateBasis='))).toBe(true);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({bad:true})));await expect(readScheduleBoard(query,first.cache,true,new AbortController().signal)).rejects.toThrow();expect(first.cache.size).toBe(2);
});
test('full timeline reads scheduled open work and completed work inside the active date span',async()=>{
  const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
    calls.push(path);const url=new URL(path,'https://test/'),status=url.searchParams.get('status');
    if(url.pathname==='/api/holidays')return Response.json({holidays:[{date:'2026-12-25',name:'회사 휴일'}],available:true,updatedAt:null});
    if(url.pathname==='/api/milestones')return Response.json([{id:7,title:'출시',description:'',date:'2026-09-10',projectId:10,version:1,type:'update'}]);
    if(status==='planned')return Response.json(list([{...task,id:1,startDate:'2026-01-05',endDate:'2026-01-09',status:'planned'}]));
    if(status==='progress')return Response.json(list([{...task,id:2,startDate:'2026-09-07',endDate:'2026-09-11',status:'progress'}]));
    if(status==='done')return Response.json(list([{...task,id:3,startDate:'2026-09-07',endDate:'2026-09-07',status:'done'}]));
    throw Error(`unexpected ${path}`);
  }));
  const result=await readScheduleBoard({...query,allOpen:true,project:'mine',goal:'3'},new Map(),false,new AbortController().signal);
  expect(result.tasks.items.map(item=>item.id)).toEqual([1,2,3]);expect(result.tasks.items.map(item=>item.status)).toEqual(['planned','progress','done']);
  expect(result.milestones.map(item=>item.id)).toEqual([7]);
  expect(calls.filter(path=>path.startsWith('/api/tasks'))).toHaveLength(3);expect(calls.filter(path=>path.startsWith('/api/tasks')&&!path.includes('status=done')).every(path=>!path.includes('from=')&&!path.includes('to='))).toBe(true);expect(calls.some(path=>path.includes('status=done')&&path.includes('from=2026-01-05')&&path.includes('to=2026-09-13'))).toBe(true);
  expect(calls.filter(path=>path.startsWith('/api/tasks')).every(path=>path.includes('projectId=mine')&&path.includes('goalId=3')&&path.includes('scheduled=true'))).toBe(true);
  expect(calls.some(path=>path.startsWith('/api/holidays?from=2026-01-05&to=2026-09-13'))).toBe(true);
  expect(calls.some(path=>path.startsWith('/api/milestones?from=2026-01-05&to=2026-09-13')&&path.includes('projectId=mine'))).toBe(true);
});
test('personal timeline requests unfinished work without requiring a date and keeps completed work date-bounded',async()=>{
  const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
    calls.push(path);const url=new URL(path,'https://test/'),status=url.searchParams.get('status');
    if(url.pathname==='/api/holidays')return Response.json({holidays:[],available:true,updatedAt:null});
    if(url.pathname==='/api/milestones')return Response.json([]);
    if(status==='planned')return Response.json(list([{...task,startDate:null,endDate:null,status:'planned'}]));
    return Response.json(list([]));
  }));
  const result=await readScheduleBoard({...query,allOpen:true,includeUnscheduledOpen:true,person:'me'},new Map(),false,new AbortController().signal);
  expect(result.tasks.items.map(item=>item.title)).toEqual(['업무']);
  expect(calls.filter(path=>path.includes('status=planned')||path.includes('status=progress')).every(path=>!path.includes('scheduled=true')&&!path.includes('from=')&&!path.includes('to='))).toBe(true);
  expect(calls.some(path=>path.includes('status=done')&&path.includes('from=')&&path.includes('to='))).toBe(true);
});
test('project selection also limits milestone rendering as a fail-closed boundary',()=>{
  const milestones=[{id:1,title:'선택 프로젝트',description:'',date:'2026-09-10',projectId:10,version:1},{id:2,title:'다른 프로젝트',description:'',date:'2026-09-10',projectId:20,version:1},{id:3,title:'미지정',description:'',date:'2026-09-10',projectId:null,version:1}];
  expect(milestonesForProject(milestones,'10',[20]).map(item=>item.id)).toEqual([1]);
  expect(milestonesForProject(milestones,'mine',[20]).map(item=>item.id)).toEqual([2]);
  expect(milestonesForProject(milestones,'',[]).map(item=>item.id)).toEqual([1,2,3]);
});
test('full unscheduled pagination and independent kanban limits keep server totals',async()=>{
  const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
    calls.push(path);const q=new URL(path,'https://test/').searchParams,status=q.get('status');
    if(!path.startsWith('/api/tasks'))return Response.json(path.startsWith('/api/milestones')?[]:absence);
    const total=status?status==='planned'?231:0:231,skip=Number(q.get('skip')),take=Number(q.get('take'));
    return Response.json(list(Array.from({length:Math.max(0,Math.min(take,total-skip))},(_,i)=>({...task,id:skip+i+1,startDate:status?task.startDate:null,endDate:status?task.endDate:null})),total));
  }));
  const all=await readScheduleBoard({...query,unscheduled:true},new Map(),false,new AbortController().signal);expect(all.tasks.items).toHaveLength(231);expect(calls.some(p=>p.includes('skip=200'))).toBe(true);
  const partial=await readScheduleBoard({...query,view:'kanban'},new Map(),false,new AbortController().signal);expect(partial.tasks.items).toHaveLength(50);expect(partial.tasks.total).toBe(231);
});
test('archive pages require archived rows and merge only a stable non-overlapping continuation',()=>{
  const first={...list([{...task,archived:true}],2),editableIds:[]},second={...list([{...task,id:2,archived:true}],2),editableIds:[]};
  expect(archivedTaskPageResponse(first)).toEqual(first);expect(mergeTaskListPages(first,second).items.map(item=>item.id)).toEqual([1,2]);
  expect(()=>archivedTaskPageResponse(list())).toThrow();
  for(const next of [{...second,total:3},{...second,items:[first.items[0]]},{...second,items:[]}])expect(()=>mergeTaskListPages(first,next)).toThrow();
});
test('task references require the requested safe ID and complete display metadata',()=>{
  const reference={id:202,title:'연결 대상 업무',projectId:10,archived:false};
  expect(taskReferenceResponse(reference,202)).toEqual(reference);
  for(const value of [null,{...reference,id:203},{...reference,title:undefined},{...reference,projectId:0},{...reference,archived:'false'}]){
    expect(()=>taskReferenceResponse(value,202)).toThrow();
  }
});
