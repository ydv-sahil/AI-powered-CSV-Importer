import {
  type CrmRecord,
  type RawLlmRecord,
  emptyCrmRecord,
  isCrmStatus,
  isDataSource,
  CRM_FIELDS,
} from './crm.js';
import { normalizeDate } from './dates.js';
import {
  clean,
  escapeForCsvCell,
  extractEmails,
  extractPhones,
  joinNotes,
} from '../utils/text.js';

/**
 * Turns whatever the LLM returned into a record that provably satisfies the
 * import spec — or rejects it.
 *
 * The prompt asks the model to follow these rules. This module *enforces* them.
 * A model that hallucinates `crm_status: "HOT"`, returns three emails in one
 * cell, or writes a note containing a literal newline cannot corrupt the output;
 * the worst it can do is lose information into `crm_note`.
 */

export type NormalizeOutcome =
  | { ok: true; record: CrmRecord }
  | { ok: false; reason: string };

/** Statuses the model reaches for when it ignores the enum. Mapped, not discarded. */
const STATUS_ALIASES: Record<string, string> = {
  good_lead: 'GOOD_LEAD_FOLLOW_UP',
  good: 'GOOD_LEAD_FOLLOW_UP',
  hot: 'GOOD_LEAD_FOLLOW_UP',
  hot_lead: 'GOOD_LEAD_FOLLOW_UP',
  warm: 'GOOD_LEAD_FOLLOW_UP',
  interested: 'GOOD_LEAD_FOLLOW_UP',
  follow_up: 'GOOD_LEAD_FOLLOW_UP',
  followup: 'GOOD_LEAD_FOLLOW_UP',
  qualified: 'GOOD_LEAD_FOLLOW_UP',
  contacted: 'GOOD_LEAD_FOLLOW_UP',

  not_dialed: 'DID_NOT_CONNECT',
  not_dialled: 'DID_NOT_CONNECT',
  no_answer: 'DID_NOT_CONNECT',
  not_reachable: 'DID_NOT_CONNECT',
  unreachable: 'DID_NOT_CONNECT',
  busy: 'DID_NOT_CONNECT',
  new: 'DID_NOT_CONNECT',
  pending: 'DID_NOT_CONNECT',

  bad: 'BAD_LEAD',
  cold: 'BAD_LEAD',
  junk: 'BAD_LEAD',
  spam: 'BAD_LEAD',
  invalid: 'BAD_LEAD',
  lost: 'BAD_LEAD',
  not_interested: 'BAD_LEAD',
  unqualified: 'BAD_LEAD',

  won: 'SALE_DONE',
  closed: 'SALE_DONE',
  closed_won: 'SALE_DONE',
  converted: 'SALE_DONE',
  sold: 'SALE_DONE',
  sale: 'SALE_DONE',
  booked: 'SALE_DONE',
};

/**
 * Calling codes we can confidently strip off a `+…` number, longest first so
 * `+91` wins over `+9`. Not exhaustive — an unlisted code simply stays attached
 * to the number rather than being guessed at and mangled.
 */
const CALLING_CODES = [
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '39', '40', '44', '49',
  '52', '55', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86',
  '90', '91', '92', '93', '94', '95', '98', '211', '212', '213', '234', '254',
  '255', '256', '260', '263', '264', '265', '266', '267', '268', '269', '971',
  '972', '973', '974', '975', '976', '977', '992', '993', '994', '995', '996',
  '998',
].sort((a, b) => b.length - a.length);

function canonicalKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Clamp to the allowed status enum, mapping common synonyms. Unknown → ''. */
export function normalizeStatus(input: string): string {
  const value = clean(input);
  if (!value) return '';

  const upper = value.toUpperCase().replace(/[^A-Z_]+/g, '_').replace(/^_+|_+$/g, '');
  if (isCrmStatus(upper)) return upper;

  const alias = STATUS_ALIASES[canonicalKey(value)];
  return alias ?? '';
}

/** Clamp to the allowed source enum. Unknown → '' (the spec: "leave it blank"). */
export function normalizeDataSource(input: string): string {
  const value = canonicalKey(clean(input));
  return isDataSource(value) ? value : '';
}

/**
 * Split a `+91`-style code from a mobile number.
 * Accepts `+91 98765 43210`, `919876543210`, `0091-9876543210`, `(+91) 9876543210`.
 */
export function splitPhone(
  rawCode: string,
  rawMobile: string,
): { countryCode: string; mobile: string } {
  let code = clean(rawCode).replace(/[^\d+]/g, '');
  let mobile = clean(rawMobile).replace(/[^\d+]/g, '');

  if (code.startsWith('00')) code = `+${code.slice(2)}`;
  if (code && !code.startsWith('+')) code = `+${code}`;
  if (code === '+') code = '';

  if (mobile.startsWith('00')) mobile = `+${mobile.slice(2)}`;

  // The number carries its own code — trust it over the (possibly absent) code column.
  if (mobile.startsWith('+')) {
    const digits = mobile.slice(1);
    for (const candidate of CALLING_CODES) {
      if (digits.startsWith(candidate) && digits.length - candidate.length >= 7) {
        return { countryCode: `+${candidate}`, mobile: digits.slice(candidate.length) };
      }
    }
    return { countryCode: code, mobile: digits };
  }

  // A bare 12-digit number that begins with the code column is `91` + `9876543210`.
  const bareCode = code.replace('+', '');
  if (bareCode && mobile.startsWith(bareCode) && mobile.length - bareCode.length >= 7) {
    mobile = mobile.slice(bareCode.length);
  }

  return { countryCode: code, mobile };
}

/**
 * Validate and canonicalize one LLM-produced record.
 *
 * Returns `{ ok: false }` when the record has neither an email nor a mobile —
 * the one condition under which the spec says to drop the row entirely.
 */
export function normalizeRecord(raw: RawLlmRecord): NormalizeOutcome {
  const get = (key: string): string => clean(raw[key as keyof RawLlmRecord]);

  const record = emptyCrmRecord();
  const noteFragments: string[] = [];

  // --- Email: first one wins, the rest are demoted to notes. ---------------
  const emails = extractEmails(get('email'));
  record.email = emails[0] ?? '';
  if (emails.length > 1) {
    noteFragments.push(`Additional emails: ${emails.slice(1).join(', ')}`);
  }

  // --- Mobile: same rule. Extra numbers survive as notes, not as data loss. -
  const mobileRaw = get('mobile_without_country_code');
  const phones = extractPhones(mobileRaw);
  const primaryPhone = phones[0] ?? '';
  const { countryCode, mobile } = splitPhone(get('country_code'), primaryPhone);
  record.country_code = countryCode;
  record.mobile_without_country_code = mobile;
  if (phones.length > 1) {
    noteFragments.push(`Additional numbers: ${phones.slice(1).join(', ')}`);
  }

  // --- The skip rule. No way to contact the lead → not a lead. -------------
  if (!record.email && !record.mobile_without_country_code) {
    return { ok: false, reason: 'No email or mobile number found' };
  }

  // --- Constrained vocabularies. -------------------------------------------
  record.crm_status = normalizeStatus(get('crm_status'));
  record.data_source = normalizeDataSource(get('data_source'));

  // A status the model invented is information, even if it isn't a valid enum value.
  const rawStatus = get('crm_status');
  if (rawStatus && !record.crm_status) {
    noteFragments.push(`Original status: ${rawStatus}`);
  }

  // --- Dates. ---------------------------------------------------------------
  record.created_at = normalizeDate(get('created_at'));

  // --- Free-text fields. ----------------------------------------------------
  record.name = get('name');
  record.company = get('company');
  record.city = get('city');
  record.state = get('state');
  record.country = get('country');
  record.lead_owner = get('lead_owner');
  record.possession_time = get('possession_time');
  record.description = get('description');

  // --- Notes last: the model's own note, then everything we salvaged. -------
  record.crm_note = joinNotes([get('crm_note'), ...noteFragments]);

  // --- One record, one CSV row. ---------------------------------------------
  for (const field of CRM_FIELDS) {
    record[field] = escapeForCsvCell(record[field]);
  }

  return { ok: true, record };
}
