import { CRM_FIELDS, emptyCrmRecord, type CrmField } from '../../domain/crm.js';
import { normalizeHeader } from '../../utils/text.js';
import type { LlmCompletionRequest, LlmCompletionResponse, LlmProvider } from './types.js';

/**
 * A deterministic stand-in for a language model.
 *
 * It exists so the pipeline can be unit-tested without a network call or an API
 * key, and so `npm run dev` works before you've pasted a key into `.env`.
 * It matches headers with regexes — no semantic understanding whatsoever.
 *
 * This is NOT the product. Set `LLM_PROVIDER=gemini` for real extraction.
 */

const HEADER_PATTERNS: Array<[CrmField, RegExp]> = [
  ['created_at', /^(created|submit|date|timestamp|time|lead_date|created_time|submitted_on)/],
  ['email', /(e_?mail)/],
  ['country_code', /^(country_code|dial_code|calling_code|isd)/],
  ['mobile_without_country_code', /(mobile|phone|contact_number|whatsapp|^contact$|^number$)/],
  ['name', /(full_name|^name$|lead_name|first_name|customer|client)/],
  ['company', /(company|organi[sz]ation|business|firm|employer)/],
  ['city', /^(city|town|locality|area)$/],
  ['state', /^(state|province|region)$/],
  ['country', /^country$/],
  ['lead_owner', /(owner|assigned|agent|sales_?person|rep|counsellor)/],
  ['crm_status', /(status|stage|disposition)/],
  ['crm_note', /(note|remark|comment|feedback|message)/],
  ['data_source', /(source|project|campaign|property)/],
  ['possession_time', /(possession|handover|ready_by)/],
  ['description', /(description|details|requirement)/],
];

function guessField(header: string): CrmField | null {
  const normalized = normalizeHeader(header);
  for (const [field, pattern] of HEADER_PATTERNS) {
    if (pattern.test(normalized)) return field;
  }
  return null;
}

interface InputRow {
  __row: number;
  [key: string]: unknown;
}

export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'heuristic-v1';

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const rows = extractRowsFromPrompt(request.userPrompt);

    // Phase 1: the mapping prompt asks for `entries`, not `records`.
    if (request.userPrompt.includes('"sourceColumn"')) {
      const headers = extractHeadersFromPrompt(request.userPrompt);
      return {
        text: JSON.stringify({
          entries: headers.map((sourceColumn) => {
            const crmField = guessField(sourceColumn);
            return {
              sourceColumn,
              crmField,
              confidence: crmField ? 'medium' : 'low',
              reason: crmField ? 'header pattern match' : 'no pattern matched',
            };
          }),
        }),
      };
    }

    // Phase 2: extraction.
    const records = rows.map((row) => {
      const record: Record<string, string | number> = { ...emptyCrmRecord(), __row: row.__row };
      const leftovers: string[] = [];

      for (const [key, value] of Object.entries(row)) {
        if (key === '__row') continue;
        const text = String(value ?? '').trim();
        if (!text) continue;

        const field = guessField(key);
        if (field && !record[field]) {
          record[field] = text;
        } else if (!field) {
          leftovers.push(`${key}: ${text}`);
        }
      }

      if (leftovers.length) {
        record.crm_note = [record.crm_note, ...leftovers].filter(Boolean).join('; ');
      }

      return record;
    });

    return { text: JSON.stringify({ records }) };
  }
}

/** Pulls the `[ {...} ]` row array back out of the prompt we built. */
function extractRowsFromPrompt(prompt: string): InputRow[] {
  const start = prompt.indexOf('[\n  {');
  if (start === -1) return [];

  const depth = { value: 0 };
  let end = -1;

  for (let i = start; i < prompt.length; i++) {
    const char = prompt[i];
    if (char === '[') depth.value++;
    else if (char === ']') {
      depth.value--;
      if (depth.value === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) return [];

  try {
    const parsed: unknown = JSON.parse(prompt.slice(start, end));
    return Array.isArray(parsed) ? (parsed as InputRow[]) : [];
  } catch {
    return [];
  }
}

function extractHeadersFromPrompt(prompt: string): string[] {
  const match = /CSV COLUMN HEADERS \(\d+\):\n(\[[\s\S]*?\n\])/.exec(prompt);
  if (!match?.[1]) return [];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Exported for the test suite, which asserts the heuristic covers every CRM field. */
export const __testing = { guessField, HEADER_PATTERNS, CRM_FIELDS };
