import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MilestoneDetails } from './Settings';

describe('주요 일정 상세 읽기', () => {
  it('줄바꿈과 긴 내용을 유지하고 입력 HTML은 텍스트로 표시한다', () => {
    const html = renderToStaticMarkup(<MilestoneDetails milestone={{ title: '배포', date: '2026-09-08', description: '준비 사항\n<script>alert(1)</script>\n검수 완료' }} projects={[]} />);
    expect(html).toContain('class="body-text"');
    expect(html).toContain('준비 사항\n&lt;script&gt;alert(1)&lt;/script&gt;\n검수 완료');
    expect(html).not.toContain('<textarea'); expect(html).not.toContain('<script>');
  });
  it('기존 일정의 상세 내용 미입력을 안내한다', () => {
    const html = renderToStaticMarkup(<MilestoneDetails milestone={{ title: '기존 일정', date: '2026-09-08' }} projects={[]} />);
    expect(html).toContain('등록된 상세 내용이 없습니다.');
  });
});
