import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const policy=JSON.parse(readFileSync(resolve(root,'tooling/verification-policy.json'),'utf8'));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(value=>b.includes(value));
function requireValid(value,message){if(!value)throw Error(message);}

// This deliberately accepts only the repository's small, single-line workflow dialect.
// A YAML syntax/style migration must update this checker and its mutation tests together.
export function validateWorkflow(source,definition=policy) {
  const body=source.replaceAll('\r\n','\n');
  requireValid(body.startsWith('name: Workspace Verification\non:\n  push:\n    branches: [main]\n  pull_request:\n'),'Verification must run for main pushes and pull requests.');
  requireValid(!/\t|\bcontinue-on-error\s*:|^\s+(?:ref|repository|paths|paths-ignore|branches-ignore)\s*:/m.test(body),'Verification cannot allow errors, alternate checkouts or path-based skipping.');
  const matches=[...body.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)];
  const entries=matches.filter(match=>match.index>body.indexOf('\njobs:\n')).map((match,index,all)=>[match[1],body.slice(match.index,all[index+1]?.index??body.length)]);
  requireValid(sameSet(entries.map(([id])=>id),[...Object.keys(definition.jobs),definition.requiredJob]),'Workflow jobs do not match the required verification policy.');
  const jobs=Object.fromEntries(entries);
  for(const [id,spec] of Object.entries(definition.jobs)) {
    const job=jobs[id];
    requireValid(!/^    if:/m.test(job),`${id}: required verification cannot be conditionally skipped.`);
    if(spec.apps){
      const matrix=/^        app: \[([^\]]+)\]$/m.exec(job)?.[1].split(',').map(app=>app.trim())||[];
      requireValid(sameSet(matrix,spec.apps),`${id}: service matrix is incomplete or duplicated.`);
      requireValid(!/^\s+(?:exclude|include):/m.test(job),`${id}: matrix overrides are not permitted.`);
    }
    const steps=[...job.matchAll(/^      - (?:run|uses|name):.*(?:\n(?!      - |  [a-z])[^\n]*)*/gm)].map(match=>match[0]);
    for(const action of spec.requiredUses||[])requireValid(steps.some(step=>step.split('\n')[0]===`      - uses: ${action}`&&!/^\s+if:/m.test(step)),`${id}: unconditional action missing: ${action}`);
    for(const command of spec.commands)requireValid(steps.some(step=>step.split('\n')[0]===`      - run: ${command}`&&!/^\s+if:/m.test(step)),`${id}: unconditional command missing: ${command}`);
    for(const [command,condition] of Object.entries(spec.conditionalCommands||{}))requireValid(steps.some(step=>step.split('\n')[0]===`      - run: ${command}`&&step.includes(`\n        if: ${condition}`)),`${id}: conditional command missing: ${command}`);
  }
  const aggregate=jobs[definition.requiredJob];
  requireValid(!/^        if:/m.test(aggregate),'Aggregate gate and receipt upload cannot be conditionally skipped.');
  requireValid(/^    if: always\(\)$/m.test(aggregate),'Aggregate verification must run after failed or skipped jobs.');
  const needs=/^    needs: \[([^\]]+)\]$/m.exec(aggregate)?.[1].split(',').map(id=>id.trim())||[];
  requireValid(sameSet(needs,Object.keys(definition.jobs)),'Aggregate dependencies must include every verification job exactly once.');
  requireValid(aggregate.includes('      - uses: actions/checkout@v7')&&aggregate.includes('      - uses: actions/setup-node@v7'),'Aggregate must execute the gate from its checked-out commit.');
  requireValid(aggregate.includes('          RESULTS: ${{ toJSON(needs) }}')&&aggregate.includes('        run: node tooling/verification-gate.mjs'),'Aggregate must validate actual dependency results.');
  requireValid(aggregate.includes('      - uses: actions/download-artifact@v8')
    &&aggregate.includes('          pattern: image-verification-*-${{ github.run_id }}-${{ github.run_attempt }}')
    &&aggregate.includes('          path: artifacts/image-input')
    &&aggregate.includes('          merge-multiple: true')
    &&aggregate.includes('      - run: node tooling/image-verification-set.mjs'),'Aggregate must bind all six image records to the successful verification receipt.');
  requireValid(aggregate.includes('      - uses: actions/upload-artifact@v7')&&aggregate.includes('          if-no-files-found: error')&&aggregate.includes('          path: artifacts/verification/*.json'),'Successful verification receipt must be uploaded, not silently omitted.');
  const images=jobs.images;
  requireValid(images.includes('          name: image-verification-${{ matrix.app }}-${{ github.run_id }}-${{ github.run_attempt }}')
    &&images.includes('          path: artifacts/images/${{ matrix.app }}.json')
    &&images.includes('          if-no-files-found: error'),'Each verified image record must be uploaded with exact service and run identity.');
  return true;
}

export function validateResults(results,definition=policy) {
  requireValid(object(results)&&sameSet(Object.keys(results),Object.keys(definition.jobs)),'Required results are missing, duplicated or unexpected.');
  for(const id of Object.keys(definition.jobs))requireValid(object(results[id])&&results[id].result==='success',`Required verification did not succeed: ${id}`);
  return Object.fromEntries(Object.keys(definition.jobs).map(id=>[id,'success']));
}

export function verificationReceipt({results,context,checkout,workflowSource},definition=policy) {
  validateWorkflow(workflowSource,definition);
  const jobs=validateResults(results,definition);
  requireValid(object(context)&&object(checkout),'CI identity and checkout are required.');
  const {repository,sha,runId,attempt,event,ref,workflowRef}=context;
  requireValid(typeof repository==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),'Invalid CI repository.');
  requireValid(typeof sha==='string'&&/^[a-f0-9]{40}$/.test(sha)&&checkout.sha===sha,'The checkout must match the exact verified CI commit.');
  requireValid(typeof checkout.tree==='string'&&/^[a-f0-9]{40}$/.test(checkout.tree)&&checkout.clean===true,'Verification requires a clean checkout and source tree.');
  requireValid(typeof runId==='string'&&/^[1-9]\d*$/.test(runId)&&typeof attempt==='string'&&/^[1-9]\d*$/.test(attempt),'Invalid CI run or attempt.');
  requireValid(event==='push'&&ref==='refs/heads/main'||event==='pull_request'&&/^refs\/pull\/[1-9]\d*\/merge$/.test(ref),'Unsupported verification event/ref.');
  requireValid(workflowRef===`${repository}/${definition.workflow}@${ref}`,'Verification ran from an unexpected workflow ref.');
  return {schema:'workspace-verification-v1',repository,commit:sha,tree:checkout.tree,runId,attempt,event,ref,workflowRef,
    runUrl:`https://github.com/${repository}/actions/runs/${runId}/attempts/${attempt}`,
    policySha256:hash(JSON.stringify(definition)),workflowSha256:hash(workflowSource.replaceAll('\r\n','\n')),jobs,
    scope:'ci-verification-only',deploymentApproved:false};
}

export function main(args=process.argv.slice(2),env=process.env) {
  const workflowSource=readFileSync(resolve(root,policy.workflow),'utf8');
  if(args.length===1&&args[0]==='--check-workflow'){validateWorkflow(workflowSource);console.log('Verification workflow policy checked.');return;}
  requireValid(args.length===0,'Only --check-workflow is supported; gate inputs come from CI context.');
  // This is an execution-context guard, not proof of GitHub provenance. Only an
  // artifact retrieved from the trusted workflow/run may be used as CI evidence.
  requireValid(env.GITHUB_ACTIONS==='true','Receipt generation requires the GitHub Actions execution context.');
  const results=JSON.parse(env.RESULTS||'null');
  validateResults(results); // Fail before invoking Git or creating output on incomplete results.
  const executable=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
  const git=(...params)=>execFileSync(executable,['-C',root,...params],{encoding:'utf8'}).trim();
  const receipt=verificationReceipt({results,workflowSource,context:{repository:env.GITHUB_REPOSITORY,sha:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,workflowRef:env.GITHUB_WORKFLOW_REF},
    checkout:{sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean:git('status','--porcelain','--untracked-files=normal')===''}});
  const directory=resolve(root,'artifacts/verification');mkdirSync(directory,{recursive:true});
  const output=resolve(directory,`${receipt.runId}-${receipt.attempt}.json`);
  writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(`Required verification succeeded for ${receipt.commit}. Receipt: artifacts/verification/${receipt.runId}-${receipt.attempt}.json`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(`Verification gate rejected: ${error.message}`);process.exitCode=1;}
}
