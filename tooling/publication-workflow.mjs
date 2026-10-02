import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicationPolicy } from './publication-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = (condition, message) => { if (!condition) throw new Error(message); };
const sameSet = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));

export function validatePublicationWorkflow(source, policy = publicationPolicy) {
  const body = source.replaceAll('\r\n', '\n');
  required(body.startsWith('name: Publish Verified Images\non:\n  workflow_dispatch:\npermissions:\n'), '이미지 게시는 수동 workflow_dispatch로만 시작해야 합니다.');
  required(!/^  (?:push|pull_request|workflow_run|schedule|repository_dispatch):/m.test(body), '자동 또는 외부 이벤트 이미지 게시를 허용하지 않습니다.');
  for (const permission of ['contents: read', 'actions: read', 'packages: write'])
    required(body.includes(`  ${permission}\n`), `필수 게시 권한이 없습니다: ${permission}`);
  required(body.includes('  group: publish-verified-images\n  cancel-in-progress: false\n'), '동시 게시 실행을 취소하거나 겹칠 수 없습니다.');
  const matrix = /^        app: \[([^\]]+)\]$/m.exec(body)?.[1].split(',').map(value => value.trim()) ?? [];
  required(sameSet(matrix, policy.services), '게시 서비스 matrix가 빠졌거나 중복되었습니다.');
  for (const action of Object.values(policy.actions)) required(body.includes(`      - uses: ${action}\n`), `공식 게시 action이 빠졌습니다: ${action}`);
  const approvedActions = Object.fromEntries(Object.values(policy.actions).map(action => action.split('@')).map(([name, version]) => [name, version]));
  for (const match of body.matchAll(/^      - uses: ([^@\s]+)@([^\s]+)$/gm)) {
    required(Object.hasOwn(approvedActions, match[1]) && approvedActions[match[1]] === match[2], `승인되지 않은 action 또는 버전입니다: ${match[0].trim()}`);
  }
  const exact = [
    '      - id: verification\n        run: node tooling/publication-source.mjs resolve',
    '          name: workspace-verification-${{ steps.verification.outputs.run_id }}-${{ steps.verification.outputs.attempt }}',
    '          run-id: ${{ steps.verification.outputs.run_id }}',
    '      - run: node tooling/publication-source.mjs verify',
    '          ref: ${{ needs.source.outputs.commit }}',
    '      - run: docker build -t ghcr.io/company-org/company-workspace-${{ matrix.app }}:${{ needs.source.outputs.commit }} apps/${{ matrix.app }}',
    '      - run: node tooling/container-smoke.mjs --service ${{ matrix.app }} --image ghcr.io/company-org/company-workspace-${{ matrix.app }}:${{ needs.source.outputs.commit }}',
    '      - run: docker push ghcr.io/company-org/company-workspace-${{ matrix.app }}:${{ needs.source.outputs.commit }}',
    '        run: node tooling/image-publication-record.mjs --service ${{ matrix.app }} --image ghcr.io/company-org/company-workspace-${{ matrix.app }}:${{ needs.source.outputs.commit }}',
    '          pattern: image-publication-*-${{ github.run_id }}-${{ github.run_attempt }}',
    '      - run: node tooling/image-publication-set.mjs',
    '          SOURCE_RESULT: ${{ needs.source.result }}',
    '          PUBLISH_RESULT: ${{ needs.publish.result }}',
    '          if-no-files-found: error'
  ];
  for (const marker of exact) required(body.includes(marker), `게시 workflow 필수 경계가 빠졌습니다: ${marker}`);
  required((body.match(/^          ref: \$\{\{ needs\.source\.outputs\.commit \}\}$/gm) ?? []).length === 2
    && !/^          ref: (?!\$\{\{ needs\.source\.outputs\.commit \}\}$).+/m.test(body), '게시와 집계 checkout은 검증된 exact commit만 사용해야 합니다.');
  required(body.includes('  publication:\n    if: always()\n    needs: [source, publish]\n'), '게시 집계는 source와 전체 matrix 결과를 항상 검사해야 합니다.');
  required(!/\bcontinue-on-error\s*:|\bcancel-in-progress:\s*true|\bif-no-files-found:\s*(?:warn|ignore)|\bid-token:\s*write|\battestations:\s*write/.test(body), '게시 실패를 무시하거나 지원되지 않는 서명 권한을 요청할 수 없습니다.');
  return true;
}

export function main(args = process.argv.slice(2)) {
  required(args.length === 0, '인수 없이 고정 게시 workflow만 검사합니다.');
  validatePublicationWorkflow(readFileSync(resolve(root, publicationPolicy.workflow), 'utf8'));
  console.log('Publication workflow policy checked.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Publication workflow rejected: ${error.message}`); process.exitCode = 1; }
}
