import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';

const source=readFileSync(resolve(root,'packages/workspace-ui/src/context-contract.js'),'utf8');
function contract(t){const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.eval(source);return dom.window.CompanyContextContract;}
const valid={authenticated:true,user:{id:'9007199254740993',name:'검증',email:'test@example.test',role:'admin',accountType:'employee',department:null,avatarUrl:null},services:[{key:'cs',name:'CS',href:'/workspace/cs'}],isAdmin:true,csrfToken:'token',profiles:{'9007199254740993':'/avatar'},projectIcons:{'2':'/icon'},projects:[{id:2,name:'프로젝트',isPrivate:false}]};

test('company context accepts anonymous and complete authenticated values without normalization',t=>{
  const c=contract(t),anonymous={authenticated:false};assert.equal(c.read(anonymous),anonymous);assert.equal(c.read(valid),valid);
});

test('company context rejects malformed identity, service and optional directory fields',t=>{
  const c=contract(t);
  for(const value of [null,{}, {...valid,user:{...valid.user,id:1.5}}, {...valid,user:{...valid.user,role:'owner'}}, {...valid,services:[...valid.services,{...valid.services[0]}]}, {...valid,services:[{key:'cs',name:'',href:'/'}]}, {...valid,profiles:[]}, {...valid,projectIcons:{2:''}}, {...valid,projects:[{id:2,name:'',isPrivate:false}]}, {...valid,isAdmin:'true'}, {...valid,csrfToken:1}])assert.throws(()=>c.read(value));
});
