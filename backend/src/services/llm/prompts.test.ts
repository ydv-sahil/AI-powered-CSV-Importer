import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_SYSTEM_PROMPT,
  MAPPING_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildMappingPrompt,
} from './prompts.js';
import { CRM_FIELDS, CRM_STATUSES, DATA_SOURCES, type FieldMapping } from '../../domain/crm.js';

/**
 * The prompts are the product. These tests don't judge their wording — they pin
 * down the properties that make them *correct*:
 *
 *   - every CRM field, status, and source the domain defines is actually named,
 *     so adding a field can't silently leave the model unaware of it;
 *   - a stray backtick can't truncate a template literal without being noticed;
 *   - row data is serialized as valid JSON with newlines preserved.
 */

const mapping: FieldMapping = {
  entries: [
    { sourceColumn: 'Full Name', crmField: 'name', confidence: 'high', reason: 'header' },
    { sourceColumn: 'Budget', crmField: null, confidence: 'low', reason: 'no field' },
  ],
  unmappedColumns: ['Budget'],
};

describe('MAPPING_SYSTEM_PROMPT', () => {
  it('names every allowed crm_status', () => {
    for (const status of CRM_STATUSES) expect(MAPPING_SYSTEM_PROMPT).toContain(status);
  });

  it('names every allowed data_source', () => {
    for (const source of DATA_SOURCES) expect(MAPPING_SYSTEM_PROMPT).toContain(source);
  });

  it('names every CRM field', () => {
    for (const field of CRM_FIELDS) expect(MAPPING_SYSTEM_PROMPT).toContain(field);
  });

  it('is not truncated by a stray backtick', () => {
    expect(MAPPING_SYSTEM_PROMPT.length).toBeGreaterThan(1200);
    expect(MAPPING_SYSTEM_PROMPT).toContain('Respond with JSON only');
  });

  it('exempts crm_note from the one-column-per-field rule', () => {
    expect(MAPPING_SYSTEM_PROMPT).toMatch(/crm_note is the ONE exception/);
  });
});

describe('EXTRACTION_SYSTEM_PROMPT', () => {
  it('names every CRM field', () => {
    for (const field of CRM_FIELDS) expect(EXTRACTION_SYSTEM_PROMPT).toContain(field);
  });

  it('is not truncated by a stray backtick', () => {
    expect(EXTRACTION_SYSTEM_PROMPT.length).toBeGreaterThan(1500);
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('Respond with JSON only');
  });

  it('states the __row echo protocol, which row alignment depends on', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('__row');
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/never renumber|Never renumber/);
  });

  it('demonstrates the enum clamping in a worked example', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('GOOD_LEAD_FOLLOW_UP');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('meridian_tower');
  });
});

describe('buildMappingPrompt', () => {
  it('lists every header verbatim', () => {
    const prompt = buildMappingPrompt(['Full Name', 'E-mail'], [{ 'Full Name': 'A', 'E-mail': 'a@b.c' }]);
    expect(prompt).toContain('"Full Name"');
    expect(prompt).toContain('"E-mail"');
  });

  it('omits blank cells from the sample rows', () => {
    const prompt = buildMappingPrompt(['a', 'b'], [{ a: 'x', b: '' }]);
    expect(prompt).toContain('"a"');
    expect(prompt).not.toContain('"b": ""');
  });
});

describe('buildExtractionPrompt', () => {
  it('anchors each row to its absolute index, not its position in the batch', () => {
    const prompt = buildExtractionPrompt([{ a: '1' }, { a: '2' }], 50, mapping);
    expect(prompt).toContain('"__row": 50');
    expect(prompt).toContain('"__row": 51');
  });

  it('carries the established mapping and the unmapped columns', () => {
    const prompt = buildExtractionPrompt([{ a: '1' }], 0, mapping);
    expect(prompt).toContain('"Full Name" -> name');
    expect(prompt).toContain('"Budget"');
  });

  it('tells the model the mapping may be overridden per row', () => {
    const prompt = buildExtractionPrompt([{ a: '1' }], 0, mapping);
    expect(prompt).toMatch(/guidance, not gospel/);
  });

  it('preserves newlines as the \\n escape so the model can echo them', () => {
    const prompt = buildExtractionPrompt([{ note: 'line one\nline two' }], 0, mapping);
    // JSON.stringify renders the real newline as the two characters \ and n.
    expect(prompt).toContain('line one\\nline two');
    expect(prompt.split('ROWS TO CONVERT')[1]).not.toMatch(/line one\nline two/);
  });

  it('emits rows as parseable JSON', () => {
    const prompt = buildExtractionPrompt([{ 'weird "key"': 'a,b' }], 7, mapping);
    const start = prompt.indexOf('[\n  {');
    const end = prompt.indexOf('\n]', start) + 2;
    expect(() => JSON.parse(prompt.slice(start, end))).not.toThrow();
  });
});
