// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {ScheduleToastNotice,ScheduleToastProvider,ScheduleToasts,type ScheduleNotice} from './ScheduleToasts';

let root:Root,host:HTMLDivElement;
const notice=(kind:'success'|'error',message:string):ScheduleNotice=>({id:'status',state:{kind,title:'업무 상태 알림',message}});

beforeEach(()=>{
  vi.useFakeTimers();host=document.createElement('div');host.id='board';document.body.append(host);root=createRoot(host);
});
afterEach(()=>{
  act(()=>root.unmount());host.remove();vi.useRealTimers();
});

test('success appears outside the board and disappears without changing board layout',()=>{
  act(()=>root.render(createElement(ScheduleToasts,{notices:[notice('success','완료 상태로 저장했습니다.')]})));
  const stack=document.querySelector('.schedule-toast-stack');
  expect(stack?.parentElement).toBe(document.body);
  expect(host.querySelector('.schedule-toast')).toBeNull();
  expect(stack?.textContent).toContain('완료 상태로 저장했습니다.');
  act(()=>vi.advanceTimersByTime(5000));
  expect(stack?.querySelector('.schedule-toast')).toBeNull();
});

test('an error remains available until it is dismissed',()=>{
  act(()=>root.render(createElement(ScheduleToasts,{notices:[notice('error','목록을 다시 확인해 주세요.')]})));
  act(()=>vi.advanceTimersByTime(6000));
  expect(document.querySelector('.schedule-toast')?.textContent).toContain('목록을 다시 확인해 주세요.');
  const button=document.querySelector<HTMLButtonElement>('.schedule-toast-close');
  act(()=>button?.click());
  expect(document.querySelector('.schedule-toast')).toBeNull();
});

test('nested schedule notices share one fixed toast stack and leave page layout alone',()=>{
  act(()=>root.render(<ScheduleToastProvider><main data-testid="content"><ScheduleToastNotice id="loading" state={{kind:'loading',title:'일정을 불러오는 중입니다…'}}/><section><ScheduleToastNotice id="upload" state={{kind:'error',message:'이미지를 올리지 못했습니다.'}}/></section></main></ScheduleToastProvider>));
  const stacks=document.querySelectorAll('.schedule-toast-stack');
  expect(stacks).toHaveLength(1);
  expect(stacks[0].querySelectorAll('.schedule-toast')).toHaveLength(2);
  expect(host.querySelector('.schedule-toast')).toBeNull();
  expect(host.textContent).not.toContain('일정을 불러오는 중입니다');
});

test('a transient notice is removed from the shared stack without adding page content',()=>{
  act(()=>root.render(<ScheduleToastProvider><main><ScheduleToastNotice id="loading" state={{kind:'loading',title:'일정을 불러오는 중입니다…'}}/></main></ScheduleToastProvider>));
  expect(document.querySelector('[data-schedule-toast="loading"]')).not.toBeNull();
  act(()=>root.render(<ScheduleToastProvider><main><ScheduleToastNotice id="loading" state={null}/></main></ScheduleToastProvider>));
  expect(document.querySelector('[data-schedule-toast="loading"]')).toBeNull();
  expect(host.querySelector('[data-workspace-feedback]')).toBeNull();
});
