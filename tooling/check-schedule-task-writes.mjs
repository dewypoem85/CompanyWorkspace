// Source guards complement (not replace) the actual HTTP/SQLite contract tests.
export function checkScheduleTaskWrites(routes, protocol) {
  const errors=[];
  const operations=[['Post','/api/tasks','create'],['Put','/api/tasks/{id:long}','update'],['Patch','/api/tasks/{id:long}/status','status']];
  for(const [verb,path,operation] of operations){
    const start=routes.indexOf(`app.Map${verb}("${path}"`);
    const next=routes.indexOf('app.Map',start+1);
    const body=start<0?'':routes.slice(start,next<0?undefined:next);
    for(const marker of ['TaskWriteProtocol.RequireActor(request, me)', 'TaskWriteProtocol.StartingWrite(request)',
      'TaskWriteProtocol.Saved(request, db, me, task, "'+operation+'"', '.AddEndpointFilter<TaskWriteProtocol>()'])
      if(!body.includes(marker))errors.push(`Task ${operation}: missing ${marker}`);
    const begin=body.indexOf('await db.Database.BeginTransactionAsync()');
    const saved=body.indexOf('var result = await TaskWriteProtocol.Saved(');
    const commit=body.indexOf('await transaction.CommitAsync()');
    if(begin<0||saved<begin||commit<saved||body.indexOf('return result;',commit)<0)
      errors.push(`Task ${operation}: capture ACK in transaction and return only after commit`);
    if(operation!=='create'){
      for(const marker of ['TaskWriteProtocol.RequireState(request, db, task)','Access.Version(task.Version, input.Version)'])
        if(!body.includes(marker))errors.push(`Task ${operation}: missing ${marker}`);
      if(body.indexOf('await Editable(')<begin)errors.push(`Task ${operation}: baseline must be read inside transaction`);
    }
  }
  for(const marker of ['editing = new { actorId = me.Id.ToString(', 'stateToken = TaskWriteProtocol.StateToken(task, attachments)'])
    if(!routes.includes(marker))errors.push(`Task detail: missing ${marker}`);
  for(const marker of ['request.Headers[ActorHeader].ToString() != me.Id.ToString(',
    'request.Headers[StateHeader].ToString() != token','x.TaskId == task.Id && x.CommentId == null',
    'task.Title, task.Body, task.AssigneeId, task.CreatedBy', 'task.ProjectId, task.GoalId, task.StartDate, task.EndDate',
    'task.Status, task.Archived, task.Version', 'x.CommentId, x.Name, x.ContentType, x.Size',
    'SHA256.HashData(', 'var savedTask = await db.Tasks.AsNoTracking().SingleAsync(x => x.Id == task.Id)',
    'stateToken = StateToken(savedTask, attachments), task = savedTask, attachments',
    'JsonSerializer.SerializeToElement(data, Json)', 'if (!Requested(request)) return Results.Ok(task);',
    'protocol = "workspace-form-v1"', '!context.HttpContext.Items.ContainsKey(WriteBoundary)',
    'error.Status == 400 ? 422 : error.Status', 'Envelope(500, "unknown"'])
    if(!protocol.includes(marker))errors.push(`Task write contract: missing ${marker}`);
  return errors;
}

export function checkScheduleTaskWriteClient(panel,hook,contract){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  requireMarkers(panel,['useTaskWrites({','void writes.run();','void writes.run(e.target.value as Status)','writeBusy.current=writes.transmitting||writes.needsRefresh','writes.recover(latest,directory)','writes.refreshSaved()'],'Task write UI');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-task-writes')",'createWorkspaceWriteTransport(',"forms.begin(owner.current,[resource])",'confirmWorkspaceAction(',"reads.current.run('preflight'",'lease.markSent()','confirmTaskReceipt(value,active.write,sent)',"'X-Workspace-Actor':write.actorId","'X-Workspace-State':write.stateToken","lease.finish('saved')","reads.current.run('saved'",'confirmed.current!==receipt','transport.current?.dispose()','untrack?.()'],'Task write lifecycle');
  requireMarkers(contract,['structuredClone(draft)','taskWriteBaseline(before!,actorId)','JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','data.task.version===write.draft.form.version+1','for(const [key] of taskFields)','data.attachments.length===expectedImages.size','image.taskId===data.task.id&&image.commentId===null','sameStamp(data.task.createdAt,write.before.task.createdAt)'],'Task full ACK');
  if(/api\([^\n]*\/api\/tasks[^\n]*(?:method:\s*['"](?:POST|PUT|PATCH)['"])/.test(panel))errors.push('Task write UI: do not restore a private raw task writer');
  if(/\bfetch\s*\(/.test(hook))errors.push('Task write lifecycle: use shared transport and reads');
  return errors;
}

export function checkScheduleQuickStatusClient(app,hook,contract){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  requireMarkers(app,['useTaskQuickStatus({','refreshBoard:()=>refresh(true,true)','void quickStatus.run(t, status as Status)','disabled={quickStatus.busyTaskId!==null||quickStatus.locked}','if(quickStatus.outcome)notices.push({id:\'quick-status\',state:quickStatus.outcome})','notices.map(notice=><ScheduleToastNotice key={notice.id} {...notice}/>)'],'Kanban status UI');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-task-writes')",'createWorkspaceReadSession()','createWorkspaceWriteTransport({','start.refreshIdentity()','scheduleGet(`/api/tasks/${source.id}`','taskDetailResponse(value,source.id)','taskWriteBaseline(checked.value.detail','captureTaskWrite(\'status\'','session.begin(owner.current,[`task:${source.id}:${write.stateToken}`])','confirmWorkspaceAction({','lease.markSent()','writer.send({url:`/api/tasks/${source.id}/status`','confirmTaskReceipt(value,active.write,sent)',"lease.finish('saved')",'await live.current.refreshBoard()',"document.dispatchEvent(new Event('workspace-entity-scope-change'))"],'Kanban status lifecycle');
  requireMarkers(contract,['statusDraft(detail:Detail,status:Status)','taskWriteBaseline(before!,actorId)','data.operation===write.kind','data.previousStateToken===write.stateToken','data.task.version===write.draft.form.version+1'],'Kanban status acknowledgement');
  if(/api\([^\n]*\/api\/tasks\/\$\{t\.id\}\/status[^\n]*['"]PATCH['"]/.test(app))errors.push('Kanban status UI: private raw status writer prohibited');
  if(/\bfetch\s*\(|\bapi\s*\(/.test(hook))errors.push('Kanban status lifecycle: use shared read and write transports');
  return errors;
}

export function checkScheduleImageUploads(routes,protocol,editor,hook,contract,reactForm){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  requireMarkers(routes,['ImageWriteProtocol.RequireActor(req, me)','ImageWriteProtocol.StartingWrite(req)','IncrementalHash.CreateHash(HashAlgorithmName.SHA256)','hash.AppendData(','ImageWriteProtocol.Saved(req, me, image, sha256)','}).AddEndpointFilter<ImageWriteProtocol>()'],'Image upload server');
  requireMarkers(protocol,['TaskWriteProtocol.Requested(request)','TaskWriteProtocol.ActorHeader','WriteBoundary','operation = "upload"','actorId = me.Id.ToString','sha256, attachment','protocol = "workspace-form-v1"','contentType: TaskWriteProtocol.MediaType','"unknown"'],'Image upload protocol');
  requireMarkers(editor,['useImageUploads({boot,refreshIdentity,images,setImages,disabled:disabled||uploadDisabled,label,busyChanged})','const controlsDisabled=disabled||uploads.busy','const uploadControlsDisabled=controlsDisabled||uploadDisabled||uploads.locked','void uploads.upload(','disabled={controlsDisabled}','disabled={uploadControlsDisabled}','state={uploads.outcome}'],'Image editor');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-image-uploads')",'batch=useRef(false)','batch.current||busy','batch.current=true','createWorkspaceWriteTransport({','timeoutMs:60000','start.refreshIdentity()','captureImageUpload(file,directory)','confirmWorkspaceAction({','forms.begin(owner.current,[`upload:${++resourceSequence}:${uploadIntent.sha256}`])','lease.markSent()','formData.append(\'file\',file)','writer.send({url:\'/api/images\'','confirmImageUploadReceipt(value,command.intent,sent)',"lease.finish('saved')","document.dispatchEvent(new Event('workspace-entity-scope-change'))"],'Image upload lifecycle');
  requireMarkers(contract,["operation:'upload'",'crypto.subtle.digest(\'SHA-256\'','data.sha256===intent.sha256','sent instanceof FormData','file instanceof File','image.ownerId===Number(intent.actorId)','image.taskId===null&&image.commentId===null','image.name===intent.name&&image.size===intent.size'],'Image upload acknowledgement');
  requireMarkers(reactForm,['formData:FormData;json?:never'],'React multipart transport');
  if(/api\s*<[^>]+>\s*\(\s*['"]\/api\/images['"]\s*,\s*['"]POST['"]/.test(editor)||/fetch\s*\(\s*['"]\/api\/images/.test(editor))errors.push('Image editor: private raw upload prohibited');
  if(/\bfetch\s*\(|\bapi\s*(?:<[^>]+>)?\s*\(/.test(hook))errors.push('Image upload lifecycle: use shared transport and identity callback');
  return errors;
}

export function checkScheduleCommentWrites(routes,protocol,taskRoutes,composer,panel,hook,contract){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  for(const [verb,path,label] of [['Post','/api/tasks/{id:long}/comments','create/reply'],['Put','/api/comments/{id:long}','update']]){
    const start=routes.indexOf(`app.Map${verb}("${path}"`),next=routes.indexOf('app.Map',start+1),body=start<0?'':routes.slice(start,next<0?undefined:next);
    requireMarkers(body,['CommentWriteProtocol.RequireActor(request, me)','CommentWriteProtocol.RequireState(request, db, task,','CommentWriteProtocol.StartingWrite(request)','var result = await CommentWriteProtocol.Saved(','.AddEndpointFilter<CommentWriteProtocol>()'],`Comment ${label} server`);
    const begin=body.indexOf('await db.Database.BeginTransactionAsync()'),firstRead=body.indexOf(label==='update'?'var comment = await db.Comments.FindAsync':'var task = await TaskRoutes.Find'),saved=body.indexOf('var result = await CommentWriteProtocol.Saved('),commit=body.indexOf('await transaction.CommitAsync()');
    if(begin<0||firstRead<begin||saved<firstRead||commit<saved||body.indexOf('return result;',commit)<0)errors.push(`Comment ${label} server: baseline and ACK must stay inside the transaction`);
  }
  requireMarkers(taskRoutes,['commentEditing = CommentWriteProtocol.Editing(me, task, comments, attachments)'],'Comment detail');
  requireMarkers(protocol,['TargetStateHeader = "X-Workspace-Target-State"','TaskWriteProtocol.Requested(request)','TaskWriteProtocol.ActorHeader','request.Headers[TargetStateHeader].ToString() != token','db.Comments.AsNoTracking().Where(x => x.TaskId == task.Id)','comments = commentRows','x.ParentId == target.Id','operation, actorId = me.Id.ToString','previousStateToken','stateToken = StateToken(task, saved, allAttachments, comments)','comment = saved, attachments','protocol = "workspace-form-v1"','!context.HttpContext.Items.ContainsKey(WriteBoundary)','Envelope(500, "unknown"'],'Comment write protocol');
  requireMarkers(composer,['useCommentWrites({','void writes.run();','writes.recover(detail,boot)','writes.recover(latest,directory)','state={writes.outcome}'],'Comment composer');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-comment-writes')",'createWorkspaceReadSession()','createWorkspaceWriteTransport({','captureCommentWrite(','commentWriteBaseline(fresh.value.detail','confirmWorkspaceAction({','lease.markSent()','writer.send({url:','confirmCommentReceipt(value,active.write,sent)',"'X-Workspace-Target-State':write.stateToken","lease.finish('saved')",'live.current.committed(receipt)','await live.current.refreshed(receipt.comment)','recoverScope()'],'Comment write lifecycle');
  requireMarkers(contract,['structuredClone(draft)','commentWriteBaseline(detail,actorId,targetId)','JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','comment.version===write.draft.version+1','data.attachments.length===expected.size','image.taskId===write.taskId&&image.commentId===comment.id','sameStamp(comment.createdAt,write.before.createdAt)'],'Comment full ACK');
  if(/\bapi\s*(?:<[^>]+>)?\s*\([^\n]*(?:\/api\/comments|\/comments`)/.test(composer+panel)||/submit=\{async/.test(panel))errors.push('Comment UI: do not restore a private raw comment writer');
  if(/\bfetch\s*\(|\bapi\s*(?:<[^>]+>)?\s*\(/.test(hook))errors.push('Comment write lifecycle: use shared read and write transports');
  return errors;
}

export function checkScheduleMilestoneWrites(routes,protocol,settings,hook,contract,reads){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  for(const [verb,path,label] of [['Post','/api/milestones','create'],['Put','/api/milestones/{id:long}','update'],['Delete','/api/milestones/{id:long}','delete']]){
    const start=routes.indexOf(`app.Map${verb}("${path}"`),next=routes.indexOf('app.Map',start+1),body=start<0?'':routes.slice(start,next<0?undefined:next);
    requireMarkers(body,['MilestoneWriteProtocol.RequireActor(request, me)','MilestoneWriteProtocol.RequireState(request, me,','MilestoneWriteProtocol.StartingWrite(request)',label==='delete'?'MilestoneWriteProtocol.Deleted(':'MilestoneWriteProtocol.Saved(','.AddEndpointFilter<MilestoneWriteProtocol>()'],`Milestone ${label} server`);
    const begin=body.indexOf('await db.Database.BeginTransactionAsync()'),state=body.indexOf('MilestoneWriteProtocol.RequireState(request, me,'),firstWrite=body.indexOf(label==='delete'?'db.Milestones.Remove(m)':'MilestoneWriteProtocol.StartingWrite(request)'),receipt=body.indexOf(label==='delete'?'MilestoneWriteProtocol.Deleted(':'MilestoneWriteProtocol.Saved('),commit=body.indexOf('await transaction.CommitAsync()');
    if(begin<0||state<begin||firstWrite<state||receipt<firstWrite||commit<receipt||body.indexOf('return result;',commit)<0)errors.push(`Milestone ${label} server: baseline and ACK must stay inside the transaction`);
  }
  requireMarkers(routes,['request.Query["editing"] != "true"','MilestoneWriteProtocol.Editing(me, visible)'],'Milestone editing read');
  requireMarkers(protocol,['StateHeader = "X-Workspace-Milestone-State"','TaskWriteProtocol.Requested(request)','TaskWriteProtocol.ActorHeader','request.Headers[StateHeader].ToString() != token','me.Id, me.Role, me.Active, me.Shared, me.Access, me.IsAdmin, me.DepartmentId','x.Id, x.Type, x.Title, x.Description, x.DeadlineMemo, x.Date, x.EndDate, x.AdditionalSchedulesJson, x.ProjectId, x.Version','createStateToken = StateToken(me, null, rows)','operation, actorId = me.Id.ToString','previousStateToken','stateToken = StateToken(me, saved, rows)','milestone = saved, deleted = false','operation = "delete"','milestone = snapshot, deleted = true','protocol = "workspace-form-v1"','!context.HttpContext.Items.ContainsKey(WriteBoundary)','Envelope(500, "unknown"'],'Milestone write protocol');
  requireMarkers(settings,['useMilestoneWrites({','page:milestonePage',"await writes.run('delete')","void writes.run(milestone.id?'update':'create')",'id="settings-write" state={writes.outcome}'],'Milestone editor');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-milestone-writes')",'createWorkspaceReadSession()','createWorkspaceWriteTransport({','captureMilestoneWrite(','milestoneWriteBaseline(fresh.value.page','confirmWorkspaceAction({','lease.markSent()','writer.send({url:','confirmMilestoneReceipt(value,active.write,sent)',"'X-Workspace-Milestone-State':write.stateToken","lease.finish('saved')",'start.committed(receipt)','await start.readPage()','start.conflicted(next)'],'Milestone write lifecycle');
  requireMarkers(contract,['structuredClone(value)','milestoneActorScope(boot)','milestoneWriteBaseline(page,actorId','JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','data.stateToken!==write.stateToken','saved.version===write.draft.version+1','JSON.stringify(saved)===JSON.stringify(write.before)'],'Milestone full acknowledgement');
  requireMarkers(reads,['milestonePageResponse','createStateToken',"tokens.milestones",'unique<MilestonePage', 'items.every(item=>rows.some(row=>row.id===item.id))'],'Milestone editing response');
  if(/\bapi\s*(?:<[^>]+>)?\s*\([^\n]*\/api\/milestones[^\n]*(?:['"](?:POST|PUT|DELETE)['"])/.test(settings))errors.push('Milestone editor: do not restore a private raw milestone writer');
  if(/\bfetch\s*\(|\bapi\s*(?:<[^>]+>)?\s*\(/.test(hook))errors.push('Milestone write lifecycle: use shared read and write transports');
  return errors;
}

export function checkScheduleTaskActions(taskRoutes,discussionRoutes,taskProtocol,commentProtocol,panel,hook,contract,spec){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  for(const [path,operation,lookup] of [['archive','archive','await Editable('],['restore','restore','await Find(']]){
    const start=taskRoutes.indexOf(`app.MapPost("/api/tasks/{id:long}/${path}"`),next=taskRoutes.indexOf('app.Map',start+1),body=start<0?'':taskRoutes.slice(start,next<0?undefined:next);
    requireMarkers(body,['TaskWriteProtocol.RequireActor(request, me)','await db.Database.BeginTransactionAsync()','TaskWriteProtocol.RequireState(request, db, task)','Access.Version(task.Version, input.Version)','TaskWriteProtocol.StartingWrite(request)',`TaskWriteProtocol.Saved(request, db, me, task, "${operation}"`,'await transaction.CommitAsync()','return result;','.AddEndpointFilter<TaskWriteProtocol>()'],`Task ${operation} action server`);
    const begin=body.indexOf('await db.Database.BeginTransactionAsync()'),read=body.indexOf(lookup),state=body.indexOf('TaskWriteProtocol.RequireState(request, db, task)'),write=body.indexOf('TaskWriteProtocol.StartingWrite(request)'),receipt=body.indexOf('TaskWriteProtocol.Saved('),commit=body.indexOf('await transaction.CommitAsync()');
    if(begin<0||read<begin||state<read||write<state||receipt<write||commit<receipt)errors.push(`Task ${operation} action server: baseline, write and ACK must stay inside the transaction`);
  }
  {
    const start=discussionRoutes.indexOf('app.MapDelete("/api/comments/{id:long}"'),next=discussionRoutes.indexOf('app.Map',start+1),body=start<0?'':discussionRoutes.slice(start,next<0?undefined:next);
    requireMarkers(body,['CommentWriteProtocol.RequireActor(request, me)','await db.Database.BeginTransactionAsync()','CommentWriteProtocol.RequireState(request, db, task, comment)','Access.Version(comment.Version, version)','CommentWriteProtocol.StartingWrite(request)','CommentWriteProtocol.Deleted(request, db, me, task, comment, previousStateToken)','await transaction.CommitAsync()','return result;','.AddEndpointFilter<CommentWriteProtocol>()'],'Comment delete action server');
    const begin=body.indexOf('await db.Database.BeginTransactionAsync()'),read=body.indexOf('var comment = await db.Comments.FindAsync'),state=body.indexOf('CommentWriteProtocol.RequireState(request, db, task, comment)'),write=body.indexOf('CommentWriteProtocol.StartingWrite(request)'),receipt=body.indexOf('CommentWriteProtocol.Deleted('),commit=body.indexOf('await transaction.CommitAsync()');
    if(begin<0||read<begin||state<read||write<state||receipt<write||commit<receipt)errors.push('Comment delete action server: baseline, write and ACK must stay inside the transaction');
  }
  requireMarkers(taskProtocol,['stateToken = StateToken(savedTask, attachments), task = savedTask, attachments','navigateTo = $"/tasks/{task.Id.ToString(CultureInfo.InvariantCulture)}"','protocol = "workspace-form-v1"','Envelope(500, "unknown"'],'Task action acknowledgement');
  requireMarkers(commentProtocol,['public static async Task<IResult> Deleted(','if (!TaskWriteProtocol.Requested(request)) return Results.NoContent()','operation = "delete-comment"','previousStateToken, stateToken = StateToken(task, saved, allAttachments, comments)','comment = saved, attachments = Array.Empty<Attachment>()','Envelope(500, "unknown"'],'Comment deletion acknowledgement');
  requireMarkers(panel,['useTaskActions({',"actions.run('delete-comment',c.id)","actions.run('restore')","actions.run('archive')"],'Task action UI');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-task-actions')",'createWorkspaceWriteTransport({','captureTaskAction(','taskActionBaseline(live.current.detail!', 'confirmWorkspaceAction({','lease.markSent()','writer.send({url:',"'X-Workspace-Actor':write.actorId","'X-Workspace-Target-State':'X-Workspace-State'",'confirmTaskActionReceipt(value,active.write,sent)',"lease.finish('saved')",'await read(id,scope,generation,write.action)','forms.current?.invalid&&!forms.current.recoverScope()','refreshRequired.current=attempted'],'Task action lifecycle');
  requireMarkers(contract,['structuredClone({kind,task:detail.task,comment,attachments})','taskActionBaseline(detail,actorId,kind,commentId)','JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','data.stateToken!==write.stateToken','confirmTaskActionResult(data.task,action)','data.attachments.length===action.attachments.length','comment.version===before.version+1','sameStamp(comment.createdAt,before.createdAt)'],'Task action full acknowledgement');
  requireMarkers(spec,['archive','restore','delete-comment','X-Workspace-State','X-Workspace-Target-State','exact JSON body','full task','deleted comment','must not retry'],'Task action contract');
  if(/\bapi\s*(?:<[^>]+>)?\s*\([^\n]*(?:\/archive|\/restore|\/api\/comments)[^\n]*(?:['"](?:POST|DELETE)['"])/.test(panel+hook))errors.push('Task action UI: do not restore private raw action writers');
  if(/\bfetch\s*\(/.test(hook))errors.push('Task action lifecycle: use shared transport and supplied reads');
  return errors;
}

export function checkScheduleReleaseWrites(routes,protocol,view,hook,contract,spec){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  for(const [verb,path,operation] of [['Post','/api/releases','create'],['Put','/api/releases/{id:long}','update']]){
    const start=routes.indexOf(`app.Map${verb}("${path}"`),next=routes.indexOf('app.Map',start+1),body=start<0?'':routes.slice(start,next<0?undefined:next);
    requireMarkers(body,['ReleaseWriteProtocol.RequireActor(request, me)','await db.Database.BeginTransactionAsync()','ReleaseWriteProtocol.RequireState(request, me,','ReleaseWriteProtocol.StartingWrite(request)',`ReleaseWriteProtocol.Saved(request, db, me, record, "${operation}"`,'await tx.CommitAsync()','return result;','.AddEndpointFilter<ReleaseWriteProtocol>()'],`Release ${operation} server`);
    const begin=body.indexOf('await db.Database.BeginTransactionAsync()'),state=body.indexOf('ReleaseWriteProtocol.RequireState(request, me,'),write=body.indexOf('ReleaseWriteProtocol.StartingWrite(request)'),receipt=body.indexOf('ReleaseWriteProtocol.Saved('),commit=body.indexOf('await tx.CommitAsync()');
    if(begin<0||state<begin||write<state||receipt<write||commit<receipt)errors.push(`Release ${operation} server: baseline, write and ACK must stay inside the transaction`);
  }
  requireMarkers(routes,['app.MapGet("/api/releases/editing"','ReleaseWriteProtocol.ProjectRows(db, projectId)','ReleaseWriteProtocol.Editing(me, target, rows)'],'Release editing read');
  requireMarkers(protocol,['StateHeader = "X-Workspace-Release-State"','TaskWriteProtocol.Requested(request)','TaskWriteProtocol.ActorHeader','request.Headers[StateHeader].ToString() != token','me.Id, me.Role, me.Active, me.Shared, me.Access, me.IsAdmin, me.DepartmentId','x.Id, x.ProjectId, x.BaseVersion, x.Minor, x.ReleasedOn, x.ReleasedOnUnknown, x.Notes, x.Status','x.Issue, x.RollbackTargetId, x.ResolvedInId, x.CreatedBy, x.SourceReference, x.Version, x.UpdatedAt','operation, actorId = me.Id.ToString','previousStateToken','stateToken = StateToken(me, saved, rows), release = saved','protocol = "workspace-form-v1"','!context.HttpContext.Items.ContainsKey(WriteBoundary)','Envelope(500, "unknown"'],'Release write protocol');
  requireMarkers(view,['useReleaseEditor(','edit.save()','edit.review()','edit.refreshList()','edit.unavailable'],'Release editor UI');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-release-writes')",'createWorkspaceReadSession()','createWorkspaceWriteTransport({','scheduleGet(`/api/releases/editing?${query}`','releaseEditingResponse(value,submitted.projectId,submitted.id)','captureReleaseWrite(','confirmWorkspaceAction({','lease.markSent()','writer.send({url:',"'X-Workspace-Release-State':write.stateToken",'confirmReleaseReceipt(value,active.write,sent)',"lease.finish('saved')",'await live.current.saved()'],'Release write lifecycle');
  requireMarkers(contract,['structuredClone(draft)','releaseActorScope(boot)','releaseDraftSignature(currentRelease(editing.record,before))!==releaseDraftSignature(before)','JSON.stringify(sent)===JSON.stringify(write.body)','data.previousStateToken===write.stateToken','data.stateToken!==write.stateToken','confirmReleaseSaved(data.release,write.draft,write.before,Number(write.actorId))'],'Release full acknowledgement');
  requireMarkers(spec,['workspace-form-v1','X-Workspace-Actor','X-Workspace-Release-State','전체 JSON','트랜잭션','자동 또는 수동으로 재전송하지 않는다'],'Release write contract');
  if(/\bapi\s*(?:<[^>]+>)?\s*\([^\n]*\/api\/releases[^\n]*['"](?:POST|PUT)['"]/.test(hook+view))errors.push('Release editor: do not restore a private raw release writer');
  if(/\bfetch\s*\(/.test(hook))errors.push('Release write lifecycle: use shared read and write transports');
  return errors;
}

export function checkSchedulePersonalTodoWrites(routes,protocol,hook,contract,spec){
  const errors=[];
  const requireMarkers=(source,markers,label)=>{for(const marker of markers)if(!source.includes(marker))errors.push(`${label}: missing ${marker}`);};
  const operations=[
    ['Post','/api/personal-todos','add','PersonalTodoWriteProtocol.Saved('],
    ['Put','/api/personal-todos/{id:long}','save','PersonalTodoWriteProtocol.Saved('],
    ['Patch','/api/personal-todos/{id:long}/completion','complete','PersonalTodoWriteProtocol.Saved('],
    ['Put','/api/personal-todos/order','order','PersonalTodoWriteProtocol.Ordered('],
    ['Delete','/api/personal-todos/{id:long}','delete','PersonalTodoWriteProtocol.Deleted(']
  ];
  for(const [verb,path,operation,receiptMarker] of operations){
    const start=routes.indexOf(`app.Map${verb}("${path}"`),next=routes.indexOf('app.Map',start+1),body=start<0?'':routes.slice(start,next<0?undefined:next);
    requireMarkers(body,['PersonalTodoWriteProtocol.RequireActor(request, me)','await db.Database.BeginTransactionAsync()','PersonalTodoWriteProtocol.RequireState(request, me,','PersonalTodoWriteProtocol.StartingWrite(request)',receiptMarker,'await transaction.CommitAsync()','return result;','.AddEndpointFilter<PersonalTodoWriteProtocol>()'],`Personal TODO ${operation} server`);
    const begin=body.indexOf('await db.Database.BeginTransactionAsync()'),state=body.indexOf('PersonalTodoWriteProtocol.RequireState(request, me,'),write=body.indexOf('PersonalTodoWriteProtocol.StartingWrite(request)'),receipt=body.indexOf(receiptMarker),commit=body.indexOf('await transaction.CommitAsync()');
    if(begin<0||state<begin||write<state||receipt<write||commit<receipt)errors.push(`Personal TODO ${operation} server: baseline, write and ACK must stay inside the transaction`);
  }
  requireMarkers(routes,['app.MapGet("/api/personal-todos/editing"','PersonalTodoWriteProtocol.Rows(db, me.Id, archived == true)','PersonalTodoWriteProtocol.Editing(me, target, rows)'],'Personal TODO editing read');
  requireMarkers(protocol,['StateHeader = "X-Workspace-Todo-State"','TaskWriteProtocol.Requested(request)','TaskWriteProtocol.ActorHeader','request.Headers[StateHeader].ToString() != token','me.Id, me.Role, me.Active, me.Shared, me.Access, me.IsAdmin, me.DepartmentId','x.Id, x.OwnerId, x.Title, x.SortOrder, x.Version','previousStateToken','operation, actorId = me.Id.ToString','protocol = "workspace-form-v1"','!context.HttpContext.Items.ContainsKey(WriteBoundary)','DbUpdateConcurrencyException','Envelope(500, "unknown"'],'Personal TODO write protocol');
  requireMarkers(hook,["workspaceDocumentFormSession('schedule-todo-writes')",'createWorkspaceWriteTransport({',"reader.run('todo-write-preflight'",'scheduleGet(`/api/personal-todos/editing?','todoEditingResponse(value,ownerId,id)','captureTodoWrite(','forms.begin(','lease.markSent()','writer.send({url,method,json:write.body',"'X-Workspace-Todo-State':write.stateToken",'active.receipt=confirmTodoReceipt(value,active.write,sent)','result.saved&&receipt&&valid()',"lease.finish('saved')",'const next=await read(generation,actor,tab)'],'Personal TODO write lifecycle');
  requireMarkers(contract,['export function todoEditingResponse(','export function captureTodoWrite(','export function confirmTodoReceipt(','JSON.stringify(sent) === JSON.stringify(write.body)','receipt.previousStateToken === write.stateToken','receipt.stateToken !== write.stateToken','confirmTodoResult(receipt.todo, write.command, ownerId)','receipt.deleted && fullSignature(todo) === fullSignature(write.command.item)','JSON.stringify(todos.map(item => item.id)) === JSON.stringify(write.command.ids)'],'Personal TODO full acknowledgement');
  requireMarkers(spec,['workspace-form-v1','X-Workspace-Actor','X-Workspace-Todo-State','전체 JSON','트랜잭션','자동 또는 수동으로 재전송하지 않는다'],'Personal TODO write contract');
  if(/\bapi\s*(?:<[^>]+>)?\s*\([^\n]*\/api\/personal-todos[^\n]*['"](?:POST|PUT|PATCH|DELETE)['"]/.test(hook))errors.push('Personal TODO UI: do not restore a private raw writer');
  if(/\bfetch\s*\(/.test(hook))errors.push('Personal TODO write lifecycle: use shared read and write transports');
  return errors;
}
