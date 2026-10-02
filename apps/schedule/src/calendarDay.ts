import { weekDay } from './timeline';
import type { CalendarHoliday } from './types';

export function calendarDay(date: string, holidays: CalendarHoliday[]) {
  const weekday = weekDay(date);
  const holiday = holidays.filter(h => h.date === date).map(h => h.name).join(' · ');
  const kind = holiday ? 'holiday' : weekday === '일' ? 'sunday' : weekday === '토' ? 'saturday' : 'weekday';
  return { kind, holiday, className: `calendar-${kind}`, label: `${date} ${weekday}요일${holiday ? ` · ${holiday}` : kind !== 'weekday' ? ' · 주말' : ''}` };
}
