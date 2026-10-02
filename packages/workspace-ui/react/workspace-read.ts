export type ReadResult<T> = {status:'cancelled'} | {status:'success';value:T;isCurrent:()=>boolean} | {status:'error';error:unknown;isCurrent:()=>boolean};
export type WorkspaceReadSession = {
  run<T>(channel:string,work:(signal:AbortSignal)=>Promise<T>,timeoutMs?:number):Promise<ReadResult<T>>;
  cancel(channel:string):void;
  dispose():void;
};
export function createWorkspaceReadSession():WorkspaceReadSession {
  const factory=(window as unknown as {CompanyReadSession?:{create:()=>WorkspaceReadSession}}).CompanyReadSession;
  if(!factory)throw Error('공통 조회 도구를 불러오지 못했습니다. 페이지를 다시 열어 주세요.');
  return factory.create();
}
