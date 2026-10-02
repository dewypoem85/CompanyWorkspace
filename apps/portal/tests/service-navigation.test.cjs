const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../wwwroot/js/company-workspace.js'), 'utf8');
const layout = source.slice(source.indexOf('  let serviceLayoutFrame'), source.indexOf('  function drawContext'));

function fixture() {
  const document = { activeElement:null };
  const element = (width=0) => ({
    width, style:{columnGap:'8',paddingLeft:'24',paddingRight:'24'}, attributes:{},
    getBoundingClientRect() { return {width:this.width}; },
    setAttribute(key,value) { this.attributes[key]=value; },
    contains(node) { return node?.parent===this; },
    focus() { document.activeElement=this; }
  });
  const nav=element(520), menu=element(90), trigger=element(), panel=element(), link=element();
  link.parent=nav; trigger.parent=menu;
  nav.childElementCount=5; nav.querySelector=()=>link;
  const right=element(), left=element(), brand=element(145), sidebar=element();
  right.children=[element(40),element(190),menu,element(40)];
  const classes=new Set();
  const root=element();
  root.clientWidth=1200;
  root.classList={contains:key=>classes.has(key),toggle:(key,on)=>on?classes.add(key):classes.delete(key)};
  const selectors={'[data-cw-service-links]':nav,'[data-cw-service-menu]':menu,'.cw-header-right':right,'.cw-header-left':left,'[data-cw-nav]':sidebar,'.cw-brand':brand,'[data-cw-popover="services"]':panel,'[data-cw-panel="services"]':trigger};
  root.querySelector=selector=>selectors[selector];
  let scheduled;
  const context={authenticated:true};
  const sandbox={root,context,document,matchMedia:()=>({matches:false}),getComputedStyle:el=>el.style,requestAnimationFrame:callback=>{scheduled=callback;return 1;}};
  vm.createContext(sandbox); vm.runInContext(layout,sandbox);
  const update=()=>{sandbox.scheduleServiceLayout();scheduled();};
  return {root,nav,menu,trigger,panel,link,context,document,update};
}

test('all permitted services fit: inline links replace the menu',()=>{
  const f=fixture(); f.update();
  assert.equal(f.menu.hidden,true); assert.equal(f.nav.inert,false); assert.equal(f.nav.attributes['aria-hidden'],'false');
});
test('insufficient room collapses and growing restores the same navigation',()=>{
  const f=fixture(); f.root.clientWidth=700; f.update();
  assert.equal(f.menu.hidden,false); assert.equal(f.nav.inert,true);
  f.root.clientWidth=1440; f.update(); assert.equal(f.menu.hidden,true);
});
test('additional or long service names cause overflow fallback even on desktop',()=>{
  const f=fixture(); f.nav.width=1300; f.update(); assert.equal(f.menu.hidden,false);
});
test('anonymous or no permitted services never exposes inline navigation',()=>{
  const f=fixture(); f.context.authenticated=false; f.update(); assert.equal(f.menu.hidden,false);
  f.context.authenticated=true; f.nav.childElementCount=0; f.update(); assert.equal(f.nav.inert,true);
});
test('resize preserves keyboard focus and closes an obsolete service panel',()=>{
  const f=fixture(); f.update(); f.document.activeElement=f.link;
  f.root.clientWidth=400; f.update(); assert.equal(f.document.activeElement,f.trigger);
  f.panel.hidden=false; f.trigger.setAttribute('aria-expanded','true');
  f.root.clientWidth=1440; f.update();
  assert.equal(f.document.activeElement,f.link); assert.equal(f.panel.hidden,true);
  assert.equal(f.trigger.attributes['aria-expanded'],'false');
});
