import { describe, expect, it } from 'vitest';
import { chunk, parseCsv, sampleRows } from './csv.service.js';
import { ApiError } from '../middleware/errors.js';

const buf = (text: string) => Buffer.from(text, 'utf8');

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    const csv = parseCsv(buf('name,email\nJohn,john@x.com\nSara,sara@y.com'));

    expect(csv.headers).toEqual(['name', 'email']);
    expect(csv.rows).toHaveLength(2);
    expect(csv.rows[0]).toEqual({ name: 'John', email: 'john@x.com' });
  });

  it('strips the Excel BOM from the first header', () => {
    const csv = parseCsv(buf('﻿name,email\nJohn,john@x.com'));
    expect(csv.headers[0]).toBe('name');
  });

  it('keeps quoted commas and embedded newlines inside one cell', () => {
    const csv = parseCsv(buf('name,note\nJohn,"Busy, will retry\nnext week"'));

    expect(csv.rows).toHaveLength(1);
    expect(csv.rows[0]?.note).toBe('Busy, will retry\nnext week');
  });

  it('de-duplicates colliding headers instead of overwriting data', () => {
    const csv = parseCsv(buf('email,email\na@x.com,b@y.com'));

    expect(csv.headers).toEqual(['email', 'email_2']);
    expect(csv.rows[0]).toEqual({ email: 'a@x.com', email_2: 'b@y.com' });
  });

  it('names blank headers rather than producing an empty key', () => {
    const csv = parseCsv(buf('name,,email\nJohn,x,john@x.com'));
    expect(csv.headers).toEqual(['name', 'column_2', 'email']);
  });

  it('skips entirely blank rows and reports them', () => {
    const csv = parseCsv(buf('name,email\nJohn,john@x.com\n,\nSara,sara@y.com'));

    expect(csv.rows).toHaveLength(2);
    expect(csv.blankRowNumbers).toEqual([2]);
  });

  it('preserves ragged overflow columns under a synthetic header', () => {
    const csv = parseCsv(buf('name,email\nJohn,john@x.com,stray-value'));
    expect(csv.rows[0]?.extra_column_3).toBe('stray-value');
  });

  it('pads short rows with empty strings', () => {
    const csv = parseCsv(buf('name,email,city\nJohn,john@x.com'));
    expect(csv.rows[0]).toEqual({ name: 'John', email: 'john@x.com', city: '' });
  });

  it('rejects an empty file', () => {
    expect(() => parseCsv(buf(''))).toThrow(ApiError);
    expect(() => parseCsv(buf('   \n  '))).toThrow(/empty/i);
  });

  it('rejects a header-only file', () => {
    expect(() => parseCsv(buf('name,email'))).toThrow(/no data rows/i);
  });
});

describe('sampleRows', () => {
  it('returns everything when the file is small', () => {
    const rows = [{ a: '1' }, { a: '2' }];
    expect(sampleRows(rows, 8)).toHaveLength(2);
  });

  it('spreads the sample across the file rather than taking the head', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ a: String(i) }));
    const sample = sampleRows(rows, 4);

    expect(sample).toHaveLength(4);
    expect(sample.map((r) => r.a)).toEqual(['0', '25', '50', '75']);
  });
});

describe('chunk', () => {
  it('splits into fixed-size batches with a short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('handles an empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});
