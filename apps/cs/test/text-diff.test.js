import test from 'node:test';
import assert from 'node:assert/strict';
import { diffTextLines } from '../public/text-diff.js';

test('변경이 없으면 모든 줄을 unchanged로 반환한다', () => {
  const diff = diffTextLines('{\n  "gem": 100\n}', '{\n  "gem": 100\n}');
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.lines.map((line) => line.kind), ['unchanged', 'unchanged', 'unchanged']);
});

test('같은 위치의 값 변경은 수정 줄로 표시한다', () => {
  const diff = diffTextLines('{\n  "gem": 100\n}', '{\n  "gem": 123\n}');
  assert.equal(diff.modifiedCount, 1);
  assert.equal(diff.addedCount, 0);
  assert.equal(diff.removedCount, 0);
  assert.deepEqual(diff.lines.map((line) => line.kind), ['unchanged', 'modified', 'unchanged']);
  assert.deepEqual(diff.changes, [{
    kind: 'modified', originalStart: 1, originalEnd: 2, currentStart: 1, currentEnd: 2,
    targetLine: 1, modifiedLines: 1, addedLines: 0, removedLines: 0
  }]);
});

test('줄 추가와 삭제를 별도로 집계한다', () => {
  const added = diffTextLines('alpha\nomega', 'alpha\nbeta\nomega');
  assert.equal(added.addedCount, 1);
  assert.deepEqual(added.lines.map((line) => line.kind), ['unchanged', 'added', 'unchanged']);

  const removed = diffTextLines('alpha\nbeta\nomega', 'alpha\nomega');
  assert.equal(removed.removedCount, 1);
  assert.deepEqual(removed.lines.map((line) => line.kind), ['unchanged', 'unchanged']);
  assert.deepEqual(removed.changes, [{
    kind: 'removed', originalStart: 1, originalEnd: 2, currentStart: 1, currentEnd: 1,
    targetLine: 1, modifiedLines: 0, addedLines: 0, removedLines: 1
  }]);
});

test('큰 데이터의 서로 떨어진 변경도 사이 줄을 변경으로 오인하지 않는다', () => {
  const originalLines = Array.from({ length: 1_200 }, (_, index) => `"unique-key-${index}": ${index}`);
  const currentLines = [...originalLines];
  currentLines[100] = '"unique-key-100": 9999';
  currentLines[1_100] = '"unique-key-1100": 8888';
  const diff = diffTextLines(originalLines.join('\n'), currentLines.join('\n'));
  assert.equal(diff.modifiedCount, 2);
  assert.equal(diff.lines.filter((line) => line.kind === 'unchanged').length, 1_198);
  assert.deepEqual(diff.changes.map((change) => change.targetLine), [100, 1_100]);
});
