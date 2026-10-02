// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {act,StrictMode,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,test,expect,vi} from 'vitest';
import {useWorkspaceDisclosure} from './generated/workspace-disclosure';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,node,state,change;
function Example({extra=false,rootKey='one'}) {
  const ref=useRef(null);state=useWorkspaceDisclosure(ref,{onChange:change});
  return <div key={rootKey} ref={ref}><button data-cw-disclosure="one" disabled={!state.ready}>내용</button><div data-cw-disclosure-panel="one" hidden><input defaultValue="초안"/></div>{extra&&<><button data-cw-disclosure="two">추가</button><div data-cw-disclosure-panel="two" hidden>추가 내용</div></>}</div>;
}
beforeEach(()=>{node=document.createElement('div');document.body.append(node);root=createRoot(node);change=vi.fn();window.eval(readFileSync('../../packages/workspace-ui/src/disclosure.js','utf8'));});
afterEach(()=>{act(()=>root.unmount());node.remove();});
test('shared controller owns visibility, ARIA and focus across React renders',()=>{
  act(()=>root.render(<StrictMode><Example/></StrictMode>));const button=node.querySelector('button'),panel=node.querySelector('[data-cw-disclosure-panel]'),input=node.querySelector('input');
  expect(button.disabled).toBe(false);expect(panel.hidden).toBe(true);expect(button.getAttribute('aria-controls')).toBe(panel.id);
  act(()=>button.click());expect(panel.hidden).toBe(false);expect(change).toHaveBeenCalledTimes(1);input.value='보존할 초안';
  act(()=>root.render(<StrictMode><Example extra/></StrictMode>));expect(panel.hidden).toBe(false);expect(input.value).toBe('보존할 초안');
  input.focus();act(()=>state.setOpen('one',false));expect(document.activeElement).toBe(button);expect(panel.hidden).toBe(true);
  act(()=>node.querySelector('[data-cw-disclosure="two"]').click());expect(node.querySelector('[data-cw-disclosure-panel="two"]').hidden).toBe(false);
});
test('missing shared renderer disables disclosure instead of using a private fallback',()=>{
  delete window.CompanyDisclosure;
  act(()=>root.render(<Example/>));expect(node.querySelector('button').disabled).toBe(true);expect(state.setOpen('one',true)).toBe(false);
});
test('a replacement root receives new bindings and detached controls no longer fire',()=>{
  act(()=>root.render(<Example/>));const old=node.querySelector('button');
  act(()=>root.render(<Example rootKey="replacement"/>));act(()=>old.click());expect(change).not.toHaveBeenCalled();
  act(()=>node.querySelector('button').click());expect(change).toHaveBeenCalledTimes(1);expect(node.querySelector('[data-cw-disclosure-panel]').hidden).toBe(false);
});
