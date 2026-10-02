const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../wwwroot/js/company-workspace.js'), 'utf8');
const logic = source.slice(source.indexOf('  const SIDEBAR_COOKIE'), source.indexOf('  function closePanels'));

function fixture(cookie = '', mobile = false) {
  const classes = new Set();
  const document = {cookie, activeElement:null};
  const element = () => ({attributes:{},children:[],
    setAttribute(key,value) { this.attributes[key]=value; },
    append(node) { this.children.push(node); node.parent=this; },
    querySelector() { return this.children[0] || null; },
    contains(node) { return node===this || this.children.includes(node); },
    focus() { document.activeElement=this; }
  });
  const sidebar=element(), toggle=element();
  let present=true, layouts=0;
  document.body={classList:{contains:key=>classes.has(key),toggle:(key,on)=>on?classes.add(key):classes.delete(key)}};
  document.querySelectorAll=()=>present?[sidebar]:[];
  document.querySelector=()=>present?sidebar.children[0]:null;
  document.createElement=element;
  const sandbox={document,root:{querySelector:()=>toggle},icon:()=>'<svg/>',
    location:{hostname:'schedule.example.com',protocol:'https:'},matchMedia:()=>({matches:mobile}),
    scheduleServiceLayout:()=>layouts++};
  vm.createContext(sandbox); vm.runInContext(logic,sandbox);
  return {sidebar,toggle,document,classes, sandbox,
    sync:()=>sandbox.syncSidebar(),open:value=>sandbox.setSidebarOpen(value),
    mobile:value=>{mobile=value;},present:value=>{present=value;},layouts:()=>layouts};
}

test('desktop starts expanded and enhances an asynchronously mounted sidebar once',()=>{
  const f=fixture(); f.present(false); f.sync(); assert.equal(f.classes.has('cw-has-sidebar'),false);
  f.present(true); f.sync(); f.sync();
  assert.equal(f.sidebar.children.length,1); assert.equal(f.sidebar.inert,false);
  assert.equal(f.toggle.attributes['aria-controls'],f.sidebar.id);
  assert.equal(f.toggle.attributes['aria-expanded'],'true');
});
test('collapse hides keyboard targets, expands content and preserves preference across services',()=>{
  const f=fixture(); f.sync(); f.sidebar.children[0].focus(); f.open(false);
  assert.equal(f.sidebar.inert,true); assert.equal(f.sidebar.attributes['aria-hidden'],'true');
  assert.equal(f.classes.has('cw-sidebar-collapsed'),true);
  assert.equal(f.document.activeElement,f.toggle);
  assert.match(f.document.cookie,/CompanySidebarCollapsed=1/);
  assert.match(f.document.cookie,/Domain=.example.com/); assert.match(f.document.cookie,/Secure/);
  const reloaded=fixture(f.document.cookie); reloaded.sync(); assert.equal(reloaded.sidebar.inert,true);
  f.open(true); assert.equal(f.sidebar.inert,false); assert.equal(f.classes.has('cw-sidebar-collapsed'),false);
  assert.equal(f.document.activeElement,f.sidebar.children[0]); assert.match(f.document.cookie,/Collapsed=0/);
  assert.ok(f.layouts()>=3);
});
test('mobile drawer opens independently without overwriting desktop preference',()=>{
  const f=fixture('CompanySidebarCollapsed=1',true); f.sync(); assert.equal(f.sidebar.inert,true);
  f.open(true); assert.equal(f.sidebar.inert,false); assert.equal(f.classes.has('cw-nav-open'),true);
  f.open(false); assert.equal(f.sidebar.inert,true); assert.equal(f.document.cookie,'CompanySidebarCollapsed=1');
  f.mobile(false); f.sync(); assert.equal(f.sidebar.inert,true);
});
test('mobile closed state does not collapse an expanded desktop preference',()=>{
  const f=fixture('',true); f.sync(); f.open(true); f.open(false);
  f.mobile(false); f.sync(); assert.equal(f.sidebar.inert,false); assert.equal(f.document.cookie,'');
});
