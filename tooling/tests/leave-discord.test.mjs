import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveDiscord} from '../check-architecture.mjs';
import {validateDiscordSnapshot,validateDiscordReceipt} from '../../apps/leave/wwwroot/js/discord-settings.js';
const before={employeeId:'9007199254740993',stateToken:'A'.repeat(64),discordUserId:'9007199254740995',discordUsername:'검증 계정',enabled:true,selectedTypes:['LeaveRequestApproved']};
test('Discord receipts retain exact identities, settings and read-only test semantics',()=>{
  const submitted=new FormData();submitted.append('discordDmEnabled','true');submitted.append('discordDmEnabled','false');submitted.append('selectedTypes','LeaveRequestRejected');
  const saved={...before,stateToken:'B'.repeat(64),selectedTypes:['LeaveRequestRejected']};
  assert.equal(validateDiscordReceipt({operation:'Save',snapshot:saved},'Save',before,submitted),saved);
  assert.equal(validateDiscordReceipt({operation:'Test',snapshot:before},'Test',before,submitted),before);
  const unlinked={...saved,discordUserId:null,discordUsername:null,enabled:false,selectedTypes:[]};
  assert.equal(validateDiscordReceipt({operation:'Unlink',snapshot:unlinked},'Unlink',before,submitted),unlinked);
  for(const patch of [{employeeId:9007199254740993},{stateToken:'bad'},{discordUserId:9007199254740995},{enabled:'false'},{selectedTypes:['duplicate','duplicate']}])assert.throws(()=>validateDiscordSnapshot({...saved,...patch}));
  for(const patch of [{employeeId:'2'},{discordUserId:'other'},{enabled:false},{selectedTypes:before.selectedTypes}])assert.throws(()=>validateDiscordReceipt({operation:'Save',snapshot:{...saved,...patch}},'Save',before,submitted));
  assert.throws(()=>validateDiscordReceipt({operation:'Test',snapshot:saved},'Test',before,submitted));
  assert.throws(()=>validateDiscordReceipt({operation:'Unlink',snapshot:before},'Unlink',before,submitted));
});
test('Discord architecture rejects private confirm, missing scope and invented color tokens',()=>{
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const args=[read('apps/leave/wwwroot/js/discord-settings.js'),read('apps/leave/Pages/Settings/Discord.cshtml'),read('apps/leave/Pages/Settings/Discord.cshtml.cs'),read('apps/leave/wwwroot/css/site.css'),read('packages/workspace-ui/src/company-workspace.css'),read('packages/workspace-ui/src/primitives.css')];
  assert.deepEqual(checkLeaveDiscord(...args),[]);
  for(const marker of ['window.CompanyForm.attach(','window.CompanyState.render(','window.CompanyDialog.confirm(','context.isCurrent()','returnFocus'])assert.ok(checkLeaveDiscord(args[0].replaceAll(marker,'bypass'),...args.slice(1)).length);
  assert.ok(checkLeaveDiscord(args[0],args[1]+' onsubmit="return confirm()"',...args.slice(2)).length);
  assert.ok(checkLeaveDiscord(args[0],args[1],args[2].replaceAll('CheckTarget(employee,expectedEmployeeId,expectedStateToken)','Bypass()'),...args.slice(3)).length);
  assert.ok(checkLeaveDiscord(...args.slice(0,3),args[3].replaceAll('var(--cw-raised)','var(--cw-invented-color)'),args[4],args[5]).length);
});
