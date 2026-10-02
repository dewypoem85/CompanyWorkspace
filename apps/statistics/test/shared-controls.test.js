import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('statistical cell meaning maps to common table tones without changing values or sorting classes',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const cell=source.slice(source.indexOf('function cell('),source.indexOf('function numberCell('));
  const context=vm.createContext({el:(tag,attrs,text)=>({tag,attrs,text})});vm.runInContext(cell,context);
  const raw='9007199254740993123 <sample>';
  for(const [classes,tone]of [['number positive','success'],['sample-cell good','success'],['number negative','danger'],['sample-cell low','danger'],['number warning','warning'],['sample-cell medium','warning'],['number',null],['',null]]){
    const result=context.cell(raw,classes);assert.equal(result.tag,'td');assert.equal(result.text,raw);assert.equal(result.attrs.class,classes);assert.equal(result.attrs['data-tone'],tone);
  }
});
