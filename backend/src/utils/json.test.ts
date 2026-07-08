import { describe, expect, it } from 'vitest';
import { JsonRecoveryError, parseLlmJson } from './json.js';

describe('parseLlmJson', () => {
  it('parses clean JSON', () => {
    expect(parseLlmJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('unwraps a markdown fence', () => {
    expect(parseLlmJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLlmJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose around the JSON', () => {
    expect(parseLlmJson('Here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  it('is not fooled by braces inside strings', () => {
    expect(parseLlmJson('{"note":"a } brace"}')).toEqual({ note: 'a } brace' });
    expect(parseLlmJson('{"note":"escaped \\" and }"}')).toEqual({ note: 'escaped " and }' });
  });

  it('salvages a response truncated mid-object', () => {
    const truncated = '{"records":[{"name":"A"},{"name":"B"},{"name":"C';
    expect(parseLlmJson(truncated)).toEqual({ records: [{ name: 'A' }, { name: 'B' }] });
  });

  it('salvages a truncated top-level array', () => {
    expect(parseLlmJson('[{"a":1},{"a":2},{"a":')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('throws when nothing can be recovered', () => {
    expect(() => parseLlmJson('I am afraid I cannot help with that.')).toThrow(JsonRecoveryError);
    expect(() => parseLlmJson('')).toThrow(JsonRecoveryError);
  });

  it('includes a preview of the offending output in the error', () => {
    expect(() => parseLlmJson('total nonsense')).toThrow(/total nonsense/);
  });
});
