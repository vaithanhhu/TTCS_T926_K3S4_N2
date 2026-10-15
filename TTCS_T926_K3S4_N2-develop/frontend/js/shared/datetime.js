/** Audit timestamps are stored as UTC, including SQLite values without an offset. */
window.ATS_DATETIME = (() => {
  function parseUtcTimestamp(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    const parts = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/i.exec(raw);
    if (!parts) return null;
    // Reject calendar/time overflow instead of silently rolling into another day.
    const calendar = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== raw.slice(0, 10) ||
        Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) return null;
    const normalized = raw.replace(' ', 'T') + (parts[8] ? '' : 'Z');
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatUtcTimestamp(value, options = {}) {
    const date = parseUtcTimestamp(value);
    // No fixed display timezone: the browser's timezone is used by default.
    return date ? date.toLocaleString('vi-VN', options) : '—';
  }

  return { parseUtcTimestamp, formatUtcTimestamp };
})();
