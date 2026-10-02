import { describe, expect, it } from 'vitest';
import { archiveTime } from './PersonalTodos';

describe('개인 TODO 보관 시각', () => {
  it('SQLite에서 읽은 UTC 시각에 정확히 72시간을 더한다', () => {
    expect(archiveTime('2026-09-09T16:45:00')).toBe('2026-09-12T16:45:00.000Z');
    expect(archiveTime('2026-09-09T16:45:00Z')).toBe('2026-09-12T16:45:00.000Z');
  });
});
