import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLogMessages, parseEventData } from '../public/playfab-log-format.js';

test('CloudScript EventData에서 운영 로그 Message만 추출한다', () => {
  const eventData = JSON.stringify({
    EventName: 'player_executed_cloudscript',
    CloudScriptExecutionResult: {
      FunctionResult: { messageValue: '젬 변동' },
      Logs: [
        { Level: 'Info', Message: '사용자가 젬을 125 만큼 획득 = 970->1095' },
        { Level: 'Info', Message: '보상 지급 완료' }
      ]
    }
  });

  assert.deepEqual(extractLogMessages(eventData), [
    '사용자가 젬을 125 만큼 획득 = 970->1095',
    '보상 지급 완료'
  ]);
});

test('중복 Message를 제거하고 메시지가 없으면 검색 문맥을 사용한다', () => {
  assert.deepEqual(extractLogMessages({ Logs: [
    { Message: '동일 메시지' },
    { message: '동일 메시지' }
  ] }), ['동일 메시지']);
  assert.deepEqual(extractLogMessages('{"value":1}', '검색어 주변 문맥'), ['검색어 주변 문맥']);
});

test('문자열로 한 번 더 감싼 EventData도 해석한다', () => {
  const value = JSON.stringify(JSON.stringify({ Message: '중첩 JSON 메시지' }));
  assert.deepEqual(parseEventData(value), { Message: '중첩 JSON 메시지' });
  assert.deepEqual(extractLogMessages(value), ['중첩 JSON 메시지']);
});
