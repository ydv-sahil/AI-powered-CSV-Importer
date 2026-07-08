/**
 * Date normalization.
 *
 * The contract is narrow: whatever we emit for `created_at` must satisfy
 * `!isNaN(new Date(created_at).getTime())` in JavaScript. Real-world CSVs carry
 * `29-06-2026 10:00`, `13/05/2026`, `May 13, 2026`, Excel serial numbers, and
 * Unix timestamps — none of which `new Date()` handles correctly (or at all).
 *
 * We emit `YYYY-MM-DD HH:mm:ss`, matching the GrowEasy sample records.
 */

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/** `29-06-2026 10:00`, `29/06/2026`, `6.29.2026` — separator-agnostic day/month first. */
const NUMERIC_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/** Excel stores dates as days since 1899-12-30. Anything in this window is plausibly a date. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_MIN = 20000; // ~1954
const EXCEL_MAX = 60000; // ~2064

/** Unix seconds, in a sane range (2001-09-09 .. 2286-11-20). */
const UNIX_S_MIN = 1_000_000_000;
const UNIX_S_MAX = 9_999_999_999;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Format a Date in UTC as `YYYY-MM-DD HH:mm:ss`. */
function format(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * Format a Date using its **local** components.
 *
 * Only for dates `new Date(string)` built by interpreting a zone-less string as
 * local time. Reading those back with UTC getters would silently shift the
 * wall-clock the user wrote — `May 13, 2026` becomes 12 May 18:30 on an IST box.
 */
function formatLocal(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function isValid(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

/**
 * Nudge an ISO-ish string into strict ISO 8601 so `new Date()` reads it as UTC
 * rather than local time. A bare `2026-05-13` is already UTC by spec; a
 * `2026-05-13 14:20:48` is not, and would otherwise shift by the server's offset.
 */
function toIso8601(value: string): string {
  const hasTime = /[T ]\d{2}:\d{2}/.test(value);
  if (!hasTime) return value;

  const withT = value.replace(' ', 'T');
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(withT);
  return hasZone ? withT : `${withT}Z`;
}

/**
 * Interpret a numeric-separated date. Ambiguous `05/06/2026` is read as
 * **day-first** (5 June), matching Indian CRM exports; `13/06/2026` is
 * unambiguous and read the same way. If the first component exceeds 12 it can
 * only be a day; if the *second* exceeds 12 we flip to month-first.
 */
function parseNumericDmy(value: string): Date | null {
  const m = NUMERIC_DMY.exec(value);
  if (!m) return null;

  let day = Number(m[1]);
  let month = Number(m[2]);
  const year = Number(m[3]);
  const hour = Number(m[4] ?? 0);
  const minute = Number(m[5] ?? 0);
  const second = Number(m[6] ?? 0);

  if (day > 12 && month > 12) return null; // neither reading works
  if (month > 12) [day, month] = [month, day]; // must have been MM/DD/YYYY

  if (day < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Rejects 31 February and friends, which Date silently rolls forward.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date;
}

function parseNumeric(value: string): Date | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);

  if (n >= EXCEL_MIN && n <= EXCEL_MAX) {
    return new Date(EXCEL_EPOCH_MS + Math.round(n * 86_400_000));
  }
  if (n >= UNIX_S_MIN && n <= UNIX_S_MAX) {
    return new Date(n * 1000);
  }
  if (n > UNIX_S_MAX) {
    return new Date(n); // already milliseconds
  }
  return null;
}

/**
 * Coerce any date-ish string into `YYYY-MM-DD HH:mm:ss`.
 * Returns `''` when the value cannot be understood — a blank `created_at` is
 * always preferable to a wrong one.
 */
export function normalizeDate(input: string): string {
  const value = input.trim();
  if (!value) return '';

  // 1. Already ISO-ish. `new Date()` handles this correctly and unambiguously.
  if (ISO_LIKE.test(value)) {
    const date = new Date(toIso8601(value));
    if (isValid(date)) return format(date);
  }

  // 2. Day-first numeric, the most common CSV export shape outside the US.
  const dmy = parseNumericDmy(value);
  if (dmy && isValid(dmy)) return format(dmy);

  // 3. Excel serials and Unix timestamps.
  const numeric = parseNumeric(value);
  if (numeric && isValid(numeric)) return format(numeric);

  // 4. Anything `new Date()` recognises on its own: `May 13, 2026`, RFC 2822, …
  //    A zone-less string here was parsed as local time, so read it back as local.
  const native = new Date(value);
  if (isValid(native)) {
    const hasExplicitZone = /(Z|GMT|UTC|[+-]\d{2}:?\d{2})\s*$/i.test(value);
    return hasExplicitZone ? format(native) : formatLocal(native);
  }

  return '';
}

/** Guards the final output: the exact check the spec asks for. */
export function isJsParseableDate(value: string): boolean {
  return value === '' || !Number.isNaN(new Date(value).getTime());
}
