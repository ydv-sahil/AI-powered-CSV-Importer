/** Small, dependency-free string helpers shared by the normalizer and the prompt builder. */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Anything that could plausibly be a phone number: 7+ digits, optional +, separators allowed. */
const PHONE_RE = /\+?\d[\d\s()\-.]{5,}\d/g;

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  const t = value.trim().toLowerCase();
  return t === '' || t === 'null' || t === 'undefined' || t === 'n/a' || t === 'na' || t === '-';
}

/**
 * Trim, tidy internal whitespace, and coerce blank-ish sentinels to ''.
 *
 * Newlines are deliberately **preserved**. A naive `\s+ → ' '` would collapse
 * them here, and `escapeForCsvCell` — which runs last and turns them into the
 * literal `\n` the CSV spec asks for — would have nothing left to escape.
 * Only horizontal whitespace is collapsed.
 */
export function clean(value: unknown): string {
  if (isBlank(value)) return '';

  return String(value)
    .replace(/\r\n?/g, '\n') // CRLF / CR → LF
    .replace(/[^\S\n]+/g, ' ') // runs of spaces and tabs, but not newlines
    .replace(/ ?\n ?/g, '\n') // drop the spaces that hug a newline
    .trim();
}

/** Extract every email address in a string, lowercased and de-duplicated in order. */
export function extractEmails(value: string): string[] {
  const matches = value.match(EMAIL_RE) ?? [];
  return dedupe(matches.map((m) => m.toLowerCase()));
}

/**
 * Extract every phone-number-shaped substring, reduced to `+`-prefixed digits.
 * De-duplicated on digits alone so `+91 98765 43210` and `9876543210` don't both survive.
 */
export function extractPhones(value: string): string[] {
  const matches = value.match(PHONE_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const match of matches) {
    const hasPlus = match.trim().startsWith('+');
    const digits = match.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;

    // Two spellings of the same number differ only by a leading country code.
    const tail = digits.slice(-10);
    if (seen.has(tail)) continue;
    seen.add(tail);

    out.push(hasPlus ? `+${digits}` : digits);
  }

  return out;
}

export function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Make a value safe to sit inside a single CSV cell on a single CSV row.
 * Real newlines become the two-character escape `\n`, per the import spec.
 */
export function escapeForCsvCell(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\\n').trim();
}

/** Join note fragments with `; `, dropping blanks and duplicates. */
export function joinNotes(fragments: Array<string | undefined | null>): string {
  const parts = fragments
    .map((f) => clean(f))
    .filter((f) => f.length > 0);
  return dedupe(parts).join('; ');
}

/** `Lead Owner` / `lead-owner` / `LEAD_OWNER` → `lead_owner`. Used to spot exact header matches. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
