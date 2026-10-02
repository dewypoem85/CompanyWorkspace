import React,{useEffect,useId,useState} from 'react';
import type {Game} from '../shared/domain';
import {activeProjectsFirst,type CompanyProject} from '../shared/project-directory';
import {ConnectionHelp} from './ConnectionHelp';
import {spreadsheetIdFromInput} from '../shared/sheet-reference';
export function ProjectConnections({games,projects,selectedProjectId,current,onSave}:{games:Game[];projects:CompanyProject[];selectedProjectId:string;current?:Game;onSave:(path:string,method:string,body:unknown)=>Promise<void>}){
  const [selected,setSelected]=useState(selectedProjectId),[sheet,setSheet]=useState(''),[connector,setConnector]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{setSelected(selectedProjectId);},[selectedProjectId]);
  const available=projects.some(p=>p.id===selected&&!p.archived)&&!games.some(g=>g.portalProjectId===selected);
  const sheetId=useId(),connectorId=useId();
  async function save(bind:boolean){setBusy(true);setError('');try{const project=projects.find(p=>p.id===selected);if(!project)return;await onSave(bind?`/games/${current!.id}/project`:'/games',bind?'PUT':'POST',bind?{projectId:project.id}:{id:`project-${project.id}`,portalProjectId:project.id,name:project.name,spreadsheetId:spreadsheetIdFromInput(sheet),connectorKey:connector.trim()});setSelected('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="panel form-panel"><h2>회사 프로젝트 연결</h2><p>회사 포털의 공통 프로젝트를 선택합니다. 이름을 별도로 만들지 않습니다.</p>{current&&<p>현재 연결: {current.portalProjectId?`${current.name} · 포털 ID ${current.portalProjectId}`:`${current.name} · 기존 데이터 (프로젝트 연결 필요)`}</p>}
    <label>회사 프로젝트<select className="cw-form-control" data-company-picker="project" disabled={busy} value={projects.some(p=>p.id===selected)?selected:''} onChange={e=>setSelected(e.target.value)}><option value="">프로젝트 선택</option>{activeProjectsFirst(projects).map(p=><option key={p.id} value={p.id} disabled={p.archived||games.some(g=>g.portalProjectId===p.id)}>{p.name}{p.archived?' (보관됨)':games.some(g=>g.portalProjectId===p.id)?' (연결됨)':''}</option>)}</select></label>
    {current&&!current.portalProjectId&&<button className="cw-button" disabled={!available||busy} onClick={()=>save(true)}>현재 상품·이력을 이 프로젝트에 연결</button>}
    <h3>새 프로젝트의 IAP 연결 설정</h3>
    <div className="connection-field">
      <ConnectionHelp id={sheetId} label="상품 시트 주소 또는 ID" summary="Google 시트 주소 전체를 붙여 넣으세요. /d/ 다음의 문서 ID만 입력해도 됩니다.">
        상품 목록이 있는 Google 스프레드시트를 열고 주소창의 주소 전체를 복사해 붙여 넣으세요. 문서 ID만 입력해도 됩니다.<br/>
        예: <code>https://docs.google.com/spreadsheets/d/문서ID/edit#gid=0</code> → <code>문서ID</code><br/>
        <code>gid=0</code>은 문서 안의 탭 번호이므로 입력할 ID가 아닙니다. 서버 연결 프로필의 시트 서비스 계정에 해당 문서의 뷰어 권한이 필요합니다.<br/>
        표준 <code>Products</code> 탭을 사용합니다. JSON으로 먼저 가져올 경우 비워둘 수 있지만, 시트 가져오기를 하려면 문서를 연결해야 합니다.
      </ConnectionHelp>
      <input id={sheetId} className="cw-form-control" aria-describedby={`${sheetId}-help`} placeholder="https://docs.google.com/spreadsheets/d/…/edit 또는 문서 ID" value={sheet} onChange={e=>setSheet(e.target.value)}/>
    </div>
    <div className="connection-field">
      <ConnectionHelp id={connectorId} label="서버 연결 프로필 키" summary="서버에 미리 등록된 연결 설정의 이름입니다. 던전슬래셔에 준비한 키는 dungeon-slasher입니다.">
        서버 관리자가 미리 등록한 시트·스토어 연결 설정의 이름을 입력하세요. 임의로 새 이름을 만드는 입력칸이 아닙니다.<br/>
        던전슬래셔에 준비한 프로필 키: <code>dungeon-slasher</code>. 다른 프로젝트는 담당자에게 해당 프로젝트용 키를 확인하세요.<br/>
        회사 프로젝트 ID, Google 문서 ID, API 키 또는 JSON 인증 파일 내용은 넣지 않습니다. 인증 정보는 서버에서 관리합니다.<br/>
        프로필이 없다는 오류가 나오면 서버 담당자에게 등록을 요청하세요. 프로필 연결만으로 상품이 업로드되거나 기존 상품이 변경되지는 않습니다.
      </ConnectionHelp>
      <input id={connectorId} className="cw-form-control" aria-describedby={`${connectorId}-help`} placeholder="예: dungeon-slasher (서버에 등록된 키)" autoComplete="off" spellCheck={false} value={connector} onChange={e=>setConnector(e.target.value)}/>
    </div>
    <button className="cw-button primary" data-variant="primary" disabled={!available||!connector.trim()||busy} onClick={()=>save(false)}>선택한 프로젝트 연결 추가</button>{error&&<p className="price-error" role="alert">{error}</p>}
  </section>;
}
