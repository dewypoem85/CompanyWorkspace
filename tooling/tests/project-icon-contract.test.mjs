import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkProjectIcon} from '../check-architecture.mjs';
test('project icons cannot bypass common images, target scope, versions or native forms',()=>{
  const args=['packages/workspace-ui/src/project-icon.js','packages/workspace-ui/src/image-editor.js','apps/portal/Pages/Admin/Organization.cshtml','apps/portal/Pages/Admin/Organization.cshtml.cs','packages/workspace-ui/src/company-entities.js','packages/workspace-ui/src/company-workspace.js'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkProjectIcon(...args),[]);
  for(const [index,markers] of [[0,['CompanyImageEditor.attach(','value.isAdmin','value.projects.some','form.elements.ProjectId.value===id','data.projectId===id','data.previousVersion===sent.get','value.projectIcons']],
    [1,['resource.allowed(value)','resource.receiptMatches(data,sent)','stamp(resource.receiptUrl(data))','transport.dispose()','imagePending','CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm(']],
    [2,['data-cw-project-icon','asp-page-handler="Icon"','name="ProjectId"']],
    [3,['OnPostIconAsync','ExpectedUserId != owner','WorkspaceImageKind.Project, id, image, expected','previousVersion = expected','OrganizationService.RequireAdmin(actor)']],
    [5,['CompanyProjectIcon.attach(']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkProjectIcon(...changed).length,marker);}
  const legacy=[...args];legacy[4]+='; function sendIcon() {}';assert.ok(checkProjectIcon(...legacy).length);
  assert.ok(checkProjectIcon(args[0]+'; fetch("/private")',...args.slice(1)).length);
});
