import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkOrganizationForm} from '../check-architecture.mjs';
test('organization forms cannot bypass shared transport, confirmation, account and receipt checks',()=>{
  const args=['apps/portal/wwwroot/js/organization.js','apps/portal/Pages/Admin/Organization.cshtml','apps/portal/Pages/Admin/Organization.cshtml.cs'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkOrganizationForm(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm(','controller.dispose()','workspace-entity-scope-change','captured !== snapshot()','sentSnapshot !== snapshot()','data.userId !== sent.get','data.previousVersion !== previousVersion','BigInt(data.version)']],
    [1,['asp-for="ExpectedUserId"','asp-for="Form.Version"','data-write-locked']],
    [2,['ExpectedUserId != actorId','DbUpdateConcurrencyException','OrganizationValidationException','workspace-form-v1','previousVersion = Form.Version','WriteLocked = outcome != "invalid"']]])
    for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkOrganizationForm(...changed).length,marker);}
  assert.ok(checkOrganizationForm(args[0]+'; fetch("/private")',...args.slice(1)).length);
  assert.ok(checkOrganizationForm(args[0]+'; window.confirm("private")',...args.slice(1)).length);
});
