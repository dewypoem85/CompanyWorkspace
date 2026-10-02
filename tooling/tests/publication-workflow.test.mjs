import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../build-ui.mjs';
import { publicationPolicy } from '../publication-source.mjs';
import { validatePublicationWorkflow } from '../publication-workflow.mjs';

const workflow = readFileSync(resolve(root, publicationPolicy.workflow), 'utf8').replaceAll('\r\n', '\n');

test('real publication workflow is manual, exact-source and all-service gated', () => {
  assert.equal(validatePublicationWorkflow(workflow), true);
  assert.equal(validatePublicationWorkflow(workflow.replaceAll('\n', '\r\n')), true);
});

test('automatic triggers, reduced matrices and failure bypasses are rejected', () => {
  for (const changed of [
    workflow.replace('  workflow_dispatch:', '  push:\n    branches: [main]'),
    workflow.replace('app: [portal, leave, schedule, cs, statistics, sheet, iap]', 'app: [portal, leave]'),
    workflow.replace('cancel-in-progress: false', 'cancel-in-progress: true'),
    workflow.replace('      - run: docker push ', '      - run: echo skipped # '),
    workflow.replace('  packages: write', '  packages: read'),
    workflow.replace('    if: always()', '    if: success()'),
    workflow.replace('          PUBLISH_RESULT: ${{ needs.publish.result }}', '          PUBLISH_RESULT: success'),
    workflow.replace('          if-no-files-found: error', '          if-no-files-found: warn')
  ]) assert.throws(() => validatePublicationWorkflow(changed));
});

test('private Free publication does not claim unsupported GitHub attestation permissions', () => {
  for (const line of ['  id-token: write\n', '  attestations: write\n'])
    assert.throws(() => validatePublicationWorkflow(workflow.replace('  packages: write\n', `  packages: write\n${line}`)));
});

test('action versions and exact verified source checkout cannot drift', () => {
  for (const action of Object.values(publicationPolicy.actions))
    assert.throws(() => validatePublicationWorkflow(workflow.replace(action, `${action.split('@')[0]}@main`)), action);
  assert.throws(() => validatePublicationWorkflow(workflow.replace('          ref: ${{ needs.source.outputs.commit }}', '          ref: main')));
  assert.throws(() => validatePublicationWorkflow(workflow.replace('          run-id: ${{ steps.verification.outputs.run_id }}', '          run-id: 1')));
});
