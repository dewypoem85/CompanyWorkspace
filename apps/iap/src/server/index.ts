import { MemoryRepository,PostgresRepository } from './repository.js';
import { createApp } from './app.js';
import { loadConnections } from './connectors/config.js';
import { connectors,DemoConnector } from './connectors/index.js';
import { ProductSchema,DomainError,type Job,type Store } from '../shared/domain.js';
import { importCatalog } from './catalog.js';
import { checkPortal,type AuthConfig } from './auth.js';
const demo=process.env.DEMO_MODE==='true';
if(demo&&process.env.NODE_ENV==='production')throw new Error('DEMO_MODE is local development only');
const port=Number(process.env.PORT??4180);
const repo=demo?new MemoryRepository():new PostgresRepository(process.env.DATABASE_URL??'');
if(repo instanceof PostgresRepository)await repo.migrate();
const connections=demo?{}:loadConnections(process.env.CONNECTOR_CONFIG_FILE??'/run/secrets/iap-connectors.json');
const reviewAssetDirectory=process.env.REVIEW_ASSET_DIR??'/app/data/review-assets';
const fake={google:new DemoConnector('google'),apple:new DemoConnector('apple'),steam:new DemoConnector('steam')};
const factory=demo?(_game:unknown,store:Store)=>fake[store]:connectors(connections,reviewAssetDirectory);
const auth:AuthConfig={demo,origin:process.env.APP_ORIGIN??`http://localhost:${port}`,secret:process.env.COMPANY_SSO_SHARED_SECRET??'',secure:process.env.COOKIE_SECURE!=='false',portalUrl:process.env.COMPANY_PORTAL_URL??'https://company.example.com',portalInternalUrl:process.env.COMPANY_PORTAL_INTERNAL_URL??'http://company-portal:8080'};
if(demo){
  await repo.put('game','dungeon-slasher',{id:'dungeon-slasher',name:'던전슬래셔',connectorKey:'demo'},0);
  const products=[['starter_pack','스타터 패키지','1001'],['gem_pouch','작은 보석 주머니','1002'],['ad_free','광고 제거','1003']].map(([key,name,steamId])=>ProductSchema.parse({productKey:key,name,type:key==='ad_free'?'nonConsumable':'consumable',googleId:key,appleId:key,steamId,pricePresetKey:'P5500',legacyName:key,localizations:{'ko-KR':{name,description:'모험을 위한 특별한 구성'},'en-US':{name:key==='ad_free'?'Remove Ads':'Adventure Pack',description:'A special pack for your adventure'}}}));
  const catalog=await importCatalog(repo,'dungeon-slasher',products,'demo','isolated-demo');
  await repo.put('readiness','dungeon-slasher',{revision:catalog.snapshotId,keys:products.map(p=>p.productKey),evidence:'격리된 가상 데이터입니다.'});
  await repo.put('preset','demo-p5500',{key:'P5500',name:'기본 패키지',krw:'5500',google:{KR:{currency:'KRW',amount:'5500'},US:{currency:'USD',amount:'3.99'},JP:{currency:'JPY',amount:'600'}},apple:{KOR:{pricePointId:'resolve-per-product',currency:'KRW',amount:'5500'}},steam:{KRW:'5500',USD:'3.99',JPY:'600'},version:'demo-p5500',confirmedAt:new Date().toISOString(),confirmedBy:'demo'},0);
}
const {app,engine}=createApp(repo,factory,auth,connections,reviewAssetDirectory);
let busy=false;
const timer=setInterval(async()=>{if(busy)return;busy=true;try{for(const {data:job}of await repo.list<Job>('job')){if(job.state==='queued'||job.state==='running'){try{await checkPortal(auth,job.actor,'iap.publish');await engine.run(job.id);}catch(error){if(error instanceof DomainError&&error.code==='BUSY')continue;console.error(JSON.stringify({event:'worker-paused',jobId:job.id,code:error instanceof DomainError?error.code:'INTERNAL'}));}}}}catch{console.error(JSON.stringify({event:'worker-storage-unavailable'}));}finally{busy=false;}},3000);
const host=process.env.HOST??(demo?'127.0.0.1':'0.0.0.0');
const server=app.listen(port,host,()=>console.log(`Product Upload ${demo?'local demo':'server'}: http://localhost:${port}`));
async function shutdown(){clearInterval(timer);server.close();if(repo instanceof PostgresRepository)await repo.pool.end();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
