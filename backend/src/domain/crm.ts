import { z } from 'zod';

/**
 * The canonical GrowEasy CRM record contract.
 *
 * Everything downstream — the LLM prompt, the validator, the API response, the
 * frontend table — derives from the constants and schemas in this file. Adding a
 * CRM field means editing here and nowhere else.
 */

/** Lead status. The AI may only emit one of these, or an empty string. */
export const CRM_STATUSES = [
  'GOOD_LEAD_FOLLOW_UP',
  'DID_NOT_CONNECT',
  'BAD_LEAD',
  'SALE_DONE',
] as const;

export type CrmStatus = (typeof CRM_STATUSES)[number];

/** Lead source. The AI may only emit one of these, or an empty string. */
export const DATA_SOURCES = [
  'leads_on_demand',
  'meridian_tower',
  'eden_park',
  'varah_swamy',
  'sarjapur_plots',
] as const;

export type DataSource = (typeof DATA_SOURCES)[number];

/**
 * CRM field order. Drives the CSV export column order and the result table
 * column order, so the two can never drift apart.
 */
export const CRM_FIELDS = [
  'created_at',
  'name',
  'email',
  'country_code',
  'mobile_without_country_code',
  'company',
  'city',
  'state',
  'country',
  'lead_owner',
  'crm_status',
  'crm_note',
  'data_source',
  'possession_time',
  'description',
] as const;

export type CrmField = (typeof CRM_FIELDS)[number];

/** Human-readable descriptions, injected into the LLM prompt and used as table headers. */
export const CRM_FIELD_DESCRIPTIONS: Record<CrmField, string> = {
  created_at: 'Lead creation date',
  name: 'Lead name',
  email: 'Primary email',
  country_code: 'Country code',
  mobile_without_country_code: 'Mobile number',
  company: 'Company name',
  city: 'City',
  state: 'State',
  country: 'Country',
  lead_owner: 'Lead owner',
  crm_status: 'Lead status',
  crm_note: 'Notes/remarks',
  data_source: 'Source',
  possession_time: 'Property possession time',
  description: 'Additional description',
};

/**
 * What we accept back from the LLM.
 *
 * Deliberately permissive: every field is an optional string. The model is
 * asked for clean values, but a model that returns `null`, omits a key, or
 * invents a status must not crash the request — it degrades to a blank field
 * or a skipped row. Strictness is applied afterwards, in `normalizeRecord`.
 */
export const RawLlmRecordSchema = z
  .object(
    Object.fromEntries(
      CRM_FIELDS.map((field) => [field, z.string().nullish()]),
    ) as Record<CrmField, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
  )
  .passthrough();

export type RawLlmRecord = z.infer<typeof RawLlmRecordSchema>;

/** A fully validated, normalized CRM record. Every field present, every field a string. */
export type CrmRecord = Record<CrmField, string>;

/** A source row that never made it into the CRM, plus the reason why. */
export interface SkippedRecord {
  /** 1-based row number in the original CSV, excluding the header row. */
  rowNumber: number;
  reason: string;
  /** The original row, so the user can see what was dropped. */
  raw: Record<string, string>;
}

export interface ImportSummary {
  totalRows: number;
  totalImported: number;
  totalSkipped: number;
  /** Batches that exhausted their retries. Their rows land in `skipped`. */
  failedBatches: number;
}

export interface ImportResult {
  records: CrmRecord[];
  skipped: SkippedRecord[];
  summary: ImportSummary;
  /** The column → CRM field mapping the AI inferred, surfaced for transparency. */
  fieldMapping: FieldMapping;
}

/** One inferred mapping from a source CSV column to a CRM field. */
export interface FieldMappingEntry {
  sourceColumn: string;
  crmField: CrmField | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface FieldMapping {
  entries: FieldMappingEntry[];
  /** Columns the AI could not confidently place. Their values are folded into `crm_note`. */
  unmappedColumns: string[];
}

/** An empty CRM record — the base every normalized record is built on. */
export function emptyCrmRecord(): CrmRecord {
  return Object.fromEntries(CRM_FIELDS.map((f) => [f, ''])) as CrmRecord;
}

export function isCrmStatus(value: string): value is CrmStatus {
  return (CRM_STATUSES as readonly string[]).includes(value);
}

export function isDataSource(value: string): value is DataSource {
  return (DATA_SOURCES as readonly string[]).includes(value);
}

export function isCrmField(value: string): value is CrmField {
  return (CRM_FIELDS as readonly string[]).includes(value);
}
