// ============================================================================
// format.js — shared date/time/number formatting helpers.
// ============================================================================

/** ISO string -> value suitable for an <input type="datetime-local"> (local time). */
export function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time, no timezone) -> ISO UTC string. */
export function datetimeLocalToIso(value) {
  if (!value) return '';
  return new Date(value).toISOString();
}

/** ISO string -> friendly local display, e.g. "22 Jul 2026, 2:00 PM". */
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Seconds -> "mm:ss" (or "h:mm:ss" if an hour or more). */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, '');
}
