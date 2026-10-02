import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, requirePublish, storeId, StoreSchema, SettingsSchema, type Actor, type Approval, type Catalog, type Desired, type Game, type Job, type Plan, type Preset, type Row, type Settings } from '../shared/domain.js';
import { type Repository, audit, hash, need } from './repository.js';
import { ConnectorError, EXCEPTION_FIELDS, type ConnectorFactory } from './connectors/types.js';

export const CreateRequest=z.object({gameId:z.string(),productKeys:z.array(z.string()).min(1).max(100),stores:z.array(StoreSchema).min(1).max(3)}).strict();
export const ExceptionRequest=z.object({gameId:z.string(),productKey:z.string(),store:z.enum(['google','apple']),fields:z.array(z.enum(EXCEPTION_FIELDS)).min(1),reason:z.string().trim().min(5).max(1000)}).strict();
export class Engine {
  constructor(public repo:Repository,public factory:ConnectorFactory,public now=()=>new Date(),private authorize:(actor:Actor)=>Promise<void>=async()=>{}){}
  async source(gameId:string){
    const game=await need<Game>(this.repo,'game',gameId);const catalog=await need<Catalog>(this.repo,'catalog',gameId);
    const settings=(await this.repo.list<Settings>('settings')).filter(s=>s.id.startsWith(gameId+':'));
    const presets=(await this.repo.list<Preset>('preset')).map(r=>r.data).sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt)||a.version.localeCompare(b.version));
    const readiness=await this.repo.get<{revision:string;keys:string[]}>('readiness',gameId);
    const fingerprints=Object.fromEntries(['google','apple','steam'].map(s=>{try{return [s,this.factory(game,s as 'google'|'apple'|'steam').fingerprint];}catch{return[s,'unconfigured'];}}));
    return {game,catalog,settings,presets,readiness,fingerprints};
  }
  async desired(source:Awaited<ReturnType<Engine['source']>>,key:string,store:string):Promise<Desired>{
    const product=source.catalog.products.find(p=>p.productKey===key);
    if(!product||source.catalog.missingKeys.includes(key))throw new DomainError('MISSING_PRODUCT',`시트에 없는 상품: ${key}`);
    const base=source.presets.filter(p=>p.key===product.pricePresetKey).at(-1);
    if(!base)throw new DomainError('PRESET_MISSING',`${key}: 확정된 가격표가 없습니다.`);
    const settings=SettingsSchema.parse(source.settings.find(s=>s.id===`${source.game.id}:${key}:${store}`)?.data??{countries:store==='apple'?['KOR']:['KR']});
    // Google legacy product availability follows the app's verified sale countries.
    // A stale per-product draft must not narrow or widen that app-level scope.
    if(store==='google'){
      const countries=this.factory(source.game,'google').saleCountries?.()??[];
      if(countries.length)settings.countries=countries;
    }
    const preset=structuredClone(base);
    if(store==='google')for(const [market,price] of Object.entries(settings.priceOverrides))preset.google[market]={currency:price.currency,amount:price.amount};
    if(store==='apple'&&settings.priceOverrides.KOR){const price=settings.priceOverrides.KOR;preset.apple.KOR={pricePointId:price.referenceId??'',selectionId:price.sourceVersion,amount:price.amount,currency:price.currency};}
    if(store==='steam')for(const [currency,price] of Object.entries(settings.priceOverrides))preset.steam[currency]=price.amount;
    return {product,preset,settings};
  }
  async createPlan(actor:Actor,input:unknown):Promise<Plan>{
    requirePublish(actor);const req=CreateRequest.parse(input);const source=await this.source(req.gameId);const rows:Row[]=[];
    for(const key of [...new Set(req.productKeys)])for(const store of [...new Set(req.stores)]){
      const desired=await this.desired(source,key,store);const id=storeId(desired.product,store);if(!id)throw new DomainError('STORE_ID_MISSING',`${key}: ${store} ID 누락`);
      const connector=this.factory(source.game,store);const before=await connector.read(id);
      const existingMobile=before!==null&&store!=='steam';
      if(!existingMobile){
        if(desired.product.type==='unconfigured')throw new DomainError('PRODUCT_UNCONFIGURED',`${key}: 웹에서 상품 유형과 내용을 설정하세요.`);
        if(source.readiness?.data.revision!==source.catalog.snapshotId||!source.readiness.data.keys.includes(key))throw new DomainError('GAME_NOT_READY',`${key}: 현재 manifest의 게임 설정 확인이 필요합니다.`);
        await connector.validate(desired);
      }
      rows.push({productKey:key,store,remoteId:id,before,desired,action:existingMobile?'skip':before?'update':'create',state:existingMobile?'skipped':'pending',steps:existingMobile?[]:connector.steps(desired).map(key=>({key,state:'pending'})),message:existingMobile?'기존 상품 — 변경 없이 건너뜀':undefined});
    }
    return this.savePlan({id:randomUUID(),mode:'create',game:source.game,actorId:actor.id,createdAt:this.now().toISOString(),sourceHash:hash(source),connections:source.fingerprints,rows,hash:''});
  }
  async exceptionPlan(actor:Actor,input:unknown){
    requirePublish(actor);const req=ExceptionRequest.parse(input);const source=await this.source(req.gameId);const desired=await this.desired(source,req.productKey,req.store);
    const id=storeId(desired.product,req.store);if(!id)throw new DomainError('STORE_ID_MISSING','상품 ID 누락');const connector=this.factory(source.game,req.store);const before=await connector.read(id);
    if(!before)throw new DomainError('NOT_EXISTING','기존 상품만 예외 변경할 수 있습니다.');
    await connector.validate(desired,req.fields);
    const row:Row={productKey:req.productKey,store:req.store,remoteId:id,before,desired,fields:[...new Set(req.fields)],action:'update',state:'pending',steps:connector.steps(desired,req.fields).map(key=>({key,state:'pending'}))};
    if(!row.steps.length)throw new DomainError('EMPTY_CHANGE','실행할 변경이 없습니다.');
    return this.savePlan({id:randomUUID(),mode:'exception',game:source.game,actorId:actor.id,createdAt:this.now().toISOString(),sourceHash:hash(source),connections:source.fingerprints,rows:[row],reason:req.reason,hash:''});
  }
  private async savePlan(plan:Plan){plan.hash=hash({...plan,hash:''});await this.repo.put('plan',plan.id,plan,0);await audit(this.repo,plan.actorId,'plan.'+plan.mode,{planId:plan.id,hash:plan.hash});return plan;}
  async approve(actor:Actor,planId:string,typedId:string){
    requirePublish(actor);const plan=await need<Plan>(this.repo,'plan',planId);
    if(plan.mode!=='exception'||plan.actorId!==actor.id||plan.rows.length!==1||typedId!==plan.rows[0].remoteId)throw new DomainError('INVALID_APPROVAL','상품 ID 또는 승인 대상이 일치하지 않습니다.',403);
    await this.checkFresh(plan);
    const approval:Approval={id:randomUUID(),planId,actorId:actor.id,planHash:plan.hash,expiresAt:new Date(this.now().getTime()+600_000).toISOString()};
    await this.repo.put('approval',approval.id,approval,0);await audit(this.repo,actor.id,'exception.approve',{approvalId:approval.id,planId});return approval;
  }
  private async checkFresh(plan:Plan){
    if(hash(await this.source(plan.game.id))!==plan.sourceHash)throw new DomainError('STALE_PLAN','시트·게임 설정·가격표·연결이 변경되었습니다. 새 계획이 필요합니다.',409);
    for(const row of plan.rows){if(row.action==='skip')continue;const current=await this.factory(plan.game,row.store).read(row.remoteId);if(hash(current)!==hash(row.before))throw new DomainError('REMOTE_CHANGED','스토어 값이 변경되었습니다. 새 계획이 필요합니다.',409);}
  }
  async enqueue(actor:Actor,planId:string,mode:'create'|'exception',approvalId?:string){
    requirePublish(actor);
    return this.repo.lock('enqueue:'+planId,async()=>{
      const plan=await need<Plan>(this.repo,'plan',planId);
      if(plan.mode!==mode||plan.actorId!==actor.id)throw new DomainError('WRONG_ROUTE','작업 경로 또는 사용자가 일치하지 않습니다.',403);
      const previous=await this.repo.get<Job>('job',planId);if(previous)return previous.data;
      await this.checkFresh(plan);
      let approvalExpiresAt:string|undefined;
      if(mode==='exception'){
        const approval=await this.repo.get<Approval>('approval',approvalId??'');
        if(!approval||approval.data.actorId!==actor.id||approval.data.planId!==planId||approval.data.planHash!==plan.hash||approval.data.jobId||new Date(approval.data.expiresAt)<=this.now())throw new DomainError('APPROVAL_REQUIRED','유효한 일회성 승인이 필요합니다.',403);
        // 승인을 먼저 소비한다. 이후 장애가 나면 안전하게 새 승인이 필요하다.
        approvalExpiresAt=approval.data.expiresAt;
        await this.repo.put('approval',approval.id,{...approval.data,jobId:planId},approval.version);
      }
      const job:Job={id:planId,plan,actor,state:'queued',rows:structuredClone(plan.rows),createdAt:this.now().toISOString(),updatedAt:this.now().toISOString(),approvalExpiresAt};
      await this.repo.put('job',job.id,job,0);await audit(this.repo,actor.id,'job.enqueue',{jobId:job.id,mode});return job;
    });
  }
  private async save(job:Job){job.updatedAt=this.now().toISOString();await this.repo.put('job',job.id,job);}
  async run(jobId:string){
    return this.repo.lock('job:'+jobId,async()=>{
      const job=await need<Job>(this.repo,'job',jobId);if(job.state==='done')return job;
      if(job.state==='needs_action')return job;
      requirePublish(job.actor);
      await this.authorize(job.actor);
      if(job.nextAttemptAt&&new Date(job.nextAttemptAt)>this.now())return job;
      const hasProgress=job.rows.some(r=>r.created||r.state==='running'||r.steps.some(s=>s.state!=='pending'));
      if(!hasProgress&&((job.approvalExpiresAt&&new Date(job.approvalExpiresAt)<=this.now())||hash(await this.source(job.plan.game.id))!==job.plan.sourceHash)){
        job.state='needs_action';for(const row of job.rows)if(row.state==='pending'){row.state='needs_action';row.message='실행 전 승인 만료 또는 원본 변경 — 새 계획 필요';}await this.save(job);return job;
      }
      if(hash({...job.plan,hash:''})!==job.plan.hash)throw new DomainError('PLAN_TAMPERED','계획 해시 불일치');
      const intent=(r:Row)=>({productKey:r.productKey,store:r.store,remoteId:r.remoteId,desired:r.desired,action:r.action,fields:r.fields,steps:r.steps.map(s=>s.key)});
      if(hash(job.rows.map(intent))!==hash(job.plan.rows.map(intent)))throw new DomainError('PLAN_TAMPERED','작업 내용이 최초 승인 계획과 다릅니다.');
      job.state='running';await this.save(job);
      for(const row of job.rows){
        if(['done','skipped','needs_action','failed'].includes(row.state))continue;
        try{await this.repo.lock(`store:${job.plan.game.id}:${row.store}`,async()=>{
          const connector=this.factory(job.plan.game,row.store);
          if(connector.fingerprint!==job.plan.connections?.[row.store])throw new DomainError('CONNECTION_CHANGED','연결 설정이 변경되어 작업을 중단합니다.');
          if(row.action==='skip'){row.state='skipped';await this.save(job);return;}
          // 생성의 성공 응답 또는 단계 완료 기록이 없는 in-flight 작업은 절대 자동 재실행하지 않는다.
          if(row.state==='running'&&!row.created&&row.action==='create'&&row.store!=='steam'||row.steps.some(s=>s.state==='inflight'))throw new ConnectorError('OUTCOME_UNKNOWN','이전 요청 결과가 미확정입니다. 자동 재실행하지 않습니다.');
          const completed=row.steps.some(s=>s.state==='done');
          if(!row.created&&!completed){
            const current=await connector.read(row.remoteId);
            if(row.store==='steam'){
              const previous=job.rows.slice(0,job.rows.indexOf(row)).filter(r=>r.store==='steam'&&r.state==='done').at(-1);
              const receipt=previous?.steps.find(s=>s.key==='catalog')?.receipt as {hash?:string}|undefined;
              if(receipt?.hash){if(hash(current?.data.raw)!==receipt.hash)throw new DomainError('REMOTE_CHANGED','Steam 선행 작업 이후 외부 변경 감지');row.before=current;}
            }
            if(job.plan.mode==='create'&&row.store!=='steam'&&current){row.state='skipped';row.message='기존 상품 — 변경 없이 건너뜀';await this.save(job);return;}
            if(hash(current)!==hash(row.before))throw new DomainError('REMOTE_CHANGED','실행 직전 원격값이 변경되었습니다.');
          }
          await connector.validate(row.desired,row.fields);
          if(row.store!=='steam'&&row.action==='update'&&(job.plan.mode!=='exception'||job.rows.length!==1||!row.fields?.length))throw new DomainError('EXISTING_PROTECTED','기존 모바일 상품 변경 차단',403);
          row.state='running';await this.save(job);
          if(row.action==='create'&&row.store!=='steam'&&!row.created){
            await this.authorize(job.actor);
            try{const result=await connector.create(row.remoteId,row.desired);row.created={...result,at:this.now().toISOString()};await this.save(job);}
            catch(error){if(error instanceof ConnectorError&&error.code==='ALREADY_EXISTS'){row.state='skipped';row.message='생성 충돌 — 기존 상품 변경 없이 건너뜀';await this.save(job);return;}throw error;}
          }
          if(row.store==='steam'&&!row.backup){row.backup=await connector.read(row.remoteId);await this.repo.put('backup',randomUUID(),{jobId:job.id,store:row.store,remote:row.backup},0);await this.save(job);}
          for(const step of row.steps){
            if(step.state==='done')continue;
            await this.authorize(job.actor);
            step.state='inflight';await this.save(job);
            try{step.receipt=await connector.apply(step.key,row);step.state='done';await this.save(job);}
            catch(error){if(error instanceof ConnectorError&&error.certainty==='rejected'&&error.retryable){step.state='pending';row.state='pending';await this.save(job);}throw error;}
          }
          row.state='done';row.message=row.desired.settings.submitReview&&row.store==='apple'?'등록·심사 제출 완료 — 심사 결과는 상태 조회로 확인':'반영 완료';await this.save(job);
        });}
        catch(error){
          if(error instanceof DomainError&&error.code==='BUSY'){row.state='pending';await this.save(job);continue;}
          if(error instanceof ConnectorError&&error.certainty==='rejected'&&error.retryable&&row.created){row.state='pending';row.message=error.message;}
          else{row.state='needs_action';row.message=error instanceof DomainError?`${error.code}: ${error.message}`:'처리 결과 확인 필요 — 서버 로그의 작업 ID를 확인하세요.';}
          await this.save(job);
        }
      }
      job.state=job.rows.some(r=>['pending','running'].includes(r.state))?'queued':job.rows.some(r=>['needs_action','failed'].includes(r.state))?'needs_action':'done';
      if(job.state==='queued'){job.attempts=(job.attempts??0)+1;job.nextAttemptAt=new Date(this.now().getTime()+Math.min(300000,3000*2**Math.min(job.attempts,7))).toISOString();}
      await this.save(job);await audit(this.repo,job.actor.id,'job.result',{jobId:job.id,state:job.state,rows:job.rows.map(r=>({key:r.productKey,store:r.store,state:r.state,message:r.message}))});return job;
    });
  }
}
