export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > '9998-12-31') return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function dateError(value: string, min = '0001-01-01', max = '9998-12-31') {
  if (!value) return '';
  if (!validDate(value)) return '날짜를 YYYY-MM-DD 형식으로 입력해 주세요.';
  if (value < min) return `${min} 이후 날짜를 선택해 주세요.`;
  if (value > max) return `${max} 이전 날짜를 선택해 주세요.`;
  return '';
}
export function monthDays(month: string) {
  const first = new Date(month + '-01T12:00:00Z');
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(first); date.setUTCDate(date.getUTCDate() + i);
    return date.toISOString().slice(0, 10);
  });
}
export function shiftMonth(month: string, delta: number) {
  const date = new Date(month + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
