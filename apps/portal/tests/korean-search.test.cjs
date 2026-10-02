const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../wwwroot/js/company-workspace.js'), 'utf8');
const sandbox = {window:{}};
vm.runInNewContext(source.slice(source.indexOf('  // Shared Korean list search'), source.indexOf('  const scriptUrl')), sandbox);
const {matches, createMatcher} = sandbox.window.CompanySearch;
for (const [value, query, expected] of [
  ['라재준', 'ㄹㅈㅈ', true], ['라재준', 'ㅈㅈ', true], ['라재준', '라ㅈㅈ', true],
  ['라재준', 'ㄹ재ㅈ', true], ['라재준', 'ㄹㅊㅈ', false], ['라재준', '재준', true],
  ['던전슬래셔', 'ㄷㅈㅅㄹㅅ', true], ['개발팀', 'ㄱㅂ', true],
  ['까치', 'ㄲㅊ', true], ['까치', 'ㄱㅊ', false],
  ['라 재 준', ' ㄹ ㅈㅈ ', true], ['QA 테스트 42', 'qaㅌㅅㅌ42', true],
  ['라재준'.normalize('NFD'), 'ㄹㅈㅈ', true], ['라재준', '\u1105\u110c\u110c', true],
  ['Alpha@example.test', 'ALPHA@', true], ['[테스트].*', '[ㅌㅅㅌ].*', true],
  ['테스트', '.*', false], ['테스트', '[', false], ['테스트', '(a+)+$', false],
  ['', 'ㄱ', false], [null, '', true], ['이름', '   ', true],
  ['테스트😀', 'ㅌㅅㅌ😀', true]
]) test(JSON.stringify(query)+' searches '+JSON.stringify(value), () => assert.equal(matches(value, query), expected));
test('all 11,172 Hangul syllables match only their own initial', () => {
  const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const matchers = [...initials].map(createMatcher);
  for (let code=0xac00; code<=0xd7a3; code++) {
    const index = Math.floor((code-0xac00)/588), value = String.fromCharCode(code);
    assert.equal(matchers[index](value), true);
    assert.equal(matchers[(index+1)%19](value), false);
  }
});
test('compiled matcher is reusable', () => {
  const match = createMatcher('ㄱㅅ');
  assert.equal(match('김수'), true); assert.equal(match('김수'), true); assert.equal(match('라재준'), false);
});
