export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function dayAdd(date: string, n: number) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return dateString(d); }
export function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function monday(date = today()) { const d = new Date(date + 'T12:00:00'); return dayAdd(date, -((d.getDay() + 6) % 7)); }
export function stamp(date: string, includeYear = false) { return new Date(date.endsWith('Z') ? date : date + 'Z').toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: includeYear ? 'numeric' : undefined, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
