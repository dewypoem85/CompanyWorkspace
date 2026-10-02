import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../build-ui.mjs';
import {policy,validateWorkflow,validateResults,verificationReceipt} from '../verification-gate.mjs';
const workflow=readFileSync(resolve(root,policy.workflow),'utf8').replaceAll('\r\n','\n');
const passed=()=>Object.fromEntries(Object.keys(policy.jobs).map(id=>[id,{result:'success',outputs:{}}]));
const context={repository:'synthetic/workspace',sha:'a'.repeat(40),runId:'1234',attempt:'2',event:'push',ref:'refs/heads/main',workflowRef:'synthetic/workspace/.github/workflows/verify.yml@refs/heads/main'};
const checkout={sha:context.sha,tree:'b'.repeat(40),clean:true};

test('real workflow has every required job, service matrix, command and unconditional aggregate',()=>{
  assert.equal(validateWorkflow(workflow),true);
  assert.equal(validateWorkflow(workflow.replaceAll('\n','\r\n')),true);
});
test('online dependency audit covers all npm projects without omitting development dependencies',()=>{
  const command='npm audit --audit-level=low --include=dev --include=optional --registry=https://registry.npmjs.org';
  for(const id of ['shared-ui','node-apps','frontend-apps'])assert.ok(policy.jobs[id].commands.includes(command),id);
  assert.deepEqual([...policy.jobs['node-apps'].apps,...policy.jobs['frontend-apps'].apps].sort(),['cs','iap','schedule','sheet','statistics']);
  for(const replacement of [command.replace('--include=dev','--omit=dev'),command.replace('--audit-level=low','--audit-level=high'),command+' || true']){
    assert.throws(()=>validateWorkflow(workflow.replace(command,replacement)));
  }
});
test('empty, missing, extra, skipped, cancelled, failed and malformed results fail closed',()=>{
  assert.equal(Object.keys(validateResults(passed())).length,8);
  for(const value of [null,[],{},true,'success'])assert.throws(()=>validateResults(value));
  for(const id of Object.keys(policy.jobs)){
    const missing=passed();delete missing[id];assert.throws(()=>validateResults(missing),id);
    for(const result of ['failure','skipped','cancelled','neutral','pending',true,null,undefined,'Success'])assert.throws(()=>validateResults({...passed(),[id]:{result}}),`${id}: ${result}`);
    assert.throws(()=>validateResults({...passed(),[id]:'success'}));
  }
  assert.throws(()=>validateResults({...passed(),surprise:{result:'success'}}));
});
test('removing or conditionally skipping each required command is rejected',()=>{
  for(const [id,spec] of Object.entries(policy.jobs))for(const command of spec.commands){
    const begin=workflow.indexOf(`\n  ${id}:`);
    // Locate the exact command in its owning job, even if another job uses it too.
    const index=workflow.indexOf(`      - run: ${command}\n`,begin);
    assert.ok(index>begin,`${id}: ${command}`);
    const line=`      - run: ${command}`;
    const remove=workflow.slice(0,index)+workflow.slice(index).replace(line,'      - run: echo omitted');
    assert.throws(()=>validateWorkflow(remove),`${id}: removed ${command}`);
    const skip=workflow.slice(0,index)+workflow.slice(index).replace(line,line+'\n        if: false');
    assert.throws(()=>validateWorkflow(skip),`${id}: skipped ${command}`);
  }
  for(const [id,spec] of Object.entries(policy.jobs))for(const [command,condition] of Object.entries(spec.conditionalCommands||{})){
    const step=`      - run: ${command}\n        if: ${condition}`;
    assert.ok(workflow.includes(step),`${id}: ${command}`);
    assert.throws(()=>validateWorkflow(workflow.replace(step,'      - run: echo omitted')));
    assert.throws(()=>validateWorkflow(workflow.replace(step,step.replace(condition,'false'))));
  }
});
test('image startup verification cannot lose its pinned Node runtime',()=>{
  const begin=workflow.indexOf('\n  images:');
  const index=workflow.indexOf('      - uses: actions/setup-node@v7',begin);
  assert.ok(index>begin);
  const removed=workflow.slice(0,index)+workflow.slice(index).replace('      - uses: actions/setup-node@v7','      - uses: actions/cache@v4');
  assert.throws(()=>validateWorkflow(removed));
  const conditional=workflow.slice(0,index)+workflow.slice(index).replace('      - uses: actions/setup-node@v7','      - uses: actions/setup-node@v7\n        if: false');
  assert.throws(()=>validateWorkflow(conditional));
});
test('verified image records cannot be omitted, redirected or silently missing',()=>{
  for(const [from,to] of [
    ['          path: artifacts/images/${{ matrix.app }}.json','          path: artifacts/images/*.json'],
    ['          if-no-files-found: error','          if-no-files-found: warn'],
    ['          name: image-verification-${{ matrix.app }}-${{ github.run_id }}-${{ github.run_attempt }}','          name: image-verification-latest']
  ]){
    const begin=workflow.indexOf('\n  images:');
    const index=workflow.indexOf(from,begin);
    assert.ok(index>begin,from);
    assert.throws(()=>validateWorkflow(workflow.slice(0,index)+workflow.slice(index).replace(from,to)));
  }
});
test('aggregate cannot omit or loosen the exact image record merge',()=>{
  for(const [from,to] of [
    ['      - uses: actions/download-artifact@v8','      - uses: actions/cache@v4'],
    ['          pattern: image-verification-*-${{ github.run_id }}-${{ github.run_attempt }}','          pattern: image-verification-*'],
    ['          path: artifacts/image-input','          path: artifacts'],
    ['          merge-multiple: true','          merge-multiple: false'],
    ['      - run: node tooling/image-verification-set.mjs','      - run: echo skipped']
  ])assert.throws(()=>validateWorkflow(workflow.replace(from,to)),from);
});
test('job and matrix coverage cannot shrink or duplicate and alternate checkout refs are rejected',()=>{
  for(const [id,spec] of Object.entries(policy.jobs)){
    assert.throws(()=>validateWorkflow(workflow.replace(`  ${id}:\n`,`  omitted-${id}:\n`)),id);
    assert.throws(()=>validateWorkflow(workflow.replace(`  ${id}:\n`,`  ${id}:\n    if: false\n`)),id);
    if(spec.apps){
      const matrix=`app: [${spec.apps.join(', ')}]`;
      assert.throws(()=>validateWorkflow(workflow.replace(matrix,`app: [${spec.apps.slice(1).join(', ')}]`)));
      assert.throws(()=>validateWorkflow(workflow.replace(matrix,`app: [${[...spec.apps,spec.apps[0]].join(', ')}]`)));
    }
  }
  for(const change of [
    text=>text.replace('if: always()','if: success()'),
    text=>text.replace('needs: [shared-ui,','needs: ['),
    text=>text.replace('run: node tooling/verification-gate.mjs','if: false\n        run: node tooling/verification-gate.mjs'),
    text=>text.replace('if-no-files-found: error','if-no-files-found: warn'),
    text=>text.replace('      - uses: actions/checkout@v7','      - uses: actions/checkout@v7\n        with:\n          ref: main'),
    text=>text.replace('  pull_request:','  workflow_dispatch:'),
    text=>text.replace('  push:','  push:\n    paths: [apps/cs/**]'),
    text=>text.replace('      - run: npm test','      - run: npm test\n        continue-on-error: true')
  ])assert.throws(()=>validateWorkflow(change(workflow)));
});
test('receipt binds exact commit, tree, workflow and policy but does not authorize deployment',()=>{
  const receipt=verificationReceipt({results:passed(),context,checkout,workflowSource:workflow});
  assert.equal(receipt.commit,context.sha);assert.equal(receipt.tree,checkout.tree);assert.equal(receipt.scope,'ci-verification-only');assert.equal(receipt.deploymentApproved,false);
  assert.match(receipt.policySha256,/^[a-f0-9]{64}$/);assert.match(receipt.workflowSha256,/^[a-f0-9]{64}$/);
  assert.equal(receipt.runUrl,'https://github.com/synthetic/workspace/actions/runs/1234/attempts/2');
  assert.equal(verificationReceipt({results:passed(),context,checkout,workflowSource:workflow.replaceAll('\n','\r\n')}).workflowSha256,receipt.workflowSha256);
});
test('PR merge commits are identified as PR evidence, never production approval',()=>{
  const ref='refs/pull/42/merge',receipt=verificationReceipt({results:passed(),context:{...context,event:'pull_request',ref,workflowRef:`${context.repository}/${policy.workflow}@${ref}`},checkout,workflowSource:workflow});
  assert.equal(receipt.event,'pull_request');assert.equal(receipt.deploymentApproved,false);
});
test('mismatched commit, dirty tree, invalid context and unexpected workflow cannot produce receipts',()=>{
  const run=(overrides={})=>verificationReceipt({results:passed(),context,checkout,workflowSource:workflow,...overrides});
  for(const patch of [{sha:'c'.repeat(40)},{tree:''},{clean:false},{clean:'true'}])assert.throws(()=>run({checkout:{...checkout,...patch}}));
  for(const patch of [{sha:'main'},{repository:'../outside'},{runId:'../1'},{attempt:'0'},{event:'workflow_dispatch'},{ref:'refs/heads/other'},{workflowRef:'elsewhere/verify.yml'},{sha:undefined}])assert.throws(()=>run({context:{...context,...patch}}));
  assert.throws(()=>run({results:{}}));
});
test('CLI validates the checked-in workflow and rejects local receipt creation',()=>{
  const checked=spawnSync(process.execPath,['tooling/verification-gate.mjs','--check-workflow'],{cwd:root,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  const local=spawnSync(process.execPath,['tooling/verification-gate.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false'}});
  assert.equal(local.status,1);assert.match(local.stderr,/requires the GitHub Actions execution context/);
  const empty=spawnSync(process.execPath,['tooling/verification-gate.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',RESULTS:'{}'}});
  assert.equal(empty.status,1);assert.match(empty.stderr,/results are missing/);
});
