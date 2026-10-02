// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OpenScheduleBoard} from './OpenScheduleBoard';
import type {Employee,Task} from './types';

const person:Employee={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[1],role:'employee',active:true,shared:false,access:true,isAdmin:false};
const task:Task={id:1,title:'긴 업무',body:'',assigneeId:1,createdBy:1,projectId:1,goalId:null,startDate:'2026-08-03',endDate:'2026-11-20',status:'progress',archived:false,version:1,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};

describe('전체 일정 최초 위치',()=>{
  let host:HTMLDivElement,root:Root,scrollTo:ReturnType<typeof vi.fn>,requestFrame:ReturnType<typeof vi.fn>,frame:FrameRequestCallback|undefined;
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T03:00:00Z'));
    (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    scrollTo=vi.fn();Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:scrollTo});
    Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get:()=>1018});
    frame=undefined;requestFrame=vi.fn((callback:FrameRequestCallback)=>{frame=callback;return 1;});
    vi.stubGlobal('requestAnimationFrame',requestFrame);vi.stubGlobal('cancelAnimationFrame',vi.fn());
  });
  afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

  it('조회 완료 전에는 이동하지 않고 완료되면 이번 주 월요일을 왼쪽에 맞춘다',()=>{
    const render=(ready:boolean)=>act(()=>root.render(<OpenScheduleBoard tasks={[task]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} ready={ready} open={()=>{}}/>));
    render(false);expect(scrollTo).not.toHaveBeenCalled();
    render(true);expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({left:0,behavior:'auto'}));
  });

  it('스크롤 중에는 프레임당 한 번만 제목 위치를 갱신한다',()=>{
    act(()=>root.render(<OpenScheduleBoard tasks={[task]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} ready={false} open={()=>{}}/>));
    const board=host.querySelector<HTMLElement>('.open-schedule-scroll');expect(board).not.toBeNull();
    Object.defineProperty(board!,'scrollLeft',{configurable:true,writable:true,value:500});
    Object.defineProperty(board!,'scrollWidth',{configurable:true,value:5000});
    act(()=>{board!.dispatchEvent(new Event('scroll'));board!.dispatchEvent(new Event('scroll'));});
    expect(requestFrame).toHaveBeenCalledTimes(1);
    act(()=>frame?.(0));
    expect(board!.style.getPropertyValue('--open-schedule-scroll-left')).toBe('500px');
  });

  it('화면 밖 일정의 방향과 기간을 표시하고 누르면 해당 주로 이동한다',()=>{
    const before={...task,id:2,title:'이전 업무',startDate:'2026-09-21',endDate:'2026-09-25'},after={...task,id:3,title:'이후 업무',startDate:'2026-10-12',endDate:'2026-10-16',status:'planned' as const};
    act(()=>root.render(<OpenScheduleBoard fixedWeek tasks={[before,after]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} ready={false} open={()=>{}}/>));
    const previous=host.querySelector<HTMLButtonElement>('.open-schedule-offscreen.before'),next=host.querySelector<HTMLButtonElement>('.open-schedule-offscreen.after');
    expect(previous?.textContent).toBe('← 이전 · 09.21–09.25');expect(next?.textContent).toBe('10.12–10.16 · 이후 →');
    expect(next?.getAttribute('aria-label')).toContain('이후 업무 - 직원 · 2026-10-12 ~ 2026-10-16');
    act(()=>next!.click());
    expect(host.textContent).toContain('10/12 주');expect(host.textContent).toContain('이후 업무');expect(scrollTo).toHaveBeenCalledWith({left:0,behavior:'smooth'});
  });

  it('양쪽으로 잘린 일정 바에 이어짐 화살표를 표시한다',()=>{
    const crossing={...task,startDate:'2026-09-21',endDate:'2026-10-16'};
    act(()=>root.render(<OpenScheduleBoard fixedWeek tasks={[crossing]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} ready={false} open={()=>{}}/>));
    const bar=host.querySelector('.open-schedule-bar');expect(bar?.textContent).toBe('긴 업무');expect(bar?.classList.contains('continues-before')).toBe(true);expect(bar?.classList.contains('continues-after')).toBe(true);expect(bar?.querySelector('.open-schedule-bar-arrow')).toBeNull();expect(host.querySelector('.open-schedule-continuation')).toBeNull();expect(host.querySelector('.open-schedule-offscreen')).toBeNull();
  });

  it('일반 보기의 이전 표식은 필요한 과거 날짜를 불러온 뒤 업무 종료일로 이동한다',()=>{
    const previous={...task,id:4,title:'불러올 이전 업무',startDate:'2026-08-03',endDate:'2026-08-07'};
    act(()=>root.render(<OpenScheduleBoard tasks={[previous]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} ready={false} open={()=>{}}/>));
    const marker=host.querySelector<HTMLButtonElement>('.open-schedule-offscreen.before');expect(marker?.textContent).toBe('← 이전 · 08.03–08.07');
    act(()=>marker!.click());
    expect(host.textContent).toContain('8/3 주');expect(scrollTo).toHaveBeenCalledWith({left:176,behavior:'smooth'});
  });

  it('일정 우클릭 메뉴에서 날짜 등록과 업무 상태 변경을 제공한다',()=>{
    const create=vi.fn(),changeStatus=vi.fn();
    act(()=>root.render(<OpenScheduleBoard tasks={[task]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} ready={false} open={()=>{}} create={create} editableIds={[task.id]} changeStatus={changeStatus}/>));
    const bar=host.querySelector<HTMLElement>('.open-schedule-bar');expect(bar).not.toBeNull();
    act(()=>bar!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120})));
    const menu=host.querySelector<HTMLElement>('[role="menu"]');expect(menu?.textContent).toContain('이 날에 업무 등록');expect(menu?.textContent).toContain('진행중');
    const planned=[...menu!.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes('예정'));expect(planned?.disabled).toBe(false);
    act(()=>planned!.click());expect(changeStatus).toHaveBeenCalledWith(task,'planned');expect(host.querySelector('[role="menu"]')).toBeNull();

    act(()=>bar!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120})));
    const createButton=[...host.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button=>button.textContent?.includes('이 날에 업무 등록'));
    act(()=>createButton!.click());expect(create).toHaveBeenCalledWith('2026-09-28');
  });

  it('고정 칸 경계선을 드래그하거나 키보드로 너비를 조절한다',()=>{
    const projectWidth=vi.fn(),taskWidth=vi.fn();
    act(()=>root.render(<OpenScheduleBoard tasks={[task]} employees={[person]} departments={[{id:1,name:'개발'}]} projects={[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}]} goals={[]} milestones={[]} holidays={[]} milestoneHolidays={{dates:new Set(),available:true}} includeWeekends={false} ready={false} projectColumnWidth={132} taskColumnWidth={280} onProjectColumnWidthChange={projectWidth} onTaskColumnWidthChange={taskWidth} open={()=>{}}/>));
    const handle=host.querySelector<HTMLElement>('[aria-label="프로젝트 칸 너비 조절"]');expect(handle).not.toBeNull();
    Object.defineProperty(handle!,'setPointerCapture',{configurable:true,value:vi.fn()});Object.defineProperty(handle!,'hasPointerCapture',{configurable:true,value:()=>true});Object.defineProperty(handle!,'releasePointerCapture',{configurable:true,value:vi.fn()});
    const pointer=(type:string,x:number)=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:7});return event;};
    act(()=>{handle!.dispatchEvent(pointer('pointerdown',100));handle!.dispatchEvent(pointer('pointermove',128));handle!.dispatchEvent(pointer('pointerup',128));});
    expect(projectWidth).toHaveBeenCalledWith(160);
    const taskHandle=host.querySelector<HTMLElement>('[aria-label="업무 담당자 칸 너비 조절"]');
    act(()=>taskHandle!.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowRight'})));
    expect(taskWidth).toHaveBeenCalledWith(284);
  });
});
