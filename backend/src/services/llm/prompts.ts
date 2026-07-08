import {
  CRM_FIELDS,
  CRM_FIELD_DESCRIPTIONS,
  CRM_STATUSES,
  DATA_SOURCES,
} from '../../domain/crm.js';
import type { CsvRow } from '../csv.service.js';
import type { FieldMapping } from '../../domain/crm.js';

/**
 * Prompt construction.
 *
 * Two prompts, because field mapping and value extraction are different problems:
 *
 *   1. `buildMappingPrompt` runs **once** per file. It sees the headers and a
 *      handful of sample rows and decides what each column *means*. Semantics is
 *      a whole-file question — you cannot tell whether `Contact` holds a name or
 *      a phone number by staring at one row.
 *
 *   2. `buildExtractionPrompt` runs **per batch**. It receives the mapping as
 *      established context and only has to do per-row work: pick the first of
 *      two emails, read a date, fold leftovers into a note.
 *
 * Separating them means the expensive reasoning happens once, each batch prompt
 * stays small, and batches stay independent — so they parallelise and retry cleanly.
 */

const STATUS_LIST = CRM_STATUSES.join(' | ');
const SOURCE_LIST = DATA_SOURCES.join(' | ');

const FIELD_TABLE = CRM_FIELDS.map(
  (field) => `  - ${field}: ${CRM_FIELD_DESCRIPTIONS[field]}`,
).join('\n');

/** Shared rules. Stated once, referenced by both prompts, so they cannot drift. */
const CRM_RULES = `
GROWEASY CRM FIELDS
${FIELD_TABLE}

HARD CONSTRAINTS — these are not suggestions:

1. crm_status MUST be exactly one of: ${STATUS_LIST}
   Map synonyms onto the closest value:
     "Hot" / "Interested" / "Follow up" / "Qualified"  -> GOOD_LEAD_FOLLOW_UP
     "No answer" / "Busy" / "Not dialed" / "New"       -> DID_NOT_CONNECT
     "Cold" / "Junk" / "Not interested" / "Lost"       -> BAD_LEAD
     "Won" / "Closed" / "Converted" / "Booked"         -> SALE_DONE
   If nothing maps confidently, use "".

2. data_source MUST be exactly one of: ${SOURCE_LIST}
   These are specific GrowEasy campaign identifiers, NOT generic channels.
   "Facebook", "Google Ads", "Website", "Walk-in" are NOT valid — use "" for those.
   Only emit a value when the source text clearly names one of the five above.
   When in doubt, use "". A blank is correct; a guess is wrong.

3. created_at MUST be "YYYY-MM-DD HH:mm:ss" (24-hour, no timezone suffix).
   Treat ambiguous numeric dates as DAY-first: "05/06/2026" is 5 June 2026.
   If no time is present, use 00:00:00. If no date is present, use "".
   A bare 5-digit number ("45790") is an Excel serial date. A 10-digit one
   ("1747145048") is a Unix timestamp. If you cannot convert such a value with
   confidence, COPY IT THROUGH UNCHANGED rather than blanking it — it will be
   converted downstream. Never guess a date.

4. email — if the source has several, keep the FIRST one and append the
   others to crm_note as: "Additional emails: b@x.com, c@y.com"

5. mobile_without_country_code — digits only, NO country code, NO spaces or dashes.
   country_code — the calling code with a leading "+", e.g. "+91".
   If several numbers exist, keep the FIRST and append the others to crm_note as:
   "Additional numbers: +919876543210, 9123456789"

6. crm_note is the catch-all. Put remarks, follow-up notes, extra emails, extra
   phone numbers, and any source column that maps to no CRM field into it, as
   "Label: value" fragments joined by "; ". Never discard information silently.

7. Every value MUST be a single-line string. Replace any real newline with the
   two characters \\n. Never emit a raw line break inside a value.

8. Never invent data. A field with no source evidence is "". Do not infer a
   country from a city, a company from an email domain, or a status from a name.
   Copy values; do not embellish them.

9. Return "" for missing values — never null, never "N/A", never "-".
`.trim();

/**
 * Trim a cell so a 60-column CSV doesn't blow the context window.
 *
 * Newlines survive. `JSON.stringify` renders a real line break as the two
 * characters `\n`, which is precisely the escape the model is asked to echo back
 * — so flattening them here would make rule 7 impossible to satisfy, and every
 * multi-line remark would silently lose its structure.
 */
function truncateValue(value: string, max = 160): string {
  const tidy = value.replace(/[^\S\n]+/g, ' ').trim();
  return tidy.length > max ? `${tidy.slice(0, max)}…` : tidy;
}

function serializeRows(rows: CsvRow[], startIndex: number): string {
  return rows
    .map((row, i) => {
      const cells = Object.entries(row)
        .filter(([, value]) => value.trim() !== '')
        .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(truncateValue(value))}`)
        .join(',\n');
      return `  {\n    "__row": ${startIndex + i},\n${cells}\n  }`;
    })
    .join(',\n');
}

// ---------------------------------------------------------------------------
// Phase 1 — field mapping
// ---------------------------------------------------------------------------

export const MAPPING_SYSTEM_PROMPT = `
You are a senior data engineer who has spent years importing lead exports into CRMs.
You have seen Facebook Lead Ads exports, Google Ads downloads, Salesforce and Zoho
dumps, real-estate CRM exports, and spreadsheets a sales intern hand-typed at 2am.

Your task: given a CSV's column headers and a few sample rows, decide which
GrowEasy CRM field each column corresponds to.

You reason from BOTH the header name and the actual sample values. A header is a
hint; the data is evidence. A column named "Contact" holding "+91 98765 43210" is
a mobile number. The same header holding "Priya Singh" is a name.

${CRM_RULES}

MAPPING GUIDANCE

- Facebook exports use "full_name", "phone_number", "created_time", "ad_name",
  "form_name", "campaign_name", "platform".
- Google Ads exports use "Lead ID", "Submit time", "User column: …" prefixes.
- Real-estate exports use "Possession", "Handover", "Ready to move" for
  possession_time, and "Project" / "Property" for the campaign source.
- "Assigned To", "Owner", "Agent", "Rep", "Counsellor", "Sales Person" -> lead_owner
- "Remarks", "Comments", "Notes", "Feedback", "Disposition" -> crm_note
- "Organization", "Business", "Firm", "Employer" -> company
- "Location", "Area", "Locality" -> city, unless a separate city column exists
- A column of "+91" values is country_code, not a mobile number.
- A column mixing a code and a number ("+91 9876543210") maps to
  mobile_without_country_code; the code will be split out downstream.

Rules for your answer:
- Map AT MOST ONE source column to each CRM field. If two columns compete
  (e.g. "Email" and "Secondary Email"), map the primary one and leave the other
  unmapped — it will be folded into crm_note.
- crm_note is the ONE exception: any number of columns may map to it. It is the
  catch-all for remarks, budgets, loan status, and anything else worth keeping.
- Set crmField to null for any column you cannot confidently place.
- An ID column, a row number, or an internal reference maps to null.
- Prefer null over a low-confidence guess. Unmapped data is preserved in crm_note;
  a wrong mapping silently corrupts a field.
- A column whose values are of MIXED kinds (some emails, some phone numbers)
  cannot be mapped to a single field. Set it to null and say so in your reason —
  the per-row extraction step will place each value individually.
- A column holding TWO facts per cell ("Kochi, Kerala") maps to the field of its
  FIRST fact (city). The extraction step will split out the rest.

Respond with JSON only. No prose, no markdown fence.
`.trim();

export function buildMappingPrompt(headers: string[], sampleRows: CsvRow[]): string {
  return `
CSV COLUMN HEADERS (${headers.length}):
${JSON.stringify(headers, null, 2)}

SAMPLE ROWS (${sampleRows.length} of the file, blank cells omitted):
[
${serializeRows(sampleRows, 0)}
]

For every header above, emit one entry. Return exactly this JSON shape:

{
  "entries": [
    {
      "sourceColumn": "<the header, copied verbatim>",
      "crmField": "<one of: ${CRM_FIELDS.join(', ')}> or null",
      "confidence": "high" | "medium" | "low",
      "reason": "<one short clause: what in the header or values decided this>"
    }
  ]
}
`.trim();
}

// ---------------------------------------------------------------------------
// Phase 2 — record extraction
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_PROMPT = `
You convert raw CSV lead rows into GrowEasy CRM records.

${CRM_RULES}

WORKED EXAMPLES

Input row:
  { "__row": 0, "Full Name": "Rahil Mohammad", "Phone": "+91 9579291234",
    "E-mail": "rahil@test.com, rahil.work@corp.com", "Submitted On": "29-06-2026 10:00",
    "Status": "Hot", "Assigned": "varun@groweasy.ai", "Source": "Facebook Lead Ad",
    "Budget": "45L", "Project": "Meridian Tower" }

Correct output:
  { "__row": 0, "created_at": "2026-06-29 10:00:00", "name": "Rahil Mohammad",
    "email": "rahil@test.com", "country_code": "+91",
    "mobile_without_country_code": "9579291234", "company": "", "city": "",
    "state": "", "country": "", "lead_owner": "varun@groweasy.ai",
    "crm_status": "GOOD_LEAD_FOLLOW_UP",
    "crm_note": "Additional emails: rahil.work@corp.com; Budget: 45L",
    "data_source": "meridian_tower", "possession_time": "", "description": "" }

  Note: "Hot" became GOOD_LEAD_FOLLOW_UP. "Facebook Lead Ad" is NOT one of the five
  allowed sources, so data_source came from the "Project" column instead. The
  unmapped "Budget" column was preserved in crm_note. The second email moved to crm_note.

Input row:
  { "__row": 1, "name": "  ", "mobile": "9812345678 / 9998887776", "remarks": "Called twice.\\nNo response.",
    "city": "Pune", "possession": "Dec 2027" }

Correct output:
  { "__row": 1, "created_at": "", "name": "", "email": "", "country_code": "",
    "mobile_without_country_code": "9812345678", "company": "", "city": "Pune",
    "state": "", "country": "", "lead_owner": "", "crm_status": "",
    "crm_note": "Called twice.\\nNo response.; Additional numbers: 9998887776",
    "data_source": "", "possession_time": "Dec 2027", "description": "" }

  Note: no country code was present, so country_code stayed "" — it was not
  guessed from the number's length. The newline in the remark became \\n.
  No status column existed, so crm_status stayed "" rather than defaulting.

OUTPUT PROTOCOL

- Return one object per input row, in the same order.
- Echo the "__row" value back on each object, unchanged. This is how rows are
  matched up. Never renumber, never omit, never merge two input rows into one.
- If a row is empty or unusable, still return an object for it with all fields "".
  Do not drop it — filtering happens downstream, not here.
- Every one of these keys must be present on every object:
  ${CRM_FIELDS.join(', ')}

Respond with JSON only. No prose, no markdown fence.
`.trim();

export function buildExtractionPrompt(
  rows: CsvRow[],
  startIndex: number,
  mapping: FieldMapping,
): string {
  const mapped = mapping.entries
    .filter((e) => e.crmField !== null)
    .map((e) => `  ${JSON.stringify(e.sourceColumn)} -> ${e.crmField}  (${e.confidence} confidence)`)
    .join('\n');

  const unmapped = mapping.unmappedColumns.length
    ? mapping.unmappedColumns.map((c) => `  ${JSON.stringify(c)}`).join('\n')
    : '  (none)';

  return `
COLUMN MAPPING for this file, already established:
${mapped || '  (none — infer field by field from the values)'}

COLUMNS WITH NO CRM FIELD — fold these into crm_note as "Label: value",
skipping any that are blank:
${unmapped}

The mapping is guidance, not gospel. If a value plainly contradicts its mapping
(a "city" column holding an email address), place it where it actually belongs.

ROWS TO CONVERT (${rows.length}, blank cells omitted):
[
${serializeRows(rows, startIndex)}
]

Return exactly:
{ "records": [ { "__row": <int>, ${CRM_FIELDS.map((f) => `"${f}": "…"`).join(', ')} } ] }
`.trim();
}
