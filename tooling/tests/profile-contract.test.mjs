import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkProfileForm} from '../check-architecture.mjs';
test('profile cannot bypass shared form, acknowledgement, native account version or scope checks',()=>{
  const read=file=>readFileSync(resolve(root,file),'utf8');
  const args=['packages/workspace-ui/src/profile.js','apps/portal/Pages/Settings/Profile.cshtml','apps/portal/Pages/Settings/Profile.cshtml.cs','packages/workspace-ui/src/company-workspace.js','packages/workspace-ui/src/image-editor.js'].map(read);
  assert.deepEqual(checkProfileForm(...args),[]);
  for(const [index,markers] of [[4,['CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm(','transport.dispose()','workspace-entity-scope-change','data.userId!==owner','stamp(resource.receiptUrl(data))','Promise.race','bitmap?.close()']],
    [0,['CompanyImageEditor.attach(','value.profiles?.[owner]','receiptUrl:data=>data.avatarUrl']],
    [1,['data-profile-form','name="ExpectedUserId"','name="ExpectedVersion"']],
    [2,['ExpectedUserId != id','AvatarStore.ApplyAsync(db, user.Id, image, expected)']],[3,['CompanyProfile.attach(']]])
    for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkProfileForm(...changed).length,marker);}
  assert.ok(checkProfileForm(args[0]+'; fetch("/private")',...args.slice(1)).length);
  assert.ok(checkProfileForm(args[0]+'; window.confirm("private")',...args.slice(1)).length);
});
