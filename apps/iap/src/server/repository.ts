import { Pool, type PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { DomainError, type Entity } from '../shared/domain.js';

export function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
export function hash(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
export interface Repository {
  get<T>(kind:string,id:string):Promise<Entity<T>|null>;
  list<T>(kind:string):Promise<Entity<T>[]>;
  put<T>(kind:string,id:string,data:T,expectedVersion?:number):Promise<void>;
  lock<T>(key:string,work:()=>Promise<T>):Promise<T>;
}
export async function need<T>(repo:Repository,kind:string,id:string):Promise<T>{const row=await repo.get<T>(kind,id);if(!row)throw new DomainError('NOT_FOUND',`${kind} 항목을 찾을 수 없습니다.`,404);return row.data;}
export async function audit(repo:Repository,actor:string,action:string,data:unknown){await repo.put('audit',randomUUID(),{at:new Date().toISOString(),actor,action,data},0);}

export class PostgresRepository implements Repository {
  pool:Pool;
  constructor(url:string){this.pool=new Pool({connectionString:url,max:12});}
  async migrate(){await this.pool.query(`
    CREATE TABLE IF NOT EXISTS entities(kind text NOT NULL,id text NOT NULL,version integer NOT NULL DEFAULT 1,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind);
    CREATE OR REPLACE FUNCTION protect_iap_records() RETURNS trigger AS $$ BEGIN
      IF OLD.kind IN ('snapshot','plan','preset','audit','backup','sso_nonce','apple_prices','apple_equalizations','apple_territories','review_asset','remote_scan') THEN RAISE EXCEPTION 'immutable record'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='immutable_iap') THEN
      CREATE TRIGGER immutable_iap BEFORE UPDATE OR DELETE ON entities FOR EACH ROW EXECUTE FUNCTION protect_iap_records();
    END IF; END; $$;
  `);}
  async get<T>(kind:string,id:string){const result=await this.pool.query('SELECT kind,id,version,data FROM entities WHERE kind=$1 AND id=$2',[kind,id]);return (result.rows[0]??null) as Entity<T>|null;}
  async list<T>(kind:string){return (await this.pool.query('SELECT kind,id,version,data FROM entities WHERE kind=$1 ORDER BY updated_at DESC,id',[kind])).rows as Entity<T>[];}
  async put<T>(kind:string,id:string,data:T,expectedVersion?:number){
    let result;
    if(expectedVersion===0){try{await this.pool.query('INSERT INTO entities(kind,id,data) VALUES($1,$2,$3)',[kind,id,JSON.stringify(data)]);return;}catch(e){if((e as {code?:string}).code==='23505')throw new DomainError('CONFLICT','이미 존재하는 레코드입니다.',409);throw e;}}
    if(expectedVersion!==undefined)result=await this.pool.query('UPDATE entities SET data=$3,version=version+1,updated_at=now() WHERE kind=$1 AND id=$2 AND version=$4',[kind,id,JSON.stringify(data),expectedVersion]);
    else result=await this.pool.query('INSERT INTO entities(kind,id,data) VALUES($1,$2,$3) ON CONFLICT(kind,id) DO UPDATE SET data=EXCLUDED.data,version=entities.version+1,updated_at=now()',[kind,id,JSON.stringify(data)]);
    if(!result.rowCount)throw new DomainError('CONFLICT','다른 작업에서 변경되었습니다.',409);
  }
  async lock<T>(key:string,work:()=>Promise<T>):Promise<T>{
    const client:PoolClient=await this.pool.connect();
    const result=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key]);
    if(!result.rows[0].locked){client.release();throw new DomainError('BUSY','같은 대상의 작업이 진행 중입니다.',409);}
    try{return await work();}finally{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();}
  }
}

/** 테스트/명시적 로컬 데모 전용. 운영은 PostgreSQL만 사용한다. */
export class MemoryRepository implements Repository {
  rows=new Map<string,Entity>();locks=new Set<string>();
  async get<T>(kind:string,id:string){return structuredClone(this.rows.get(kind+':'+id)??null) as Entity<T>|null;}
  async list<T>(kind:string){return structuredClone([...this.rows.values()].filter(r=>r.kind===kind)) as Entity<T>[];}
  async put<T>(kind:string,id:string,data:T,expectedVersion?:number){const key=kind+':'+id;const old=this.rows.get(key);if(expectedVersion!==undefined&&(old?.version??0)!==expectedVersion)throw new DomainError('CONFLICT','레코드 충돌',409);if(old&&['snapshot','plan','preset','audit','backup','sso_nonce','apple_prices','apple_equalizations','apple_territories','review_asset','remote_scan'].includes(kind))throw new DomainError('IMMUTABLE','불변 레코드');this.rows.set(key,{kind,id,version:(old?.version??0)+1,data:structuredClone(data)});}
  async lock<T>(key:string,work:()=>Promise<T>){if(this.locks.has(key))throw new DomainError('BUSY','작업 진행 중',409);this.locks.add(key);try{return await work();}finally{this.locks.delete(key);}}
}
