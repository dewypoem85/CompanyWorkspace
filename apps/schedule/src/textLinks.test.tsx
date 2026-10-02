import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Body } from './Editor';
import { TaskLinkProvider } from './TaskLinks';
import { splitLinks, taskLink } from './textLinks';

describe('본문·댓글 링크', () => {
  it('한글·쿼리·줄바꿈을 보존하고 문장 끝 괄호와 마침표를 링크에서 제외한다', () => {
    const text = '참고 (https://example.com/한글?q=1&b=2).\nhttps://example.com/wiki/Foo_(bar) www.example.com!';
    const parts = splitLinks(text);
    expect(parts.map(p => p.text).join('')).toBe(text);
    expect(parts.filter(p => p.href).map(p => p.text)).toEqual(['https://example.com/한글?q=1&b=2', 'https://example.com/wiki/Foo_(bar)', 'www.example.com']);
    expect(parts.at(-2)?.href).toBe('https://www.example.com/');
  });
  it('실제 일정 도메인·로컬 주소만 일정으로 인식하고 댓글 위치를 유지한다', () => {
    expect(taskLink('https://schedule.example.com/tasks/42#comment-9', 'http://localhost:5199')).toEqual({ id:42, commentId:9, href:'/tasks/42#comment-9' });
    expect(taskLink('http://localhost:5199/tasks/7', 'http://localhost:5199')?.id).toBe(7);
    for (const url of ['https://schedule.example.com.evil.test/tasks/42', 'https://evil.test/tasks/42', 'https://user:pass@schedule.example.com/tasks/42', 'https://schedule.example.com/tasks/42/edit', 'https://schedule.example.com/tasks/0', 'https://schedule.example.com/tasks/999999999999999999999']) expect(taskLink(url, 'http://localhost:5199')).toBeNull();
  });
  it('HTML과 스크립트를 실행하지 않고 기존 멘션과 외부 하이퍼링크를 함께 표시한다', () => {
    const html = renderToStaticMarkup(<Body text={'@[동료](2) <script>alert(1)</script> javascript:alert(1) https://example.com/?a=1&b=2'} employees={[]} />);
    expect(html).toContain('class="mention"');expect(html).toContain('<span>@동료</span>');expect(html).toContain('data-workspace-entity="employee"');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"');
  });
  it('제목 로딩 전에도 접근 가능한 일정 바로가기를 제공한다', () => {
    const html = renderToStaticMarkup(<TaskLinkProvider open={() => {}} projects={[]}><Body text="https://schedule.example.com/tasks/42#comment-9" employees={[]} /></TaskLinkProvider>);
    expect(html).toContain('class="task-reference" href="/tasks/42#comment-9"');
    expect(html).toContain('일정 #42'); expect(html).toContain('<small>댓글</small>');
  });
});
