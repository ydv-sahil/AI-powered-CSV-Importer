import { describe, expect, it } from 'vitest';
import { normalizeDataSource, normalizeRecord, normalizeStatus, splitPhone } from './normalize.js';
import { CRM_FIELDS, type RawLlmRecord } from './crm.js';

/** Stand in for "whatever the model returned" — partial, nullable, possibly junk. */
function raw(fields: Record<string, string | null | undefined>): RawLlmRecord {
  return fields as RawLlmRecord;
}

describe('normalizeStatus', () => {
  it('passes through exact enum values', () => {
    expect(normalizeStatus('SALE_DONE')).toBe('SALE_DONE');
    expect(normalizeStatus('good_lead_follow_up')).toBe('GOOD_LEAD_FOLLOW_UP');
  });

  it('maps common synonyms onto the enum', () => {
    expect(normalizeStatus('Hot')).toBe('GOOD_LEAD_FOLLOW_UP');
    expect(normalizeStatus('Not Interested')).toBe('BAD_LEAD');
    expect(normalizeStatus('Closed Won')).toBe('SALE_DONE');
    expect(normalizeStatus('No Answer')).toBe('DID_NOT_CONNECT');
    expect(normalizeStatus('Not Dialed')).toBe('DID_NOT_CONNECT');
  });

  it('blanks a value it cannot place rather than guessing', () => {
    expect(normalizeStatus('Schrodinger')).toBe('');
    expect(normalizeStatus('')).toBe('');
    expect(normalizeStatus('N/A')).toBe('');
  });
});

describe('normalizeDataSource', () => {
  it('accepts the five allowed sources in any casing', () => {
    expect(normalizeDataSource('Meridian Tower')).toBe('meridian_tower');
    expect(normalizeDataSource('EDEN_PARK')).toBe('eden_park');
    expect(normalizeDataSource('sarjapur plots')).toBe('sarjapur_plots');
  });

  it('blanks generic channels, which are not valid sources', () => {
    expect(normalizeDataSource('Facebook')).toBe('');
    expect(normalizeDataSource('Google Ads')).toBe('');
    expect(normalizeDataSource('Website')).toBe('');
  });
});

describe('splitPhone', () => {
  it('keeps a clean code and number as-is', () => {
    expect(splitPhone('+91', '9876543210')).toEqual({
      countryCode: '+91',
      mobile: '9876543210',
    });
  });

  it('normalizes a bare code to +NN', () => {
    expect(splitPhone('91', '9876543210').countryCode).toBe('+91');
    expect(splitPhone('0091', '9876543210').countryCode).toBe('+91');
  });

  it('splits a code embedded in the number', () => {
    expect(splitPhone('', '+919876543210')).toEqual({
      countryCode: '+91',
      mobile: '9876543210',
    });
    expect(splitPhone('', '+1 415 555 0132')).toEqual({
      countryCode: '+1',
      mobile: '4155550132',
    });
  });

  it('strips a duplicated code from a bare number', () => {
    expect(splitPhone('+91', '919876543210')).toEqual({
      countryCode: '+91',
      mobile: '9876543210',
    });
  });

  it('never invents a country code', () => {
    expect(splitPhone('', '9876543210')).toEqual({ countryCode: '', mobile: '9876543210' });
  });

  it('does not amputate a leading digit of a short number', () => {
    // 7 digits after stripping "+1" would be too short — must not split.
    expect(splitPhone('', '+1234567').mobile).toBe('1234567');
  });
});

describe('normalizeRecord', () => {
  it('skips a record with neither an email nor a mobile', () => {
    const outcome = normalizeRecord(raw({ name: 'Ghost Lead', city: 'Pune' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/no email or mobile/i);
  });

  it('keeps a record with only an email', () => {
    const outcome = normalizeRecord(raw({ name: 'A', email: 'a@b.com' }));
    expect(outcome.ok).toBe(true);
  });

  it('keeps a record with only a mobile', () => {
    const outcome = normalizeRecord(raw({ name: 'A', mobile_without_country_code: '9876543210' }));
    expect(outcome.ok).toBe(true);
  });

  it('keeps the first email and moves the rest into crm_note', () => {
    const outcome = normalizeRecord(
      raw({ email: 'first@x.com, second@y.com; third@z.com', name: 'Multi' }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.record.email).toBe('first@x.com');
    expect(outcome.record.crm_note).toContain('second@y.com');
    expect(outcome.record.crm_note).toContain('third@z.com');
  });

  it('keeps the first mobile and moves the rest into crm_note', () => {
    const outcome = normalizeRecord(
      raw({ mobile_without_country_code: '9812345678 / 9998887776', country_code: '+91' }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.record.mobile_without_country_code).toBe('9812345678');
    expect(outcome.record.crm_note).toContain('9998887776');
  });

  it('preserves an existing note alongside salvaged extras', () => {
    const outcome = normalizeRecord(
      raw({ email: 'a@x.com, b@y.com', crm_note: 'Call after 6pm' }),
    );
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.record.crm_note).toContain('Call after 6pm');
    expect(outcome.record.crm_note).toContain('b@y.com');
  });

  it('records an invented status in the note instead of dropping it', () => {
    const outcome = normalizeRecord(raw({ email: 'a@x.com', crm_status: 'Awaiting Budget' }));
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.record.crm_status).toBe('');
    expect(outcome.record.crm_note).toContain('Awaiting Budget');
  });

  it('escapes newlines so each record stays one CSV row', () => {
    const outcome = normalizeRecord(
      raw({ email: 'a@x.com', crm_note: 'Called twice.\nNo response.\r\nRetry.' }),
    );
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.record.crm_note).not.toMatch(/[\r\n]/);
    expect(outcome.record.crm_note).toContain('\\n');
  });

  it('emits every CRM field, always, as a string', () => {
    const outcome = normalizeRecord(raw({ email: 'a@x.com' }));
    if (!outcome.ok) throw new Error('expected ok');

    for (const field of CRM_FIELDS) {
      expect(typeof outcome.record[field]).toBe('string');
    }
    expect(Object.keys(outcome.record).sort()).toEqual([...CRM_FIELDS].sort());
  });

  it('tolerates nulls and blank-ish sentinels from the model', () => {
    const outcome = normalizeRecord(
      raw({ email: 'a@x.com', company: null, city: 'N/A', state: '-', country: undefined }),
    );
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.record.company).toBe('');
    expect(outcome.record.city).toBe('');
    expect(outcome.record.state).toBe('');
    expect(outcome.record.country).toBe('');
  });

  it('ignores extra keys the model hallucinated', () => {
    const outcome = normalizeRecord(raw({ email: 'a@x.com', budget: '45L', __row: '3' }));
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.record).not.toHaveProperty('budget');
    expect(outcome.record).not.toHaveProperty('__row');
  });
});
