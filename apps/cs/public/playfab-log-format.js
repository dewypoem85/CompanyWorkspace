export function extractLogMessages(eventData, fallback = '') {
  const parsed = parseEventData(eventData);
  const messages = [];
  const seenObjects = new Set();

  collectMessages(parsed, messages, seenObjects, 0);

  const unique = [...new Set(messages.map(normalizeMessage).filter(Boolean))];
  if (unique.length) return unique;

  const normalizedFallback = normalizeMessage(fallback);
  return normalizedFallback ? [normalizedFallback] : ['표시할 메시지가 없습니다.'];
}

export function parseEventData(value) {
  let current = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (typeof current !== 'string') return current;
    const text = current.trim();
    if (!text) return null;
    try {
      current = JSON.parse(text);
    } catch {
      return text;
    }
  }
  return current;
}

function collectMessages(value, messages, seenObjects, depth) {
  if (value === null || value === undefined || depth > 10) return;
  if (typeof value !== 'object') return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);

  if (!Array.isArray(value)) {
    for (const key of ['Message', 'message']) {
      if (typeof value[key] === 'string') messages.push(value[key]);
    }
  }

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectMessages(child, messages, seenObjects, depth + 1);
  }
}

function normalizeMessage(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
