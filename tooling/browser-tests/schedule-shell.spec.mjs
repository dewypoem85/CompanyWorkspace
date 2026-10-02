import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { root } from '../build-ui.mjs';
import {createHash} from 'node:crypto';
import {assertScheduleControls,assertTaskDateControls,assertScheduleModal} from './support/schedule-controls.mjs';

const definitions=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(p=>p.service==='schedule');
const clientRoot=resolve(root,'apps/schedule/server/wwwroot');
const employee={id:1,name:'검증 직원',department:'개발',departmentId:1,projectIds:[10],role:'admin',active:true,shared:false,access:true,isAdmin:true};
const project={id:10,name:'검증 프로젝트',color:'#5563d8',archived:false,version:1};
const task={id:101,title:'공통 구조 검증 업무',body:'업무 상세와 댓글 URL을 보존합니다.',assigneeId:1,createdBy:1,projectId:10,startDate:'2026-09-07',endDate:'2026-09-11',status:'planned',archived:false,version:1,createdAt:'2026-09-07T00:00:00Z',updatedAt:'2026-09-07T00:00:00Z'};
const taskWriteMedia='application/vnd.company.workspace-form+json';
function commentState(value,target){const comments=value.comments.filter(comment=>target===undefined||comment.id===target.id||comment.parentId===target.id),ids=new Set(comments.map(comment=>comment.id));return createHash('sha256').update(JSON.stringify([value.task,target??null,comments,value.attachments.filter(a=>a.commentId!==null&&ids.has(a.commentId))])).digest('hex');}
function withTaskWriteState(value){return {...value,editing:{actorId:'1',stateToken:createHash('sha256').update(JSON.stringify([value.task,value.attachments.filter(a=>a.commentId===null)])).digest('hex')},commentEditing:{actorId:'1',createStateToken:commentState(value),comments:value.comments.map(comment=>({id:comment.id,stateToken:commentState(value,comment)}))}};}
function taskWriteReply(value,operation,previousStateToken){const detail=withTaskWriteState(value);return {contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:'업무를 저장했습니다.',data:{operation,actorId:'1',previousStateToken,stateToken:detail.editing.stateToken,task:detail.task,attachments:detail.attachments.filter(a=>a.commentId===null),navigateTo:`/tasks/${detail.task.id}`}})};}
function commentWriteReply(value,comment,operation,previousStateToken){return {contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:'댓글을 저장했습니다.',data:{operation,actorId:'1',previousStateToken,stateToken:commentState(value,comment),comment,attachments:value.attachments.filter(a=>a.commentId===comment.id)}})};}
const commentWriteError=(status,outcome,message)=>({status,contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome,message})});
const milestone={id:5,title:'공통 구조 검증 마감',description:'직원은 주요 일정을 함께 편집할 수 있습니다.',date:'2026-09-10',projectId:10,version:1,type:'review',createdBy:1,updatedBy:1,createdAt:'2026-09-07T00:00:00Z',updatedAt:'2026-09-07T00:00:00Z'};
function milestoneState(rows,target){return createHash('sha256').update(JSON.stringify([employee.id,target?[target]:rows])).digest('hex');}
function milestonePage(rows){return{items:rows,editing:{actorId:'1',createStateToken:milestoneState(rows),milestones:rows.map(row=>({id:row.id,stateToken:milestoneState(rows,row)}))}};}
function milestoneWriteReply(rows,row,operation,previousStateToken,deleted=false){return{contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:deleted?'주요 일정을 삭제했습니다.':'주요 일정을 저장했습니다.',data:{operation,actorId:'1',previousStateToken,stateToken:deleted?milestoneState(rows):milestoneState(rows,row),milestone:row,deleted}})};}
function milestoneAudit(row){return{type:row.type||'general',title:row.title,description:row.description||'',date:row.date,endDate:row.endDate||null,additionalSchedules:row.additionalSchedules||[],projectId:row.projectId??null};}
function milestoneHistory(row){return row?[{id:1,milestoneId:row.id,actorId:1,action:'create',beforeSnapshot:'',afterSnapshot:JSON.stringify(milestoneAudit(row)),createdAt:row.createdAt||'2026-09-07T00:00:00Z'}]:[];}

async function taskWriteFixture(page){
  const f=await fixture(page),writes=[],rows=new Map([[101,{task:{...task},canEdit:true,comments:[],attachments:[],history:[]}]]);
  f.directory.profiles={'1':'https://company.example.com/test-assets/task-profile.svg?v=1'};
  await page.route('**/test-assets/task-profile.svg?*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#5563d8"/><circle cx="16" cy="16" r="8" fill="white"/></svg>'}));
  const state={mode:'ok',afterWrite:false};
  const error=(status,outcome)=>({status,contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome,message:'검증용 '+outcome})});
  await page.route('**/api/tasks**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method(),match=path.match(/^\/api\/tasks\/(\d+)(\/status)?$/);
    if(method==='GET'){
      if(!match){const status=new URL(request.url()).searchParams.get('status'),items=[...rows.values()].map(value=>value.task).filter(value=>!status||value.status===status);return route.fulfill({json:{items,total:items.length,editableIds:items.map(value=>value.id),commentCounts:[],attachmentCounts:[]}});}
      if(state.mode==='post-read-error'&&state.afterWrite)return route.fulfill({status:503,json:{error:'synthetic'}});
      return route.fulfill({json:withTaskWriteState(rows.get(Number(match[1])))});
    }
    if(!(path==='/api/tasks'&&method==='POST'||match&&(method==='PUT'||method==='PATCH')))return route.fallback();
    const body=request.postDataJSON(),headers=request.headers(),id=match?Number(match[1]):202,current=rows.get(id),previous=current?withTaskWriteState(current).editing.stateToken:null;
    writes.push({method,path,body,headers});expect(headers['x-csrf-token']).toBe('synthetic');expect(headers['x-workspace-actor']).toBe('1');expect(headers.accept).toBe(taskWriteMedia);
    if(state.mode==='invalid')return route.fulfill(error(422,'invalid'));
    if(state.mode==='failure')return route.fulfill(error(500,'unknown'));
    if(state.mode==='conflict'){
      rows.set(id,{...current,task:{...current.task,version:current.task.version+1}});return route.fulfill(error(409,'conflict'));
    }
    expect(headers['x-workspace-state']??null).toBe(previous);
    const kind=method==='POST'?'create':method==='PATCH'?'status':'update';
    const next={...(current||{canEdit:true,comments:[],attachments:[],history:[]}),task:kind==='status'?{...current.task,status:body.status,version:body.version+1,updatedAt:'2026-09-10T03:00:00Z'}:
      {...task,...body,id,title:body.title.trim(),body:body.body.trim(),version:body.version+1,updatedAt:'2026-09-10T03:00:00Z'}};
    rows.set(id,next);state.afterWrite=true;
    const reply=taskWriteReply(next,kind,previous);
    if(state.mode==='malformed'){const payload=JSON.parse(reply.body);payload.data.task.title='다른 저장 내용';reply.body=JSON.stringify(payload);}
    return route.fulfill(reply);
  });
  return {...f,state,writes,rows};
}

for(const [width,theme] of [[320,'dark'],[1440,'light']])test(`kanban quick status uses checked shared writes ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await taskWriteFixture(page);
  await page.goto('https://schedule.workspace.test/kanban');const status=page.getByRole('combobox',{name:task.title+' 상태 변경'});await expect(status).toHaveValue('planned');
  await status.selectOption('done');const confirm=page.getByRole('dialog',{name:'업무 상태를 변경할까요?'});await expect(confirm).toBeVisible();await expect(status).toBeDisabled();expect(f.writes).toHaveLength(0);
  await expect(confirm).toContainText('완료');await page.screenshot({path:info.outputPath('kanban-status-confirm.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(status).toHaveValue('planned');expect(f.writes).toHaveLength(0);
  await status.selectOption('done');await page.getByRole('button',{name:'상태 변경',exact:true}).click();await expect(page.getByText('업무 상태를 변경했습니다.',{exact:true})).toBeVisible();
  const moved=page.getByRole('combobox',{name:task.title+' 상태 변경'});await expect(moved).toHaveValue('done');expect(f.writes).toHaveLength(1);expect(f.writes[0].headers['x-workspace-state']).toMatch(/^[a-f0-9]{64}$/);expect(f.writes[0].body).toEqual({status:'done',version:1});
  await page.screenshot({path:info.outputPath('kanban-status-saved.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const [width,theme] of [[320,'dark'],[1440,'light']])test(`task image upload uses checked shared multipart writes ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await taskWriteFixture(page),writes=[];
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=','base64'),sha256=createHash('sha256').update(bytes).digest('hex'),id='a'.repeat(32),name='검증 첨부.png';
  await page.route('**/api/images',async route=>{
    const request=route.request(),headers=request.headers();writes.push({headers,body:request.postDataBuffer()});
    expect(headers.accept).toBe(taskWriteMedia);expect(headers['x-csrf-token']).toBe('synthetic');expect(headers['x-workspace-actor']).toBe('1');
    return route.fulfill({contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:{operation:'upload',actorId:'1',sha256,attachment:{id,ownerId:1,taskId:null,commentId:null,name,contentType:'image/png',size:bytes.length,createdAt:'2026-09-12T00:00:00Z'}}})});
  });
  await page.route('**/api/images/*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>'}));
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');await panel.getByRole('button',{name:'업무 수정',exact:true}).click();const input=panel.locator('input[type=file]');
  await input.setInputFiles({name,mimeType:'image/png',buffer:bytes});let confirm=page.getByRole('dialog',{name:'이미지를 업로드할까요?'});await expect(confirm).toBeVisible();await expect(confirm).toContainText(name);await expect(input).toBeDisabled();expect(writes).toHaveLength(0);await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);expect(writes).toHaveLength(0);await expect(input).toBeEnabled();
  await input.setInputFiles({name,mimeType:'image/png',buffer:bytes});confirm=page.getByRole('dialog',{name:'이미지를 업로드할까요?'});if(width===320&&theme==='dark')await page.screenshot({path:info.outputPath('image-upload-confirm.png'),animations:'disabled'});await page.getByRole('button',{name:'업로드',exact:true}).click();
  await expect(panel.getByText('이미지를 첨부했습니다.',{exact:true})).toBeVisible();const attachment=panel.getByRole('button',{name,exact:true});await expect(attachment).toBeVisible();expect(writes).toHaveLength(1);expect(writes[0].body.toString('utf8')).toContain(name);await attachment.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('image-upload-saved.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`task shared writes confirm update/status and keep completed writes separate from failed reads ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await taskWriteFixture(page);
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');await panel.getByRole('button',{name:'업무 수정',exact:true}).click();
  const title=panel.getByRole('textbox',{name:'제목',exact:true});await title.fill('확인한 업무 변경');
  await panel.getByRole('textbox',{name:'업무 본문',exact:true}).fill('원문 9223372036854775807');await panel.getByRole('button',{name:'업무 저장',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'업무 변경을 저장할까요?'});await expect(confirm).toBeVisible();expect(f.writes).toHaveLength(0);await expect(title).toBeDisabled();
  await expect(confirm.locator('.cw-entity-avatar img')).toHaveAttribute('src',/task-profile.svg\?v=1/);await page.screenshot({path:info.outputPath('task-save-confirm.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(title).toHaveValue('확인한 업무 변경');await expect(title).toBeEnabled();
  await panel.getByRole('button',{name:'업무 저장',exact:true}).click();f.state.mode='post-read-error';await page.getByRole('button',{name:'저장 확인',exact:true}).click();
  await expect(panel).toContainText('저장은 완료했지만 목록 확인에 실패했습니다.');await expect(title).toHaveValue('확인한 업무 변경');await expect(title).toBeDisabled();expect(f.writes).toHaveLength(1);
  await panel.locator('.detail-panel').evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:info.outputPath('task-saved-read-error.png'),animations:'disabled'});
  f.state.mode='ok';await panel.getByRole('button',{name:'저장 결과 다시 조회',exact:true}).click();await expect(panel.getByRole('heading',{level:1})).toHaveText('확인한 업무 변경');expect(f.writes).toHaveLength(1);
  const comment=panel.getByRole('textbox',{name:'새 댓글',exact:true});await comment.fill('다른 초안 보존');await panel.getByRole('combobox',{name:'업무 상태',exact:true}).selectOption('done');
  await expect(page.getByRole('dialog',{name:'업무 상태를 변경할까요?'})).toBeVisible();await page.getByRole('button',{name:'저장 확인',exact:true}).click();
  await expect(panel.getByRole('combobox',{name:'업무 상태',exact:true})).toHaveValue('done');await expect(comment).toHaveValue('다른 초안 보존');expect(f.writes).toHaveLength(2);
  expect(f.writes[1].body).toEqual({status:'done',version:2});expect(f.writes[0].body.body).toBe('원문 9223372036854775807');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`task edit cancel uses checked shared confirmation and retains its exact draft ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await taskWriteFixture(page);
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');await panel.getByRole('button',{name:'업무 수정',exact:true}).click();
  const title=panel.getByRole('textbox',{name:'제목',exact:true}),cancel=panel.getByRole('button',{name:'취소',exact:true});await title.fill('취소 후에도 보존할 업무 초안');
  await cancel.click();let confirm=page.getByRole('dialog',{name:'업무 편집 초안을 버릴까요?',exact:true});await expect(confirm).toBeVisible();await expect(confirm).toContainText('취소 후에도 보존할 업무 초안');await expect(confirm).toContainText('검증 직원');await expect(confirm).toContainText('검증 프로젝트');await expect(title).toBeDisabled();
  if(width===320&&theme==='dark')await page.screenshot({path:info.outputPath('task-edit-cancel-confirm.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(title).toHaveValue('취소 후에도 보존할 업무 초안');await expect(title).toBeEnabled();await expect(cancel).toBeFocused();
  await cancel.click();confirm=page.getByRole('dialog',{name:'업무 편집 초안을 버릴까요?',exact:true});await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(confirm).toHaveCount(0);await expect(title).toHaveValue('취소 후에도 보존할 업무 초안');await expect(title).toBeEnabled();
  await cancel.click();await page.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(panel.getByRole('heading',{level:1})).toHaveText(task.title);await panel.getByRole('button',{name:'업무 닫기',exact:true}).click();await expect(panel).toHaveCount(0);
  await page.goto('https://schedule.workspace.test/');await page.getByRole('button',{name:'＋ 업무 등록',exact:true}).click();const newPanel=page.locator('.task-dialog'),newTitle=newPanel.getByRole('textbox',{name:'제목',exact:true});await newTitle.fill('새 업무 취소 초안');await newPanel.getByRole('button',{name:'취소',exact:true}).click();
  confirm=page.getByRole('dialog',{name:'업무 편집 초안을 버릴까요?',exact:true});await expect(confirm).toContainText('새 업무 취소 초안');await page.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(newPanel).toHaveCount(0);await expect(page).toHaveURL('https://schedule.workspace.test/');
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const mode of ['invalid','conflict','malformed','failure'])test(`task shared writes preserve drafts and handle ${mode} without automatic resubmission`,async({page})=>{
  const f=await taskWriteFixture(page);await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');await panel.getByRole('button',{name:'업무 수정',exact:true}).click();
  const title=panel.getByRole('textbox',{name:'제목',exact:true}),save=panel.getByRole('button',{name:'업무 저장',exact:true});await title.fill('보관할 초안');
  await save.click();await expect(page.getByRole('button',{name:'저장 확인',exact:true})).toBeVisible();f.state.mode=mode;await page.getByRole('button',{name:'저장 확인',exact:true}).click();
  await expect(panel.locator('[data-state-kind="error"]').first()).toBeVisible();await expect(title).toHaveValue('보관할 초안');expect(f.writes).toHaveLength(1);
  await page.clock.fastForward(61000);expect(f.writes).toHaveLength(1);f.state.mode='ok';
  if(mode==='invalid'){
    await title.fill('교정한 초안');await save.click();await page.getByRole('button',{name:'저장 확인',exact:true}).click();await expect(panel.getByRole('button',{name:'업무 수정',exact:true})).toBeVisible();expect(f.writes).toHaveLength(2);
  }else if(mode==='conflict'){
    await save.click();await expect(panel).toContainText('이전 작성 기준으로 다시 저장할 수 없습니다');expect(f.writes).toHaveLength(1);
    await panel.getByRole('button',{name:'변경 내용 비교',exact:true}).last().click();await page.locator('dialog.cw-review [data-review-apply]').click();
    await save.click();await page.getByRole('button',{name:'저장 확인',exact:true}).click();await expect(panel.getByRole('button',{name:'업무 수정',exact:true})).toBeVisible();expect(f.writes).toHaveLength(2);
  }else{
    await expect(save).toBeDisabled();await panel.getByRole('button',{name:'업무 닫기',exact:true}).click();await page.getByRole('dialog',{name:'작성 중인 내용을 버리고 업무를 닫을까요?',exact:true}).getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(panel).toHaveCount(0);
    await page.locator('.desktop-week .task-card').first().click();await panel.getByRole('button',{name:'업무 수정',exact:true}).click();await expect(panel.getByRole('button',{name:'업무 저장',exact:true})).toBeDisabled();expect(f.writes).toHaveLength(1);
  }
  expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('task shared writes register a new task and navigate only after its exact acknowledgement and read',async({page})=>{
  const f=await taskWriteFixture(page);await page.goto('https://schedule.workspace.test/');await page.getByRole('button',{name:'＋ 업무 등록',exact:true}).click();
  const panel=page.locator('.task-dialog'),projectSelect=panel.getByRole('combobox',{name:'프로젝트',exact:true});await expect(projectSelect).toHaveValue('10');await expect(projectSelect.locator('option:checked')).toContainText('참여 중');await projectSelect.selectOption('');await expect(projectSelect).toHaveValue('');await panel.getByRole('textbox',{name:'제목',exact:true}).fill('새 공통 업무');
  await panel.getByRole('button',{name:'업무 저장',exact:true}).click();let confirm=page.getByRole('dialog',{name:'프로젝트를 지정하지 않고 저장할까요?',exact:true});
  await expect(confirm).toContainText('프로젝트 미지정');await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(panel.getByRole('textbox',{name:'제목',exact:true})).toHaveValue('새 공통 업무');expect(f.writes).toHaveLength(0);
  await panel.getByRole('button',{name:'업무 저장',exact:true}).click();confirm=page.getByRole('dialog',{name:'프로젝트를 지정하지 않고 저장할까요?',exact:true});await confirm.getByRole('button',{name:'미지정으로 계속',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'새 업무를 등록할까요?',exact:true})).toBeVisible();expect(f.writes).toHaveLength(0);await page.getByRole('button',{name:'저장 확인',exact:true}).click();
  await expect(page).toHaveURL(/\/tasks\/202$/);await expect(panel.getByRole('heading',{level:1})).toHaveText('새 공통 업무');expect(f.writes).toHaveLength(1);expect(f.writes[0].method).toBe('POST');expect(f.errors).toEqual([]);
});

test('creating a task from a future month returns to that month after closing its detail',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-09-10T03:00:00Z'));
  const f=await taskWriteFixture(page);await page.goto('https://schedule.workspace.test/');
  const modes=page.locator('.schedule-mode-navigation');await modes.getByRole('button',{name:'월간 달력',exact:true}).click();
  await page.getByRole('button',{name:'다음 달',exact:true}).click();await expect(page.locator('.month-navigation strong')).toHaveText('2026년 10월');
  await modes.getByRole('button',{name:'＋ 업무 등록',exact:true}).click();
  const panel=page.locator('.task-dialog');await panel.getByRole('textbox',{name:'제목',exact:true}).fill('월간에서 추가한 업무');
  await panel.getByRole('button',{name:'업무 저장',exact:true}).click();
  await page.getByRole('dialog',{name:'새 업무를 등록할까요?',exact:true}).getByRole('button',{name:'저장 확인',exact:true}).click();
  await expect(page).toHaveURL(/\/tasks\/202$/);await expect(panel.getByRole('heading',{level:1})).toHaveText('월간에서 추가한 업무');
  await panel.getByRole('button',{name:'업무 닫기',exact:true}).click();
  await expect(panel).toHaveCount(0);await expect(page).toHaveURL('https://schedule.workspace.test/');
  await expect(modes.getByRole('button',{name:'월간 달력',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.month-navigation strong')).toHaveText('2026년 10월');
  expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('task planning adds and edits a shared TODO and ranged detailed schedule',async({page})=>{
  const f=await taskWriteFixture(page),writes=[];
  await page.route(/\/api\/tasks\/101\/(shared-todos|schedule-items)(?:\/\d+)?$/,async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,kind=path.includes('/shared-todos')?'todo':'schedule',body=request.postDataJSON(),headers=request.headers(),detail=f.rows.get(101),updating=request.method()==='PUT';
    writes.push({kind,body});expect(headers['x-csrf-token']).toBe('synthetic');expect(headers['x-workspace-actor']).toBe('1');expect(headers.accept).toBe(taskWriteMedia);
    const value=kind==='todo'?{id:31,taskId:101,title:body.title,createdBy:1,completedBy:null,completedAt:null,version:updating?2:1,createdAt:'2026-09-14T00:00:00Z',updatedAt:'2026-09-14T00:00:00Z'}:{id:41,taskId:101,title:body.title,date:body.date,endDate:body.endDate,createdBy:1,version:updating?2:1,createdAt:'2026-09-14T00:00:00Z',updatedAt:'2026-09-14T00:00:00Z'};
    const key=kind==='todo'?'sharedTodos':'scheduleItems',current=detail[key]||[];
    f.rows.set(101,{...detail,[key]:updating?current.map(item=>item.id===value.id?value:item):[...current,value]});
    return route.fulfill({contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:'변경사항을 저장했습니다.',data:{operation:`${kind}-${updating?'update':'create'}`,value}})});
  });
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');
  const todoInput=panel.getByLabel('새 TODO',{exact:true}),todoForm=todoInput.locator('xpath=ancestor::form[1]');await todoInput.fill('상점 UI 정상화');await todoForm.getByRole('button',{name:'추가',exact:true}).click();await expect(panel.locator('.shared-todo-list')).toContainText('상점 UI 정상화');
  const scheduleInput=panel.getByLabel('일정 내용',{exact:true}),scheduleForm=scheduleInput.locator('xpath=ancestor::form[1]');await scheduleInput.fill('상점 UI 검수');await scheduleForm.getByRole('button',{name:'추가',exact:true}).click();await expect(panel.locator('.task-schedule-list')).toContainText('상점 UI 검수');
  const scheduleRow=panel.locator('.task-schedule-list li').first();await scheduleRow.getByRole('button',{name:'수정',exact:true}).click();await scheduleRow.getByLabel('일정 내용',{exact:true}).fill('상점 UI 장기 검수');await scheduleRow.getByLabel('상세 일정 수정 종료일',{exact:true}).fill('2026-09-10');await scheduleRow.getByRole('button',{name:'저장',exact:true}).click();await expect(scheduleRow).toContainText('2026-09-07 ~ 2026-09-10');
  const todoRow=panel.locator('.shared-todo-list li').first();await todoRow.getByRole('button',{name:'수정',exact:true}).click();await todoRow.getByLabel('TODO 내용',{exact:true}).fill('상점 UI 정상화 재검증');await todoRow.getByRole('button',{name:'저장',exact:true}).click();await expect(todoRow).toContainText('상점 UI 정상화 재검증');
  expect(writes).toEqual([{kind:'todo',body:{title:'상점 UI 정상화',version:0}},{kind:'schedule',body:{title:'상점 UI 검수',date:'2026-09-07',endDate:'2026-09-11',version:0}},{kind:'schedule',body:{title:'상점 UI 장기 검수',date:'2026-09-07',endDate:'2026-09-10',version:1}},{kind:'todo',body:{title:'상점 UI 정상화 재검증',version:1}}]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('task shared status conflict exposes an explicit read without discarding a comment draft',async({page})=>{
  const f=await taskWriteFixture(page);await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');
  const comment=panel.getByRole('textbox',{name:'새 댓글',exact:true});await comment.fill('보관할 댓글');f.state.mode='conflict';
  await panel.getByRole('combobox',{name:'업무 상태',exact:true}).selectOption('done');await page.getByRole('button',{name:'저장 확인',exact:true}).click();
  await panel.getByRole('button',{name:'현재 업무 다시 조회',exact:true}).click();await expect(comment).toHaveValue('보관할 댓글');expect(f.writes).toHaveLength(1);
  f.state.mode='ok';await panel.getByRole('combobox',{name:'업무 상태',exact:true}).selectOption('done');await page.getByRole('button',{name:'저장 확인',exact:true}).click();
  await expect(panel.getByRole('combobox',{name:'업무 상태',exact:true})).toHaveValue('done');expect(f.writes).toHaveLength(2);expect(f.writes[1].body.version).toBe(2);await expect(comment).toHaveValue('보관할 댓글');expect(f.errors).toEqual([]);
});

for(const kind of ['timeout','scope','pagehide'])test(`task shared write ${kind} rejects a non-abortable late JSON acknowledgement`,async({page})=>{
  const f=await taskWriteFixture(page);await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');
  await panel.getByRole('button',{name:'업무 수정',exact:true}).click();const title=panel.getByRole('textbox',{name:'제목',exact:true});await title.fill('늦은 응답에도 보관할 초안');
  await page.evaluate(()=>{
    const original=window.fetch.bind(window);
    window.fetch=async(...args)=>{
      const response=await original(...args);
      if(args[1]?.method==='PUT'&&String(args[0]).endsWith('/api/tasks/101')){
        const value=await response.json();
        return {status:response.status,ok:response.ok,headers:response.headers,json:()=>new Promise(resolve=>{window.releaseTaskWrite=()=>resolve(value);})};
      }
      return response;
    };
  });
  await panel.getByRole('button',{name:'업무 저장',exact:true}).click();await page.getByRole('button',{name:'저장 확인',exact:true}).click();await page.waitForFunction(()=>typeof window.releaseTaskWrite==='function');expect(f.writes).toHaveLength(1);
  if(kind==='timeout')await page.clock.fastForward(31000);
  if(kind==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(kind==='pagehide')await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await expect(panel.getByRole('button',{name:'업무 닫기',exact:true})).toBeEnabled();await page.evaluate(()=>window.releaseTaskWrite());
  await expect(title).toHaveValue('늦은 응답에도 보관할 초안');await expect(panel.getByRole('button',{name:'업무 저장',exact:true})).toBeDisabled();
  await expect(panel.locator('[data-state-kind="success"]')).toHaveCount(0);await page.clock.fastForward(61000);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`task detail shared reads retain drafts, failures and explicit identity recovery ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  let mode='initial-error',reads=0,latest={task:{...task},canEdit:true,comments:[],attachments:[],history:[]};
  await page.route('**/api/tasks/101',route=>{
    reads++;if(mode==='initial-error')return route.fulfill({status:503,contentType:'text/html',body:'unavailable'});
    const checked=withTaskWriteState(latest);return route.fulfill({json:mode==='malformed'?{...checked,attachments:[{id:'foreign',taskId:999,commentId:null,name:'bad',contentType:'image/png',size:1}]}:checked});
  });
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog'),retry=panel.getByRole('button',{name:'업무 다시 조회',exact:true});
  await expect(panel.locator('[data-state-kind="error"]')).toContainText('업무 상세를 불러오지 못했습니다');await expect(panel.getByRole('heading',{level:1})).toHaveCount(0);
  await expect(panel.locator('[data-state-kind="loading"]')).toHaveCount(0);await expect(panel).not.toContainText('업무를 불러오는 중');
  mode='ok';await retry.click();await expect(panel.getByRole('heading',{level:1})).toHaveText(task.title);
  const comment=panel.getByRole('textbox',{name:'새 댓글',exact:true}),submit=panel.getByRole('button',{name:'댓글 등록',exact:true});await comment.fill('보존할 댓글 9223372036854775807');
  mode='malformed';await page.clock.fastForward(31000);await expect(retry).toBeVisible();await expect(comment).toHaveValue('보존할 댓글 9223372036854775807');await expect(panel.getByRole('heading',{level:1})).toHaveText(task.title);
  const before=reads;await page.clock.fastForward(90000);expect(reads).toBe(before);
  await panel.locator('.detail-panel').evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:info.outputPath('detail-read-error.png'),animations:'disabled'});
  mode='ok';latest={...latest,task:{...latest.task,title:'새로 확인한 업무',version:2}};await retry.click();await expect(panel.getByRole('heading',{level:1})).toHaveText('새로 확인한 업무');await expect(comment).toHaveValue('보존할 댓글 9223372036854775807');
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(panel.locator('[data-state-kind="denied"]').first()).toBeVisible();await expect(submit).toBeDisabled();await expect(panel.getByRole('combobox',{name:'업무 상태',exact:true})).toBeDisabled();
  const suspended=reads;await page.clock.fastForward(61000);expect(reads).toBe(suspended);
  await retry.click();await expect(submit).toBeEnabled();await expect(comment).toHaveValue('보존할 댓글 9223372036854775807');
  expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await panel.locator('.detail-panel').evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:info.outputPath('detail-recovered.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const interruption of ['timeout','scope','pagehide','route'])test(`task detail shared reads discard non-abortable ${interruption} responses`,async({page})=>{
  const f=await fixture(page);
  await page.addInitScript(()=>{
    const original=window.fetch.bind(window);window.holdTaskBody=false;window.taskBodies=[];
    window.fetch=async(...args)=>{
      if(window.holdTaskBody&&String(args[0])==='/api/tasks/101')return {ok:true,redirected:false,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(resolve=>window.taskBodies.push(resolve))};
      return original(...args);
    };
  });
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');await expect(panel.getByRole('heading',{level:1})).toHaveText(task.title);
  await page.evaluate(()=>window.holdTaskBody=true);await page.clock.fastForward(31000);await expect.poll(()=>page.evaluate(()=>window.taskBodies.length)).toBe(1);
  if(interruption==='timeout')await page.clock.fastForward(31000);
  if(interruption==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(interruption==='pagehide')await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  if(interruption==='route')await panel.getByRole('button',{name:'업무 닫기',exact:true}).click();
  if(interruption!=='route')await expect(panel.locator('[data-state-kind="loading"]')).toHaveCount(0);
  if(interruption==='timeout'||interruption==='scope'){
    await page.evaluate(()=>window.holdTaskBody=false);await panel.getByRole('button',{name:'업무 다시 조회',exact:true}).click();await expect(panel.getByRole('heading',{level:1})).toHaveText(task.title);
  }
  await page.evaluate(value=>window.taskBodies.forEach(resolve=>resolve(value)),{task:{...task,title:'늦은 응답의 업무',version:20},canEdit:true,comments:[],attachments:[],history:[]});
  await expect(page.getByText('늦은 응답의 업무',{exact:true})).toHaveCount(0);if(interruption==='route')await expect(panel).toHaveCount(0);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`schedule shared reads distinguish errors, old snapshots and revoked scope ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  let bootstrapFails=true,listMode='ok',taskReads=0;
  await page.route('**/api/bootstrap',route=>bootstrapFails?route.fulfill({status:503,json:{error:'synthetic'}}):route.fallback());
  await page.route('**/api/tasks?*',route=>{
    taskReads++;
    if(listMode==='error')return route.fulfill({status:503,json:{error:'synthetic'}});
    if(listMode==='malformed')return route.fulfill({json:{items:[],total:0}});
    if(listMode==='denied')return route.fulfill({status:403,contentType:'text/html',body:'denied'});
    return route.fallback();
  });
  await page.goto('https://schedule.workspace.test/');
  await expect(page.getByText('회사 정보를 불러오지 못했습니다.',{exact:true})).toBeVisible();await expect(page.locator('.task-card')).toHaveCount(0);expect(taskReads).toBe(0);
  bootstrapFails=false;await page.getByRole('button',{name:'회사 정보 다시 조회',exact:true}).click();
  const board=width===320?page.locator('.mobile-week'):page.locator('.desktop-week');await expect(board.locator('.task-card').first()).toBeVisible();
  listMode='error';await page.clock.fastForward(31000);
  const failure=page.locator('.cw-main [data-state-kind="error"]').filter({hasText:'일정을 불러오지 못했습니다.'});await expect(failure).toBeVisible();await expect(board.locator('.task-card').first()).toBeVisible();
  await failure.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('read-error-last-snapshot.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  listMode='ok';await page.getByRole('button',{name:'일정 다시 조회',exact:true}).click();await expect(failure).toHaveCount(0);
  listMode='malformed';await page.getByRole('button',{name:'내 일정',exact:true}).click();await expect(failure).toBeVisible();await expect(page.locator('.task-card')).toHaveCount(0);
  listMode='ok';await page.getByRole('button',{name:'일정 다시 조회',exact:true}).click();await expect(board.locator('.task-card').first()).toBeVisible();
  listMode='denied';await page.clock.fastForward(31000);await expect(page.locator('.cw-main [data-state-kind="denied"]')).toBeVisible();await expect(page.locator('.task-card')).toHaveCount(0);
  const before=taskReads;listMode='ok';await page.clock.fastForward(61000);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(taskReads).toBe(before);
  await page.evaluate(()=>{history.pushState(null,'','/todos');window.dispatchEvent(new PopStateEvent('popstate'));});await expect(page).toHaveURL(/\/todos$/);await expect(page.locator('.cw-main [data-state-kind="denied"]')).toBeVisible();await expect(page.locator('.personal-todos')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('read-denied.png'),animations:'disabled'});expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('schedule shared read timeout ignores late JSON and allows explicit GET retry',async({page})=>{
  const f=await fixture(page);await page.goto('https://schedule.workspace.test/');await expect(page.locator('.desktop-week .task-card').first()).toBeVisible();
  await page.evaluate(()=>{
    const original=window.fetch;window.pendingReadBodies=[];window.holdReadBodies=true;
    window.fetch=async(...args)=>{
      if(window.holdReadBodies&&String(args[0]).startsWith('/api/tasks?'))return {ok:true,redirected:false,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(resolve=>window.pendingReadBodies.push(resolve))};
      return original(...args);
    };
  });
  await page.getByRole('button',{name:'내 일정',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.pendingReadBodies.length)).toBe(1);
  await page.clock.fastForward(31000);await expect(page.getByText('조회 시간이 초과되었습니다. 다시 시도해 주세요.',{exact:true})).toBeVisible();await expect(page.locator('.task-card')).toHaveCount(0);
  await page.evaluate(()=>{window.holdReadBodies=false;});await page.getByRole('button',{name:'일정 다시 조회',exact:true}).click();await expect(page.locator('.desktop-week .task-card').first()).toBeVisible();
  await page.evaluate(()=>window.pendingReadBodies.forEach(resolve=>resolve({items:[],total:0,editableIds:[],commentCounts:[],attachmentCounts:[]})));await expect(page.locator('.desktop-week .task-card').first()).toBeVisible();expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`record cards and cell overlays share interaction states without losing task actions ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1100});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page),record={...task,status:'done'};
  await page.route('**/api/tasks?*',route=>{const status=new URL(route.request().url()).searchParams.get('status'),items=status&&status!=='planned'?[]:[record];return route.fulfill({json:{items,total:items.length,editableIds:items.map(t=>t.id),commentCounts:[],attachmentCounts:[]}});});
  await page.goto('https://schedule.workspace.test/');
  const board=width===320?page.locator('.mobile-week'):page.locator('.desktop-week');
  const card=board.locator('.task-card').first();await expect(card).toBeVisible();
  await assertScheduleControls(board,{minFields:0,minButtons:3});
  await expect(card).not.toHaveAttribute('data-emphasis',/.+/);await expect(card).toHaveCSS('border-top-style','solid');
  expect(await card.evaluate(e=>getComputedStyle(e).getPropertyValue('--record-accent').trim())).toBe(project.color);
  await card.hover();await assertScheduleControls(board,{minFields:0,minButtons:3});
  await card.focus();await expect(card).toBeFocused();await page.screenshot({path:info.outputPath('record-cards.png'),animations:'disabled'});
  // Shared record state precedence is checked on an actual consumer, without issuing any mutation.
  await card.evaluate(e=>{e.disabled=true;});await assertScheduleControls(board,{minFields:0,minButtons:3});await card.evaluate(e=>{e.disabled=false;});
  await card.evaluate(e=>e.setAttribute('aria-pressed','true'));await assertScheduleControls(board,{minFields:0,minButtons:3});await card.evaluate(e=>e.removeAttribute('aria-pressed'));
  await card.focus();await page.keyboard.press('Enter');const panel=page.locator('dialog.task-dialog');await expect(panel).toContainText(task.title);
  await panel.getByRole('button',{name:'업무 수정',exact:true}).click();await expect(panel.getByRole('heading',{name:'업무 수정',exact:true})).toBeVisible();
  await expect(panel.getByLabel('시작일',{exact:true})).toHaveValue(task.startDate);await expect(panel.getByLabel('종료일',{exact:true})).toHaveValue(task.endDate);
  await expect(panel.getByLabel('실제 시작일',{exact:true})).toHaveCount(0);await expect(panel.getByLabel('실제 종료일',{exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'업무 닫기'}).click();await expect(panel).toHaveCount(0);
  const major=board.locator('.milestone-chip').first();await major.focus();await page.keyboard.press('Enter');
  await expect(page.locator('dialog[open]').last()).toContainText(milestone.title);await page.locator('dialog[open]').last().getByRole('button',{name:'관리 닫기',exact:true}).click();
  if(width===1440){
    const cell=board.locator('.cell-add').first();await cell.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(cell).toBeFocused();await expect(cell.locator('[data-overlay-hint]')).toHaveCSS('opacity','1');
    await expect(cell).toHaveCSS('outline-offset','-2px');
    const size=await cell.evaluate(e=>{const b=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {width:b.width,parentWidth:p.width,height:b.height,parentHeight:p.height};});
    expect(Math.abs(size.width-size.parentWidth)).toBeLessThanOrEqual(2);expect(Math.abs(size.height-size.parentHeight)).toBeLessThanOrEqual(2);
    await page.keyboard.press('Enter');await expect(panel.getByLabel('시작일',{exact:true})).toHaveValue('2026-09-07');await expect(panel.getByLabel('담당자',{exact:true})).toHaveValue('1');await panel.getByRole('button',{name:'업무 닫기'}).click();
  }
  if(width===320)await page.locator('.cw-nav-toggle').click();await page.locator('.cw-sidebar').getByRole('link',{name:'칸반',exact:true}).click();
  const kanban=page.locator('.kanban .task-card').first();await expect(kanban).toHaveAttribute('draggable','true');
  const transfer=await page.evaluateHandle(()=>new DataTransfer());await kanban.dispatchEvent('dragstart',{dataTransfer:transfer});expect(await transfer.evaluate(d=>d.getData('text/task-id'))).toBe('101');
  await assertScheduleControls(page.locator('.kanban'),{minFields:0,minButtons:1,buttonSelector:'.task-card'});
  await page.screenshot({path:info.outputPath('record-kanban.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`week board actions preserve overlapping rows, focus view and shared legend ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page),items=[task,...[102,103,104].map(id=>({...task,id,title:'겹치는 검증 업무 '+id}))],queries=[];
  let releaseNext,holdNext=true;
  await page.route('**/api/tasks?*',async route=>{
    const q=new URL(route.request().url()).searchParams;queries.push(q.toString());
    if(holdNext&&q.get('from')==='2026-09-21'){holdNext=false;await new Promise(resolve=>{releaseNext=resolve;});}
    return route.fulfill({json:{items,total:items.length,editableIds:items.map(t=>t.id),commentCounts:[],attachmentCounts:[]}});
  });
  await page.goto('https://schedule.workspace.test/');
  const actions=page.locator('.board-actions'),legendButton=actions.getByRole('button',{name:'색상 안내',exact:true}),legend=actions.locator('[data-cw-disclosure-panel="legend"]');
  if(width===320){
    const offset=await page.evaluate(()=>({header:document.querySelector('.cw-header').getBoundingClientRect().bottom,nav:document.querySelector('.schedule-view-switch').getBoundingClientRect().top}));
    expect(offset.nav).toBeGreaterThanOrEqual(offset.header-1);
  }
  await expect(legendButton).toBeEnabled();await expect(legendButton).toHaveAttribute('aria-expanded','false');
  await assertScheduleControls(actions,{minFields:0,minButtons:6});
  if(width===320){
    const mobileLayout=await page.evaluate(()=>{
      const day=document.querySelector('.mobile-week .mobile-day');
      const token=document.createElement('span');token.style.background='var(--cw-surface)';document.body.append(token);
      const surface=getComputedStyle(token).backgroundColor;token.remove();
      return {surface,daySurface:getComputedStyle(day).backgroundColor,buttons:[...document.querySelectorAll('.board-actions button')].map(button=>({width:button.clientWidth,content:button.scrollWidth}))};
    });
    expect(mobileLayout.daySurface).toBe(mobileLayout.surface);
    expect(mobileLayout.buttons.every(button=>button.content<=button.width+1)).toBe(true);
  }
  await legendButton.focus();await page.keyboard.press('Enter');await expect(legend).toBeVisible();await expect(legendButton).toHaveAttribute('aria-expanded','true');
  await expect(legend).toContainText('일요일·공휴일');await expect(legend).not.toContainText('점선');
  expect(await legend.evaluate(e=>e.getBoundingClientRect().right<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('board-legend.png'),animations:'disabled'});
  await legendButton.press('Enter');await expect(legend).toBeHidden();await expect(legendButton).toBeFocused();
  if(width!==320){
    const major=page.locator('.desktop-week .milestone-label');
    await assertScheduleControls(major,{minFields:0,minButtons:1});await major.getByRole('button').click();
    await expect(major.getByRole('button')).toHaveAttribute('aria-expanded','true');await expect(page.locator('.desktop-week .milestone-summary').first()).toBeVisible();
    await major.getByRole('button').click();await expect(major.getByRole('button')).toHaveAttribute('aria-expanded','false');
  }
  const lane=width===320?page.locator('.mobile-day').first().locator('.mobile-person'):page.locator('.desktop-week .timeline-row[data-employee-id="1"]');
  await expect(lane.locator('.task-card')).toHaveCount(1);
  const expand=lane.locator('.expand-person');await expect(expand).toHaveAttribute('aria-expanded','false');await expand.click();
  await expect(lane.locator('.task-card')).toHaveCount(4);await expect(expand).toHaveAttribute('aria-expanded','true');
  await assertScheduleControls(width===320?lane.locator('.mobile-person-heading'):lane.locator('.person-info'),{minFields:0,minButtons:1});
  await actions.getByRole('button',{name:'업무 모두 접기',exact:true}).click();await expect(lane.locator('.task-card')).toHaveCount(1);
  if(width!==320)expect(await expand.evaluate(e=>e.getBoundingClientRect().top>=e.parentElement.querySelector('small').getBoundingClientRect().bottom)).toBe(true);
  await actions.getByRole('button',{name:'업무 모두 펼치기',exact:true}).click();await expect(lane.locator('.task-card')).toHaveCount(4);
  await page.screenshot({path:info.outputPath('board-expanded.png'),animations:'disabled'});
  const focus=actions.getByRole('button',{name:'크게 보기',exact:true});await focus.click();
  await expect(page.locator('main')).toHaveClass(/focus-board/);await expect(page.locator('.desktop-week')).toBeVisible();await expect(actions.getByRole('button',{name:'기본 화면',exact:true})).toHaveAttribute('aria-pressed','true');
  await assertScheduleControls(actions,{minFields:0,minButtons:6});
  await page.screenshot({path:info.outputPath('board-focus-view.png'),animations:'disabled'});
  await actions.getByRole('button',{name:'기본 화면',exact:true}).click();await expect(page.locator('main')).not.toHaveClass(/focus-board/);
  await actions.getByRole('button',{name:'다음 주 불러오기'}).click();await expect.poll(()=>typeof releaseNext).toBe('function');
  await expect(actions.getByRole('button',{name:'다음 주 불러오기'})).toBeDisabled();await expect(actions.getByRole('button',{name:'이전 주 불러오기'})).toBeDisabled();
  await assertScheduleControls(actions,{minFields:0,minButtons:6});releaseNext();await expect(actions.getByRole('button',{name:'다음 주 불러오기'})).toBeEnabled();
  expect(queries.some(q=>new URLSearchParams(q).get('from')==='2026-09-21')).toBe(true);
  if(width===320){
    await lane.getByRole('button',{name:'검증 직원 2026-09-07 업무 등록',exact:true}).click();
    const editor=page.locator('dialog.task-dialog');await expect(editor.getByLabel('시작일',{exact:true})).toHaveValue('2026-09-07');
    await expect(editor.getByLabel('담당자',{exact:true})).toHaveValue('1');await editor.getByRole('button',{name:'업무 닫기'}).click();await expect(editor).toHaveCount(0);
  }
  // Group headings still control domain row layout, not a duplicate hidden/ARIA controller.
  await page.getByRole('button',{name:'프로젝트별',exact:true}).click();
  const group=width===320?page.locator('.mobile-day').first().locator('.mobile-task-group'):page.locator('.desktop-week');
  const heading=width===320?group.locator(':scope > button'):group.locator('.task-group-heading>button');
  const cards=group.locator('.task-card');await expect(cards).toHaveCount(4);
  if(width!==320){await expect(group.locator('.corner')).toHaveCount(0);await expect(group.locator('.task-row-label')).toHaveCount(0);await expect(cards.first().locator('strong')).toHaveCSS('position','sticky');}
  await heading.click();await expect(cards).toHaveCount(0);await expect(heading).toHaveAttribute('aria-expanded','false');
  await heading.click();await expect(cards).toHaveCount(4);await expect(heading).toHaveAttribute('aria-expanded','true');
  await assertScheduleControls(width===320?group:group.locator('.task-group-heading'),{minFields:0,minButtons:1,buttonSelector:':scope > button'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('short desktop schedule chrome stays compact without wrapping its mode list',async({page},info)=>{
  await page.setViewportSize({width:1686,height:603});await page.emulateMedia({colorScheme:'dark'});const f=await fixture(page);
  await page.goto('https://schedule.workspace.test/');
  const frame=await page.evaluate(()=>{
    const modes=document.querySelector('.schedule-mode-navigation'),rail=document.querySelector('.schedule-mode-rail'),toolbar=document.querySelector('.toolbar'),filters=document.querySelector('.filters'),board=document.querySelector('.week-scroll');
    const groups=[...rail.children].map(node=>({top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height}));
    return {modes:modes.getBoundingClientRect(),rail:{height:rail.getBoundingClientRect().height,scrollHeight:rail.scrollHeight},toolbar:toolbar.getBoundingClientRect(),filters:filters.getBoundingClientRect(),boardTop:board.getBoundingClientRect().top,groups};
  });
  expect(frame.modes.height).toBeLessThanOrEqual(40);expect(frame.rail.scrollHeight).toBeLessThanOrEqual(frame.rail.height+1);
  expect(new Set(frame.groups.map(group=>Math.round(group.top))).size).toBe(1);expect(frame.toolbar.height).toBeLessThanOrEqual(60);expect(frame.filters.height).toBeLessThanOrEqual(56);
  expect(frame.boardTop-frame.modes.top).toBeLessThanOrEqual(200);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('compact-schedule-chrome.png'),animations:'disabled'});expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`board filters share controls and preserve view options across navigation ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page),queries=[];
  page.on('request',request=>{const u=new URL(request.url());if(u.pathname==='/api/tasks')queries.push(u.searchParams);});
  await page.goto('https://schedule.workspace.test/');
  const toolbar=page.locator('.toolbar'),modes=page.locator('.schedule-mode-navigation'),modeRail=modes.locator('.schedule-mode-rail'),filters=page.locator('.filters'),options=page.locator('#schedule-view-options'),toggle=toolbar.getByRole('button',{name:/보기 설정/});
  await expect(page.locator('.cw-current-page')).toHaveText('주간 일정');
  if(width===320)expect(await page.locator('.cw-current-page').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  const colors=await page.evaluate(()=>{const probe=document.createElement('span');document.body.append(probe);const token=name=>{probe.style.color=`var(--cw-${name})`;return getComputedStyle(probe).color;};const result={raised:token('raised'),active:token('active')};probe.remove();return result;});
  const weekendCheck=filters.getByRole('checkbox',{name:'주말 표시',exact:true}),weekendControl=weekendCheck.locator('xpath=..');
  await expect(weekendCheck).toHaveClass(/\bcw-checkbox\b/);await expect(weekendControl).toHaveClass(/\bcw-check-control\b/);expect((await weekendCheck.boundingBox()).width).toBe(18);await expect(weekendControl).toHaveCSS('background-color',colors.raised);
  await expect(toggle).toBeEnabled();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(options).toBeHidden();
  const modeFrame=await modes.evaluate((node)=>{const rail=node.querySelector('.schedule-mode-rail');return {height:node.getBoundingClientRect().height,railHeight:rail.getBoundingClientRect().height,railScrollHeight:rail.scrollHeight};});
  expect(modeFrame.height).toBeLessThanOrEqual(width===320?130:40);expect(modeFrame.railScrollHeight).toBeLessThanOrEqual(modeFrame.railHeight+1);await expect(modeRail).toBeVisible();
  if(width===320)for(const name of ['주간 일정','월간 달력','칸반','직원별','프로젝트별','부서별','목표별','내 일정'])await expect(modes.getByRole('button',{name,exact:true})).toBeInViewport();
  await assertScheduleControls(toolbar);await assertScheduleControls(filters);
  await expect(toolbar.getByRole('button',{name:'내 일정',exact:true})).toHaveCount(0);
  const mine=modes.getByRole('button',{name:'내 일정',exact:true});
  await mine.click();await expect(mine).toHaveAttribute('aria-pressed','true');await expect(filters.getByLabel('담당자 필터')).toHaveValue('1');
  await expect.poll(()=>queries.some(q=>q.get('assigneeId')==='1')).toBe(true);await assertScheduleControls(modes,{minFields:0,minButtons:8});
  await modes.getByRole('button',{name:'직원별',exact:true}).click();await expect(mine).toHaveAttribute('aria-pressed','false');
  await filters.getByLabel('부서 필터').selectOption('1');
  await filters.getByLabel('프로젝트 필터').press('Space');const picker=page.getByRole('dialog',{name:'프로젝트 필터',exact:true});
  await picker.getByRole('searchbox').fill('ㄱㅈㅍㄹㅈㅌ');await picker.getByRole('option').click();
  await expect(filters.getByLabel('프로젝트 필터')).toHaveValue('10');await expect(filters.getByLabel('프로젝트 필터')).toBeFocused();
  await expect.poll(()=>queries.some(q=>q.get('departmentId')==='1'&&q.get('projectId')==='10'&&!q.has('assigneeId'))).toBe(true);
  await page.getByRole('button',{name:'프로젝트별',exact:true}).click();await expect(page.getByRole('button',{name:'프로젝트별',exact:true})).toHaveAttribute('aria-pressed','true');
  await assertScheduleControls(modes,{minFields:0,minButtons:8});
  expect(await page.evaluate(()=>localStorage.getItem('schedule.grouping'))).toBe('project');
  await toggle.focus();await page.keyboard.press('Enter');await expect(options).toBeVisible();await expect(toggle).toHaveAttribute('aria-controls','schedule-view-options');
  for(const name of ['상세 보기']){const input=options.getByRole('switch',{name}),control=input.locator('xpath=..');await expect(input).toHaveClass(/\bcw-checkbox\b/);await expect(control).toHaveClass(/\bcw-check-control\b/);expect((await input.boundingBox()).width).toBe(18);}
  await options.getByRole('switch',{name:'상세 보기'}).check();
  await expect(options.getByRole('switch',{name:'상세 보기'}).locator('xpath=..')).toHaveCSS('background-color',colors.active);await options.locator('.timeline-options').screenshot({path:info.outputPath('view-options-checkboxes.png'),animations:'disabled'});
  const height=options.getByRole('slider',{name:'직원 행 높이'});
  await expect(height).toHaveClass('cw-range');await expect(height).toHaveAttribute('min','36');await expect(height).toHaveAttribute('max','100');await expect(height).toHaveAttribute('step','4');
  const rangeFrame=await height.evaluate(node=>{
    const probe=document.createElement('span');probe.style.color='var(--cw-accent)';document.body.append(probe);
    const result={height:node.getBoundingClientRect().height,inside:node.getBoundingClientRect().right<=innerWidth+1,accent:getComputedStyle(node).accentColor,expectedAccent:getComputedStyle(probe).color,label:node.closest('.cw-range-field')?.textContent,control:node.parentElement?.classList.contains('cw-range-control'),output:node.parentElement?.querySelector('output')?.getAttribute('for')};probe.remove();return result;
  });
  expect(rangeFrame.height).toBeGreaterThanOrEqual(44);expect(rangeFrame.inside).toBe(true);expect(rangeFrame.accent).toBe(rangeFrame.expectedAccent);expect(rangeFrame.label).toContain('행 높이');expect(rangeFrame.control).toBe(true);expect(rangeFrame.output).toBe('schedule-row-height');
  await height.focus();await height.press('End');await expect(height).toHaveValue('100');await expect(options.locator('output[for="schedule-row-height"]')).toHaveText('100px');expect(await page.evaluate(()=>localStorage.getItem('schedule.rowHeight'))).toBe('100');
  await toolbar.getByLabel('표시 기간').selectOption('2');expect(await page.evaluate(()=>localStorage.getItem('schedule.visibleWeeks'))).toBe('2');
  expect(queries.every(q=>!q.has('dateBasis'))).toBe(true);
  await options.evaluate(node=>node.dataset.testIdentity='preserved');
  await toggle.click();await expect(options).toBeHidden();await toggle.click();await expect(options).toHaveAttribute('data-test-identity','preserved');await expect(height).toHaveValue('100');
  await expect(options.getByRole('switch',{name:'상세 보기'})).toBeChecked();
  // Changing a filter hides the options slot, not its controls or current values.
  const undated=filters.getByRole('button',{name:'날짜 미정 업무',exact:true});await undated.click();await expect(undated).toHaveAttribute('aria-pressed','true');await expect(options).toBeHidden();
  await expect.poll(()=>queries.some(q=>q.get('unscheduled')==='true'&&!q.has('from'))).toBe(true);
  await undated.click();await expect(options).toBeVisible();await expect(height).toHaveValue('100');
  await weekendCheck.check();await expect(weekendControl).toHaveCSS('background-color',colors.active);await weekendControl.screenshot({path:info.outputPath('weekend-filter-selected.png'),animations:'disabled'});
  for(const field of await filters.locator('.cw-form-field').all()){
    const widths=await field.evaluate(e=>({label:e.clientWidth,control:e.querySelector('select').getBoundingClientRect().width}));
    expect(Math.abs(widths.label-widths.control)).toBeLessThanOrEqual(1);
  }
  expect(await toolbar.locator('.date-range-button strong').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('board-controls.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  async function navigate(name){
    if(width===320)await page.locator('.cw-nav-toggle').click();
    await page.locator('.cw-sidebar').getByRole('link',{name,exact:true}).click();
  }
  await navigate('칸반');await expect(page).toHaveURL(/\/kanban$/);await expect(options).toBeHidden();
  await assertScheduleControls(toolbar,{minFields:0,minButtons:4});await assertScheduleControls(filters);
  const onlyWeekCheck=filters.getByRole('checkbox',{name:'선택한 주만'}),onlyWeekControl=onlyWeekCheck.locator('xpath=..');await expect(onlyWeekCheck).toHaveClass(/\bcw-checkbox\b/);await expect(onlyWeekControl).toHaveClass(/\bcw-check-control\b/);expect((await onlyWeekCheck.boundingBox()).width).toBe(18);await onlyWeekCheck.check();await expect(onlyWeekControl).toHaveCSS('background-color',colors.active);await onlyWeekControl.screenshot({path:info.outputPath('week-filter-selected.png'),animations:'disabled'});
  await expect.poll(()=>queries.some(q=>q.has('status')&&q.has('from')&&q.get('projectId')==='10')).toBe(true);
  await expect(page.getByLabel(task.title+' 상태 변경')).toHaveClass('cw-form-control');
  expect(await page.getByLabel(task.title+' 상태 변경').evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(120);
  await assertScheduleControls(page.locator('.kanban-person').filter({has:page.locator('select')}).first(),{minButtons:0});
  await page.screenshot({path:info.outputPath('kanban-controls.png'),animations:'disabled'});
  await navigate('개인 TODO');await expect(page).toHaveURL(/\/todos$/);
  await navigate('주간 일정');await expect(options).toBeVisible();await expect(height).toHaveValue('100');
  await expect(filters.getByLabel('프로젝트 필터')).toHaveValue('10');await expect(toolbar.getByLabel('표시 기간')).toHaveValue('2');
  await toggle.click();await expect(options).toBeHidden();await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const [width,theme] of [[320,'dark'],[1440,'light']])test(`monthly calendar and detailed my schedule stay responsive ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page),queries=[];
  const plannedTask={...task,scheduleItems:[{id:41,taskId:101,title:'상점 UI 장기 검수',date:'2026-09-07',endDate:'2026-09-10',createdBy:1,version:1,createdAt:task.createdAt,updatedAt:task.updatedAt}],sharedTodos:[{id:31,taskId:101,title:'상점 UI 정상화 재검증',createdBy:1,completedBy:null,completedAt:null,version:1,createdAt:task.createdAt,updatedAt:task.updatedAt}]};
  await page.route('**/api/tasks?*',route=>route.fulfill({json:{items:[plannedTask],total:1,editableIds:[101],commentCounts:[],attachmentCounts:[],scheduleItems:plannedTask.scheduleItems,sharedTodos:plannedTask.sharedTodos}}));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/tasks')queries.push(url.searchParams);});
  await page.goto('https://schedule.workspace.test/');const modes=page.locator('.schedule-mode-navigation');
  await modes.getByRole('button',{name:'월간 달력',exact:true}).click();
  await expect(page.getByRole('heading',{name:'월간 일정',exact:true})).toBeVisible();await expect(page.locator('.month-week-days>article')).toHaveCount(42);
  let ribbon=page.locator('.month-task').first();await expect(ribbon).toContainText(employee.name);expect(await ribbon.getAttribute('data-span-days')).toBe('5');expect(await page.locator('.month-task').count()).toBe(1);
  const contentOffset=await ribbon.evaluate(e=>e.querySelector('.month-task-heading').getBoundingClientRect().left-e.getBoundingClientRect().left);expect(contentOffset).toBeLessThan(20);
  let ribbonWidth=await ribbon.evaluate(e=>e.getBoundingClientRect().width),dayWidth=await page.locator('.month-week-days>article').nth(1).evaluate(e=>e.getBoundingClientRect().width);expect(ribbonWidth).toBeGreaterThan(dayWidth*4.5);
  await page.screenshot({path:info.outputPath('monthly-team-schedule.png'),animations:'disabled'});
  await modes.getByRole('button',{name:'주간 일정',exact:true}).click();await modes.getByRole('button',{name:'내 일정',exact:true}).click();
  const mine=width===320?page.locator('.mobile-week .mobile-task.with-task-details').first():page.locator('.desktop-week .timeline-task.with-task-details').first();
  await expect(mine.locator('.my-task-details')).toContainText('2026-09-07 ~ 2026-09-10 · 상점 UI 장기 검수');
  await expect(mine.locator('.my-task-details')).toContainText('○ 상점 UI 정상화 재검증');
  const placement=await mine.evaluate(node=>{const task=node.querySelector('.task-card').getBoundingClientRect(),details=node.querySelector('.my-task-details').getBoundingClientRect();return{taskBottom:task.bottom,detailsTop:details.top,wrap:getComputedStyle(node).flexWrap};});
  expect(placement.wrap).toBe('wrap');expect(placement.detailsTop).toBeGreaterThanOrEqual(placement.taskBottom-1);
  await modes.getByRole('button',{name:'월간 달력',exact:true}).click();
  await expect(page.getByRole('heading',{name:'내 월간 일정',exact:true})).toBeVisible();
  await expect(page.locator('.month-week-days>article')).toHaveCount(42);
  ribbon=page.locator('.month-task').first();await expect(ribbon).toContainText(task.body);await expect(ribbon).toContainText(employee.name);
  expect(await ribbon.getAttribute('data-span-days')).toBe('5');expect(await page.locator('.month-task').count()).toBe(1);
  ribbonWidth=await ribbon.evaluate(e=>e.getBoundingClientRect().width);dayWidth=await page.locator('.month-week-days>article').nth(1).evaluate(e=>e.getBoundingClientRect().width);expect(ribbonWidth).toBeGreaterThan(dayWidth*4.5);
  await expect.poll(()=>queries.some(query=>query.get('includePlanning')==='true'&&query.get('assigneeId')==='1')).toBe(true);
  await expect(page.locator('.month-week-days>article.calendar-holiday')).toContainText('검증 공휴일');
  await page.screenshot({path:info.outputPath('monthly-my-schedule.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('one major schedule shows its prototype, review, and update on separate calendar dates',async({page},info)=>{
  const f=await fixture(page),major={...milestone,id:9,title:'10월 업데이트',description:'단계별 공통 내용',type:'update',date:'2026-10-30',additionalSchedules:[{type:'prototype',date:'2026-10-10',endDate:null},{type:'review',date:'2026-10-20',endDate:'2026-10-22'}]};
  await page.emulateMedia({colorScheme:'dark'});
  await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
  await page.route('**/api/holidays?*',route=>route.fulfill({json:{holidays:[{date:'2026-10-21',name:'회사 등록 공휴일'}],available:true,updatedAt:task.updatedAt}}));
  await page.route('**/api/milestones?*',route=>{
    const query=new URL(route.request().url()).searchParams,from=query.get('from'),to=query.get('to');
    const visible=[{date:major.date,endDate:major.endDate},...major.additionalSchedules].some(schedule=>(schedule.endDate||schedule.date)>=from&&(schedule.endDate||schedule.date)<=to);
    const rows=visible?[major]:[];return route.fulfill({json:query.get('editing')==='true'?milestonePage(rows):rows});
  });
  await page.goto('https://schedule.workspace.test/');
  await expect(page.locator('.desktop-week .milestone-chip')).toContainText(['검수']);
  const weekMilestone=page.locator('.desktop-week .milestone-chip').first();
  await expect(weekMilestone).toContainText('마감까지 D-2');
  await expect(weekMilestone).toContainText('평일 D-1');
  expect(await weekMilestone.evaluate(element=>element.firstElementChild?.classList.contains('milestone-chip-heading'))).toBe(true);
  await expect(weekMilestone.locator('.milestone-type .milestone-countdown')).toContainText('마감까지 D-2');
  await expect(weekMilestone.locator('.milestone-chip-heading .milestone-countdown')).toHaveCount(0);
  await page.locator('.desktop-week .milestone-label button').click();
  await page.screenshot({path:info.outputPath('weekly-countdown-top.png'),animations:'disabled'});
  await page.getByRole('button',{name:'월간 달력',exact:true}).click();
  for(const [day,type] of [['2026-10-10','프로토타입'],['2026-10-22','검수'],['2026-10-30','업데이트']])
    await expect(page.locator(`.month-week-days article:has(time[datetime="${day}"]) .month-milestone`)).toContainText(type+' · 10월 업데이트');
  await expect(page.locator('.month-week-days article:has(time[datetime="2026-10-20"]) .month-milestone')).toHaveCount(0);
  await expect(page.locator('.month-week-days article:has(time[datetime="2026-10-30"]) .month-milestone')).toContainText('D-10평일 D-7');
  await page.screenshot({path:info.outputPath('monthly-countdown.png'),animations:'disabled'});
  await page.locator('.month-week-days article:has(time[datetime="2026-10-22"]) .month-milestone').click();
  await expect(page.locator('.schedule-settings')).toContainText('10월 업데이트');
  const summary=page.locator('.schedule-settings .settings-list .milestone-card').filter({hasText:'10월 업데이트'});
  await expect(summary).toContainText('프로토타입');await expect(summary).toContainText('검수');await expect(summary).toContainText('업데이트');
  await expect(summary).toContainText('마감 후 D+10');await expect(summary).toContainText('마감까지 D-2');await expect(summary).toContainText('마감까지 D-10');
  await expect(page.locator('.schedule-settings .milestone-editor')).toContainText('마감까지 D-10');
  const editor=page.locator('.schedule-settings .milestone-editor');
  await expect(editor.getByRole('heading',{name:'업데이트 마감',exact:true})).toBeVisible();
  await expect(editor.getByRole('heading',{name:'프로토타입 마감',exact:true})).toBeVisible();
  await expect(editor.getByRole('heading',{name:'검수 마감',exact:true})).toBeVisible();
  await expect(page.locator('.schedule-settings').getByRole('textbox',{name:'추가 일정 2 마감일'})).toHaveValue('2026-10-10');
  await page.screenshot({path:info.outputPath('milestone-management-schedules.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

async function todoFixture(page) {
  const base=await fixture(page),writes=[];
  let rows=[1,2].map(id=>({id,ownerId:1,title:`개인 검증 ${id}`,sortOrder:id,version:1,completedAt:null,createdAt:'2026-09-10T01:00:00Z',updatedAt:'2026-09-10T01:00:00Z'}));
  let failRead=false,failWrite='',hold=false,release,stateRevision=1;
  const state=()=>stateRevision.toString(16).padStart(64,'0');
  const envelope=(outcome,message,data,status=200)=>({status,contentType:'application/vnd.company.workspace-form+json',body:JSON.stringify({protocol:'workspace-form-v1',outcome,message,data})});
  await page.route(/\/api\/personal-todos(?:[/?].*)?$/,async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    if(method==='GET'){
      expect(req.headers().accept).toBe('application/json');if(failRead)return route.fulfill({status:503,json:{error:'격리 TODO 목록 장애'}});
      const visible=url.searchParams.get('archived')==='true'?[]:rows;
      if(url.pathname.endsWith('/editing')){const id=url.searchParams.get('id'),todos=id===null?visible:visible.filter(item=>item.id===Number(id));return route.fulfill({json:{actorId:'1',stateToken:state(),todos}});}
      return route.fulfill({json:visible});
    }
    const body=req.postDataJSON();writes.push({method,path:url.pathname,body,version:url.searchParams.get('version')});expect(req.headers()['x-csrf-token']).toBe('synthetic');expect(req.headers()['x-workspace-actor']).toBe('1');expect(req.headers()['x-workspace-todo-state']).toBe(state());expect(req.headers().accept).toBe('application/vnd.company.workspace-form+json');
    if(hold)await new Promise(resolve=>{release=resolve;});
    if(failWrite==='network')return route.abort();
    if(failWrite==='403'||failWrite==='409')return route.fulfill(envelope(failWrite==='403'?'denied':'conflict','격리 TODO 쓰기 거부',null,Number(failWrite)));
    const id=Number(url.pathname.split('/')[3]),item=rows.find(row=>row.id===id),deleted=item;let saved;
    if(method==='POST'){saved={...rows[0],id:10,title:body.title,version:1,sortOrder:10};rows.push(saved);}
    else if(url.pathname.endsWith('/order'))rows=body.ids.map((id,index)=>({...rows.find(row=>row.id===id),sortOrder:index+1}));
    else if(method==='DELETE')rows=rows.filter(row=>row.id!==id);
    else {saved={...item,title:body.title??item.title,completedAt:method==='PATCH'?(body.completed?'2026-09-10T03:00:00Z':null):item.completedAt,version:item.version+1};rows=rows.map(row=>row.id===id?saved:row);}
    if(failWrite==='partial')return route.fulfill({json:{success:true}});
    const previousStateToken=state();stateRevision++;
    const operation=method==='POST'?'add':url.pathname.endsWith('/order')?'order':method==='DELETE'?'delete':method==='PATCH'?'complete':'save';
    const data={operation,actorId:'1',previousStateToken,stateToken:state(),todo:saved??deleted??null,todos:operation==='order'||operation==='delete'?rows:null,deleted:operation==='delete'};
    return route.fulfill(envelope('saved','격리 TODO 저장 완료',data));
  });
  return {...base,writes,rows:()=>rows,setRows:value=>{rows=value;stateRevision++;},readFails:value=>{failRead=value;},writeFails:value=>{failWrite=value;},hold:()=>{hold=true;release=null;},get pending(){return Boolean(release);},release:()=>{hold=false;release?.();}};
}

for(const width of [320,1440])for(const theme of ['light','dark'])test(`personal TODO shared confirmations and acknowledged operations ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const native=[];page.on('dialog',dialog=>{native.push(dialog.message());void dialog.dismiss();});const f=await todoFixture(page);
  await page.goto('https://schedule.workspace.test/todos');const root=page.locator('.personal-todos'),row=id=>root.locator(`[data-todo-id="${id}"]`),modal=page.locator('.cw-confirm');
  const remove=row(1).getByRole('button',{name:'삭제',exact:true});await expect(remove).toBeEnabled();await assertScheduleControls(root);
  const checkColors=await page.evaluate(()=>{const probe=document.createElement('span');document.body.append(probe);const token=name=>{probe.style.backgroundColor=`var(--cw-${name})`;return getComputedStyle(probe).backgroundColor;};const result={raised:token('raised'),active:token('active')};probe.remove();return result;});
  const firstCheck=row(1).getByRole('checkbox'),firstCheckControl=firstCheck.locator('xpath=..');await expect(firstCheck).toHaveClass(/\bcw-checkbox\b/);await expect(firstCheckControl).toHaveClass(/\bcw-check-control\b/);expect((await firstCheck.boundingBox()).width).toBe(18);expect((await firstCheckControl.boundingBox()).height).toBeGreaterThanOrEqual(42);await expect(firstCheckControl).toHaveCSS('background-color',checkColors.raised);await firstCheckControl.screenshot({path:info.outputPath('todo-completion-checkbox.png'),animations:'disabled'});
  await root.getByRole('button',{name:'개인 검증 1 아래로 이동'}).hover();await assertScheduleControls(root);
  await remove.click();await expect(modal).toContainText('개인 검증 1');
  await page.screenshot({path:info.outputPath('todo-confirm.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(remove).toBeEnabled();await expect(remove).toBeFocused();expect(f.writes).toHaveLength(0);
  await row(1).getByRole('button',{name:'수정',exact:true}).click();const editInput=root.getByLabel('TODO 내용 수정');await editInput.fill('검토할 TODO 수정 초안');const cancel=root.getByRole('button',{name:'취소',exact:true});await cancel.click();await expect(modal).toContainText('검토할 TODO 수정 초안');
  await page.screenshot({path:info.outputPath('todo-edit-cancel.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(editInput).toHaveValue('검토할 TODO 수정 초안');await expect(cancel).toBeFocused();
  await cancel.click();await modal.getByRole('button',{name:'수정 취소',exact:true}).click();await expect(editInput).toHaveCount(0);await expect(row(1)).toContainText('개인 검증 1');expect(f.writes).toHaveLength(0);
  await row(1).getByRole('button',{name:'수정',exact:true}).click();await root.getByLabel('TODO 내용 수정').fill('전환 전에 지킬 초안');const switchEdit=row(2).getByRole('button',{name:'수정',exact:true});await expect(switchEdit).toBeEnabled();await switchEdit.click();await expect(modal).toContainText('전환 전에 지킬 초안');await expect(modal).toContainText('개인 검증 2');
  await page.screenshot({path:info.outputPath('todo-edit-switch.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(root.getByLabel('TODO 내용 수정')).toHaveValue('전환 전에 지킬 초안');await expect(switchEdit).toBeFocused();
  await switchEdit.click();await modal.getByRole('button',{name:'TODO 전환',exact:true}).click();await expect(root.getByLabel('TODO 내용 수정')).toHaveValue('개인 검증 2');await expect(row(1)).toContainText('개인 검증 1');await row(2).getByRole('button',{name:'취소',exact:true}).click();
  const newDraft=root.getByLabel('새 TODO',{exact:true});await newDraft.fill('탭 전환에도 유지할 새 초안');await row(1).getByRole('button',{name:'수정',exact:true}).click();await root.getByLabel('TODO 내용 수정').fill('탭 전환 전에 지킬 수정 초안');const archiveTab=root.getByRole('tab',{name:'보관함',exact:true});await archiveTab.click();await expect(modal).toContainText('탭 전환 전에 지킬 수정 초안');await expect(modal).toContainText('보관함');
  await page.screenshot({path:info.outputPath('todo-tab-switch.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(root.getByLabel('TODO 내용 수정')).toHaveValue('탭 전환 전에 지킬 수정 초안');await expect(archiveTab).toHaveAttribute('aria-selected','false');await expect(archiveTab).toBeFocused();
  await archiveTab.click();await modal.getByRole('button',{name:'목록 전환',exact:true}).click();await expect(archiveTab).toHaveAttribute('aria-selected','true');await expect(root).toContainText('보관된 TODO가 없습니다.');await root.getByRole('tab',{name:'할 일',exact:true}).click();await expect(newDraft).toHaveValue('탭 전환에도 유지할 새 초안');await expect(row(1)).toBeVisible();expect(f.writes).toHaveLength(0);
  await root.getByLabel('새 TODO',{exact:true}).fill('추가할 개인 항목 9223372036854775807');f.hold();await root.getByRole('button',{name:'추가',exact:true}).click();await expect.poll(()=>f.pending).toBe(true);
  await expect(root.getByLabel('새 TODO',{exact:true})).toBeDisabled();await assertScheduleControls(root);await root.locator('.todo-add').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);
  f.readFails(true);f.release();await expect(root).toContainText('변경은 완료되었지만 목록 갱신에 실패');await expect(root.getByLabel('새 TODO',{exact:true})).toHaveValue('');
  f.readFails(false);await root.getByRole('button',{name:'목록 다시 확인'}).click();await expect(row(10)).toContainText('9223372036854775807');expect(f.writes).toHaveLength(1);
  await row(10).getByRole('button',{name:'수정',exact:true}).click();await root.getByLabel('TODO 내용 수정').fill('수정한 할 일');await assertScheduleControls(root);await page.screenshot({path:info.outputPath('todo-edit.png'),animations:'disabled'});await root.getByRole('button',{name:'저장',exact:true}).click();await expect(row(10)).toContainText('수정한 할 일');await expect(row(10).getByRole('button',{name:'수정',exact:true})).toBeEnabled();
  await row(10).getByRole('checkbox').click();await expect(row(10).getByRole('checkbox')).toBeChecked();await expect(row(10).getByRole('checkbox')).toBeEnabled();await expect(row(10).getByRole('checkbox').locator('xpath=..')).toHaveCSS('background-color',checkColors.active);await row(10).getByRole('checkbox').locator('xpath=..').screenshot({path:info.outputPath('todo-completion-selected.png'),animations:'disabled'});
  await row(10).getByRole('checkbox').click();await expect(row(10).getByRole('checkbox')).not.toBeChecked();await expect(row(10).getByRole('checkbox')).toBeEnabled();
  await row(10).getByRole('button',{name:'수정한 할 일 위로 이동'}).click();await expect(root.locator('[data-todo-id]').nth(1)).toHaveAttribute('data-todo-id','10');await expect(row(10).getByRole('button',{name:'삭제',exact:true})).toBeEnabled();
  await row(10).getByRole('button',{name:'삭제',exact:true}).click();await modal.getByRole('button',{name:'TODO 삭제',exact:true}).click();await expect(row(10)).toHaveCount(0);await expect(root).toContainText('TODO를 삭제했습니다.');
  await page.screenshot({path:info.outputPath('todo-result.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(f.writes.map(w=>w.method)).toEqual(['POST','PUT','PATCH','PATCH','PUT','DELETE']);expect(native).toEqual([]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`personal TODO page navigation preserves every draft ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const native=[];page.on('dialog',dialog=>{native.push(dialog.message());void dialog.dismiss();});const f=await todoFixture(page);
  await page.goto('https://schedule.workspace.test/');if(width===320)await page.locator('.cw-nav-toggle').click();await page.locator('.cw-sidebar').getByRole('link',{name:'개인 TODO',exact:true}).click();await expect(page).toHaveURL(/\/todos$/);
  const root=page.locator('.personal-todos'),newDraft=root.getByLabel('새 TODO',{exact:true});await expect(root.locator('[data-todo-id="1"]')).toBeVisible();await newDraft.fill('이동 전에 지킬 새 TODO 초안');await root.locator('[data-todo-id="1"]').getByRole('button',{name:'수정',exact:true}).click();const editDraft=root.getByLabel('TODO 내용 수정');await editDraft.fill('이동 전에 지킬 수정 초안');
  if(width===320)await page.locator('.cw-nav-toggle').click();const week=page.locator('.cw-sidebar').getByRole('link',{name:'주간 일정',exact:true});await week.click();const discard=page.getByRole('dialog',{name:'작성 중인 TODO를 버리고 이동할까요?',exact:true});await expect(discard).toBeVisible();await expect(discard).toContainText('이동 전에 지킬 새 TODO 초안');await expect(discard).toContainText('이동 전에 지킬 수정 초안');await expect(discard).toContainText('개인 검증 1 (v1)');await expect(discard).toContainText('사이드바·링크');
  if(width===320&&theme==='dark')await page.screenshot({path:info.outputPath('todo-page-leave.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/todos$/);await expect(newDraft).toHaveValue('이동 전에 지킬 새 TODO 초안');await expect(editDraft).toHaveValue('이동 전에 지킬 수정 초안');
  await page.goBack();await expect(discard).toBeVisible();await expect(discard).toContainText('브라우저 이전·다음');await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/todos$/);await expect(newDraft).toHaveValue('이동 전에 지킬 새 TODO 초안');await expect(editDraft).toHaveValue('이동 전에 지킬 수정 초안');
  await page.goBack();await expect(discard).toBeVisible();await discard.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(page).toHaveURL('https://schedule.workspace.test/');await expect(root).toHaveCount(0);expect(f.writes).toHaveLength(0);expect(native).toEqual([]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('personal TODO polling never replaces an editing version and rejected saves preserve the draft',async({page})=>{
  const f=await todoFixture(page);await page.goto('https://schedule.workspace.test/todos');const root=page.locator('.personal-todos');await root.locator('[data-todo-id="1"]').getByRole('button',{name:'수정',exact:true}).click();
  const input=root.getByLabel('TODO 내용 수정');await input.fill('보존할 수정 초안');f.setRows(f.rows().map(row=>row.id===1?{...row,title:'서버의 새 제목',version:2}:row));
  await page.clock.fastForward(61000);await expect(input).toHaveValue('보존할 수정 초안');f.writeFails('409');await root.getByRole('button',{name:'저장',exact:true}).click();await expect(root).toContainText('TODO 내용이 변경');expect(f.writes).toHaveLength(0);
  await root.getByRole('button',{name:'목록 다시 확인'}).click();await expect(root).toContainText('편집 기준이 변경되었습니다');await expect(input).toHaveValue('보존할 수정 초안');await expect(root.getByRole('button',{name:'저장',exact:true})).toBeDisabled();
  await page.locator('.cw-sidebar').getByRole('link',{name:'주간 일정',exact:true}).click();await expect(page.getByRole('dialog',{name:'작성 중인 TODO를 버리고 이동할까요?',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/todos$/);await expect(input).toHaveValue('보존할 수정 초안');
  expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});

for(const failure of ['partial','network','403'])test(`personal TODO ${failure} write blocks repetition and preserves new input`,async({page})=>{
  const f=await todoFixture(page);await page.goto('https://schedule.workspace.test/todos');const root=page.locator('.personal-todos');await expect(root.getByRole('button',{name:'수정',exact:true}).first()).toBeEnabled();
  await root.getByLabel('새 TODO',{exact:true}).fill('미확정 입력');f.writeFails(failure);await root.getByRole('button',{name:'추가',exact:true}).click();await expect(root.getByRole('button',{name:'목록 다시 확인'})).toBeVisible();await expect(root.getByLabel('새 TODO',{exact:true})).toHaveValue('미확정 입력');await expect(root.getByRole('button',{name:'추가',exact:true})).toBeDisabled();
  await page.clock.fastForward(61000);expect(f.writes).toHaveLength(1);await expect(root.getByLabel('새 TODO',{exact:true})).toHaveValue('미확정 입력');expect(f.errors).toEqual([]);
});

test('personal TODO stale deletion and confirmed delete read failure never repeat writes',async({page})=>{
  const f=await todoFixture(page);await page.goto('https://schedule.workspace.test/todos');const root=page.locator('.personal-todos'),row=root.locator('[data-todo-id="1"]');await expect(row.getByRole('button',{name:'삭제',exact:true})).toBeEnabled();
  f.setRows(f.rows().map(item=>item.id===1?{...item,title:'변경된 제목',version:2}:item));await row.getByRole('button',{name:'삭제',exact:true}).click();await expect(root).toContainText('TODO 내용이 변경');await expect(page.locator('.cw-confirm')).toHaveCount(0);expect(f.writes).toHaveLength(0);
  await root.getByRole('button',{name:'목록 다시 확인'}).click();await row.getByRole('button',{name:'삭제',exact:true}).click();await expect(page.locator('.cw-confirm')).toContainText('변경된 제목');f.readFails(true);await page.locator('.cw-confirm').getByRole('button',{name:'TODO 삭제',exact:true}).click();
  await expect(root).toContainText('변경은 완료되었지만 목록 갱신에 실패');await expect(row.getByRole('button',{name:'삭제',exact:true})).toBeDisabled();expect(f.writes[0].version).toBe('2');
  f.readFails(false);await root.getByRole('button',{name:'목록 다시 확인'}).click();await expect(row).toHaveCount(0);expect(f.writes).toHaveLength(1);
  await root.getByRole('tab',{name:'보관함',exact:true}).click();await expect(root).toContainText('보관된 TODO가 없습니다.');await root.getByRole('tab',{name:'할 일',exact:true}).click();await expect(root.locator('[data-todo-id="2"]')).toBeVisible();expect(f.errors).toEqual([]);
});

test('personal TODO scope changes close confirmation and ignore delayed writes',async({page})=>{
  const f=await todoFixture(page);await page.goto('https://schedule.workspace.test/todos');const root=page.locator('.personal-todos');await root.locator('[data-todo-id="1"]').getByRole('button',{name:'삭제',exact:true}).click();await expect(page.locator('.cw-confirm')).toBeVisible();
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.locator('.cw-confirm')).toHaveCount(0);await expect(root).toContainText('로그인·권한이 변경');expect(f.writes).toHaveLength(0);
  await root.getByRole('button',{name:'목록 다시 확인'}).click();await root.getByLabel('새 TODO',{exact:true}).fill('늦은 응답 초안');f.hold();await root.getByRole('button',{name:'추가',exact:true}).click();await expect.poll(()=>f.pending).toBe(true);await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));f.release();
  await expect(root.getByLabel('새 TODO',{exact:true})).toBeEnabled();await expect(root.getByLabel('새 TODO',{exact:true})).toHaveValue('늦은 응답 초안');await expect(root.getByRole('button',{name:'추가',exact:true})).toBeDisabled();await expect(root.locator('[data-todo-id]')).toHaveCount(0);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`release identities show shared profiles, project icons and private labels ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);
  f.people([{...employee,id:2,name:'프로필 검증자',role:'employee',isAdmin:false,isPrivate:true}]);
  f.projects([{...project,id:20,name:'비공개 검증 프로젝트',isPrivate:true}]);
  f.directory.profiles={'2':'https://company.example.com/test-assets/release-actor.svg?v=1','99':'https://company.example.com/test-assets/unauthorized-actor.svg'};
  f.directory.projectIcons={'20':'https://company.example.com/test-assets/release-project.svg?v=1'};
  await page.route('**/test-assets/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="6" fill="#5261dc"/><circle cx="14" cy="14" r="7" fill="white"/></svg>'}));
  const record={id:70,projectId:20,baseVersion:770,minor:0,releasedOn:'2026-09-10',notes:'프로필 연결 검증',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,version:1,createdBy:2,updatedAt:'2026-09-10T03:00:00Z'};
  await page.route(/\/api\/release-series(?:\?.*)?$/,route=>{
    const allowed=new URL(route.request().url()).searchParams.get('projectId')==='20';
    return route.fulfill({json:{items:allowed?[{baseVersion:770,first:record,latest:record}]:[],total:allowed?1:0}});
  });
  await page.route(/\/api\/releases\/70\/history(?:\?.*)?$/,route=>route.fulfill({json:{items:[2,99,0].map((actorId,index)=>({id:index+1,actorId,releaseId:70,createdAt:record.updatedAt,snapshot:JSON.stringify({...record,...(actorId===0?{sourceReference:'https://example.test/legacy'}:{})})})),total:3}}));
  await page.goto('https://schedule.workspace.test/releases');await page.waitForFunction(()=>window.CompanyEntities);
  const projectSelect=page.getByRole('combobox',{name:'업데이트 버전 프로젝트'});await projectSelect.press('Space');
  const picker=page.getByRole('dialog',{name:'업데이트 버전 프로젝트',exact:true});await picker.getByRole('searchbox').fill('ㅂㄱㄱ');
  const option=picker.getByRole('option');await expect(option).toHaveCount(1);await expect(option).toContainText('비공개');
  await expect(option.locator('img')).toHaveAttribute('src',/release-project.svg/);
  await option.click();await expect(projectSelect).toHaveValue('20');await expect(projectSelect).toBeFocused();
  await page.screenshot({path:info.outputPath('release-list.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  if(width===320)expect(await page.locator('.release-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  await page.getByRole('button',{name:'770',exact:true}).click();
  const detail=page.locator('dialog.task-dialog'),identity=detail.locator('.release-project-identity');
  await expect(identity).toContainText('비공개 검증 프로젝트');await expect(identity.locator('img')).toHaveAttribute('src',/release-project.svg/);
  await page.screenshot({path:info.outputPath('release-project.png'),animations:'disabled'});
  await detail.getByRole('button',{name:'변경 이력 조회'}).click();
  const history=detail.locator('.release-history'),rows=history.locator('article');await expect(rows).toHaveCount(3);
  const actor=rows.nth(0).locator('.release-actor');await expect(actor).toContainText('프로필 검증자');await expect(actor).toContainText('비공개');
  await expect(actor.locator('img')).toHaveAttribute('src',/release-actor.svg\?v=1/);
  await expect(rows.nth(1)).toContainText('이전 직원');await expect(rows.nth(1).locator('img')).toHaveCount(0);
  await expect(rows.nth(1).locator('[data-workspace-entity-id]')).toHaveCount(0);
  await expect(rows.nth(2)).toContainText('기존 시트에서 이전');await expect(rows.nth(2).locator('[data-workspace-entity]')).toHaveCount(0);
  f.directory.profiles={'2':'https://company.example.com/test-assets/release-actor.svg?v=2'};
  await page.evaluate(()=>window.CompanyWorkspace.refresh());await expect(actor.locator('img')).toHaveAttribute('src',/release-actor.svg\?v=2/);
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('release-actors.png'),animations:'disabled'});
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(el=>el.right>innerWidth+1));
  await info.attach('overflow-elements',{body:JSON.stringify(overflow,null,2),contentType:'application/json'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth),JSON.stringify(overflow)).toBeLessThanOrEqual(width+1);
  const box=await detail.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`release lists share disclosure and recover failed reads ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const record={id:70,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',notes:'기본 패치 9223372036854775807',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:1,version:1,updatedAt:'2026-09-10T03:00:00Z'};
  const minor={...record,id:71,minor:1,status:'unstable',notes:'아주 긴 마이너 패치 설명 '.repeat(15),issue:'해결이 필요한 문제'},older={...record,id:72,minor:2};
  let fail=true;const minorReads=[];
  await page.route(/\/api\/release-series(?:\?.*)?$/,route=>fail?route.fulfill({status:503,json:{error:'격리 목록 장애'}}):route.fulfill({json:{items:[{baseVersion:770,first:record,latest:minor}],total:1}}));
  await page.route(/\/api\/releases(?:\?.*)?$/,route=>{const skip=Number(new URL(route.request().url()).searchParams.get('skip'));minorReads.push(skip);return route.fulfill({json:{items:skip?[older]:[minor,record],total:3}});});
  await page.route(/\/api\/legacy-releases(?:\?.*)?$/,route=>{const skip=Number(new URL(route.request().url()).searchParams.get('skip'));return route.fulfill({json:{items:[{id:30+skip,projectId:10,releasedOn:null,notes:skip?'이전 미기재 원문':'미기재 원문 9223372036854775807',issue:'',sourceReference:'https://example.test/legacy'}],total:2}});});
  await page.route(/\/api\/releases\/70\/history(?:\?.*)?$/,route=>route.fulfill({json:{items:[{id:1,releaseId:70,actorId:1,createdAt:record.updatedAt,snapshot:JSON.stringify(record)}],total:1}}));
  await page.goto('https://schedule.workspace.test/releases');const list=page.locator('.releases-page');
  await expect(list.locator('[data-state-kind="error"]')).toContainText('일정 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.');await expect(page.getByText('아직 등록된 버전이 없습니다.',{exact:true})).toHaveCount(0);
  fail=false;await list.getByRole('button',{name:'목록 다시 조회',exact:true}).click();const toggle=list.locator('.version-expand'),panel=list.locator('[data-cw-disclosure-panel="series"]');
  await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(panel).toBeVisible();
  await expect(panel.locator('.release-card')).toHaveCount(2);await expect(panel.getByRole('button',{name:'770.1 기록 수정',exact:true})).toContainText('수정');expect(await toggle.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'));await assertScheduleControls(list);
  const releasePalette=await page.evaluate(()=>{const p=document.createElement('span');document.body.append(p);p.style.cssText='color:var(--cw-danger);background:var(--cw-danger-bg)';const d=getComputedStyle(p),danger={color:d.color,background:d.backgroundColor};p.style.cssText='color:var(--cw-success);background:var(--cw-success-bg)';const s=getComputedStyle(p),success={color:s.color,background:s.backgroundColor};p.remove();return {danger,success};});const unstableBadge=panel.locator('.release-status[data-tone="danger"]'),stableBadge=panel.locator('.release-status[data-tone="success"]');await expect(unstableBadge).toContainText('불안정');await expect(stableBadge).toContainText('안정');for(const badge of [unstableBadge,stableBadge])await expect(badge).toHaveClass(/\bcw-state-pill\b/);await expect(unstableBadge).toHaveCSS('color',releasePalette.danger.color);await expect(unstableBadge).toHaveCSS('background-color',releasePalette.danger.background);await expect(stableBadge).toHaveCSS('color',releasePalette.success.color);await expect(stableBadge).toHaveCSS('background-color',releasePalette.success.background);
  await expect(list.locator('th').first()).toHaveCSS('padding-top','12px');
  for(const card of await panel.locator('.release-card').all()){const geometry=await card.evaluate(n=>({left:n.getBoundingClientRect().left,heading:n.firstElementChild.getBoundingClientRect().left,padding:parseFloat(getComputedStyle(n).paddingLeft)}));expect(geometry.heading-geometry.left).toBeLessThanOrEqual(geometry.padding+2);}
  const scroll=list.getByRole('region',{name:'프로젝트 업데이트 버전 표'});await expect(scroll).toHaveAttribute('tabindex','0');
  if(width<700){await scroll.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>scroll.evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);await scroll.evaluate(n=>n.scrollTo({left:0,behavior:'instant'}));}
  await panel.getByRole('button',{name:'이전 마이너 더 보기'}).click();await expect(panel.locator('.release-card')).toHaveCount(3);expect(minorReads).toEqual([0,2]);
  const detail=panel.locator('.cw-table-detail');await detail.scrollIntoViewIfNeeded();const box=await detail.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('release-list-expanded.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await toggle.focus();await page.keyboard.press('Space');await expect(panel).toBeHidden();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toHaveText('▸ 770');await page.keyboard.press('Enter');await expect(panel.locator('.release-card')).toHaveCount(2);
  const legacy=list.locator('.legacy-releases');await legacy.getByRole('button',{name:/버전 미기재 기록/}).click();await expect(legacy.locator('article')).toHaveCount(1);await legacy.getByRole('button',{name:'이전 기록 더 보기'}).click();await expect(legacy.locator('article')).toHaveCount(2);await expect(legacy).toContainText('9223372036854775807');
  await panel.getByRole('button',{name:'기본 버전 내용 수정'}).click();const editor=page.locator('dialog.task-dialog');await editor.getByRole('button',{name:'변경 이력 조회'}).click();
  const history=editor.locator('.release-history'),historyToggle=history.getByRole('button',{name:'당시 패치·조치 내용'});await historyToggle.click();await expect(history.locator('[data-cw-disclosure-panel="revision"]')).toBeVisible();await historyToggle.press('Space');await expect(history.locator('[data-cw-disclosure-panel="revision"]')).toBeHidden();
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('release lists reject malformed pages and discard delayed responses after a scope change',async({page})=>{
  const f=await fixture(page);let bad=true,releaseRead,hold=false;
  const record={id:70,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',notes:'이전 계정 기록',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:1,version:1,updatedAt:'2026-09-10T03:00:00Z'};
  await page.route(/\/api\/release-series(?:\?.*)?$/,async route=>{if(hold)await new Promise(resolve=>{releaseRead=resolve;});return route.fulfill({json:bad?{success:true}:{items:[{baseVersion:770,first:record,latest:record}],total:1}});});
  await page.goto('https://schedule.workspace.test/releases');await expect(page.locator('.releases-page [data-state-kind="error"]')).toContainText('버전 목록 응답이 올바르지 않습니다.');
  bad=false;hold=true;await page.getByRole('button',{name:'목록 다시 조회',exact:true}).click();await expect.poll(()=>Boolean(releaseRead)).toBe(true);await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));hold=false;releaseRead();
  await expect(page.locator('.releases-page > [data-workspace-feedback]')).toContainText('로그인·권한이 변경되었습니다.');await expect(page.locator('.release-table tbody')).toHaveCount(0);
  await page.locator('.releases-page > [data-workspace-feedback]').getByRole('button',{name:'목록 다시 조회'}).click();await expect(page.locator('.release-table tbody')).toHaveCount(1);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

async function releaseEditorFixture(page) {
  const base=await fixture(page),writes=[];
  let record={id:70,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',releasedOnUnknown:false,sourceReference:'',notes:'원래 패치 내용',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:1,version:1,updatedAt:'2026-09-10T03:00:00Z'};
  let failList=false,failure='',hold=false,releasePending,deleted=false;
  const token=value=>(value?'a':'c').repeat(64),media='application/vnd.company.workspace-form+json';
  await page.route(/\/api\/release-series(?:\?.*)?$/,route=>failList?route.fulfill({status:503,json:{error:'격리 목록 장애'}}):route.fulfill({json:{items:deleted?[]:[{baseVersion:record.baseVersion,first:record,latest:record}],total:deleted?0:1}}));
  await page.route(/\/api\/releases(?:\/(?:\d+|editing))?(?:\?.*)?$/,async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()==='GET'){
      if(path==='/api/releases/editing'){const id=new URL(req.url()).searchParams.has('id');return route.fulfill({json:{actorId:'1',stateToken:token(id),record:id?record:null}});}
      return route.fulfill({json:path==='/api/releases'?{items:[record],total:1}:record});
    }
    const body=req.postDataJSON(),previous=req.headers()['x-workspace-release-state'];writes.push({method:req.method(),body});expect(req.headers()['x-csrf-token']).toBe('synthetic');expect(req.headers()['x-workspace-actor']).toBe('1');expect(previous).toBe(token(req.method()!=='POST'));
    if(hold)await new Promise(resolve=>{releasePending=resolve;});
    if(failure==='network')return route.abort();
    if(failure==='html')return route.fulfill({contentType:'text/html',body:'<html>Sign in</html>'});
    if(failure==='partial')return route.fulfill({json:{success:true}});
    if(failure){const status=Number(failure),outcome=status===409?'conflict':status===403?'denied':'unknown';return route.fulfill({status,contentType:media,json:{protocol:'workspace-form-v1',outcome,message:'격리 쓰기 거부'}});}
    if(req.method()!=='POST'&&body.version!==record.version)return route.fulfill({status:409,contentType:media,json:{protocol:'workspace-form-v1',outcome:'conflict',message:'다른 사람이 수정했습니다.'}});
    if(req.method()==='DELETE'){deleted=true;return route.fulfill({contentType:media,json:{protocol:'workspace-form-v1',outcome:'saved',message:'업데이트 버전을 삭제했습니다.',data:{operation:'delete',actorId:'1',previousStateToken:previous,stateToken:'b'.repeat(64),release:record,deleted:true}}});}
    record={...record,...body,id:body.id||80,version:req.method()==='POST'?1:record.version+1,notes:body.notes.trim(),issue:body.issue.trim()};
    return route.fulfill({contentType:media,json:{protocol:'workspace-form-v1',outcome:'saved',message:'업데이트 버전을 저장했습니다.',data:{operation:req.method()==='POST'?'create':'update',actorId:'1',previousStateToken:previous,stateToken:'b'.repeat(64),release:record,deleted:false}}});
  });
  return {...base,writes,change:patch=>{record={...record,...patch};},failList:value=>{failList=value;},fail:value=>{failure=value;},hold:()=>{hold=true;releasePending=null;},get pending(){return Boolean(releasePending);},release:()=>{hold=false;releasePending?.();}};
}

test('release editor deletes an existing record only after explicit acknowledgement',async({page})=>{
  const f=await releaseEditorFixture(page);await page.goto('https://schedule.workspace.test/releases');await page.getByRole('button',{name:'770',exact:true}).click();
  let panel=page.locator('dialog.task-dialog'),remove=panel.getByRole('button',{name:'업데이트 버전 삭제',exact:true});await expect(remove).toBeEnabled();await remove.click();
  let confirmation=page.getByRole('dialog',{name:'버전 770.0 기록을 삭제할까요?',exact:true});await expect(confirmation).toContainText('복구할 수 없습니다');await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);expect(f.writes).toHaveLength(0);await expect(panel).toBeVisible();
  await remove.click();confirmation=page.getByRole('dialog',{name:'버전 770.0 기록을 삭제할까요?',exact:true});await confirmation.locator('[data-confirm-apply]').click();
  await expect(panel).toHaveCount(0);await expect(page.locator('.release-table tbody')).toHaveCount(0);expect(f.writes).toEqual([{method:'DELETE',body:{version:1}}]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`release editor shared review and acknowledged save ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await releaseEditorFixture(page);
  await page.goto('https://schedule.workspace.test/releases');await page.getByRole('button',{name:'770',exact:true}).click();
  const panel=page.locator('dialog.task-dialog'),notes=panel.getByRole('textbox',{name:'패치 내용',exact:true}),save=panel.getByRole('button',{name:'업데이트 버전 저장',exact:true}),compare=panel.getByRole('button',{name:'버전 변경 비교',exact:true}),review=page.locator('dialog.cw-review');
  await notes.fill('내 변경 9223372036854775807');await assertScheduleControls(panel);await page.screenshot({path:info.outputPath('release-edit.png'),animations:'disabled'});f.change({notes:'서버 변경',issue:'서버의 추가 메모',version:2});
  await save.click();await expect(panel).toContainText('다른 사람이 업데이트 버전을 수정했습니다.');expect(f.writes).toHaveLength(0);await expect(notes).toHaveValue('내 변경 9223372036854775807');
  await compare.click();await expect(review).toBeVisible();await expect(review.locator('[data-review-field="notes"]')).toHaveAttribute('data-conflict','true');await expect(review.locator('[data-review-apply]')).toBeDisabled();
  await page.screenshot({path:info.outputPath('release-review.png'),animations:'disabled'});expect(await review.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.keyboard.press('Escape');await expect(review).toHaveCount(0);await expect(notes).toHaveValue('내 변경 9223372036854775807');await expect(compare).toBeFocused();
  await compare.click();await review.locator('[data-review-field="notes"] select').selectOption('draft');await review.locator('[data-review-apply]').click();await expect(panel).toContainText('아직 저장하지 않았습니다.');
  expect(f.writes).toHaveLength(0);await expect(notes).toHaveValue('내 변경 9223372036854775807');
  f.failList(true);f.hold();await save.click();await page.getByRole('dialog',{name:'업데이트 버전 변경을 저장할까요?',exact:true}).locator('[data-confirm-apply]').click();await expect.poll(()=>f.pending).toBe(true);await expect(notes).toBeDisabled();await assertScheduleControls(panel);await panel.locator('form').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);
  await page.keyboard.press('Escape');await expect(panel).toBeVisible();f.release();await expect(panel).toContainText('업데이트 버전은 저장되었습니다.');await expect(save).toBeDisabled();expect(f.writes[0].body.version).toBe(2);expect(f.writes[0].body.issue).toBe('서버의 추가 메모');
  f.failList(false);await panel.getByRole('button',{name:'목록 다시 확인'}).click();await expect(panel).toContainText('저장된 버전 목록을 확인했습니다.');expect(f.writes).toHaveLength(1);
  await page.screenshot({path:info.outputPath('release-saved.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])for(const trigger of ['button','escape','native-close'])test(`release async draft close ${trigger} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await releaseEditorFixture(page),native=[];
  page.on('dialog',async dialog=>{native.push(dialog.message());await dialog.dismiss();});
  await page.goto('https://schedule.workspace.test/releases');const opener=page.getByRole('button',{name:'770',exact:true});await opener.click();
  const panel=page.locator('dialog.task-dialog'),notes=panel.getByRole('textbox',{name:'패치 내용',exact:true}),close=panel.getByRole('button',{name:'업데이트 버전 닫기'}),confirm=page.getByRole('dialog',{name:'버전 초안 버리기',exact:true});
  await notes.fill('유지할 버전 초안 9223372036854775807');
  if(trigger==='button')await close.click();else if(trigger==='escape')await page.keyboard.press('Escape');else await panel.evaluate(node=>node.close());
  await expect(confirm).toBeVisible();await expect(panel).toBeVisible();await expect(notes).toBeDisabled();await expect(confirm).toContainText('770.0');
  await expect(panel.getByText('저장 중…',{exact:true})).toHaveCount(0);await expect(panel.locator('[data-state-kind="loading"]')).toHaveCount(0);
  await close.evaluate(node=>node.click());await expect(confirm).toHaveCount(1);expect(f.writes).toHaveLength(0);
  await page.screenshot({path:info.outputPath('draft-close.png'),animations:'disabled'});expect(await confirm.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(notes).toBeEnabled();await expect(notes).toHaveValue('유지할 버전 초안 9223372036854775807');
  await close.click();await confirm.locator('[data-confirm-apply]').click();await expect(panel).toHaveCount(0);await expect(opener).toBeFocused();
  expect(f.writes).toHaveLength(0);expect(native).toEqual([]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('release async close aborts pending intent on scope change without losing the retained draft',async({page})=>{
  const f=await releaseEditorFixture(page);await page.goto('https://schedule.workspace.test/releases');await page.getByRole('button',{name:'770',exact:true}).click();
  const panel=page.locator('dialog.task-dialog'),notes=panel.getByRole('textbox',{name:'패치 내용',exact:true});await notes.fill('계정 변경 중 유지할 초안');
  await panel.getByRole('button',{name:'업데이트 버전 닫기'}).click();await expect(page.getByRole('dialog',{name:'버전 초안 버리기',exact:true})).toBeVisible();
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await expect(page.getByRole('dialog',{name:'버전 초안 버리기',exact:true})).toHaveCount(0);await expect(panel).toBeVisible();await expect(notes).toBeEnabled();await expect(notes).toHaveValue('계정 변경 중 유지할 초안');
  await expect(panel.getByRole('button',{name:'업데이트 버전 저장',exact:true})).toBeDisabled();expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});

for(const failure of ['partial','network','html','403','409','500'])test(`release editor ${failure} blocks duplicate saves and preserves draft`,async({page})=>{
  const f=await releaseEditorFixture(page);await page.goto('https://schedule.workspace.test/releases');await page.getByRole('button',{name:'770',exact:true}).click();const panel=page.locator('dialog.task-dialog'),notes=panel.getByRole('textbox',{name:'패치 내용',exact:true});
  await notes.fill('오류 뒤 보존할 초안');f.fail(failure);await panel.getByRole('button',{name:'업데이트 버전 저장',exact:true}).click();await page.getByRole('dialog',{name:'업데이트 버전 변경을 저장할까요?',exact:true}).locator('[data-confirm-apply]').click();await expect(panel.getByRole('button',{name:'업데이트 버전 저장',exact:true})).toBeDisabled();await expect(notes).toHaveValue('오류 뒤 보존할 초안');await expect(notes).toBeEnabled();
  await panel.locator('form').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);
  await panel.getByRole('button',{name:'업데이트 버전 닫기'}).click();const confirmation=page.getByRole('dialog',{name:'버전 초안 버리기',exact:true});await expect(confirmation).toBeVisible();await confirmation.locator('[data-confirm-cancel]').click();await expect(confirmation).toHaveCount(0);await expect(panel).toBeVisible();await expect(notes).toHaveValue('오류 뒤 보존할 초안');
  expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('release editor scope changes close review and navigation cancellation retains draft',async({page})=>{
  const f=await releaseEditorFixture(page);await page.goto('https://schedule.workspace.test/');await page.locator('.cw-sidebar').getByRole('link',{name:'업데이트 버전',exact:true}).click();await page.getByRole('button',{name:'770',exact:true}).click();const panel=page.locator('dialog.task-dialog'),notes=panel.getByRole('textbox',{name:'패치 내용',exact:true});
  await notes.fill('계정 변경 중 초안');await page.goBack();const discard=page.getByRole('dialog',{name:'버전 초안 버리기',exact:true});await expect(discard).toBeVisible();await discard.locator('[data-confirm-cancel]').click();await expect(page).toHaveURL(/\/releases$/);await expect(notes).toHaveValue('계정 변경 중 초안');
  await panel.getByRole('button',{name:'버전 변경 비교'}).click();await expect(page.locator('dialog.cw-review')).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.locator('dialog.cw-review')).toHaveCount(0);await expect(notes).toHaveValue('계정 변경 중 초안');
  await expect(panel).toContainText('로그인·권한이 변경되었습니다.');await expect(panel.getByRole('button',{name:'업데이트 버전 저장',exact:true})).toBeDisabled();expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('release editor ignores a late save response after scope change',async({page})=>{
  const f=await releaseEditorFixture(page);await page.goto('https://schedule.workspace.test/releases');await page.getByRole('button',{name:'770',exact:true}).click();const panel=page.locator('dialog.task-dialog'),notes=panel.getByRole('textbox',{name:'패치 내용',exact:true});
  await notes.fill('전송 중 보존할 초안');f.hold();await panel.getByRole('button',{name:'업데이트 버전 저장',exact:true}).click();await page.getByRole('dialog',{name:'업데이트 버전 변경을 저장할까요?',exact:true}).locator('[data-confirm-apply]').click();await expect.poll(()=>f.pending).toBe(true);
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));f.release();await expect(panel).toContainText('로그인·권한이 변경되었습니다.');await expect(notes).toHaveValue('전송 중 보존할 초안');await expect(notes).toBeEnabled();await expect(panel.getByRole('button',{name:'업데이트 버전 저장',exact:true})).toBeDisabled();expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`release async history preserves cancelled multi-step back and forward entries ${width}px ${theme}`,async({page},info)=>{
  const f=await releaseEditorFixture(page),native=[];page.on('dialog',async dialog=>{native.push(dialog.message());await dialog.dismiss();});
  await page.setViewportSize({width:1440,height:900});await page.goto('https://schedule.workspace.test/');
  await page.locator('[data-workspace-page="schedule.kanban"]').click();await expect(page).toHaveURL(/\/kanban$/);
  await page.locator('[data-workspace-page="schedule.releases"]').click();await expect(page).toHaveURL(/\/releases$/);
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});await page.getByRole('button',{name:'770',exact:true}).click();
  const notes=page.getByRole('textbox',{name:'패치 내용',exact:true}),discard=page.getByRole('dialog',{name:'버전 초안 버리기',exact:true});await notes.fill('방문 기록과 함께 지킬 초안');
  await page.evaluate(()=>history.go(-2));await expect(discard).toBeVisible();await expect(page).toHaveURL(/\/releases$/);await expect(notes).toBeDisabled();
  await page.screenshot({path:info.outputPath('history-draft.png'),animations:'disabled'});await discard.locator('[data-confirm-cancel]').click();
  await expect(notes).toBeEnabled();await expect(notes).toHaveValue('방문 기록과 함께 지킬 초안');await expect(page).toHaveURL(/\/releases$/);
  await page.evaluate(()=>history.go(-2));await expect(discard).toBeVisible();await discard.locator('[data-confirm-apply]').click();
  await expect(page).toHaveURL('https://schedule.workspace.test/');await expect(page.locator('dialog.task-dialog')).toHaveCount(0);
  await page.goForward();await expect(page).toHaveURL(/\/kanban$/);await page.goForward();await expect(page).toHaveURL(/\/releases$/);
  expect(native).toEqual([]);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const interruption of ['scope','second-back'])test(`release async navigation ${interruption} cancels stale intent and retains the editor`,async({page})=>{
  const f=await releaseEditorFixture(page);await page.goto('https://schedule.workspace.test/');await page.locator('[data-workspace-page="schedule.releases"]').click();await page.getByRole('button',{name:'770',exact:true}).click();
  const notes=page.getByRole('textbox',{name:'패치 내용',exact:true}),discard=page.getByRole('dialog',{name:'버전 초안 버리기',exact:true});await notes.fill('이전 승인으로 지우지 않을 초안');
  // Same route request as the common sidebar, dispatched while its parent is inert.
  await page.locator('[data-workspace-page="schedule.kanban"]').evaluate(node=>node.click());await expect(discard).toBeVisible();await expect(page).toHaveURL(/\/releases$/);
  if(interruption==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));else await page.goBack();
  await expect(discard).toHaveCount(0);await expect(page).toHaveURL(/\/releases$/);await expect(notes).toBeEnabled();await expect(notes).toHaveValue('이전 승인으로 지우지 않을 초안');
  expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('release editor creation adopts the saved ID and never repeats an uncertain POST',async({page})=>{
  const f=await releaseEditorFixture(page);await page.goto('https://schedule.workspace.test/releases');await page.getByRole('button',{name:'＋ 기본 버전 등록',exact:true}).click();const panel=page.locator('dialog.task-dialog'),notes=panel.getByRole('textbox',{name:'패치 내용',exact:true});
  await notes.fill('새 버전');await panel.getByRole('button',{name:'업데이트 버전 저장',exact:true}).click();await page.getByRole('dialog',{name:'새 업데이트 버전을 등록할까요?',exact:true}).locator('[data-confirm-apply]').click();await expect(panel).toContainText('업데이트 버전을 저장했습니다.');await expect(panel.getByRole('button',{name:'버전 변경 비교'})).toBeVisible();expect(f.writes[0].method).toBe('POST');await panel.getByRole('button',{name:'업데이트 버전 닫기'}).click();
  await page.getByRole('button',{name:'＋ 기본 버전 등록',exact:true}).click();await notes.fill('미확정 새 버전');f.fail('partial');await panel.getByRole('button',{name:'업데이트 버전 저장',exact:true}).click();await page.getByRole('dialog',{name:'새 업데이트 버전을 등록할까요?',exact:true}).locator('[data-confirm-apply]').click();await expect(panel).toContainText('저장 결과를 확인하지 못했습니다.');await expect(notes).toHaveValue('미확정 새 버전');await panel.locator('form').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(2);expect(f.errors).toEqual([]);
});

test('release editor discards stale history after saves and reports malformed history without crashing',async({page})=>{
  const f=await releaseEditorFixture(page);let releaseRead,hold=true,bad='';
  const snapshot={id:70,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',notes:'저장 이전 패치',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:1,version:1,updatedAt:'2026-09-10T03:00:00Z'};
  await page.route(/\/api\/releases\/70\/history(?:\?.*)?$/,async route=>{const value={items:[{id:1,releaseId:70,actorId:1,createdAt:bad==='timestamp'?42:snapshot.updatedAt,snapshot:bad==='json'?'invalid-json':JSON.stringify(snapshot)}],total:1};if(hold)await new Promise(resolve=>{releaseRead=resolve;});return route.fulfill({json:value});});
  await page.goto('https://schedule.workspace.test/releases');await page.getByRole('button',{name:'770',exact:true}).click();const panel=page.locator('dialog.task-dialog');
  await panel.getByRole('button',{name:'변경 이력 조회'}).click();await expect.poll(()=>Boolean(releaseRead)).toBe(true);await panel.getByRole('textbox',{name:'패치 내용',exact:true}).fill('새 저장 내용');await panel.getByRole('button',{name:'업데이트 버전 저장',exact:true}).click();await page.getByRole('dialog',{name:'업데이트 버전 변경을 저장할까요?',exact:true}).locator('[data-confirm-apply]').click();await expect(panel).toContainText('업데이트 버전을 저장했습니다.');hold=false;releaseRead();await expect(panel.locator('.release-history article')).toHaveCount(0);
  bad='json';await panel.getByRole('button',{name:'변경 이력 조회'}).click();await expect(panel.locator('[data-state-kind="error"]')).toContainText('변경 이력을 해석하지 못했습니다.');await expect(panel.getByRole('textbox',{name:'패치 내용',exact:true})).toHaveValue('새 저장 내용');
  bad='timestamp';await panel.getByRole('button',{name:'변경 이력 조회'}).click();await expect(panel.locator('[data-state-kind="error"]')).toContainText('변경 이력 확인 정보가 일치하지 않습니다.');expect(f.errors).toEqual([]);
});

async function fixture(page,role='admin') {
  const errors=[],writes=[],unhandled=[],directory={profiles:{},projectIcons:{}};let documents=0,currentRole=role,extraPeople=[],extraProjects=[],demoMode=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-10T03:00:00Z'));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documents++;
    const me={...employee,role:currentRole==='admin'?'admin':'employee',isAdmin:currentRole==='admin'};
    if(path==='/api/workspace/context')return route.fulfill({json:{authenticated:true,user:me,services:[{key:'schedule',name:'팀 일정',href:'/workspace/schedule'}],...directory,projects:[],employees:[],csrfToken:'synthetic'}});
      if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
      if(url.origin==='https://company.example.com'&&path==='/images/company-logo.png')return route.fulfill({body:readFileSync(resolve(root,'apps/portal/wwwroot/images/company-logo.png')),contentType:'image/png'});
    if(request.method()!=='GET'){writes.push(path);return route.abort();}
    if(path==='/api/bootstrap')return route.fulfill({json:{me,employees:[me,...extraPeople],projects:[project,...extraProjects],departments:[{id:1,name:'개발',archived:false}],leads:currentRole==='lead'?[{id:1,employeeId:1,department:'개발',departmentId:1}]:[],demo:demoMode,csrfToken:'synthetic'}});
    if(path==='/api/tasks/101')return route.fulfill({json:withTaskWriteState({task,canEdit:true,comments:[{id:7,taskId:101,authorId:1,parentId:null,body:'상세 링크 검증 댓글',deleted:false,version:1,createdAt:task.createdAt,editedAt:null}],attachments:[],history:[]})});
    if(path==='/api/tasks'){
      const items=url.searchParams.has('status')&&url.searchParams.get('status')!=='planned'?[]:[task];
      return route.fulfill({json:{items,total:items.length,editableIds:items.map(t=>t.id),commentCounts:items.map(t=>({taskId:t.id,count:1})),attachmentCounts:[]}});
    }
    const inRange=date=>(!url.searchParams.has('from')||date>=url.searchParams.get('from'))&&(!url.searchParams.has('to')||date<=url.searchParams.get('to'));
    if(path==='/api/milestones'){const rows=[milestone].filter(m=>inRange(m.date));return route.fulfill({json:url.searchParams.get('editing')==='true'?milestonePage(rows):rows});}
    if(/^\/api\/milestones\/\d+\/history$/.test(path))return route.fulfill({json:milestoneHistory(milestone)});
    if(path==='/api/absences')return route.fulfill({json:{items:[],holidays:[{date:'2026-09-09',name:'검증 공휴일'}].filter(h=>inRange(h.date)),available:true,holidaysAvailable:true,updatedAt:task.updatedAt}});
    if(path==='/api/holidays')return route.fulfill({json:{holidays:[{date:'2026-09-09',name:'검증 공휴일'}].filter(h=>inRange(h.date)),available:true,updatedAt:task.updatedAt}});
    if(path==='/api/feedback/badge')return route.fulfill({json:{count:0}});
    if(path==='/api/personal-todos')return route.fulfill({json:[]});
    if(['/api/release-series','/api/releases','/api/legacy-releases'].includes(path))return route.fulfill({json:{items:[],total:0}});
    const shared={
      '/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js',
      '/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js',
      '/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css'
    }[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    const isPage=definitions.some(p=>[p.path,...p.aliases||[]].includes(path))||/^\/tasks\/[1-9]\d*$/.test(path);
    const file=resolve(clientRoot,isPage?'index.html':path.slice(1));
    if(file.startsWith(clientRoot+sep)&&existsSync(file)&&['.html','.js','.css'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css'}[extname(file)]});
    unhandled.push(path);return route.abort();
  });
  return {errors,writes,unhandled,directory,documents:()=>documents,role:value=>{currentRole=value;},people:value=>{extraPeople=value;},projects:value=>{extraProjects=value;},demo:value=>{demoMode=value;}};
}

for(const [width,theme] of [[390,'dark'],[1440,'light']])test(`offscreen schedule hints stay visible and navigate ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  await page.addInitScript(()=>{localStorage.setItem('schedule.openFixedWeek','true');localStorage.setItem('schedule.openProjectWidth','100');localStorage.setItem('schedule.openTaskWidth','200');localStorage.setItem('schedule.openColumnWidth','64');localStorage.setItem('schedule.openColor.planned','#8a4fff');localStorage.setItem('schedule.openTextColor.planned','#fff2a8');});
  const f=await fixture(page),rows=[{...task,id:201,title:'이전 미완료 업무',startDate:'2026-08-31',endDate:'2026-09-04',status:'progress'},{...task,id:202,title:'양쪽으로 이어지는 업무',startDate:'2026-09-01',endDate:'2026-09-18',status:'progress'},{...task,id:203,title:'다음 주 이후 업무',startDate:'2026-09-21',endDate:'2026-09-25',status:'planned'}];
  await page.route('**/api/tasks?*',route=>{const status=new URL(route.request().url()).searchParams.get('status'),items=rows.filter(value=>!status||value.status===status);return route.fulfill({json:{items,total:items.length,editableIds:items.map(value=>value.id),commentCounts:[],attachmentCounts:[]}});});
  await page.goto('https://schedule.workspace.test/');const board=page.locator('.open-schedule-scroll');await expect(board).toBeVisible();
  const previous=page.getByRole('button',{name:/이전 미완료 업무.*이전 일정으로 이동/}),next=page.getByRole('button',{name:/다음 주 이후 업무.*이후 일정으로 이동/});
  await expect(previous).toHaveText('← 이전 · 08.31–09.04');await expect(next).toHaveText('09.21–09.25 · 이후 →');
  await expect(page.locator('.open-schedule-bar.continues-before.continues-after')).toHaveCount(1);await expect(page.locator('.open-schedule-bar-arrow')).toHaveCount(0);await expect(page.locator('.open-schedule-continuation')).toHaveCount(0);
  const geometry=await page.evaluate(()=>{const taskCell=document.querySelector('.open-schedule-task-cell').getBoundingClientRect(),marker=document.querySelector('.open-schedule-offscreen.before').getBoundingClientRect(),viewport=document.querySelector('.open-schedule-scroll').getBoundingClientRect(),label=document.querySelector('.open-schedule-bar.continues-before.continues-after .open-schedule-bar-label'),title=label.querySelector('.open-schedule-bar-title').getBoundingClientRect(),labelRect=label.getBoundingClientRect(),style=getComputedStyle(label),before=getComputedStyle(label,'::before'),after=getComputedStyle(label,'::after');return{taskRight:taskCell.right,markerLeft:marker.left,markerRight:marker.right,viewportRight:viewport.right,labelLeft:labelRect.left,labelRight:labelRect.right,titleLeft:title.left,titleRight:title.right,paddingLeft:parseFloat(style.paddingLeft),paddingRight:parseFloat(style.paddingRight),before:before.content,after:after.content};});
  expect(geometry.markerLeft).toBeGreaterThanOrEqual(geometry.taskRight-1);expect(geometry.markerRight).toBeLessThanOrEqual(geometry.viewportRight+1);expect(geometry.before).toBe('"←"');expect(geometry.after).toBe('"→"');expect(geometry.titleLeft).toBeGreaterThanOrEqual(geometry.labelLeft+geometry.paddingLeft-1);expect(geometry.titleRight).toBeLessThanOrEqual(geometry.labelRight-geometry.paddingRight+1);
  await expect(next).toHaveCSS('background-color','rgb(138, 79, 255)');await expect(next).toHaveCSS('color','rgb(255, 242, 168)');await page.screenshot({path:info.outputPath('offscreen-hints.png'),animations:'disabled'});
  await next.click();await expect(page.locator('.open-schedule-day b').first()).toHaveText('21');await expect(page.locator('.open-schedule-bar')).toContainText('다음 주 이후 업무');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('goal manager creates again after reopening and goal grouping filters the board',async({page},info)=>{
  await page.setViewportSize({width:1440,height:900});await page.emulateMedia({colorScheme:'dark'});const f=await fixture(page),writes=[],updates=[];
  let nextId=2,goals=[{id:1,title:'기존 목표',description:'연결 업무를 한곳에서 확인합니다.',projectId:10,createdBy:1,closedAt:null,closedBy:null,version:1,createdAt:task.createdAt,updatedAt:task.updatedAt}];
  await page.route('**/api/bootstrap',route=>route.fulfill({json:{me:employee,employees:[employee],projects:[project],departments:[{id:1,name:'개발',archived:false}],leads:[],goals,demo:false,csrfToken:'synthetic'}}));
  await page.route('**/api/work-goals',route=>{const request=route.request();expect(request.method()).toBe('POST');expect(request.headers()['x-csrf-token']).toBe('synthetic');expect(request.headers()['x-workspace-actor']).toBe('1');const input=request.postDataJSON(),goal={id:nextId++,...input,createdBy:1,closedAt:null,closedBy:null,version:1,createdAt:task.createdAt,updatedAt:task.updatedAt};goals=[...goals,goal];writes.push(goal.title);return route.fulfill({contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:'목표를 등록했습니다.',data:{operation:'goal-create',value:goal}})});});
  await page.route('**/api/work-goals/1',route=>{const request=route.request();expect(request.method()).toBe('PUT');expect(request.headers()['x-csrf-token']).toBe('synthetic');expect(request.headers()['x-workspace-actor']).toBe('1');const input=request.postDataJSON(),current=goals.find(goal=>goal.id===1);expect(input.version).toBe(current.version);const updated={...current,...input,version:current.version+1,updatedAt:'2026-09-10T03:00:00Z'};goals=goals.map(goal=>goal.id===1?updated:goal);updates.push(updated.title);return route.fulfill({contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:'목표를 수정했습니다.',data:{operation:'goal-update',value:updated}})});});
  await page.route('**/api/tasks?*',route=>{const url=new URL(route.request().url());if(!url.searchParams.has('goalId'))return route.fallback();const inRange=(!url.searchParams.has('from')||task.startDate>=url.searchParams.get('from'))&&(!url.searchParams.has('to')||task.startDate<=url.searchParams.get('to'));const item={...task,goalId:Number(url.searchParams.get('goalId'))},items=inRange?[item]:[];return route.fulfill({json:{items,total:items.length,editableIds:items.map(value=>value.id),commentCounts:items.map(value=>({taskId:value.id,count:1})),attachmentCounts:[]}});});
  await page.goto('https://schedule.workspace.test/');await page.getByRole('button',{name:'목표 관리',exact:true}).click();let panel=page.getByRole('dialog',{name:'업무 목표 관리',exact:true});
  await panel.getByRole('textbox',{name:'목표 이름',exact:true}).fill('첫 추가 목표');await panel.getByRole('button',{name:'목표 등록',exact:true}).click();await expect(panel.getByRole('heading',{name:'첫 추가 목표',exact:true})).toBeVisible();await panel.getByRole('button',{name:'목표 관리 닫기',exact:true}).click();
  await page.getByRole('button',{name:'목표 관리',exact:true}).click();panel=page.getByRole('dialog',{name:'업무 목표 관리',exact:true});await panel.getByRole('textbox',{name:'목표 이름',exact:true}).fill('새로고침 없는 다음 목표');await panel.getByRole('button',{name:'목표 등록',exact:true}).click();await expect(panel.getByRole('heading',{name:'새로고침 없는 다음 목표',exact:true})).toBeVisible();expect(writes).toEqual(['첫 추가 목표','새로고침 없는 다음 목표']);
  const originalCard=panel.locator('[data-goal-id="1"]');await originalCard.getByRole('button',{name:'수정',exact:true}).click();await originalCard.getByRole('textbox',{name:'목표 이름',exact:true}).fill('수정된 목표');await originalCard.getByRole('textbox',{name:'설명',exact:true}).fill('수정 내용이 일정 필터에도 반영됩니다.');await page.screenshot({path:info.outputPath('goal-edit.png'),animations:'disabled'});await originalCard.getByRole('button',{name:'저장',exact:true}).click();await expect(panel.getByRole('heading',{name:'수정된 목표',exact:true})).toBeVisible();expect(updates).toEqual(['수정된 목표']);
  await expect(panel.getByRole('button',{name:'업무 모아보기',exact:true})).toHaveCount(0);await panel.getByRole('button',{name:'목표 관리 닫기',exact:true}).click();
  await page.getByRole('button',{name:'목표별',exact:true}).click();const goalFilter=page.getByLabel('업무 목표 필터',{exact:true});await expect(goalFilter).toBeVisible();await goalFilter.selectOption({label:'수정된 목표'});const group=page.locator('.task-group-heading').filter({hasText:'수정된 목표'});await expect(group).toBeVisible();await expect(page.locator('[data-task-id="101"]')).toContainText(task.title);
  const sizes=await page.evaluate(()=>{const select=document.querySelector('[aria-label="표시 기간"]'),today=[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()==='오늘'),a=select?.getBoundingClientRect(),b=today?.getBoundingClientRect();return{select:a?.height,selectWidth:a?.width,today:b?.height};});expect(sizes.select).toBeGreaterThanOrEqual(44);expect(sizes.selectWidth).toBeGreaterThanOrEqual(76);expect(sizes.today).toBeGreaterThanOrEqual(32);await page.screenshot({path:info.outputPath('goal-grouping.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);expect(f.writes).toEqual([]);
});

test('schedule read-only tool verifies a task before navigation and reports failed lookup',async({page})=>{
  await page.addInitScript(()=>{document.modelContext={registerTool(tool){window.__scheduleOpenTool=tool;}};});
  const f=await fixture(page),headers=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/tasks/101')headers.push(request.headers().accept);});
  await page.route('**/api/tasks/999',route=>{expect(route.request().headers().accept).toBe('application/json');return route.fulfill({status:404,json:{error:'격리된 미존재 업무'}});});
  await page.goto('https://schedule.workspace.test/');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__scheduleOpenTool))).toBe(true);
  expect(await page.evaluate(()=>window.__scheduleOpenTool.execute({taskId:101}))).toEqual({taskId:101,opened:true});
  await expect(page).toHaveURL(/\/tasks\/101$/);await expect(page.locator('dialog.task-dialog h1')).toHaveText(task.title);
  const failure=await page.evaluate(async()=>{try{await window.__scheduleOpenTool.execute({taskId:999});return '';}catch(error){return error.message;}});
  expect(failure).toContain('일정 조회에 실패했습니다.');await expect(page).toHaveURL(/\/tasks\/101$/);
  expect(headers.length).toBeGreaterThanOrEqual(2);expect(headers.every(value=>value==='application/json')).toBe(true);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`schedule demo and today indicators use shared semantic pills ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);f.demo(true);
  await page.goto('https://schedule.workspace.test/');const demo=page.locator('.demo-badge'),today=page.locator(width===320?'.mobile-day .status-badge':'.day-header .today-badge');
  await expect(demo).toHaveClass(/\bcw-state-pill\b/);await expect(demo).toHaveAttribute('data-tone','warning');
  if(width===320)await expect(demo).toBeHidden();else await expect(demo).toBeVisible();
  await expect(today).toHaveCount(1);if(width===320)await expect(today).toBeVisible();else await expect(today).toBeHidden();await expect(today).toHaveClass(/\bcw-state-pill\b/);await expect(today).toHaveAttribute('data-tone','info');
  const colors=await today.evaluate(node=>{const probe=document.createElement('span');document.body.append(probe);const color=name=>{probe.style.backgroundColor=`var(${name})`;return getComputedStyle(probe).backgroundColor;};const text=name=>{probe.style.color=`var(${name})`;return getComputedStyle(probe).color;};const style=getComputedStyle(node),result={background:style.backgroundColor,color:style.color,whiteSpace:style.whiteSpace,expectedBackground:color('--cw-active'),expectedColor:text('--cw-active-text')};probe.remove();return result;});
  expect(colors.background).toBe(colors.expectedBackground);expect(colors.color).toBe(colors.expectedColor);expect(colors.whiteSpace).toBe('nowrap');
  if(width===1440){const demoColors=await demo.evaluate(node=>{const probe=document.createElement('span');document.body.append(probe);const style=getComputedStyle(node);probe.style.backgroundColor='var(--cw-warning-bg)';const expectedBackground=getComputedStyle(probe).backgroundColor;probe.style.color='var(--cw-warning)';const expectedColor=getComputedStyle(probe).color;probe.remove();return {background:style.backgroundColor,color:style.color,expectedBackground,expectedColor};});expect(demoColors.background).toBe(demoColors.expectedBackground);expect(demoColors.color).toBe(demoColors.expectedColor);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('schedule-state-pills.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`task action confirmation preserves scope, focus, replies and acknowledged writes ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page),writes=[];
  let latest={task:{...task},canEdit:true,comments:[{id:7,taskId:101,authorId:1,parentId:null,body:'삭제할 댓글 9007199254740993',deleted:false,version:1,createdAt:task.createdAt,editedAt:null},{id:8,taskId:101,authorId:1,parentId:7,body:'삭제 뒤에도 유지할 답글',deleted:false,version:1,createdAt:task.createdAt,editedAt:null}],attachments:[],history:[]},listFails=false,hold=false,finish;
  await page.route('**/api/tasks/101',route=>route.fulfill({json:withTaskWriteState(latest)}));
  await page.route('**/api/tasks?*',route=>listFails?route.fulfill({status:503,json:{error:'격리 목록 장애'}}):route.fallback());
  await page.route(/\/api\/tasks\/101\/(archive|restore)$/,async route=>{
    const request=route.request(),data=request.postDataJSON(),kind=new URL(request.url()).pathname.split('/').pop(),previous=request.headers()['x-workspace-state'];writes.push({kind,...data});expect(request.headers()['x-csrf-token']).toBe('synthetic');expect(request.headers()['x-workspace-actor']).toBe('1');expect(request.headers().accept).toBe(taskWriteMedia);expect(previous).toBe(withTaskWriteState(latest).editing.stateToken);
    if(hold)await new Promise(resolve=>{finish=resolve;});
    expect(data).toEqual({version:latest.task.version});latest={...latest,canEdit:kind==='restore',task:{...latest.task,archived:kind==='archive',version:data.version+1,updatedAt:'2026-09-10T03:00:00Z'}};
    return route.fulfill(taskWriteReply(latest,kind,previous));
  });
  await page.route('**/api/comments/7?version=*',route=>{
    const request=route.request(),headers=request.headers(),data=request.postDataJSON(),previous=headers['x-workspace-target-state'];expect(request.method()).toBe('DELETE');expect(headers['x-csrf-token']).toBe('synthetic');expect(headers['x-workspace-actor']).toBe('1');expect(headers.accept).toBe(taskWriteMedia);expect(previous).toBe(withTaskWriteState(latest).commentEditing.comments.find(row=>row.id===7).stateToken);expect(data).toEqual({version:1});writes.push({kind:'delete',version:Number(new URL(request.url()).searchParams.get('version'))});
    const saved={...latest.comments.find(c=>c.id===7),deleted:true,body:'',version:2,editedAt:'2026-09-10T03:00:00Z'};latest={...latest,comments:latest.comments.map(c=>c.id===7?saved:c)};return route.fulfill(commentWriteReply(latest,saved,'delete-comment',previous));
  });
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('dialog.task-dialog'),archive=panel.getByRole('button',{name:'보관',exact:true}),modal=page.locator('dialog.cw-confirm'),draft=panel.getByRole('textbox',{name:'새 댓글',exact:true});
  await draft.fill('먼저 보존할 초안');await expect(archive).toBeDisabled();await expect(panel.locator('#comment-7').getByRole('button',{name:'삭제',exact:true})).toBeDisabled();await draft.fill('');
  await panel.locator('#comment-7').getByRole('button',{name:'수정',exact:true}).click();await expect(archive).toBeDisabled();await panel.locator('#comment-7').getByRole('button',{name:'취소',exact:true}).click();
  await archive.click();await expect(modal).toBeVisible();await expect(modal).toContainText(task.title);await expect(draft).toBeDisabled();await expect(modal.getByRole('heading')).toBeFocused();
  // Native modal tab order may pass through browser chrome, but never the underlying task controls.
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');expect(await modal.evaluate(e=>e.contains(document.activeElement)||document.activeElement===document.body)).toBe(true);}
  await page.screenshot({path:info.outputPath('task-confirm.png'),animations:'disabled'});expect(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(archive).toBeEnabled();await expect(archive).toBeFocused();expect(writes).toHaveLength(0);
  await archive.click();listFails=true;hold=true;await modal.getByRole('button',{name:'보관',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);await expect(draft).toBeDisabled();await archive.evaluate(e=>e.click());expect(writes).toHaveLength(1);
  finish();await expect(panel).toContainText('업무를 보관했습니다.');await expect(panel).toContainText('목록 갱신에 실패');await expect(panel.getByRole('button',{name:'복원',exact:true})).toBeDisabled();await expect(panel.locator('#comment-8')).toContainText('유지할 답글');
  listFails=false;hold=false;await panel.getByRole('button',{name:'목록 다시 확인',exact:true}).click();await expect(panel.getByRole('button',{name:'복원',exact:true})).toBeEnabled();expect(writes).toHaveLength(1);
  await panel.getByRole('button',{name:'복원',exact:true}).click();await expect(modal).toContainText('업무를 복원할까요?');await modal.getByRole('button',{name:'복원',exact:true}).click();await expect(archive).toBeEnabled();expect(writes[1]).toEqual({kind:'restore',version:2});
  await panel.locator('#comment-7').getByRole('button',{name:'삭제',exact:true}).click();await expect(modal).toContainText('삭제할 댓글 9007199254740993');await expect(modal).toContainText('답글과 감사 기록은 유지');await modal.getByRole('button',{name:'댓글 삭제',exact:true}).click();await expect(panel.locator('#comment-7')).toContainText('삭제된 댓글입니다.');await expect(panel.locator('#comment-8')).toContainText('유지할 답글');await expect(archive).toBeEnabled();expect(writes).toHaveLength(3);expect(writes[2]).toEqual({kind:'delete',version:1});
  expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`comment draft transitions use checked shared confirmation ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const comments=[
    {id:7,taskId:101,authorId:1,parentId:null,body:'첫 번째 댓글 원문',deleted:false,version:1,createdAt:task.createdAt,editedAt:null},
    {id:8,taskId:101,authorId:1,parentId:null,body:'두 번째 댓글 원문',deleted:false,version:1,createdAt:task.createdAt,editedAt:null},
  ];
  await page.route('**/api/tasks/101',route=>route.fulfill({json:{task:{...task},canEdit:true,comments,attachments:[],history:[]}}));
  await page.goto('https://schedule.workspace.test/tasks/101');const first=page.locator('#comment-7'),second=page.locator('#comment-8');
  await first.getByRole('button',{name:'수정',exact:true}).click();let composer=first.locator('.comment-composer'),input=composer.getByRole('textbox',{name:'댓글 수정',exact:true}),cancel=composer.getByRole('button',{name:'취소',exact:true});
  await input.fill('취소 전 보존할 댓글 초안');await cancel.click();let confirm=page.getByRole('dialog',{name:'댓글 수정 초안을 버릴까요?'});await expect(confirm).toBeVisible();await expect(confirm).toContainText('첫 번째 댓글 원문');
  if(width===320&&theme==='dark')await page.screenshot({path:info.outputPath('comment-edit-discard.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(input).toHaveValue('취소 전 보존할 댓글 초안');await expect(cancel).toBeFocused();
  await cancel.click();confirm=page.getByRole('dialog',{name:'댓글 수정 초안을 버릴까요?'});await confirm.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(composer).toHaveCount(0);
  await first.getByRole('button',{name:'답글',exact:true}).click();composer=first.locator('.comment-composer');input=composer.getByRole('textbox',{name:'새 댓글',exact:true});await input.fill('취소할 답글 초안');await composer.getByRole('button',{name:'취소',exact:true}).click();confirm=page.getByRole('dialog',{name:'답글 초안을 버릴까요?'});await expect(confirm).toContainText('첫 번째 댓글 원문');await confirm.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(composer).toHaveCount(0);
  await first.getByRole('button',{name:'답글',exact:true}).click();composer=first.locator('.comment-composer');await composer.getByRole('textbox',{name:'새 댓글',exact:true}).fill('이동 전 보존할 답글');await second.getByRole('button',{name:'수정',exact:true}).click();confirm=page.getByRole('dialog',{name:'작성 중인 댓글을 버리고 이동할까요?'});await expect(confirm).toContainText('두 번째 댓글 원문');await confirm.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(first.locator('.comment-composer')).toHaveCount(0);
  let secondComposer=second.locator('.comment-composer'),secondInput=secondComposer.getByRole('textbox',{name:'댓글 수정',exact:true});await expect(secondInput).toHaveValue('두 번째 댓글 원문');await secondComposer.getByRole('button',{name:'취소',exact:true}).click();await expect(secondComposer).toHaveCount(0);
  const panel=page.locator('.task-dialog'),newComment=panel.getByRole('textbox',{name:'새 댓글',exact:true}),editTask=panel.getByRole('button',{name:'업무 수정',exact:true});await newComment.fill('업무 수정 전 보존할 댓글 초안');await editTask.click();
  confirm=page.getByRole('dialog',{name:'댓글 초안을 버리고 업무를 수정할까요?',exact:true});await expect(confirm).toContainText('새 댓글');await expect(confirm).toContainText(task.title);await expect(confirm).toContainText(project.name);await page.keyboard.press('Escape');await expect(newComment).toHaveValue('업무 수정 전 보존할 댓글 초안');await expect(editTask).toBeFocused();
  await editTask.click();await confirm.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(panel.getByRole('heading',{name:'업무 수정',exact:true})).toBeVisible();await panel.getByRole('button',{name:'취소',exact:true}).click();
  const historyDraft=panel.getByRole('textbox',{name:'새 댓글',exact:true}),history=panel.getByRole('button',{name:'변경 이력',exact:true});await historyDraft.fill('이력 전환 전 보존할 댓글 초안');await history.click();confirm=page.getByRole('dialog',{name:'댓글 초안을 버리고 변경 이력을 열까요?',exact:true});await expect(confirm).toContainText('새 댓글');await expect(historyDraft).toBeDisabled();
  if(width===320&&theme==='dark')await page.screenshot({path:info.outputPath('task-comment-transition.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(historyDraft).toHaveValue('이력 전환 전 보존할 댓글 초안');await expect(history).toBeFocused();await history.click();await confirm.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(panel.getByRole('button',{name:'댓글 보기',exact:true})).toBeVisible();await panel.getByRole('button',{name:'댓글 보기',exact:true}).click();
  await second.getByRole('button',{name:'수정',exact:true}).click();secondComposer=second.locator('.comment-composer');secondInput=secondComposer.getByRole('textbox',{name:'댓글 수정',exact:true});await secondInput.fill('범위 변경에도 남길 초안');await secondComposer.getByRole('button',{name:'취소',exact:true}).click();confirm=page.getByRole('dialog',{name:'댓글 수정 초안을 버릴까요?'});await page.evaluate(()=>document.dispatchEvent(new CustomEvent('workspace-entity-scope-change')));await expect(confirm).toHaveCount(0);await expect(secondInput).toHaveValue('범위 변경에도 남길 초안');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`task reference transition uses shared draft confirmation ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page),native=[];page.on('dialog',dialog=>native.push(dialog.message()));
  const linked={...task,id:202,title:'연결 대상 업무',body:'이동한 업무 본문',version:3};
  await page.route(/\/api\/tasks\/202\/reference$/,route=>{expect(route.request().headers().accept).toBe('application/json');return route.fulfill({json:{id:202,title:linked.title,projectId:10,archived:false}});});
  await page.route(/\/api\/tasks\/202$/,route=>route.fulfill({json:withTaskWriteState({task:linked,canEdit:true,comments:[],attachments:[],history:[]})}));
  await page.route(/\/api\/tasks\/101$/,route=>route.fulfill({json:withTaskWriteState({task:{...task,body:'다음 업무를 확인합니다. https://schedule.workspace.test/tasks/202'},canEdit:true,comments:[],attachments:[],history:[]})}));
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog'),draft=panel.getByRole('textbox',{name:'새 댓글',exact:true}),link=panel.getByRole('link',{name:/연결 대상 업무/}),confirm=page.getByRole('dialog',{name:'작성 중인 내용을 버리고 다른 업무로 이동할까요?',exact:true});await expect(link).toBeVisible();await draft.fill('링크 이동 뒤에도 보존할 댓글 초안');
  await link.click();await expect(confirm).toBeVisible();await expect(confirm).toContainText(task.title);await expect(confirm).toContainText('새 댓글');await expect(confirm).toContainText('업무 #202');await expect(draft).toBeDisabled();
  if(width===320&&theme==='dark')await page.screenshot({path:info.outputPath('task-reference-discard.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(draft).toHaveValue('링크 이동 뒤에도 보존할 댓글 초안');await expect(link).toBeFocused();
  await link.click();await confirm.locator('[data-confirm-apply]').click();await expect(page).toHaveURL(/\/tasks\/202$/);await expect(page.locator('.task-dialog h1')).toHaveText(linked.title);
  expect(native).toEqual([]);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('task reference transition rejects a stale scope without losing its draft',async({page})=>{
  const f=await fixture(page),native=[];page.on('dialog',dialog=>native.push(dialog.message()));
  await page.route(/\/api\/tasks\/202\/reference$/,route=>{expect(route.request().headers().accept).toBe('application/json');return route.fulfill({json:{id:202,title:'연결 대상 업무',projectId:10,archived:false}});});
  await page.route(/\/api\/tasks\/101$/,route=>route.fulfill({json:withTaskWriteState({task:{...task,body:'https://schedule.workspace.test/tasks/202'},canEdit:true,comments:[],attachments:[],history:[]})}));
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog'),draft=panel.getByRole('textbox',{name:'새 댓글',exact:true}),link=panel.getByRole('link',{name:/연결 대상 업무/}),confirm=page.getByRole('dialog',{name:'작성 중인 내용을 버리고 다른 업무로 이동할까요?',exact:true});await draft.fill('범위 변경에도 보존할 링크 초안');
  await link.click();await expect(confirm).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(confirm).toHaveCount(0);await expect(draft).toHaveValue('범위 변경에도 보존할 링크 초안');await expect(page).toHaveURL(/\/tasks\/101$/);await expect(panel.getByRole('link',{name:'확인할 수 없는 일정 #202'})).toBeVisible();
  expect(native).toEqual([]);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('task confirmation refuses stale preflight, permission denial and scope changes without automatic writes',async({page})=>{
  await page.setViewportSize({width:390,height:900});const f=await fixture(page),writes=[];
  let latest={task:{...task},canEdit:true,comments:[],attachments:[],history:[]},readStatus=200,writeStatus=409;
  await page.route('**/api/tasks/101',route=>route.fulfill({status:readStatus,json:readStatus===200?withTaskWriteState(latest):{error:'격리 권한 없음'}}));
  await page.route('**/api/tasks/101/archive',route=>{writes.push(route.request().postDataJSON());if(writeStatus!==200){latest={...latest,task:{...latest.task,version:latest.task.version+1,updatedAt:'2026-09-10T03:00:00Z'}};return route.fulfill(commentWriteError(409,'conflict','검토 이후 버전 충돌'));}return route.fulfill({status:200,json:{success:true}});});
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog'),archive=panel.getByRole('button',{name:'보관',exact:true}),modal=page.locator('.cw-confirm'),refresh=()=>panel.getByRole('button',{name:/다시 (조회|확인)/}).first();
  await expect(archive).toBeVisible();readStatus=403;await archive.click();await expect(panel).toContainText('로그인·권한을 다시 확인해 주세요.');await expect(modal).toHaveCount(0);expect(writes).toHaveLength(0);
  readStatus=200;await refresh().click();await expect(archive).toBeEnabled();latest={...latest,task:{...latest.task,title:'동료가 변경한 제목',version:2}};
  await archive.click();await expect(panel).toContainText('업무 또는 댓글이 변경되었습니다');await expect(modal).toHaveCount(0);await expect(panel.getByRole('heading',{level:1})).toHaveText('동료가 변경한 제목');expect(writes).toHaveLength(0);
  await archive.click();await expect(modal).toBeVisible();latest={...latest,task:{...latest.task,title:'확인 중 다시 변경된 제목',version:3}};await page.clock.fastForward(31000);await expect(panel.getByRole('heading',{level:1})).toHaveText('확인 중 다시 변경된 제목');
  await modal.getByRole('button',{name:'보관',exact:true}).click();await expect(modal).toContainText('대상·권한 또는 업무 내용이 변경되었습니다');expect(writes).toHaveLength(0);await modal.getByRole('button',{name:'취소',exact:true}).click();
  await archive.click();await modal.getByRole('button',{name:'보관',exact:true}).click();await expect(panel).toContainText('검토 이후 버전 충돌');await expect(archive).toBeDisabled();expect(writes).toEqual([{version:3}]);
  await refresh().click();await archive.click();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(modal).toHaveCount(0);await expect(panel).toContainText('로그인 상태가 변경되었습니다');expect(writes).toHaveLength(1);
  await refresh().click();await refresh().click();writeStatus=200;await archive.click();await modal.getByRole('button',{name:'보관',exact:true}).click();await expect(panel).toContainText('저장 결과를 확인하지 못했습니다');await expect(panel).toContainText('자동으로 다시 전송하지 않습니다');await expect(archive).toBeDisabled();expect(writes).toHaveLength(2);await refresh().click();await expect(archive).toBeDisabled();await expect(panel).toContainText('이 화면에서 다시 실행할 수 없습니다');expect(writes).toHaveLength(2);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('new comments and replies reconcile confirmed writes while malformed responses retain the draft',async({page})=>{
  await page.setViewportSize({width:390,height:900});await page.emulateMedia({colorScheme:'dark'});const f=await fixture(page),writes=[];
  let latest={task:{...task},canEdit:true,comments:[{id:7,taskId:101,authorId:1,parentId:null,body:'원래 댓글',deleted:false,version:1,createdAt:task.createdAt,editedAt:null}],attachments:[],history:[]},malformed=false;
  await page.route('**/api/tasks/101',route=>route.fulfill({json:withTaskWriteState(latest)}));
  await page.route('**/api/tasks/101/comments',route=>{
    const request=route.request(),data=request.postDataJSON(),previous=request.headers()['x-workspace-target-state'];writes.push(data);expect(request.headers()['x-csrf-token']).toBe('synthetic');expect(request.headers()['x-workspace-actor']).toBe('1');expect(request.headers().accept).toBe(taskWriteMedia);
    if(malformed)return route.fulfill({contentType:taskWriteMedia,body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message:'broken',data:{operation:'create'}})});
    const saved={id:7+writes.length,taskId:101,authorId:1,parentId:data.parentId,body:data.body.trim(),deleted:false,version:1,createdAt:task.createdAt,editedAt:null};latest.comments.push(saved);return route.fulfill(commentWriteReply(latest,saved,data.parentId===null?'create':'reply',previous));
  });
  await page.goto('https://schedule.workspace.test/tasks/101');const main=page.locator('.task-dialog .comment-composer').last();
  await main.getByRole('textbox',{name:'새 댓글',exact:true}).fill('새 논의');await main.getByRole('button',{name:'댓글 등록',exact:true}).click();let confirm=page.getByRole('dialog',{name:'댓글을 등록할까요?'});await expect(confirm).toBeVisible();expect(writes).toHaveLength(0);await confirm.getByRole('button',{name:'댓글 등록',exact:true}).click();await expect(page.locator('#comment-8')).toContainText('새 논의');await expect(main.getByRole('textbox',{name:'새 댓글',exact:true})).toHaveValue('');expect(writes[0]).toMatchObject({body:'새 논의',parentId:null,version:0,attachmentIds:[]});
  await page.locator('#comment-7').getByRole('button',{name:'답글',exact:true}).click();const reply=page.locator('#comment-7 .comment-composer');await reply.getByRole('textbox',{name:'새 댓글',exact:true}).fill('답글 본문');await reply.getByRole('button',{name:'댓글 등록',exact:true}).click();confirm=page.getByRole('dialog',{name:'답글을 등록할까요?'});await confirm.getByRole('button',{name:'댓글 등록',exact:true}).click();await expect(page.locator('#comment-9')).toContainText('답글 본문');await expect(reply).toHaveCount(0);expect(writes[1].parentId).toBe(7);
  malformed=true;await main.getByRole('textbox',{name:'새 댓글',exact:true}).fill('확인 전 유지할 초안');await main.getByRole('button',{name:'댓글 등록',exact:true}).click();await page.getByRole('dialog',{name:'댓글을 등록할까요?'}).getByRole('button',{name:'댓글 등록',exact:true}).click();await expect(main).toContainText('저장 결과를 확인하지 못했습니다');await expect(main.getByRole('textbox',{name:'새 댓글',exact:true})).toHaveValue('확인 전 유지할 초안');expect(writes).toHaveLength(3);
  f.role('employee');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(main).toContainText('현재 댓글을 저장할 수 없습니다');await expect(main.getByRole('button',{name:'댓글 등록',exact:true})).toBeDisabled();await expect(main.getByRole('textbox',{name:'새 댓글',exact:true})).toHaveValue('확인 전 유지할 초안');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`comment conflict review preserves authorship, drafts and explicit saves ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const original={id:7,taskId:101,authorId:1,parentId:null,body:'@[검증 직원](1) 원본 9007199254740993',deleted:false,version:1,createdAt:task.createdAt,editedAt:null};
  const image=id=>({id,taskId:101,commentId:7,name:id+'.png',contentType:'image/png',size:10,ownerId:1,createdAt:task.createdAt});
  let latest={task:{...task},canEdit:false,comments:[{...original}],attachments:[image('original')],history:[]},readStatus=200,holdRead=false,holdWrite=false,pendingRead,pendingWrite;
  const writes=[];
  await page.route('**/api/images/*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>'}));
  await page.route('**/api/tasks/101',async route=>{const snapshot=withTaskWriteState(structuredClone(latest));if(holdRead)await new Promise(resolve=>{pendingRead=resolve;});return route.fulfill({status:readStatus,json:readStatus===200?snapshot:{error:'격리 댓글 조회 실패'}});});
  await page.route('**/api/comments/7',async route=>{
    const request=route.request(),data=request.postDataJSON(),previous=request.headers()['x-workspace-target-state'];writes.push(data);
    expect(request.headers()['x-csrf-token']).toBe('synthetic');expect(request.headers()['x-workspace-actor']).toBe('1');expect(request.headers().accept).toBe(taskWriteMedia);
    if(holdWrite)await new Promise(resolve=>{pendingWrite=resolve;});
    if(data.version!==latest.comments[0].version)return route.fulfill(commentWriteError(409,'conflict','댓글 버전 충돌'));
    const saved={...latest.comments[0],body:data.body.trim(),version:data.version+1,editedAt:'2026-09-12T00:01:00Z'};latest={...latest,comments:[saved],attachments:data.attachmentIds.map(image)};
    return route.fulfill(commentWriteReply(latest,saved,'update',previous));
  });
  await page.goto('https://schedule.workspace.test/tasks/101');const comment=page.locator('#comment-7');await comment.getByRole('button',{name:'수정',exact:true}).click();
  const composer=comment.locator('.comment-composer'),input=composer.getByRole('textbox',{name:'댓글 수정',exact:true}),save=composer.getByRole('button',{name:'댓글 수정',exact:true}),compare=composer.getByRole('button',{name:'댓글 변경 비교',exact:true}).first(),review=page.locator('dialog.cw-review');
  const replaceTail=async text=>{await input.evaluate(e=>{e.focus();e.setSelectionRange('@검증 직원 '.length,e.value.length);});await page.keyboard.insertText(text);};
  await expect(input).toBeVisible();await assertScheduleControls(composer);
  await composer.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('comment-edit-controls.png'),animations:'disabled'});
  await replaceTail('내 변경 9007199254740993');await composer.getByRole('button',{name:'original.png 첨부 제거'}).click();
  latest={...latest,comments:[{...original,body:'서버 변경',version:2}],attachments:[image('remote')]};
  await save.click();await expect(composer).toContainText('업무·댓글 또는 첨부가 변경됐습니다');expect(writes).toHaveLength(0);
  readStatus=403;await compare.click();await expect(composer).toContainText('로그인·권한을 다시 확인해 주세요.');await expect(input).toHaveValue('@검증 직원 내 변경 9007199254740993');await expect(save).toBeDisabled();
  readStatus=200;holdRead=true;await compare.click();await expect.poll(()=>!!pendingRead).toBe(true);await replaceTail('조회 중 변경 9007199254740993');holdRead=false;pendingRead();await expect(composer).toContainText('조회 중 초안 또는 로그인 상태가 바뀌었습니다');
  await compare.click();await expect(review).toBeVisible();await expect(review.getByRole('heading',{name:'댓글 변경 내용 비교'})).toBeFocused();await expect(review.locator('[data-review-field="body"]')).toHaveAttribute('data-conflict','true');
  await expect(review.locator('[data-review-field="attachmentIds"]')).toHaveAttribute('data-conflict','true');await expect(review.locator('[data-review-apply]')).toBeDisabled();
  await page.screenshot({path:info.outputPath('comment-review.png'),animations:'disabled'});expect(await review.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.keyboard.press('Escape');await expect(review).toHaveCount(0);await expect(input).toHaveValue('@검증 직원 조회 중 변경 9007199254740993');
  await compare.click();await expect(review).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(review).toHaveCount(0);expect(writes).toHaveLength(0);
  await compare.click();await review.locator('[data-review-field="body"] select').selectOption('draft');await review.locator('[data-review-field="attachmentIds"] select').selectOption('current');await review.locator('[data-review-apply]').click();await expect(composer).toContainText('아직 저장하지 않았습니다');await expect(composer.getByRole('img',{name:'remote.png'})).toBeVisible();expect(writes).toHaveLength(0);
  latest.comments[0]={...latest.comments[0],body:'비교 이후 변경',version:3};await save.click();await expect(composer).toContainText('업무·댓글 또는 첨부가 변경됐습니다');expect(writes).toHaveLength(0);
  await compare.click();await review.locator('[data-review-field="body"] select').selectOption('draft');await review.locator('[data-review-apply]').click();
  holdWrite=true;await save.click();const saveConfirm=page.getByRole('dialog',{name:'댓글 변경을 저장할까요?'});await expect(saveConfirm).toBeVisible();await saveConfirm.getByRole('button',{name:'댓글 수정',exact:true}).click();await expect.poll(()=>!!pendingWrite).toBe(true);await expect(input).toBeDisabled();await expect(composer.getByRole('button',{name:'＋ 이미지'})).toBeDisabled();
  await composer.evaluate(e=>e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(writes).toHaveLength(1);expect(writes[0].version).toBe(3);expect(writes[0].attachmentIds).toEqual(['remote']);
  readStatus=503;holdWrite=false;pendingWrite();await expect(composer).toContainText('댓글은 저장했지만 목록 확인에 실패했습니다');await expect(input).toHaveValue('@검증 직원 조회 중 변경 9007199254740993');expect(writes).toHaveLength(1);
  readStatus=200;await compare.click();await expect(review).toBeVisible();await review.locator('[data-review-cancel]').click();
  latest.comments[0]={...latest.comments[0],deleted:true,body:'',version:5};latest.attachments=[];await compare.click();await expect(composer).toContainText('수정할 수 없는 댓글');await expect(input).toHaveValue('@검증 직원 조회 중 변경 9007199254740993');await expect(save).toBeDisabled();
  await page.clock.fastForward(31000);await expect(composer).toBeVisible();await expect(input).toHaveValue('@검증 직원 조회 중 변경 9007199254740993');
  expect(writes).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`task conflict review preserves drafts, directory IDs and attachment choices ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const image=id=>({id,taskId:101,commentId:null,name:id+'.png',size:10,contentType:'image/png',ownerId:1,createdAt:task.createdAt});
  let latest={task:{...task},canEdit:true,comments:[],attachments:[image('original')],history:[]},readStatus=200,hold=false,pending;
  const writes=[];
  await page.route('**/api/images/*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>'}));
  await page.route('**/api/tasks/101',async route=>{
    if(route.request().method()==='PUT'){
      const data=route.request().postDataJSON();writes.push(data);
      if(data.version!==latest.task.version)return route.fulfill({status:409,json:{error:'다른 사람이 수정했습니다.'}});
      latest={...latest,task:{...latest.task,...data,version:latest.task.version+1}};
      return route.fulfill(taskWriteReply(latest,'update',route.request().headers()['x-workspace-state']));
    }
    const snapshot=withTaskWriteState(structuredClone(latest));if(hold)await new Promise(resolve=>{pending=resolve;});
    return route.fulfill({status:readStatus,json:readStatus===200?snapshot:{error:'읽기 권한 없음'}});
  });
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');await panel.getByRole('button',{name:'업무 수정',exact:true}).click();
  const title=panel.getByRole('textbox',{name:'제목',exact:true}),body=panel.getByRole('textbox',{name:'업무 본문',exact:true}),save=panel.getByRole('button',{name:'업무 저장',exact:true});
  await expect(title).toBeVisible();await assertScheduleControls(panel);await assertTaskDateControls(panel.locator('.task-editor'));await assertScheduleModal(panel);
  await panel.locator('.detail-panel').evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:info.outputPath('task-edit-controls.png'),animations:'disabled'});
  await body.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('task-body-controls.png'),animations:'disabled'});
  await panel.getByRole('button',{name:'original.png',exact:true}).click();
  const imageDialog=panel.locator('dialog.lightbox');await expect(imageDialog).toBeVisible();await expect(imageDialog.getByRole('img',{name:'original.png'})).toBeVisible();await assertScheduleModal(imageDialog);
  const imageGeometry=await imageDialog.evaluate(e=>({image:e.querySelector('img').getBoundingClientRect().top,close:e.querySelector('button').getBoundingClientRect().bottom}));expect(imageGeometry.image).toBeGreaterThanOrEqual(imageGeometry.close+4);
  await page.screenshot({path:info.outputPath('task-image-modal.png'),animations:'disabled'});
  await imageDialog.getByRole('button',{name:'이미지 닫기'}).click();await expect(imageDialog).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'original.png',exact:true})).toBeFocused();
  await title.fill('내 제목');await panel.getByRole('button',{name:'original.png 첨부 제거'}).click();
  f.people([{...employee,id:2,name:'새 담당자',role:'employee',isAdmin:false}]);f.projects([{...project,id:20,name:'새 프로젝트'}]);
  latest={...latest,task:{...latest.task,title:'서버 제목',body:'@[새 담당자](2) 서버 본문 9007199254740993',assigneeId:2,projectId:20,version:2},attachments:[image('remote')]};
  await save.click();await expect(panel).toContainText('업무 또는 첨부가 변경됐습니다');expect(writes).toHaveLength(0);
  const compare=panel.getByRole('button',{name:'변경 내용 비교',exact:true}).last(),review=page.locator('dialog.cw-review');
  readStatus=403;await compare.click();await expect(panel).toContainText('로그인·권한을 다시 확인해 주세요.');await expect(title).toHaveValue('내 제목');await expect(review).toHaveCount(0);
  readStatus=200;latest.canEdit=false;await compare.click();await expect(panel).toContainText('수정할 권한 또는 로그인 상태가 변경');await expect(title).toHaveValue('내 제목');await expect(review).toHaveCount(0);latest.canEdit=true;
  readStatus=200;hold=true;await compare.click();await expect.poll(()=>pending!==undefined).toBe(true);
  await title.fill('조회 중 수정');hold=false;pending();await expect(panel).toContainText('초안 또는 로그인 상태가 바뀌었습니다');
  await compare.click();await expect(review).toBeVisible();await expect(review.getByRole('heading',{name:'업무 변경 내용 비교'})).toBeFocused();
  await expect(review.locator('[data-review-field="title"]')).toHaveAttribute('data-conflict','true');
  await expect(review.locator('[data-review-field="attachmentIds"]')).toHaveAttribute('data-conflict','true');
  await expect(review.locator('[data-review-field="assigneeId"]')).toContainText('새 담당자');await expect(review.locator('[data-review-field="projectId"]')).toContainText('새 프로젝트');
  await expect(review.locator('[data-review-apply]')).toBeDisabled();
  expect(await review.locator('[data-review-apply]').evaluate(e=>getComputedStyle(e).opacity)).toBe('1');
  await page.screenshot({path:info.outputPath('task-review.png'),animations:'disabled'});
  expect(await review.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.keyboard.press('Escape');await expect(review).toHaveCount(0);await expect(panel).toBeVisible();await expect(title).toHaveValue('조회 중 수정');
  await compare.click();await expect(review).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await expect(review).toHaveCount(0);await expect(title).toHaveValue('조회 중 수정');expect(writes).toHaveLength(0);
  await compare.click();await review.locator('[data-review-field="title"] select').selectOption('draft');await review.locator('[data-review-field="attachmentIds"] select').selectOption('current');
  await review.locator('[data-review-apply]').click();await expect(review).toHaveCount(0);await expect(panel).toContainText('아직 저장하지 않았습니다');
  await expect(title).toHaveValue('조회 중 수정');await expect(body).toHaveValue('@새 담당자 서버 본문 9007199254740993');
  await expect(panel.locator('select[aria-label="담당자"]')).toHaveValue('2');await expect(panel.locator('select[aria-label="프로젝트"]')).toHaveValue('20');
  await expect(panel.getByRole('img',{name:'remote.png'})).toBeVisible();expect(writes).toHaveLength(0);
  latest={...latest,task:{...latest.task,title:'검토 이후 변경',version:3}};await save.click();await expect(panel).toContainText('업무 또는 첨부가 변경됐습니다');
  expect(writes).toHaveLength(0);
  await compare.click();await review.locator('[data-review-field="title"] select').selectOption('draft');await review.locator('[data-review-apply]').click();
  await save.click();await page.getByRole('button',{name:'저장 확인',exact:true}).click();await expect(panel.getByRole('button',{name:'업무 수정',exact:true})).toBeVisible();expect(writes[0].version).toBe(3);expect(writes[0].body).toBe('@[새 담당자](2) 서버 본문 9007199254740993');expect(writes[0].attachmentIds).toEqual(['remote']);
  await panel.getByRole('button',{name:'업무 수정',exact:true}).click();await compare.click();await expect(review).toBeVisible();
  // An active comparison owns the page and rejects navigation until it closes.
  await page.evaluate(()=>{history.pushState(null,'','/kanban');window.dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page).toHaveURL(/\/tasks\/101$/);await expect(review).toBeVisible();await page.keyboard.press('Escape');await expect(review).toHaveCount(0);
  // Once the comparison closes, parent route unmount removes the task modal.
  await page.evaluate(()=>{history.pushState(null,'','/kanban');window.dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page).toHaveURL(/\/kanban$/);await expect(panel).toHaveCount(0);await expect(review).toHaveCount(0);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared mention suggestions preserve IDs, IME and editor focus ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  f.people([{...employee,id:2,department:'운영'},{...employee,id:3,name:'비활성 직원',active:false},{...employee,id:4,name:'공용 직원',shared:true},{...employee,id:5,name:'권한없는 직원',access:false},...Array.from({length:10},(_,i)=>({...employee,id:i+6,name:'검색 동료 '+(i+6)}))]);
  f.directory.profiles={'2':'https://company.example.com/test-assets/mention-profile.svg?v=1'};
  await page.route('**/test-assets/mention-profile.svg?*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#5563d8"/><circle cx="16" cy="16" r="8" fill="white"/></svg>'}));
  const posts=[];
  await page.route('**/api/tasks/101/comments',route=>{posts.push(route.request().postDataJSON());return route.fulfill(commentWriteError(422,'invalid','격리 검증: 저장하지 않음'));});
  await page.goto('https://schedule.workspace.test/tasks/101');const input=page.getByRole('textbox',{name:'새 댓글',exact:true});
  await input.fill('@ㄱㅈㅈㅇ');const list=page.getByRole('listbox',{name:'멘션할 직원'});
  await expect(list.getByRole('option')).toHaveCount(2);await expect(input).toHaveAttribute('aria-expanded','true');
  await expect(list.locator('[data-workspace-entity-id="2"] img')).toHaveAttribute('src',/v=1/);
  f.directory.profiles={'2':'https://company.example.com/test-assets/mention-profile.svg?v=2'};await page.evaluate(()=>window.CompanyWorkspace.refresh());
  await expect(list.locator('[data-workspace-entity-id="2"] img')).toHaveAttribute('src',/v=2/);await expect(input).toHaveValue('@ㄱㅈㅈㅇ');
  await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});await expect(input).toHaveValue('@ㄱㅈㅈㅇ');
  const bounds=await list.boundingBox();expect(bounds.y+bounds.height).toBeLessThanOrEqual(901);
  await page.screenshot({path:info.outputPath('mention-options.png'),animations:'disabled'});
  await input.press('ArrowUp');await page.keyboard.press('Enter');await expect(input).toHaveValue('@검증 직원 · 운영 #2 ');await expect(input).toBeFocused();
  await page.getByRole('button',{name:'댓글 등록',exact:true}).click();await page.getByRole('dialog',{name:'댓글을 등록할까요?'}).getByRole('button',{name:'댓글 등록',exact:true}).click();await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0].body).toBe('@[검증 직원 · 운영 #2](2) ');await expect(input).toHaveValue('@검증 직원 · 운영 #2 ');
  await input.press('End');await input.pressSequentially('@검증 직원');await input.press('Escape');
  await expect(page.locator('dialog.task-dialog')).toBeVisible();await expect(list).toHaveCount(0);
  await page.getByRole('button',{name:'댓글 등록',exact:true}).click();await page.getByRole('dialog',{name:'댓글을 등록할까요?'}).getByRole('button',{name:'댓글 등록',exact:true}).click();await expect.poll(()=>posts.length).toBe(2);
  expect(posts[1].body).toBe('@[검증 직원 · 운영 #2](2) @검증 직원');
  await input.fill('@검색');await expect(list.getByRole('option')).toHaveCount(10);
  await input.press('ArrowUp');await page.keyboard.press('Enter');await expect(input).toHaveValue('@검색 동료 15 ');
  await input.fill('@없는이름');await expect(page.locator('.cw-entity-suggestions [role="status"]')).toHaveText('검색 결과가 없습니다.');await input.press('Escape');
  await input.fill('@');await expect(list.getByRole('option')).toHaveCount(12);
  f.role('employee');await page.evaluate(()=>window.CompanyWorkspace.refresh());await expect(list).toHaveCount(0);await expect(input).toHaveValue('@');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared entity profiles, icons and searchable React selects ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);
  f.directory.profiles={'1':'https://company.example.com/test-assets/profile.svg?v=1'};
  f.directory.projectIcons={'10':'https://company.example.com/test-assets/project.svg?v=1'};
  await page.route('**/test-assets/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="6" fill="#5261dc"/><circle cx="14" cy="14" r="7" fill="white"/></svg>'}));
  await page.goto('https://schedule.workspace.test/');await page.waitForFunction(()=>window.CompanyEntities);
  const header=page.locator('.cw-header [data-workspace-entity="employee"] img').first();
  const board=page.locator('main [data-workspace-entity="employee"] img').first();
  await expect(header).toHaveAttribute('src',/profile.svg\?v=1/);await expect(board).toHaveAttribute('src',/profile.svg\?v=1/);
  const select=page.locator('select[aria-label="담당자 필터"]');await select.press('Space');
  const dialog=page.getByRole('dialog',{name:'담당자 필터',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox').fill('ㄱㅈㅈㅇ');await expect(dialog.getByRole('option')).toHaveCount(1);
  const search=dialog.getByRole('searchbox');
  await search.dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(dialog).toBeVisible();
  await search.dispatchEvent('keydown',{key:'Enter',keyCode:229});await expect(dialog).toBeVisible();
  await search.dispatchEvent('compositionstart',{data:'ㄱ'});
  await search.press('Enter');await expect(dialog).toBeVisible();await expect(select).toHaveValue('');
  await search.press('ArrowDown');await expect(search).toBeFocused();
  await search.dispatchEvent('compositionend',{data:'ㄱㅈㅈㅇ'});
  await expect(dialog.getByRole('searchbox')).toHaveCSS('height','44px');
  await expect(dialog.getByRole('button',{name:'닫기'})).toHaveCSS('box-shadow','none');
  expect(await dialog.getByRole('searchbox').evaluate(node=>getComputedStyle(node).color)).toBe(await dialog.evaluate(node=>getComputedStyle(node).color));
  await expect(dialog.locator('[role=option] img')).toHaveAttribute('src',/profile.svg\?v=1/);
  await page.screenshot({path:info.outputPath('employee-picker.png'),animations:'disabled'});
  f.directory.profiles={'1':'https://company.example.com/test-assets/profile.svg?v=2'};
  await page.evaluate(()=>window.CompanyWorkspace.refresh());
  await expect(dialog).toBeVisible();await expect(dialog.getByRole('searchbox')).toHaveValue('ㄱㅈㅈㅇ');
  await expect(dialog.locator('[role=option] img')).toHaveAttribute('src',/profile.svg\?v=2/);
  await expect(header).toHaveAttribute('src',/profile.svg\?v=2/);await expect(board).toHaveAttribute('src',/profile.svg\?v=2/);
  await dialog.getByRole('searchbox').press('ArrowDown');await page.keyboard.press('Enter');
  await expect(select).toHaveValue('1');await expect(select).toBeFocused();await expect(dialog).toHaveCount(0);
  const projectSelect=page.locator('select[aria-label="프로젝트 필터"]');await projectSelect.press('Space');
  const projects=page.getByRole('dialog',{name:'프로젝트 필터',exact:true});await projects.getByRole('searchbox').fill('ㄱㅈㅍㄹㅈㅌ');
  await expect(projects.getByRole('option')).toHaveCount(1);await expect(projects.locator('[role=option] img')).toHaveAttribute('src',/project.svg/);
  await projects.getByRole('option').click();await expect(projectSelect).toHaveValue('10');
  // Exercise the browser's native reset algorithm, which JSDOM's selectedOptions cache does not model.
  await page.evaluate(()=>{
    const form=document.createElement('form');form.id='entity-reset-fixture';
    const select=document.createElement('select');select.dataset.companyPicker='employee';select.setAttribute('aria-label','초기화 검증 직원');
    select.add(new Option('검증 직원','1',true,true));select.add(new Option('사진 없는 직원','2'));
    form.append(select);document.querySelector('main').append(form);window.CompanyEntities.refresh();
  });
  const reset=page.locator('#entity-reset-fixture select');await reset.press('Space');
  const resetDialog=page.getByRole('dialog',{name:'초기화 검증 직원',exact:true});
  await resetDialog.getByRole('searchbox').press('ArrowUp');await page.keyboard.press('Enter');
  await expect(reset).toHaveValue('2');await expect(reset).toHaveCSS('background-image','none');
  await reset.evaluate(node=>node.form.reset());await expect(reset).toHaveValue('1');
  await expect(reset).toHaveCSS('background-image',/profile.svg\?v=2/);
  await reset.evaluate(node=>node.form.remove());
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const definition of definitions)for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`${definition.id} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);await page.goto('https://schedule.workspace.test'+definition.path.replace(':id','101'));
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',definition.view);
  await expect(page.locator('.cw-page-link')).toHaveCount(definitions.filter(p=>p.nav!==false).length);
  await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page',definition.parent||definition.id);
    await expect(page.locator('.cw-header')).toHaveCount(1);
    await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    await expect(page.locator('.cw-sidebar')).toHaveCount(1);
    if(width<901&&definition.view==='week'){
      await page.evaluate(()=>scrollTo(0,80));
      await expect.poll(()=>page.evaluate(()=>document.querySelector('.schedule-view-switch').getBoundingClientRect().top-document.querySelector('.cw-header').getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(-1);
      expect(await page.locator('.schedule-view-switch').evaluate(node=>getComputedStyle(node).position)).toBe('sticky');
      expect(await page.locator('.schedule-primary-actions').evaluate(node=>getComputedStyle(node).position)).toBe('static');
    }
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  if(definition.view==='task')await expect(page.getByRole('heading',{name:task.title,exact:true})).toBeVisible();
  if(definition.view==='settings')await expect(page.getByRole('heading',{name:'일정 관리',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('content.png'),animations:'disabled'});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(['task','settings'].includes(definition.view))await page.getByRole('button',{name:definition.view==='task'?'업무 닫기':'관리 닫기',exact:true}).click();
  if(width<901)await page.locator('[data-cw-nav]').click();
  await expect.poll(async()=>Math.round((await page.locator('.cw-sidebar').boundingBox()).x)).toBe(0);
  await page.screenshot({path:info.outputPath('navigation.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('schedule navigation preserves board state, task detail and browser history',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const f=await fixture(page);
  await page.goto('https://schedule.workspace.test/kanban');
  await page.locator('.task-card').first().click();
  await expect(page).toHaveURL(/\/tasks\/101$/);
  await expect(page.getByRole('heading',{name:task.title,exact:true})).toBeVisible();
  await page.goBack();await expect(page.locator('dialog.task-dialog')).toHaveCount(0);
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','kanban');
  await page.goForward();await expect(page.locator('dialog.task-dialog')).toBeVisible();
  await page.getByRole('button',{name:'업무 닫기',exact:true}).click();
  await expect(page).toHaveURL(/\/kanban$/);
  for(const view of ['todos','releases','week']){
    await page.locator(`[data-workspace-page="schedule.${view}"]`).click();
    await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',view);
  }
  await page.locator('[data-workspace-page="schedule.settings"]').click();
  await expect(page.getByRole('heading',{name:'일정 관리',exact:true})).toBeVisible();
  await expect(page.locator('.open-schedule-scroll')).toBeVisible();
  await expect(page.locator('.schedule-view-switch')).toHaveCount(0);
  await page.getByRole('button',{name:'관리 닫기',exact:true}).click();
  await expect(page).toHaveURL('https://schedule.workspace.test/');
  expect(f.documents()).toBe(1);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const role of ['employee','lead'])test(`schedule management capability: ${role}`,async({page})=>{
  await page.setViewportSize({width:1440,height:900});const f=await fixture(page,role);
  await page.goto('https://schedule.workspace.test/settings');
  const management=page.locator('[data-workspace-page="schedule.settings"]');
  await expect(management).toHaveCount(1);await expect(page.locator('dialog.task-dialog form')).toBeVisible();
  if(role==='employee'){
    await expect(page.locator('.milestone-editor').getByRole('button',{name:'저장',exact:true})).toBeVisible();
    await expect(page.locator('.milestone-editor').getByRole('button',{name:'삭제',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'보관함',exact:true})).toHaveCount(0);
  }else{
    f.role('employee');await page.evaluate(()=>dispatchEvent(new Event('focus')));
    await expect(management).toHaveCount(1);await expect(page.locator('dialog.task-dialog form')).toBeVisible();
  }
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`management common controls preserve milestone edits and archive navigation ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page),writes=[];
  const longTitle='긴 주요 일정 제목 · '+ '배포 준비와 검수 '.repeat(8);
  let rows=[{...milestone,title:longTitle}],hold=false,finish,reject=false;
  const archivedTitle='보관된 업무 · '+'긴제목모바일줄바꿈'.repeat(12);
  await page.route('**/api/tasks?*',route=>{if(new URL(route.request().url()).searchParams.get('archived')!=='true')return route.fallback();expect(route.request().headers().accept).toBe('application/json');return route.fulfill({json:{items:[{...task,title:archivedTitle,archived:true}],total:1,editableIds:[],commentCounts:[],attachmentCounts:[]}});});
  await page.route(/\/api\/milestones(?:[/?].*)?$/,async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    if(method==='GET'){expect(request.headers().accept).toBe('application/json');const history=url.pathname.match(/^\/api\/milestones\/(\d+)\/history$/);if(history)return route.fulfill({json:milestoneHistory(rows.find(row=>row.id===Number(history[1])))});return route.fulfill({json:url.searchParams.get('editing')==='true'?milestonePage(rows):rows});}
    const headers=request.headers();expect(headers['x-csrf-token']).toBe('synthetic');expect(headers['x-workspace-actor']).toBe('1');expect(headers.accept).toBe(taskWriteMedia);
    const data=request.postDataJSON(),id=method==='POST'?9:Number(url.pathname.split('/').pop()),before=rows.find(row=>row.id===id),previous=method==='POST'?milestoneState(rows):milestoneState(rows,before);writes.push({method,data,url:request.url(),headers});expect(headers['x-workspace-milestone-state']).toBe(previous);
    if(hold)await new Promise(resolve=>{finish=resolve;});
    if(reject){rows=rows.map(row=>({...row,version:row.version+1}));return route.fulfill(commentWriteError(409,'conflict','검증: 일정 버전 충돌'));}
    if(method==='DELETE'){expect(data.version).toBe(before.version);rows=rows.filter(r=>r.id!==id);return route.fulfill(milestoneWriteReply(rows,before,'delete',previous,true));}
    if(method==='PUT')expect(data.version).toBe(before.version);
    const saved={...data,id,version:data.version+1,createdBy:before?.createdBy||1,createdAt:before?.createdAt||'2026-09-07T00:00:00Z',updatedBy:1,updatedAt:'2026-09-10T03:00:00Z'};rows=rows.filter(row=>row.id!==saved.id).concat(saved);return route.fulfill(milestoneWriteReply(rows,saved,method==='POST'?'create':'update',previous));
  });
  await page.goto('https://schedule.workspace.test/settings');const panel=page.locator('.schedule-settings'),form=panel.locator('.milestone-editor');
  const managementDialog=page.locator('dialog:has(.schedule-settings)'),dialogBox=await managementDialog.boundingBox();
  expect(dialogBox).not.toBeNull();expect(Math.abs(dialogBox.x+dialogBox.width/2-width/2)).toBeLessThan(2);
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);expect(dialogBox.y).toBeGreaterThanOrEqual(0);
  await panel.getByRole('button').filter({hasText:longTitle}).click();await expect(form.getByRole('textbox',{name:'제목',exact:true})).toHaveValue(longTitle);
  await expect(panel.getByText('등록: 검증 직원',{exact:false}).first()).toBeVisible();await expect(panel.getByRole('region',{name:'주요 일정 변경 이력'})).toContainText('등록');
  await assertScheduleControls(panel);
  expect(await panel.locator('.settings-list').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await panel.evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:info.outputPath('management-controls.png'),animations:'disabled'});
  const title=form.getByRole('textbox',{name:'제목',exact:true}),description=form.getByRole('textbox',{name:/상세 내용/});
  const draftConfirm=page.getByRole('dialog',{name:'주요 일정 초안을 버릴까요?',exact:true}),newMilestone=form.getByRole('button',{name:'새 일정',exact:true});
  await description.fill('검수 항목\n9007199254740993\n<script>원문 보존</script>');await title.fill('편집한 주요 일정');
  await newMilestone.click();await expect(draftConfirm).toContainText('편집한 주요 일정');await expect(draftConfirm).toContainText('검증 프로젝트');await expect(title).toBeDisabled();
  await page.screenshot({path:info.outputPath('management-draft-confirm.png'),animations:'disabled'});await draftConfirm.locator('[data-confirm-cancel]').click();
  await expect(title).toHaveValue('편집한 주요 일정');await expect(newMilestone).toBeFocused();
  await form.getByRole('combobox',{name:'주요 일정 타입'}).selectOption('prototype');await form.getByRole('textbox',{name:'주요 일정 마감일',exact:true}).fill('2026-09-11');
  reject=true;await form.getByRole('button',{name:'저장',exact:true}).click();let writeConfirm=page.getByRole('dialog',{name:'주요 일정 변경을 저장할까요?'});await expect(writeConfirm).toBeVisible();await writeConfirm.locator('[data-confirm-apply]').click();await expect(panel.locator('[data-state-kind="error"]').first()).toContainText('일정 버전 충돌');await expect(title).toHaveValue('편집한 주요 일정');
  const latest=form.getByRole('button',{name:'최신 내용 불러오기'});await expect(latest).toBeVisible();
  await latest.click();await expect(draftConfirm).toBeVisible();await draftConfirm.locator('[data-confirm-cancel]').click();await expect(title).toHaveValue('편집한 주요 일정');
  await latest.click();await draftConfirm.locator('[data-confirm-apply]').click();await expect(title).toHaveValue(longTitle);
  await title.fill('편집한 주요 일정');await description.fill('검수 항목\n9007199254740993\n<script>원문 보존</script>');await form.getByRole('combobox',{name:'주요 일정 타입'}).selectOption('prototype');await form.getByRole('textbox',{name:'주요 일정 마감일',exact:true}).fill('2026-09-11');
  await form.getByRole('button',{name:'＋ 타입·일정 추가'}).click();await form.getByRole('combobox',{name:'추가 일정 2 타입'}).selectOption('review');await form.getByRole('textbox',{name:'추가 일정 2 마감일'}).fill('2026-09-18');
  reject=false;hold=true;await form.getByRole('button',{name:'저장',exact:true}).click();writeConfirm=page.getByRole('dialog',{name:'주요 일정 변경을 저장할까요?'});await writeConfirm.locator('[data-confirm-apply]').click();await expect.poll(()=>!!finish).toBe(true);await expect(title).toBeDisabled();await assertScheduleControls(panel);
  hold=false;finish();await expect(title).toBeEnabled();expect(writes[1]).toMatchObject({method:'PUT',data:{version:2,type:'prototype',date:'2026-09-11',endDate:null,additionalSchedules:[{type:'review',date:'2026-09-18',endDate:null}],projectId:10,title:'편집한 주요 일정',description:'검수 항목\n9007199254740993\n<script>원문 보존</script>'}});
  await description.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('management-editor.png'),animations:'disabled'});expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await form.getByRole('button',{name:'새 일정',exact:true}).click();await expect(title).toHaveValue('');await title.fill('새 일정 검증');await form.getByRole('button',{name:'저장',exact:true}).click();writeConfirm=page.getByRole('dialog',{name:'주요 일정을 등록할까요?'});await writeConfirm.locator('[data-confirm-apply]').click();await expect(form.getByRole('heading',{name:'주요 일정 수정'})).toBeVisible();expect(writes[2]).toMatchObject({method:'POST',data:{title:'새 일정 검증',version:0,projectId:null}});
  const deleteConfirm=page.locator('dialog.cw-confirm');await form.getByRole('button',{name:'삭제',exact:true}).click();
  await expect(deleteConfirm).toContainText('새 일정 검증');await expect(deleteConfirm).toContainText('프로젝트 미지정');
  await page.screenshot({path:info.outputPath('management-delete-confirm.png'),animations:'disabled'});
  await deleteConfirm.locator('[data-confirm-cancel]').click();await expect(form.getByRole('button',{name:'삭제',exact:true})).toBeFocused();expect(writes).toHaveLength(3);
  await form.getByRole('button',{name:'삭제',exact:true}).click();await deleteConfirm.locator('[data-confirm-apply]').click();
  await expect(form.getByRole('heading',{name:'주요 일정 추가'})).toBeVisible();expect(writes[3].method).toBe('DELETE');
  await panel.getByRole('button',{name:'보관함',exact:true}).click();await expect(panel.getByRole('button',{name:'보관함',exact:true})).toHaveAttribute('aria-pressed','true');
  const archiveCard=panel.locator('.settings-list').getByRole('button').filter({hasText:archivedTitle});await expect(archiveCard).toBeVisible();expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('management-archive.png'),animations:'disabled'});
  await archiveCard.click();await expect(page).toHaveURL(/\/tasks\/101$/);await expect(page.locator('.task-dialog h1')).toHaveText(task.title);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`management modal keeps its header and close action visible while scrolling ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  await page.goto('https://schedule.workspace.test/settings');const panel=page.locator('.schedule-settings'),toolbar=panel.locator('.schedule-settings-toolbar');
  await expect(toolbar.getByRole('heading',{name:'일정 관리',exact:true})).toBeVisible();await panel.evaluate(e=>e.scrollTo({top:320,behavior:'instant'}));
  const sticky=await panel.evaluate(element=>{const scroll=element.getBoundingClientRect(),head=element.querySelector('.schedule-settings-toolbar').getBoundingClientRect(),hit=document.elementFromPoint(head.left+Math.min(20,head.width/2),head.top+Math.min(20,head.height/2));return{scrollTop:element.scrollTop,top:head.top-scroll.top,left:head.left-scroll.left,right:scroll.right-head.right,hit:Boolean(hit?.closest('.schedule-settings-toolbar'))};});
  expect(sticky.scrollTop).toBeGreaterThan(0);expect(Math.abs(sticky.top)).toBeLessThanOrEqual(1);expect(Math.abs(sticky.left)).toBeLessThanOrEqual(1);expect(sticky.right).toBeLessThanOrEqual(20);expect(sticky.hit).toBe(true);await expect(toolbar.getByRole('button',{name:'관리 닫기',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('management-sticky-header.png'),animations:'disabled'});expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('management archive pagination validates and appends a stable next page',async({page})=>{
  const f=await fixture(page),calls=[];
  await page.route('**/api/tasks?*',route=>{
    const url=new URL(route.request().url());if(url.searchParams.get('archived')!=='true')return route.fallback();
    expect(route.request().headers().accept).toBe('application/json');const skip=Number(url.searchParams.get('skip')||0);calls.push(skip);
    const item={...task,id:skip?202:101,title:skip?'두 번째 보관 업무':'첫 번째 보관 업무',archived:true};
    return route.fulfill({json:{items:[item],total:2,editableIds:[],commentCounts:[],attachmentCounts:[]}});
  });
  await page.goto('https://schedule.workspace.test/settings');const panel=page.locator('.schedule-settings');await panel.getByRole('button',{name:'보관함',exact:true}).click();
  await expect(panel.getByText('첫 번째 보관 업무',{exact:true})).toBeVisible();await panel.getByRole('button',{name:'더 보기',exact:true}).click();
  await expect(panel.getByText('두 번째 보관 업무',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'더 보기',exact:true})).toHaveCount(0);
  expect(calls).toEqual([0,1]);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`calendar common controls retain nested focus, dates and holiday fallback ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);let holidayFailure=false;
  await page.route('**/api/absences?*',route=>{
    expect(route.request().headers().accept).toBe('application/json');
    return holidayFailure?route.fulfill({status:503,json:{error:'격리 공휴일 장애'}}):route.fallback();
  });
  await page.goto('https://schedule.workspace.test/');const opener=page.getByRole('button',{name:/^날짜로 이동:/});await opener.click();
  const navigation=page.locator('dialog.date-navigation-dialog'),date=navigation.getByRole('textbox',{name:'이동할 날짜',exact:true}),calendar=page.locator('dialog.calendar-picker-dialog');
  await expect(navigation).toBeVisible();await assertScheduleControls(navigation);await date.fill('2026-02-30');await navigation.getByRole('button',{name:'이동',exact:true}).click();await expect(navigation).toBeVisible();expect(await date.evaluate(e=>e.validity.valid)).toBe(false);
  await date.fill('2026-09-07');await navigation.getByRole('button',{name:'이동할 날짜 달력 열기'}).click();
  await expect(calendar.getByRole('button',{name:'2026-09-09 수요일 · 검증 공휴일',exact:true})).toBeVisible();await assertScheduleControls(calendar);
  expect(await calendar.getByRole('spinbutton',{name:'달력 연도'}).evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(88);
  const colors=await calendar.evaluate(root=>{const probe=document.createElement('span');root.append(probe);const token=name=>{probe.style.color=`var(--cw-${name})`;return getComputedStyle(probe).color;};const result={saturday:getComputedStyle(root.querySelector('button[aria-label="2026-09-12 토요일 · 주말"]>span')).color,holiday:getComputedStyle(root.querySelector('button[aria-label="2026-09-09 수요일 · 검증 공휴일"]>span')).color,accent:token('accent'),danger:token('danger')};probe.remove();return result;});expect(colors.saturday).toBe(colors.accent);expect(colors.holiday).toBe(colors.danger);
  expect(await calendar.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await expect(calendar.locator('.calendar-day-buttons button')).toHaveCount(42);
  const geometry=await calendar.locator('.calendar-day-buttons button').evaluateAll(nodes=>nodes.map(node=>({w:node.getBoundingClientRect().width,h:node.getBoundingClientRect().height,overflow:node.scrollWidth-node.clientWidth})));
  for(const cell of geometry){expect(cell.w).toBeGreaterThanOrEqual(32);expect(cell.h).toBeGreaterThanOrEqual(52);expect(cell.overflow).toBeLessThanOrEqual(1);}
  await assertScheduleModal(calendar);await page.screenshot({path:info.outputPath('calendar-controls.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(calendar).toHaveCount(0);await expect(navigation).toBeVisible();await expect(date).toBeFocused();
  await navigation.getByRole('button',{name:'이동할 날짜 달력 열기'}).click();await calendar.getByRole('spinbutton',{name:'달력 연도'}).fill('2028');await page.keyboard.press('Tab');await calendar.getByRole('combobox',{name:'달력 월'}).selectOption('02');
  await calendar.getByRole('button',{name:'2028-02-29 화요일',exact:true}).click();await expect(date).toHaveValue('2028-02-29');await expect(date).toBeFocused();
  await navigation.getByRole('button',{name:'취소',exact:true}).click();await expect(navigation).not.toBeVisible();await expect(opener).toBeFocused();
  await opener.click();await expect(date).toHaveValue('2026-09-07');await date.fill('2026-09-21');await navigation.getByRole('button',{name:'이동',exact:true}).click();await expect(navigation).not.toBeVisible();await expect(opener).toHaveAttribute('aria-label',/2026-09-21/);
  await page.goto('https://schedule.workspace.test/tasks/101');const taskPanel=page.locator('.task-dialog');await taskPanel.getByRole('button',{name:'업무 수정',exact:true}).click();
  holidayFailure=true;await taskPanel.getByRole('button',{name:'종료일 달력 열기'}).click();await expect(calendar.locator('[data-state-kind="error"]')).toContainText('주말만 표시합니다');
  await expect(calendar.getByRole('button',{name:'2026-09-06 일요일 · 주말',exact:true})).toBeDisabled();await assertScheduleControls(calendar);
  await page.screenshot({path:info.outputPath('calendar-fallback.png'),animations:'disabled'});
  holidayFailure=false;await calendar.getByRole('button',{name:'다시 시도',exact:true}).click();await expect(calendar.getByRole('button',{name:'2026-09-09 수요일 · 검증 공휴일',exact:true})).toBeVisible();await expect(calendar.locator('[data-state-kind="error"]')).toHaveCount(0);
  await calendar.getByRole('button',{name:'날짜 지우기',exact:true}).click();await expect(taskPanel.getByRole('textbox',{name:'종료일',exact:true})).toHaveValue('');await expect(taskPanel).toBeVisible();
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`owned task modal preserves nested order, scope drafts and guarded close ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page),native=[];page.on('dialog',dialog=>native.push(dialog.message()));
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');
  await panel.getByRole('button',{name:'업무 수정',exact:true}).click();const title=panel.getByRole('textbox',{name:'제목',exact:true}),close=panel.getByRole('button',{name:'업무 닫기',exact:true}),discard=page.getByRole('dialog',{name:'작성 중인 내용을 버리고 업무를 닫을까요?',exact:true});
  await title.fill('창을 닫아도 확인 없이 잃으면 안 되는 초안');await panel.getByRole('button',{name:'시작일 달력 열기'}).click();
  const calendar=page.locator('.calendar-picker-dialog');await expect(calendar).toBeVisible();
  await panel.evaluate(e=>e.close());await expect(calendar).toBeVisible();await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');await expect(calendar).toHaveCount(0);await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox',{name:'시작일',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(discard).toBeVisible();await expect(discard).toContainText('업무 수정');await expect(title).toBeDisabled();await page.keyboard.press('Escape');await expect(title).toHaveValue('창을 닫아도 확인 없이 잃으면 안 되는 초안');
  await panel.getByRole('button',{name:'시작일 달력 열기'}).click();await expect(calendar).toBeVisible();
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await expect(calendar).toHaveCount(0);await expect(panel).toBeVisible();await expect(title).toHaveValue('창을 닫아도 확인 없이 잃으면 안 되는 초안');
  await close.click();await expect(discard).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(discard).toHaveCount(0);await expect(panel).toBeVisible();await expect(title).toHaveValue('창을 닫아도 확인 없이 잃으면 안 되는 초안');
  await panel.locator('.detail-panel').evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));await assertScheduleModal(panel);
  const workspace=await panel.evaluate(dialog=>{const rect=dialog.getBoundingClientRect();return {placement:dialog.getAttribute('data-placement'),left:rect.left,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight};});
  expect(workspace.placement).toBeNull();
  if(width===1440){expect(workspace.width).toBeGreaterThanOrEqual(1100);expect(Math.abs(workspace.left-(workspace.viewportWidth-workspace.width)/2)).toBeLessThanOrEqual(2);expect(workspace.height).toBeGreaterThanOrEqual(840);}
  else{expect(workspace.width).toBeGreaterThanOrEqual(width-1);expect(workspace.height).toBeGreaterThanOrEqual(workspace.viewportHeight-1);}
  const scroller=panel.locator('.detail-panel'),toolbar=panel.locator('.task-detail-toolbar');await scroller.evaluate(e=>e.scrollTo({top:320,behavior:'instant'}));
  const sticky=await panel.evaluate(dialog=>{const scroll=dialog.querySelector('.detail-panel').getBoundingClientRect(),head=dialog.querySelector('.task-detail-toolbar').getBoundingClientRect(),hit=document.elementFromPoint(head.left+Math.min(20,head.width/2),head.top+Math.min(20,head.height/2));return{top:head.top-scroll.top,left:head.left-scroll.left,right:scroll.right-head.right,hit:Boolean(hit?.closest('.task-detail-toolbar'))};});
  expect(Math.abs(sticky.top)).toBeLessThanOrEqual(1);expect(Math.abs(sticky.left)).toBeLessThanOrEqual(1);expect(sticky.right).toBeLessThanOrEqual(20);expect(sticky.hit).toBe(true);
  await page.screenshot({path:info.outputPath('task-workspace.png'),animations:'disabled'});
  await close.click();await expect(discard).toBeVisible();await expect(discard).toContainText('창을 닫아도 확인 없이 잃으면 안 되는 초안');await page.screenshot({path:info.outputPath('task-close-discard.png'),animations:'disabled'});await discard.locator('[data-confirm-apply]').click();await expect(panel).toHaveCount(0);
  expect(native).toEqual([]);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`owned image modal bounds large media and keeps return focus ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:800});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const name='긴-첨부-이미지-파일명-'.repeat(4)+'.png';
  const images=['wide','tall'].map(id=>({id,taskId:101,commentId:null,name:id+name,size:100,contentType:'image/png',ownerId:1,createdAt:task.createdAt}));
  await page.route('**/api/tasks/101',route=>route.fulfill({json:withTaskWriteState({task,canEdit:true,comments:[],attachments:images,history:[]})}));
  await page.route('**/api/images/*',route=>{const wide=route.request().url().endsWith('/wide');return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${wide?2400:600}" height="${wide?600:2400}"><rect width="100%" height="100%" fill="teal"/></svg>`});});
  await page.goto('https://schedule.workspace.test/tasks/101');const panel=page.locator('.task-dialog');
  for(const item of images){const trigger=panel.getByRole('button',{name:item.name,exact:true});await trigger.click();const modal=panel.locator('.lightbox');
    await expect(modal).toBeVisible();await assertScheduleModal(modal);
    const geometry=await modal.evaluate(e=>{const image=e.querySelector('img'),rect=image.getBoundingClientRect(),close=e.querySelector('button').getBoundingClientRect();return {ratio:rect.width/rect.height,natural:image.naturalWidth/image.naturalHeight,top:rect.top,close:close.bottom};});
    expect(geometry.ratio).toBeCloseTo(geometry.natural,2);expect(geometry.top).toBeGreaterThanOrEqual(geometry.close+4);
    await page.screenshot({path:info.outputPath(item.id+'-image-modal.png'),animations:'disabled'});
    await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(trigger).toBeFocused();await expect(panel).toBeVisible();
  }
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('management shared draft confirmation protects browser-back navigation',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const f=await fixture(page),native=[];page.on('dialog',async dialog=>{native.push(dialog.message());await dialog.dismiss();});
  await page.goto('https://schedule.workspace.test/');
  await page.locator('[data-workspace-page="schedule.settings"]').click();
  let title=page.locator('dialog form').getByLabel('제목',{exact:true});const discard=page.getByRole('dialog',{name:'주요 일정 초안을 버릴까요?',exact:true}),close=page.getByRole('button',{name:'관리 닫기',exact:true});
  await title.fill('닫기 전 검증 초안');await close.click();await expect(discard).toBeVisible();await discard.locator('[data-confirm-cancel]').click();await expect(title).toHaveValue('닫기 전 검증 초안');await expect(close).toBeFocused();
  await close.click();await discard.locator('[data-confirm-apply]').click();await expect(page).toHaveURL('https://schedule.workspace.test/');await expect(page.locator('dialog.task-dialog')).toHaveCount(0);
  await page.locator('[data-workspace-page="schedule.settings"]').click();title=page.locator('dialog form').getByLabel('제목',{exact:true});await title.fill('저장 전 검증 초안');
  await page.goBack();
  await expect(discard).toBeVisible();await discard.locator('[data-confirm-cancel]').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(title).toHaveValue('저장 전 검증 초안');
  await page.goBack();await expect(discard).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(discard).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings$/);await expect(title).toHaveValue('저장 전 검증 초안');
  await page.goBack();await expect(discard).toBeVisible();await discard.locator('[data-confirm-apply]').click();await expect(page.locator('dialog.task-dialog')).toHaveCount(0);
  expect(native).toEqual([]);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('schedule legacy entry and comment fragment still resolve',async({page})=>{
  const f=await fixture(page);await page.goto('https://schedule.workspace.test/index.html');
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','week');
  await page.goto('https://schedule.workspace.test/tasks/101#comment-7');
  await expect(page.locator('#comment-7')).toBeVisible();
  expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`task editing uses shared confirmation and retains its draft when back is cancelled ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page),native=[];page.on('dialog',dialog=>native.push(dialog.message()));await page.goto('https://schedule.workspace.test/');
  await page.goto('https://schedule.workspace.test/tasks/101#comment-7');
  await page.getByRole('button',{name:'업무 수정',exact:true}).click();
  const panel=page.locator('dialog.task-dialog'),title=panel.getByLabel('제목',{exact:true}),discard=page.getByRole('dialog',{name:'작성 중인 내용을 버리고 이전 화면으로 이동할까요?',exact:true});await title.fill('저장 전 업무 초안');
  // Add a same-document entry so this verifies the shared router, not beforeunload.
  await page.evaluate(()=>{history.replaceState({},'','/');history.pushState({},'','/tasks/101#comment-7');});
  await page.goBack();await expect(discard).toBeVisible();await expect(discard).toContainText('업무 수정');await expect(discard).toContainText(task.title);await expect(title).toBeDisabled();
  if(width===320&&theme==='dark')await page.screenshot({path:info.outputPath('task-history-discard.png'),animations:'disabled'});
  await discard.locator('[data-confirm-cancel]').click();await expect(page).toHaveURL(/\/tasks\/101#comment-7$/);await expect(title).toHaveValue('저장 전 업무 초안');await expect(title).toBeFocused();
  await page.goBack();await expect(discard).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(discard).toHaveCount(0);await expect(page).toHaveURL(/\/tasks\/101#comment-7$/);await expect(title).toHaveValue('저장 전 업무 초안');
  await page.goBack();await expect(discard).toBeVisible();await discard.locator('[data-confirm-apply]').click();await expect(panel).toHaveCount(0);
  expect(native).toEqual([]);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});
