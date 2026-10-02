import test from 'node:test';
import assert from 'node:assert/strict';
import {primitiveViolations as scan, groupViolations, comparePrimitiveDebt as compare, prunePrimitiveDebt as prune} from '../check-ui-primitives.mjs';

const path='apps/demo/src/Page.tsx';
const inventory=rows=>({version:1,baselineCommit:'a'.repeat(40),sealed:false,files:[...new Set(rows.map(row=>row.path))].map(path=>({path,reason:'Existing UI at import.',removeWhen:'Replace with common component and verify behavior.'})),entries:groupViolations(rows)});
const rules=source=>scan(path,source).map(row=>row.rule);

test('static guidance requires common note markup without live outcome hydration',()=>{
  const good='<section className="cw-callout" role="note" data-tone="warning"><strong>주의</strong><p>본문 <code>gzip-v1</code></p></section>';
  assert.deepEqual(rules(good),[]);
  for(const bad of [good.replace('role="note"',''),good.replace('cw-callout','private'),good.replace('warning','success'),good.replace('<strong>','<span>'),good.replace('role="note"','role="note" aria-live="polite"'),good.replace('role="note"','role="note" data-workspace-state="success"'),good.replaceAll('section','aside')])assert.deepEqual(rules(bad),['static-note']);
  for(const bad of [good.replace('</p>',''),good.replace('주의',''),good.replace('<strong>','<section><strong>'),good.replace('role="note"','role="note" style="color:white"')])assert.deepEqual(rules(bad),['static-note']);
  assert.deepEqual(rules('<aside className="sidebar">메뉴</aside><div>본문</div>'),[]);
});

test('responsive common tables require real header scopes, native table role and server labels',()=>{
  const good='<table className="cw-data-table" data-layout="cards" role="table"><thead><tr><th scope="col">직원</th></tr></thead><tbody><tr><td data-label="직원"><div className="cw-table-value">김</div></td></tr><tr><td colspan="2" data-label=""><div className="cw-table-value">없음</div></td></tr></tbody></table>';
  assert.deepEqual(rules(good),[]);
  for(const bad of [good.replace('role="table"',''),good.replace('scope="col"',''),good.replace('data-label="직원"',''),good.replace('cw-table-value','not-common'),good.replaceAll('scope="col"','scope="row"')])assert.deepEqual(rules(bad),['native-table']);
  assert.deepEqual(rules('<table className="cw-data-table" data-layout="key-value" role="table"><tbody><tr><th scope="row">경로</th><td>/path</td></tr></tbody></table>'),[]);
  assert.deepEqual(rules('<table className="cw-data-table" data-layout="cards" role="table"></table>'),['native-table']);
  assert.deepEqual(rules(good.replace('data-layout="cards"','data-layout="card"')),['native-table']);
  assert.deepEqual(rules('<table className="cw-data-table" data-layout="cards" role="table">'+good+'</table>'),['native-table'],'nested headers cannot satisfy a missing outer header');
});

test('common calendar tables preserve a named native grid with scoped weekday headers',()=>{
  const good='<table className="cw-calendar-table year-mini-calendar" data-calendar-layout="year-mini" role="table" aria-label="2026년 9월 연차 달력"><thead><tr><th scope="col">일</th><th scope="col">월</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
  assert.deepEqual(rules(good),[]);
  for(const bad of [
    good.replace('data-calendar-layout="year-mini"',''),
    good.replace('data-calendar-layout="year-mini"','data-calendar-layout="unsupported"'),
    good.replace('role="table"',''),
    good.replace('aria-label="2026년 9월 연차 달력"',''),
    good.replace('scope="col"',''),
    good.replaceAll('scope="col"','scope="row"'),
  ])assert.deepEqual(rules(bad),['native-table']);
  const nested=rules(good.replace('<tbody>','<tbody><table></table>'));
  assert.ok(nested.length>0&&nested.every(rule=>rule==='native-table'));
  assert.deepEqual(rules(good.replace('aria-label="2026년 9월 연차 달력"','aria-labelledby="month-heading"')),[]);
  const month='<table className="cw-calendar-table month-calendar" data-calendar-layout="month" role="table" aria-label="2026년 9월 연차 달력"><thead><tr><th scope="col">일</th></tr></thead><tbody><tr><td data-date="2026-09-01" data-date-label="2026.09.01"><button className="cw-button" data-day-detail-trigger>1</button></td></tr></tbody></table>';
  assert.deepEqual(rules(month),[]);
  for(const bad of [month.replace('data-date="2026-09-01"',''),month.replace('data-date-label="2026.09.01"',''),month.replace('data-day-detail-trigger','data-unowned-trigger')])assert.deepEqual(rules(bad),['native-table']);
});

test('literal native fields, buttons, tables and dialogs require their shared primitive',()=>{
  assert.deepEqual(rules('<input/><select></select><textarea/><button/><table/><dialog/>'),['native-field','native-field','native-field','native-button','native-table','native-dialog']);
  assert.deepEqual(rules('<input className="cw-form-control"/><select className="cw-form-control"/><textarea className="cw-form-control"/><button className="cw-button"/><table className="cw-data-table"/><dialog className="cw-dialog-form"/><dialog className="cw-review"/>'),[]);
  assert.deepEqual(rules('<Input/><Button/><DataTable/>'),[],'React components are not native tags');
  assert.deepEqual(rules('useWorkspaceModal(root, options); <dialog className="cw-modal" aria-label="편집"/>'),[]);
  assert.deepEqual(rules('<dialog className="cw-modal"/>'),['native-dialog']);
  assert.deepEqual(rules('<dialog className="cw-modal-fake"/>'),['native-dialog']);
  assert.deepEqual(scan('apps/demo/Pages/Edit.cshtml','<INPUT><BUTTON>').map(row=>row.rule),['native-field','native-button']);
  assert.deepEqual(scan('apps/demo/public/index.html','<BUTTON CLASS="cw-button"/>'),[]);
  assert.deepEqual(scan('apps/demo/public/index.html','<button className="cw-button"/>').map(row=>row.rule),['native-button'],'HTML does not use React className');
});

test('owned modal class alone cannot bypass binding, accessible naming and lifecycle ownership',()=>{
  const good='useWorkspaceModal(root, options); <dialog ref={root} className="cw-modal" aria-labelledby="title"/>';
  for(const bad of [good.replace('useWorkspaceModal(root, options);',''),good.replace('aria-labelledby="title"',''),good.replace('ref={root}','ref={root} open'),good.replace('ref={root}','ref={root} onCancel={close}'),good.replace('ref={root}','ref={root} onClose={close}')])assert.deepEqual(rules(bad),['native-dialog']);
  assert.deepEqual(scan('apps/demo/public/editor.js','CompanyDialog.attach(node, options); const template = `<dialog class="cw-modal" aria-label="편집"></dialog>`;'),[]);
});

test('quoted greater-than, JSX arrows, literal expressions and common template prefixes are recognized',()=>{
  for(const source of [
    '<button title="x > y" className="cw-button"/>',
    '<button onClick={() => action()} className={"cw-button"}/>',
    '<input className={\'cw-form-control\'} />',
    '<button className={`cw-button ${variant}`} />',
    '`<button class="cw-button ${variant}">x</button>`',
    '<button title="<input>" className="cw-button"/>',
    '<button class="cw-button @variant">x</button>',
    '<button class=cw-button>x</button>',
  ])assert.deepEqual(rules(source),[],source);
});

test('common class cannot be borrowed from unrelated attributes or conditional expressions',()=>{
  for(const source of [
    '<button data-class="cw-button"/>',
    '<button title="class=\'cw-button\'"/>',
    '<button className={enabled ? "cw-button" : ""}/>',
    '<button className={"cw-button " && ""}/>',
    '<button className={"" || "cw-button"}/>',
    '<button className={`prefix ${"cw-button"}`} />',
    '<button className={`cw-button${suffix}`} />',
    '<button class="cw-button@variant"/>',
    '<button className="not-cw-button"/>',
    '<button className={classes}/>',
    '<button className="custom" className="cw-button"/>',
    '<button class="custom" class="cw-button"/>',
  ])assert.deepEqual(rules(source),['native-button'],source);
});

test('comments are ignored while literal templates and quoted URL attributes remain checked',()=>{
  assert.deepEqual(scan('apps/demo/Pages/Edit.cshtml','<!-- <button> -->\n@* <input> *@\n<button title="https://example.test/x">').map(row=>[row.rule,row.line]),[['native-button',3]]);
  assert.deepEqual(rules('// <button>\n/* <input> */\n{/* <table> */}\nconst html = `<textarea></textarea>`;'),['native-field']);
});

test('nontext controls stay outside text fields while range uses its dedicated shared primitive',()=>{
  assert.deepEqual(rules('<input type="hidden"/><input type="checkbox"/><input type="radio"/><input type="file"/>'),[]);
  assert.deepEqual(rules('<input type="range"/>'),['native-range']);
  assert.deepEqual(rules('<input type="range" className="cw-form-control"/>'),['native-range']);
  assert.deepEqual(rules('<input type="range" className="cw-range"/>'),[]);
  assert.deepEqual(rules('<input type="submit" className="cw-button"/>'),['native-button']);
  assert.deepEqual(rules('<input type={unknown}/>'),['native-field']);
});

test('literal DOM factories and native dialogs are detected without rejecting the shared API',()=>{
  assert.deepEqual(rules('document.createElement("button"); createElement("table");'),['native-dom','native-dom']);
  assert.deepEqual(rules('const token = document.createElement("input"); token.type="hidden";'),[]);
  assert.deepEqual(rules('const token = document.createElement("input"); other.type="hidden";'),['native-dom']);
  assert.deepEqual(rules('confirm("x"); window.prompt("x"); globalThis.alert("x"); CompanyDialog.confirm({}); api.confirm({});'),['native-confirm','native-confirm','native-confirm']);
});

test('legacy allowance is exact path, rule, opening tag signature and count, not a file exemption',()=>{
  const rows=scan(path,'<button>Old</button>'),debt=inventory(rows);
  assert.deepEqual(compare(rows,debt),[]);
  assert.deepEqual(compare(scan(path,'\n<button>Renamed</button>'),debt),[],'text/line movement is not new markup');
  for(const changed of [scan(path,'<button/><button/>'),scan('apps/demo/src/New.tsx','<button>'),scan(path,'<button className="custom">'),[...rows,...rows]])
    assert.ok(compare(changed,debt).some(error=>error.includes('new/increased')),JSON.stringify(changed));
  assert.ok(compare([],debt).some(error=>error.includes('retired')));
});

test('prune can only decrease reviewed allowances, never accept new code or new copies',()=>{
  const rows=scan(path,'<button/><button/><input/>'),debt=inventory(rows);
  const reduced=scan(path,'<button/>'),next=prune(reduced,debt);
  assert.equal(next.entries.length,1);assert.equal(next.entries[0].count,1);assert.deepEqual(compare(reduced,next),[]);
  const increased=[...rows,...rows],unchanged=prune(increased,debt);
  assert.deepEqual(unchanged,debt);assert.ok(compare(increased,unchanged).some(error=>error.includes('new/increased')));
  const replacement=scan(path,'<table/>'),rejected=prune(replacement,debt);
  assert.equal(rejected.entries.length,0);assert.equal(rejected.files.length,0);assert.ok(compare(replacement,rejected).some(error=>error.includes('new/increased')));
  assert.deepEqual(compare([],prune([],debt)),[]);
});

test('inventory metadata, counts, signatures, file policies and duplicate entries are validated',()=>{
  const rows=scan(path,'<button/>'),valid=inventory(rows);
  for(const mutate of [
    value=>value.version=2,
    value=>delete value.sealed,
    value=>value.sealed='yes',
    value=>value.baselineCommit='not-a-commit',
    value=>value.files[0].reason='',
    value=>value.files.push(null),
    value=>value.files[0].reason=123,
    value=>value.files[0].removeWhen='',
    value=>value.files[0].path='apps/demo/../outside',
    value=>value.files.push(value.files[0]),
    value=>value.entries[0].count=0,
    value=>value.entries.push(null),
    value=>value.entries[0].count=1.5,
    value=>value.entries[0].signature='fake',
    value=>value.entries[0].rule='ignored',
    value=>value.entries.push(value.entries[0]),
  ]){const changed=structuredClone(valid);mutate(changed);assert.ok(compare(rows,changed).some(error=>error.startsWith('Invalid')));}
  const sealed=inventory([]);sealed.sealed=true;assert.deepEqual(compare([],sealed),[]);
  const restored=inventory(rows);restored.sealed=true;assert.ok(compare(rows,restored).some(error=>error.includes('allowances cannot be restored')));
});
