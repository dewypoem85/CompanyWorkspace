import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DomainError } from '../../shared/domain.js';
import { hash } from '../repository.js';
const Verified=z.object({testApp:z.string().min(1),testedAt:z.string().datetime(),evidence:z.string().min(10),duplicateCreateRejected:z.literal(true),lostResponseStops:z.literal(true)}).strict();
const Mobile=z.object({writesEnabled:z.boolean().default(false),verification:Verified.optional()});
export const ConnectionSchema=z.object({
  google:Mobile.extend({packageName:z.string().regex(/^[a-zA-Z0-9_.]+$/),keyFile:z.string(),createMethod:z.literal('inappproducts.insert'),defaultLanguage:z.string().default('ko-KR'),legacySaleCountries:z.array(z.string().regex(/^[A-Z]{2}$/)).default([])} ).optional(),
  apple:Mobile.extend({appId:z.string().regex(/^\d+$/),issuerId:z.string(),keyId:z.string(),keyFile:z.string(),platform:z.literal('IOS').default('IOS'),reviewImages:z.record(z.string(),z.string()).default({})}).optional(),
  steam:z.object({titleId:z.string().regex(/^[a-zA-Z0-9]+$/),secretKeyFile:z.string(),writesEnabled:z.boolean().default(false),maxCatalogBytes:z.number().int().positive().default(9000)}).optional(),
  sheets:z.object({keyFile:z.string(),writesEnabled:z.boolean().default(false)}).optional(),
}).strict();
export type Connection=z.infer<typeof ConnectionSchema>;
export function loadConnections(file:string){const raw=JSON.parse(readFileSync(file,'utf8'));return z.record(z.string(),ConnectionSchema).parse(raw);}
export function mobileWrites(config:z.infer<typeof Mobile>){if(!config.writesEnabled||!config.verification)throw new DomainError('WRITES_DISABLED','실제 테스트 검증 기록이 없어 모바일 쓰기가 비활성화되어 있습니다.',409);}
export function sheetWrites(config:NonNullable<Connection['sheets']>|undefined){if(!config?.writesEnabled)throw new DomainError('SHEET_WRITES_DISABLED','상품 시트 쓰기가 비활성화되어 있습니다.',409);}
export function fingerprint(config:unknown){return hash(config);}
