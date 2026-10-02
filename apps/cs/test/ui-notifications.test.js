import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CS 업무 결과는 공통 상태와 공통 토스트를 구분하고 개별 토스트 구현을 남기지 않는다', async () => {
  const [theme, styles, sharedStates, steam, products, playerData, logs] = await Promise.all([
    readFile('public/theme.js', 'utf8'),
    readFile('public/styles.css', 'utf8'),
    readFile('../../packages/workspace-ui/src/states.js', 'utf8'),
    readFile('public/app.js', 'utf8'),
    readFile('public/product-commands.js', 'utf8'),
    readFile('public/player-data.js', 'utf8'),
    readFile('public/playfab-logs.js', 'utf8')
  ]);

  assert.match(sharedStates, /window\.CompanyToast=\{show:showToast,dismiss:dismissToast\}/);
  assert.doesNotMatch(theme, /CsToast|function showToast|toastContainer/);
  assert.doesNotMatch(styles, /\.cs-toast/);
  for (const script of [playerData, products, steam, logs]) {
    assert.match(script, /window\.CompanyState\.render/);
    assert.match(script, /window\.CompanyToast\.(?:show|dismiss)/);
    assert.doesNotMatch(script, /CsToast|function showToast|toastContainer/);
  }
  assert.match(products, /window\.CompanyState\.render/);
  assert.match(products, /window\.CompanyDialog\.confirm/);
  assert.doesNotMatch(products, /CsToast|function showToast|window\.confirm|\.showModal/);
  assert.match(logs, /window\.CompanyState\.render/);
  assert.match(logs, /window\.CompanyDisclosure\.attach/);
  assert.doesNotMatch(logs, /CsToast|function showToast|createElement\('details'\)/);
  assert.match(steam, /window\.CompanyState\.render/);
  assert.match(steam, /window\.CompanyDialog\.confirm/);
  assert.doesNotMatch(steam, /CsToast|function showToast|window\.confirm/);
});
