import test from 'node:test';
import assert from 'node:assert/strict';
import { companyUserAuditFields } from '../lib/company-user.js';

test('Company Portal 직원 정보를 감사 로그 공통 필드로 변환한다', () => {
  assert.deepEqual(companyUserAuditFields({
    id: '15',
    name: '홍길동',
    email: 'Hong@Example.com'
  }), {
    user: '홍길동',
    userId: '15',
    userName: '홍길동',
    userEmail: 'hong@example.com'
  });
});
