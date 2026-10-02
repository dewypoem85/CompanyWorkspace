import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkScheduleTaskWrites,checkScheduleTaskWriteClient,checkScheduleQuickStatusClient,checkScheduleImageUploads,checkScheduleCommentWrites,checkScheduleMilestoneWrites,checkScheduleTaskActions,checkScheduleReleaseWrites,checkSchedulePersonalTodoWrites} from '../check-schedule-task-writes.mjs';
const routes=readFileSync(new URL('../../apps/schedule/server/TaskRoutes.cs',import.meta.url),'utf8');
const protocol=readFileSync(new URL('../../apps/schedule/server/TaskWriteProtocol.cs',import.meta.url),'utf8');

test('task client cannot omit shared transport, captured intent or full ACK checks',()=>{
  const read=name=>readFileSync(new URL('../../apps/schedule/src/'+name,import.meta.url),'utf8');
  const panel=read('TaskPanel.tsx'),hook=read('useTaskWrites.ts'),contract=read('taskWrites.ts');
  assert.deepEqual(checkScheduleTaskWriteClient(panel,hook,contract),[]);
  for(const marker of ['useTaskWrites({','void writes.run();','void writes.run(e.target.value as Status)','writes.recover(latest,directory)'])assert.ok(checkScheduleTaskWriteClient(panel.replaceAll(marker,''),hook,contract).length,marker);
  for(const marker of ['createWorkspaceWriteTransport(',"forms.begin(owner.current,[resource])",'lease.markSent()','confirmWorkspaceAction(','confirmTaskReceipt(value,active.write,sent)',"reads.current.run('saved'",'transport.current?.dispose()'])assert.ok(checkScheduleTaskWriteClient(panel,hook.replaceAll(marker,''),contract).length,marker);
  for(const marker of ['data.previousStateToken===write.stateToken','data.task.version===write.draft.form.version+1','data.attachments.length===expectedImages.size'])assert.ok(checkScheduleTaskWriteClient(panel,hook,contract.replaceAll(marker,'')).length,marker);
  assert.ok(checkScheduleTaskWriteClient(panel,hook+'\nfetch("/api/tasks")',contract).length);
});
test('kanban status cannot restore the raw PATCH shortcut or skip current account and row checks',()=>{
  const read=name=>readFileSync(new URL('../../apps/schedule/src/'+name,import.meta.url),'utf8');
  const app=read('App.tsx'),hook=read('useTaskQuickStatus.ts'),contract=read('taskWrites.ts');
  assert.deepEqual(checkScheduleQuickStatusClient(app,hook,contract),[]);
  for(const marker of ['useTaskQuickStatus({','refreshBoard:()=>refresh(true,true)','void quickStatus.run(t, status as Status)','disabled={quickStatus.busyTaskId!==null||quickStatus.locked}',"if(quickStatus.outcome)notices.push({id:'quick-status',state:quickStatus.outcome})",'notices.map(notice=><ScheduleToastNotice key={notice.id} {...notice}/>)'])assert.ok(checkScheduleQuickStatusClient(app.replaceAll(marker,''),hook,contract).length,marker);
  for(const marker of ["workspaceDocumentFormSession('schedule-task-writes')",'createWorkspaceReadSession()','start.refreshIdentity()','taskWriteBaseline(checked.value.detail','confirmWorkspaceAction({','lease.markSent()','confirmTaskReceipt(value,active.write,sent)',"lease.finish('saved')",'await live.current.refreshBoard()'])assert.ok(checkScheduleQuickStatusClient(app,hook.replaceAll(marker,''),contract).length,marker);
  for(const marker of ['data.previousStateToken===write.stateToken','data.task.version===write.draft.form.version+1'])assert.ok(checkScheduleQuickStatusClient(app,hook,contract.replaceAll(marker,'')).length,marker);
  assert.ok(checkScheduleQuickStatusClient(app+'\nasync function raw(t){await api(`/api/tasks/${t.id}/status`, \'PATCH\', {});}',hook,contract).some(error=>error.includes('raw status writer')));
  assert.ok(checkScheduleQuickStatusClient(app,hook+'\nfetch("/api/tasks/1/status")',contract).some(error=>error.includes('shared read and write')));
});
test('image upload cannot restore the raw multipart shortcut or accept an incomplete receipt',()=>{
  const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  const values={routes:read('apps/schedule/server/ImageRoutes.cs'),protocol:read('apps/schedule/server/ImageWriteProtocol.cs'),editor:read('apps/schedule/src/Editor.tsx'),hook:read('apps/schedule/src/useImageUploads.ts'),contract:read('apps/schedule/src/imageUploads.ts'),form:read('packages/workspace-ui/react/workspace-form.ts')};
  const check=(patch={})=>checkScheduleImageUploads(...['routes','protocol','editor','hook','contract','form'].map(key=>patch[key]??values[key]));
  assert.deepEqual(check(),[]);
  for(const marker of ['ImageWriteProtocol.RequireActor(req, me)','ImageWriteProtocol.StartingWrite(req)','IncrementalHash.CreateHash(HashAlgorithmName.SHA256)','ImageWriteProtocol.Saved(req, me, image, sha256)'])assert.ok(check({routes:values.routes.replaceAll(marker,'')}).length,marker);
  for(const marker of ["workspaceDocumentFormSession('schedule-image-uploads')",'start.refreshIdentity()','captureImageUpload(file,directory)','confirmWorkspaceAction({','lease.markSent()',"writer.send({url:'/api/images'",'confirmImageUploadReceipt(value,command.intent,sent)',"lease.finish('saved')"])assert.ok(check({hook:values.hook.replaceAll(marker,'')}).length,marker);
  for(const marker of ['data.sha256===intent.sha256','sent instanceof FormData','image.ownerId===Number(intent.actorId)','image.taskId===null&&image.commentId===null'])assert.ok(check({contract:values.contract.replaceAll(marker,'')}).length,marker);
  assert.ok(check({editor:values.editor+'\napi<Attachment>(\'/api/images\',\'POST\',new FormData())'}).some(error=>error.includes('raw upload')));
  assert.ok(check({hook:values.hook+'\nfetch(\'/api/images\')'}).some(error=>error.includes('shared transport')));
});
test('comment writes cannot omit checked baselines, confirmation or full acknowledgements',()=>{
  const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  const values={routes:read('apps/schedule/server/DiscussionRoutes.cs'),protocol:read('apps/schedule/server/CommentWriteProtocol.cs'),taskRoutes:read('apps/schedule/server/TaskRoutes.cs'),composer:read('apps/schedule/src/CommentComposer.tsx'),panel:read('apps/schedule/src/TaskPanel.tsx'),hook:read('apps/schedule/src/useCommentWrites.ts'),contract:read('apps/schedule/src/commentWrites.ts')};
  const keys=['routes','protocol','taskRoutes','composer','panel','hook','contract'];const check=(patch={})=>checkScheduleCommentWrites(...keys.map(key=>patch[key]??values[key]));
  assert.deepEqual(check(),[]);
  for(const marker of ['CommentWriteProtocol.RequireActor(request, me)','CommentWriteProtocol.RequireState(request, db, task,','CommentWriteProtocol.StartingWrite(request)'])assert.ok(check({routes:values.routes.replaceAll(marker,'')}).length,marker);
  for(const marker of ["workspaceDocumentFormSession('schedule-comment-writes')",'captureCommentWrite(','commentWriteBaseline(fresh.value.detail','confirmWorkspaceAction({','lease.markSent()','confirmCommentReceipt(value,active.write,sent)',"'X-Workspace-Target-State':write.stateToken","lease.finish('saved')",'recoverScope()'])assert.ok(check({hook:values.hook.replaceAll(marker,'')}).length,marker);
  for(const marker of ['JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','comment.version===write.draft.version+1','data.attachments.length===expected.size'])assert.ok(check({contract:values.contract.replaceAll(marker,'')}).length,marker);
  assert.ok(check({panel:values.panel+'\nconst bad=<CommentComposer submit={async()=>api(`/api/comments/7`,\'PUT\',{})}/>;'}).some(error=>error.includes('raw comment writer')));
  assert.ok(check({hook:values.hook+'\nfetch(`/api/comments/7`)'}).some(error=>error.includes('shared read and write')));
});
test('milestone writes cannot omit checked baselines, confirmation or full acknowledgements',()=>{
  const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  const values={routes:read('apps/schedule/server/ManagementRoutes.cs'),protocol:read('apps/schedule/server/MilestoneWriteProtocol.cs'),settings:read('apps/schedule/src/Settings.tsx'),hook:read('apps/schedule/src/useMilestoneWrites.ts'),contract:read('apps/schedule/src/milestoneWrites.ts'),reads:read('apps/schedule/src/scheduleReads.ts')};
  const keys=['routes','protocol','settings','hook','contract','reads'];const check=(patch={})=>checkScheduleMilestoneWrites(...keys.map(key=>patch[key]??values[key]));
  assert.deepEqual(check(),[]);
  for(const marker of ['MilestoneWriteProtocol.RequireActor(request, me)','MilestoneWriteProtocol.RequireState(request, me,','MilestoneWriteProtocol.StartingWrite(request)','await transaction.CommitAsync()'])assert.ok(check({routes:values.routes.replaceAll(marker,'')}).length,marker);
  for(const marker of ["workspaceDocumentFormSession('schedule-milestone-writes')",'createWorkspaceReadSession()','captureMilestoneWrite(','milestoneWriteBaseline(fresh.value.page','confirmWorkspaceAction({','lease.markSent()','confirmMilestoneReceipt(value,active.write,sent)',"'X-Workspace-Milestone-State':write.stateToken","lease.finish('saved')",'await start.readPage()'])assert.ok(check({hook:values.hook.replaceAll(marker,'')}).length,marker);
  assert.ok(check({protocol:values.protocol.replace('x.DeadlineMemo, x.Date, x.EndDate, x.AdditionalSchedulesJson,','')}).length,'deadline notes and additional schedules must participate in milestone state tokens');
  for(const marker of ['JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','data.stateToken!==write.stateToken','saved.version===write.draft.version+1','JSON.stringify(saved)===JSON.stringify(write.before)'])assert.ok(check({contract:values.contract.replaceAll(marker,'')}).length,marker);
  assert.ok(check({settings:values.settings+'\napi<Milestone>(\'/api/milestones\',\'POST\',{})'}).some(error=>error.includes('raw milestone writer')));
  assert.ok(check({hook:values.hook+'\nfetch(\'/api/milestones\')'}).some(error=>error.includes('shared read and write')));
});
test('task archive, restore and comment deletion cannot bypass the common action lifecycle',()=>{
  const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  const values={taskRoutes:read('apps/schedule/server/TaskRoutes.cs'),discussionRoutes:read('apps/schedule/server/DiscussionRoutes.cs'),taskProtocol:read('apps/schedule/server/TaskWriteProtocol.cs'),commentProtocol:read('apps/schedule/server/CommentWriteProtocol.cs'),panel:read('apps/schedule/src/TaskPanel.tsx'),hook:read('apps/schedule/src/useTaskActions.ts'),contract:read('apps/schedule/src/taskActions.ts'),spec:read('packages/contracts/schedule-task-actions.md')};
  const keys=['taskRoutes','discussionRoutes','taskProtocol','commentProtocol','panel','hook','contract','spec'];const check=(patch={})=>checkScheduleTaskActions(...keys.map(key=>patch[key]??values[key]));
  assert.deepEqual(check(),[]);
  for(const marker of ['TaskWriteProtocol.RequireActor(request, me)','TaskWriteProtocol.RequireState(request, db, task)','TaskWriteProtocol.StartingWrite(request)','await transaction.CommitAsync()'])assert.ok(check({taskRoutes:values.taskRoutes.replaceAll(marker,'')}).length,marker);
  for(const marker of ['CommentWriteProtocol.RequireActor(request, me)','CommentWriteProtocol.RequireState(request, db, task, comment)','CommentWriteProtocol.StartingWrite(request)','CommentWriteProtocol.Deleted(request, db, me, task, comment, previousStateToken)'])assert.ok(check({discussionRoutes:values.discussionRoutes.replaceAll(marker,'')}).length,marker);
  for(const marker of ["workspaceDocumentFormSession('schedule-task-actions')",'createWorkspaceWriteTransport({','captureTaskAction(','confirmWorkspaceAction({','lease.markSent()','writer.send({url:','confirmTaskActionReceipt(value,active.write,sent)',"lease.finish('saved')",'await read(id,scope,generation,write.action)','forms.current?.invalid&&!forms.current.recoverScope()'])assert.ok(check({hook:values.hook.replaceAll(marker,'')}).length,marker);
  for(const marker of ['JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','data.stateToken!==write.stateToken','data.attachments.length===action.attachments.length','comment.version===before.version+1'])assert.ok(check({contract:values.contract.replaceAll(marker,'')}).length,marker);
  assert.ok(check({hook:values.hook+'\nfetch(`/api/tasks/1/archive`)'}).some(error=>error.includes('shared transport')));
  assert.ok(check({panel:values.panel+'\napi(`/api/comments/7`,\'DELETE\')'}).some(error=>error.includes('raw action')));
});
test('release creation and updates cannot bypass checked common writes',()=>{
  const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  const values={routes:read('apps/schedule/server/ReleaseRoutes.cs'),protocol:read('apps/schedule/server/ReleaseWriteProtocol.cs'),view:read('apps/schedule/src/Releases.tsx'),hook:read('apps/schedule/src/useReleaseEditor.ts'),contract:read('apps/schedule/src/releaseWrites.ts'),spec:read('packages/contracts/schedule-release-writes.md')};
  const keys=['routes','protocol','view','hook','contract','spec'];const check=(patch={})=>checkScheduleReleaseWrites(...keys.map(key=>patch[key]??values[key]));
  assert.deepEqual(check(),[]);
  for(const marker of ['ReleaseWriteProtocol.RequireActor(request, me)','ReleaseWriteProtocol.RequireState(request, me,','ReleaseWriteProtocol.StartingWrite(request)','await tx.CommitAsync()'])assert.ok(check({routes:values.routes.replaceAll(marker,'')}).length,marker);
  for(const marker of ["workspaceDocumentFormSession('schedule-release-writes')",'createWorkspaceReadSession()','scheduleGet(`/api/releases/editing?${query}`','captureReleaseWrite(','confirmWorkspaceAction({','lease.markSent()','confirmReleaseReceipt(value,active.write,sent)',"'X-Workspace-Release-State':write.stateToken","lease.finish('saved')"])assert.ok(check({hook:values.hook.replaceAll(marker,'')}).length,marker);
  for(const marker of ['JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','data.stateToken!==write.stateToken','confirmReleaseSaved(data.release,write.draft,write.before,Number(write.actorId))'])assert.ok(check({contract:values.contract.replaceAll(marker,'')}).length,marker);
  assert.ok(check({hook:values.hook+'\nfetch(`/api/releases`)'}).some(error=>error.includes('shared read and write')));
  assert.ok(check({view:values.view+'\napi(`/api/releases`,\'POST\',{})'}).some(error=>error.includes('raw release writer')));
});
test('personal TODO writes cannot bypass checked baselines, leases or full acknowledgements',()=>{
  const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  const values={routes:read('apps/schedule/server/PersonalTodoRoutes.cs'),protocol:read('apps/schedule/server/PersonalTodoWriteProtocol.cs'),hook:read('apps/schedule/src/usePersonalTodos.ts'),contract:read('apps/schedule/src/personalTodoWrites.ts'),spec:read('packages/contracts/schedule-todo-writes.md')};
  const keys=['routes','protocol','hook','contract','spec'];const check=(patch={})=>checkSchedulePersonalTodoWrites(...keys.map(key=>patch[key]??values[key]));
  assert.deepEqual(check(),[]);
  for(const marker of ['PersonalTodoWriteProtocol.RequireActor(request, me)','PersonalTodoWriteProtocol.RequireState(request, me,','PersonalTodoWriteProtocol.StartingWrite(request)','await transaction.CommitAsync()'])assert.ok(check({routes:values.routes.replaceAll(marker,'')}).length,marker);
  for(const marker of ["workspaceDocumentFormSession('schedule-todo-writes')",'createWorkspaceWriteTransport({',"reader.run('todo-write-preflight'",'captureTodoWrite(','forms.begin(','lease.markSent()','writer.send({url,method,json:write.body',"'X-Workspace-Todo-State':write.stateToken",'active.receipt=confirmTodoReceipt(value,active.write,sent)',"lease.finish('saved')",'const next=await read(generation,actor,tab)'])assert.ok(check({hook:values.hook.replaceAll(marker,'')}).length,marker);
  for(const marker of ['JSON.stringify(sent) === JSON.stringify(write.body)','receipt.previousStateToken === write.stateToken','receipt.stateToken !== write.stateToken','confirmTodoResult(receipt.todo, write.command, ownerId)','receipt.deleted && fullSignature(todo) === fullSignature(write.command.item)','JSON.stringify(todos.map(item => item.id)) === JSON.stringify(write.command.ids)'])assert.ok(check({contract:values.contract.replaceAll(marker,'')}).length,marker);
  assert.ok(check({hook:values.hook+'\nfetch(`/api/personal-todos`,{method:\'POST\'})'}).some(error=>error.includes('shared read and write')));
  assert.ok(check({hook:values.hook+'\napi(`/api/personal-todos`,\'POST\',{})'}).some(error=>error.includes('raw writer')));
  for(const marker of ['workspace-form-v1','X-Workspace-Actor','X-Workspace-Todo-State','전체 JSON','트랜잭션','자동 또는 수동으로 재전송하지 않는다'])assert.ok(check({spec:values.spec.replaceAll(marker,'')}).length,marker);
});
test('task write server uses explicit actor/baseline/commit and common envelope boundaries',()=>{
  assert.deepEqual(checkScheduleTaskWrites(routes,protocol),[]);
  for(const marker of ['TaskWriteProtocol.RequireActor(request, me)','TaskWriteProtocol.RequireState(request, db, task)',
    'TaskWriteProtocol.StartingWrite(request)', 'await transaction.CommitAsync()', '.AddEndpointFilter<TaskWriteProtocol>()',
    'editing = new { actorId = me.Id.ToString(']){
    assert.ok(routes.includes(marker),marker);
    assert.ok(checkScheduleTaskWrites(routes.replaceAll(marker,''),protocol).length,marker);
  }
  for(const marker of ['request.Headers[StateHeader].ToString() != token','request.Headers[ActorHeader].ToString() != me.Id.ToString(',
    'x.TaskId == task.Id && x.CommentId == null','task.ProjectId, task.GoalId, task.StartDate, task.EndDate',
    'x.CommentId, x.Name, x.ContentType, x.Size','!context.HttpContext.Items.ContainsKey(WriteBoundary)',
    'Envelope(500, "unknown"','JsonSerializer.SerializeToElement(data, Json)',
    'var savedTask = await db.Tasks.AsNoTracking().SingleAsync(x => x.Id == task.Id)', 'if (!Requested(request)) return Results.Ok(task);']){
    assert.ok(protocol.includes(marker),marker);
    assert.ok(checkScheduleTaskWrites(routes,protocol.replaceAll(marker,'' )).length,marker);
  }
  assert.ok(checkScheduleTaskWrites(routes.replaceAll('var task = await Editable(db, access, me, id);',
    '').replaceAll('await using var transaction = await db.Database.BeginTransactionAsync();',
    'var task = await Editable(db, access, me, id); await using var transaction = await db.Database.BeginTransactionAsync();'),protocol).length);
});
