import {execFileSync} from 'node:child_process';
import {isAbsolute, resolve, win32, posix} from 'node:path';
import {statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Deployment identities are deliberately separate from UI service IDs and never inferred from cwd.
export const targets = Object.freeze({
  portal:{service:'company-portal',container:'company-portal'},
  leave:{service:'leave-manager',container:'leave-manager'},
  schedule:{service:'schedule',container:'company-schedule'},
  cs:{service:'steam-refund-cs',container:'steam-refund-cs'},
  statistics:{service:'game-statistics',container:'statistics-web'},
  sheet:{service:'sheet-control',container:'sheet-control'},
  iap:{service:'product-upload',container:'product-upload-product-upload-1'}
});
const label = key => `{{json (index .Config.Labels "com.docker.compose.${key}")}}`;
// Never request Config.Env, arbitrary labels, command arguments, healthcheck output or secret contents.
export const containerFormat = '{"id":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},"running":{{json .State.Running}},"status":{{json .State.Status}},"health":{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}},"project":'+label('project')+',"service":'+label('service')+',"workingDirectory":'+label('project.working_dir')+',"configFiles":'+label('project.config_files')+',"environmentFiles":'+label('project.environment_file')+',"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}},"networkNames":[{{$first := true}}{{range $name,$network := .NetworkSettings.Networks}}{{if not $first}},{{end}}{{json $name}}{{$first = false}}{{end}}]}';
const assert = (condition,message) => {if(!condition)throw Error(message);};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f]/.test(value);
const sorted = values => [...values].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const equal = (a,b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

export function sourcePath(value) {
  assert(text(value),'A mount source path is missing.');
  if(/^[a-z]:[\\/]/i.test(value))return win32.normalize(value).replaceAll('\\','/').replace(/\/$/,'').replace(/^[A-Z]:/,drive=>drive.toLowerCase());
  assert(value.startsWith('/') && !value.startsWith('//'),'Bind paths must be absolute and local; ambiguous engine path mappings need manual review.');
  return posix.normalize(value).replace(/\/$/,'') || '/';
}
function uniqueMounts(mounts) {
  assert(new Set(mounts.map(m=>m.target)).size===mounts.length,'Duplicate mount targets cannot be compared.');
  return sorted(mounts);
}
export function normalizeLive(app, raw) {
  const target=targets[app];assert(target && object(raw),'Unknown deployment target or invalid container response.');
  assert(raw.name==='/'+target.container && raw.service===target.service,'Container identity does not match the selected service.');
  assert(typeof raw.id==='string' && /^[a-f0-9]{64}$/.test(raw.id) && digest(raw.imageId),'Container or immutable rollback image ID is missing.');
  assert(text(raw.project) && text(raw.workingDirectory) && text(raw.configFiles),'Compose identity labels are incomplete.');
  assert(typeof raw.running==='boolean' && text(raw.status) && (raw.health===null || text(raw.health)),'Container state is incomplete.');
  assert(Array.isArray(raw.mounts) && object(raw.ports) && Array.isArray(raw.networkNames),'Container boundary information is incomplete.');
  const mounts=uniqueMounts(raw.mounts.map(m=>{
    assert(['volume','bind'].includes(m.Type) && text(m.Destination) && m.Destination.startsWith('/') && typeof m.RW==='boolean','Unsupported or incomplete live mount.');
    assert((m.Type!=='volume' || m.Driver==='local') && (!m.Propagation || m.Propagation==='rprivate'),'Nonstandard mount driver/propagation needs manual review.');
    const source=m.Type==='volume'?m.Name:sourcePath(m.Source);assert(text(source),'Persistent mount identity is missing.');
    return {type:m.Type,source,target:m.Destination,readOnly:!m.RW};
  }));
  const ports=Object.entries(raw.ports).flatMap(([target,bindings])=>{
    assert(/^\d+\/(tcp|udp)$/.test(target) && Array.isArray(bindings),'Invalid live port binding.');
    return bindings.map(b=>{assert(text(b.HostIp) && /^\d+$/.test(b.HostPort),'Incomplete live host binding.');return {target,host:b.HostIp,port:b.HostPort};});
  });
  assert(raw.networkNames.every(text) && new Set(raw.networkNames).size===raw.networkNames.length,'Invalid live network list.');
  // This projection is also used for caller-supplied data: extra fields can never leak into the report.
  return {app,container:target.container,service:target.service,containerId:raw.id,imageId:raw.imageId,
    project:raw.project,workingDirectory:raw.workingDirectory,configFiles:raw.configFiles,
    environmentFiles:typeof raw.environmentFiles==='string'?raw.environmentFiles:null,
    running:raw.running,status:raw.status,health:raw.health,mounts,ports:sorted(ports),networks:sorted(raw.networkNames)};
}
export function normalizeCandidate(app, config) {
  const target=targets[app];assert(target && object(config) && object(config.services),'Invalid candidate Compose model.');
  assert(Object.keys(config.services).length===1 && object(config.services[target.service]),'Candidate must contain exactly the selected service; use an independent deployment definition.');
  const service=config.services[target.service];
  for(const key of ['secrets','configs','tmpfs','devices','volumes_from'])assert(!service[key] || Object.keys(service[key]).length===0,'Additional mount mechanisms need manual review.');
  assert(service.container_name===target.container && text(config.name),'Candidate container and explicit Compose project are required.');
  assert(Array.isArray(service.volumes) && Array.isArray(service.ports) && object(service.networks),'Resolved candidate mounts, ports and networks are required.');
  const mounts=uniqueMounts(service.volumes.map(m=>{
    assert(['volume','bind'].includes(m.type) && text(m.target) && m.target.startsWith('/') && (m.read_only===undefined || typeof m.read_only==='boolean'),'Unsupported or incomplete candidate mount.');
    assert(!m.volume?.subpath && (!m.bind?.propagation || m.bind.propagation==='rprivate') && !m.consistency,'Nonstandard mount options need manual review.');
    const definition=config.volumes?.[m.source];
    if(m.type==='volume')assert((!definition?.driver || definition.driver==='local') && (!definition?.driver_opts || Object.keys(definition.driver_opts).length===0),'Custom volume drivers/options need manual review.');
    const source=m.type==='volume'?config.volumes?.[m.source]?.name:sourcePath(m.source);assert(text(source),'Named volumes require a resolved name; inferred project names are not accepted.');
    return {type:m.type,source,target:m.target,readOnly:m.read_only===true};
  }));
  const ports=service.ports.map(p=>{
    assert(Number.isInteger(p.target) && p.target>0 && p.target<=65535 && ['tcp','udp'].includes(p.protocol) && typeof p.published==='string' && /^\d+$/.test(p.published) && Number(p.published)>0 && Number(p.published)<=65535 && text(p.host_ip),'Host IP and fixed published ports must be explicit.');
    return {target:p.target+'/'+p.protocol,host:p.host_ip,port:p.published};
  });
  const networks=Object.keys(service.networks).map(key=>{const name=config.networks?.[key]?.name;assert(text(name),'Candidate networks must have resolved names.');return name;});
  assert(new Set(networks).size===networks.length,'Duplicate candidate network identities need manual review.');
  const pinnedImage=typeof service.image==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(service.image);
  return {app,container:service.container_name,service:target.service,project:config.name,mounts,ports:sorted(ports),networks:sorted(networks),image:pinnedImage?service.image:null};
}
export function compareBoundaries(live,candidate) {
  const differences=[];
  if(live.app!==candidate.app || live.container!==candidate.container || live.service!==candidate.service)differences.push('service-identity');
  if(live.project!==candidate.project)differences.push('compose-project');
  for(const key of ['mounts','ports','networks'])if(!equal(live[key],candidate[key]))differences.push(key);
  if(!live.running || live.status!=='running' || (live.health!==null && live.health!=='healthy'))differences.push('current-service-not-ready');
  if(!candidate.image)differences.push('candidate-image-not-pinned');
  return {boundaryCompatible:differences.length===0,differences,deploymentApproved:false,
    unverified:['trusted CI and image provenance','environment and secret values','commands and security/resource policy','backup consistency and schema compatibility','runtime authentication and business reads','rollout and rollback rehearsal'],
    rollbackImageId:live.imageId,candidateImage:candidate.image};
}
function dockerJson(args, run) {
  let output;
  try {output=run('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe'],windowsHide:true});}
  catch(error) {throw Error(`Read-only Docker ${args[0]} failed (exit ${Number.isInteger(error.status)?error.status:'unavailable'}). Check access and the explicit input paths; raw command output is intentionally suppressed.`);}
  try {return JSON.parse(output);}catch {throw Error('Docker returned invalid JSON; raw output is intentionally suppressed.');}
}
export function inspectService(app,run=execFileSync) {
  assert(targets[app],'Unknown service.');
  return normalizeLive(app,dockerJson(['inspect','--type','container','--format',containerFormat,targets[app].container],run));
}
export function parseArguments(args) {
  const [command,...rest]=args;assert(['inspect','check'].includes(command),'Use inspect --service <app|all>, or check with explicit candidate paths.');
  const result={command,compose:[],env:[]};
  const names={'--service':'app','--compose':'compose','--env-file':'env','--project-directory':'directory','--project-name':'project'};
  for(let i=0;i<rest.length;i+=2){const key=names[rest[i]],value=rest[i+1];assert(key && text(value) && !value.startsWith('--'),'Unknown, incomplete or invalid argument.');
    if(['compose','env'].includes(key))result[key].push(value);else {assert(result[key]===undefined,'Duplicate argument.');result[key]=value;}}
  assert(targets[result.app] || (command==='inspect'&&result.app==='all'),'Select one known service, or all for inspection only.');
  if(command==='inspect')assert(!result.compose.length && !result.env.length && !result.directory && !result.project,'Inspection does not accept configuration paths.');
  else {
    assert(result.compose.length>0 && result.env.length>0 && text(result.directory) && /^[a-z0-9][a-z0-9_-]*$/.test(result.project||''),'Check requires explicit Compose files, environment files, project directory and project name.');
    for(const path of [...result.compose,...result.env,result.directory]){assert(isAbsolute(path) || win32.isAbsolute(path),'Candidate paths must be absolute.');sourcePath(path);}
    assert(new Set(result.compose).size===result.compose.length && new Set(result.env).size===result.env.length,'Repeated configuration paths are not accepted.');
  }
  return result;
}
export function execute(options,run=execFileSync,stat=statSync) {
  const daemonId=dockerJson(['info','--format','{{json .ID}}'],run);assert(text(daemonId),'Docker engine identity is missing.');
  const result={schemaVersion:1,scope:'read-only-deployment-boundary-check',observedAt:new Date().toISOString(),daemonId,deploymentApproved:false};
  if(options.command==='inspect')return {...result,services:(options.app==='all'?Object.keys(targets):[options.app]).map(app=>inspectService(app,run))};
  for(const path of [...options.compose,...options.env])assert(stat(path).isFile(),'Candidate configuration/environment path must be an existing file.');
  assert(stat(options.directory).isDirectory(),'Candidate project directory must exist.');
  const args=['compose','--ansi','never','--project-name',options.project,'--project-directory',options.directory,
    ...options.env.flatMap(file=>['--env-file',file]),...options.compose.flatMap(file=>['--file',file]),'config','--format','json','--no-env-resolution'];
  const candidate=normalizeCandidate(options.app,dockerJson(args,run));
  for(const mount of candidate.mounts.filter(m=>m.type==='bind')){const source=stat(mount.source);assert(source.isFile() || source.isDirectory(),'Bind source must already exist on this host; remote engine path mappings need manual review.');}
  assert(candidate.project===options.project,'Resolved project identity differs from the requested project.');
  const live=inspectService(options.app,run),comparison=compareBoundaries(live,candidate);
  const engineAfter=dockerJson(['info','--format','{{json .ID}}'],run);assert(engineAfter===daemonId,'Docker engine changed during preflight.');
  return {...result,inputs:{compose:options.compose,environmentFiles:options.env,projectDirectory:options.directory,project:options.project},live,candidate,...comparison};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=execute(parseArguments(process.argv.slice(2)));process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.boundaryCompatible===false)process.exitCode=2;}
  catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
