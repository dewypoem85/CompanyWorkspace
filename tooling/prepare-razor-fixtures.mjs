import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './build-ui.mjs';

// TestServer creates isolated SQLite databases and test-only login tickets.
// Browser fixtures are actual Razor responses, never handwritten substitute HTML.
const result=spawnSync(process.env.WORKSPACE_DOTNET||'dotnet',[
  'test','apps/schedule/integration-tests/CompanyIntegration.Tests.csproj','-c','Release',
  '--filter','FullyQualifiedName~PortalPageTests|FullyQualifiedName~LeavePageTests|FullyQualifiedName~AccountFormTests|FullyQualifiedName~PortalNotificationTests|FullyQualifiedName~ProfileFormTests|FullyQualifiedName~OrganizationFormTests|FullyQualifiedName~ProjectIconFormTests'
],{cwd:root,stdio:'inherit',env:{...process.env,WORKSPACE_RAZOR_SNAPSHOTS:resolve(root,'artifacts/razor')}});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
