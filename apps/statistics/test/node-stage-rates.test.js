import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../client/src/node-stage-rates.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {nodeStageSelectionRates}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('노드 단계 선택률은 실제 선택 횟수만 사용해 표시 합계를 100.0%로 맞춘다',()=>{
  const rates=nodeStageSelectionRates([
    {id:10,runs:100},
    {id:11,runs:50},
    {id:12,runs:30},
    {id:13,runs:0}
  ]);
  assert.deepEqual(rates,[55.5,27.8,16.7,0]);
  assert.equal(Math.round(rates.reduce((sum,value)=>sum+value,0)*10),1000);
});

test('단일 선택 단계와 같은 비율도 반올림 오차 없이 100.0%를 만든다',()=>{
  assert.deepEqual(nodeStageSelectionRates([{id:20,runs:99}]),[100]);
  const rates=nodeStageSelectionRates([{id:30,runs:1},{id:31,runs:1},{id:32,runs:1}]);
  assert.deepEqual(rates,[33.4,33.3,33.3]);
  assert.equal(Math.round(rates.reduce((sum,value)=>sum+value,0)*10),1000);
});

test('개발 미리보기처럼 횟수가 없으면 기존 선택률을 가중치로 사용한다',()=>{
  assert.deepEqual(nodeStageSelectionRates([
    {id:70,selectionRate:19.9},
    {id:71,selectionRate:79.1}
  ]),[20.1,79.9]);
});
