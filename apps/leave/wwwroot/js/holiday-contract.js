const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const token = value => typeof value === 'string' && /^[A-F0-9]{64}$/.test(value);
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const name = value => typeof value === 'string' && value.trim().length > 0;
const sameRows = (a, b) => a.length === b.length && a.every((row, i) => row.id === b[i].id && row.date === b[i].date && row.name === b[i].name);
const require = (condition, message) => { if (!condition) throw Error(message); };

export function validateHolidaySnapshot(value) {
  require(value && id(value.actorEmployeeId) && token(value.stateToken) && Array.isArray(value.items), 'Invalid holiday snapshot');
  const ids = new Set(); let previous = '';
  for (const row of value.items) {
    require(row && id(row.id) && !ids.has(row.id) && date(row.date) && row.date > previous && name(row.name), 'Invalid holiday row');
    ids.add(row.id); previous = row.date;
  }
  return value;
}

export function validateHolidayReceipt(data, operation, before, intent) {
  validateHolidaySnapshot(before);
  require(data?.operation === operation && data.previousStateToken === before.stateToken && data.intent, 'Holiday operation changed');
  const after = validateHolidaySnapshot(data.snapshot), actual = data.intent;
  require(after.actorEmployeeId === before.actorEmployeeId, 'Holiday owner changed');
  const expected = new Map(before.items.map(row => [row.date, {...row}]));
  let year;
  if (operation === 'Add') {
    require(date(intent.date) && name(intent.name) && actual.date === intent.date && actual.name === intent.name && data.applied === null && data.counts === null, 'Holiday input changed');
    expected.set(intent.date, {...expected.get(intent.date), date:intent.date, name:intent.name});
    year = Number(intent.date.slice(0, 4));
  } else if (operation === 'Delete') {
    const row = before.items.find(item => item.id === intent.id);
    require(row && actual.id === intent.id && data.applied === null && data.counts === null, 'Holiday delete target changed');
    expected.delete(row.date); year = Number(row.date.slice(0, 4));
  } else if (operation === 'ImportOnline' || operation === 'ImportJson') {
    year = intent.year;
    require(Number.isInteger(year) && year >= 2000 && year <= 2100 && typeof intent.overwriteExisting === 'boolean' &&
      (operation === 'ImportJson' ? token(intent.jsonHash) : intent.jsonHash === null) && actual.year === year &&
      actual.overwriteExisting === intent.overwriteExisting && actual.jsonHash === intent.jsonHash && Array.isArray(data.applied) && data.applied.length > 0, 'Holiday import intent changed');
    const counts = {created:0, updated:0, skipped:0}; let previous = '';
    for (const row of data.applied) {
      require(row && date(row.date) && row.date > previous && row.date.startsWith(year + '-') && name(row.name) && row.name === row.name.trim(), 'Invalid applied holiday');
      previous = row.date;
      const old = expected.get(row.date);
      if (!old) { expected.set(row.date, {...row}); counts.created++; }
      else if (intent.overwriteExisting && old.name !== row.name) { expected.set(row.date, {...old, name:row.name}); counts.updated++; }
      else counts.skipped++;
    }
    require(data.counts && Object.entries(counts).every(([key, count]) => data.counts[key] === count), 'Holiday import counts changed');
  } else throw Error('Unknown holiday operation');
  require(data.navigateTo === '/Admin/Holidays?Year=' + year, 'Holiday destination changed');
  const desired = [...expected.values()].sort((a, b) => a.date.localeCompare(b.date)), oldIds = new Set(before.items.map(row => row.id));
  require(desired.length === after.items.length && desired.every((row, index) => {
    const saved = after.items[index];
    return saved.date === row.date && saved.name === row.name && (row.id ? saved.id === row.id : !oldIds.has(saved.id));
  }), 'Unconfirmed holiday list');
  require(sameRows(before.items, after.items) === (before.stateToken === after.stateToken), 'Holiday state token disagrees with rows');
  return {snapshot:after, year, counts:data.counts};
}

export async function holidayTextHash(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}
