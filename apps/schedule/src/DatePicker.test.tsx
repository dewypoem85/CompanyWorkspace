import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarDays, DatePicker } from './DatePicker';
import { dateError, monthDays, shiftMonth, validDate } from './calendarPickerDates';

describe('공휴일 날짜 선택 달력', () => {
  it('윤년과 실제 존재하는 날짜만 입력할 수 있고 종료일의 최소 날짜를 지킨다', () => {
    expect(validDate('2028-02-29')).toBe(true);
    for (const value of ['2026-02-29','2026-04-31','2026-13-01','2026-9-01','0000-01-01','wrong']) expect(validDate(value)).toBe(false);
    expect(dateError('2026-09-08','2026-09-09')).not.toBe('');
    expect(dateError('2026-09-09','2026-09-09')).toBe('');
    expect(dateError('')).toBe('');
  });
  it('일요일부터 시작하는 6주 달력에서 월·연도 경계와 윤일을 포함한다', () => {
    const days = monthDays('2026-09'); expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-08-30'); expect(days.at(-1)).toBe('2026-10-10');
    expect(monthDays('2028-02')).toContain('2028-02-29');
    expect(shiftMonth('2026-12',1)).toBe('2027-01'); expect(shiftMonth('2027-01',-1)).toBe('2026-12');
    expect(monthDays('0001-01')).toContain('0001-01-01');
  });
  it('주말·공휴일 색상, 휴일명, 선택일과 선택 불가 날짜를 함께 표시한다', () => {
    const html = renderToStaticMarkup(<CalendarDays days={['2026-09-25','2026-09-26','2026-09-27','2026-10-03']} month="2026-09" value="2026-09-26" holidays={[{date:'2026-09-25',name:'등록 공휴일'}]} min="2026-09-26" max="2026-12-31" choose={()=>{}} />);
    expect(html).toContain('class="calendar-holiday"'); expect(html).toContain('<small>등록 공휴일</small>');
    expect(html).toContain('2026-09-25 금요일 · 등록 공휴일'); expect(html).toContain('disabled=""');
    expect(html).toContain('class="calendar-saturday"'); expect(html).toContain('class="calendar-sunday"');
    expect(html).toContain('aria-pressed="true"'); expect(html).toContain('other-month');
  });
  it('직접 입력과 접근 가능한 달력 버튼을 제공하고 비활성화를 유지한다', () => {
    const html = renderToStaticMarkup(<DatePicker label="종료일" value="" onChange={()=>{}} disabled />);
    expect(html).toContain('placeholder="YYYY-MM-DD"'); expect(html).toContain('aria-label="종료일 달력 열기"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
