(function () {
  'use strict';
  const sources = new Set(['leave', 'schedule']);
  const maximumId = '9223372036854775807';
  function id(value) {
    // Accept safe legacy JSON numbers during rollout, never an already-rounded long.
    if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) ||
        value.length > maximumId.length || value.length === maximumId.length && value > maximumId)
      throw Error('알림 식별자를 확인할 수 없습니다. 목록을 다시 확인해 주세요.');
    return value;
  }
  function key(value) {
    if (typeof value !== 'string') throw Error('잘못된 알림 대상입니다.');
    const parts = value.split(':');
    if (parts.length !== 2 || !sources.has(parts[0])) throw Error('잘못된 알림 대상입니다.');
    return { source: parts[0], id: id(parts[1]) };
  }
  function compare(left, right) {
    const a = id(left), b = id(right);
    return a.length === b.length ? (a === b ? 0 : a > b ? 1 : -1) : a.length > b.length ? 1 : -1;
  }
  function feed(value) {
    const invalid = () => { throw Error('알림 응답을 확인할 수 없습니다. 목록을 다시 확인해 주세요.'); };
    if (!value || !Array.isArray(value.items) || !Array.isArray(value.sources) ||
        !Number.isSafeInteger(value.unreadCount) || value.unreadCount < 0) invalid();
    const seen = new Set(), sourceKeys = new Set();
    const statuses = value.sources.map(status => {
      if (!status || !sources.has(status.source) || typeof status.available !== 'boolean' ||
          status.error != null && typeof status.error !== 'string' || sourceKeys.has(status.source)) invalid();
      sourceKeys.add(status.source);
      return { ...status };
    });
    const items = value.items.map(item => {
      if (!item || !sources.has(item.source) || typeof item.isRead !== 'boolean' ||
          !['sourceLabel','type','title','message','link','createdAtUtc'].every(name => typeof item[name] === 'string') ||
          !Number.isFinite(Date.parse(item.createdAtUtc))) invalid();
      const sourceId = id(item.sourceId), identity = item.source + ':' + sourceId;
      if (seen.has(identity)) invalid();
      seen.add(identity);
      return { ...item, sourceId };
    });
    return { items, sources: statuses, unreadCount: value.unreadCount };
  }
  window.CompanyNotificationContract = Object.freeze({ id, key, compare, feed });
})();
