/**
 * Mirrors `backend/src/domain/crm.ts`.
 *
 * In a monorepo with a shared package these would be imported, not restated.
 * They're duplicated here so each app deploys independently — and `CRM_FIELDS`
 * is asserted against `GET /api/schema` at runtime by `assertSchemaMatches`,
 * so a drift shows up as a console warning rather than a silently empty column.
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

export type CrmRecord = Record<CrmField, string>;

export const CRM_STATUSES = [
  'GOOD_LEAD_FOLLOW_UP',
  'DID_NOT_CONNECT',
  'BAD_LEAD',
  'SALE_DONE',
] as const;

export type CrmStatus = (typeof CRM_STATUSES)[number];

/** Column headers for the result table. */
export const CRM_FIELD_LABELS: Record<CrmField, string> = {
  created_at: 'Created At',
  name: 'Name',
  email: 'Email',
  country_code: 'Code',
  mobile_without_country_code: 'Mobile',
  company: 'Company',
  city: 'City',
  state: 'State',
  country: 'Country',
  lead_owner: 'Lead Owner',
  crm_status: 'Status',
  crm_note: 'Note',
  data_source: 'Source',
  possession_time: 'Possession',
  description: 'Description',
};

export interface SkippedRecord {
  rowNumber: number;
  reason: string;
  raw: Record<string, string>;
}

export interface ImportSummary {
  totalRows: number;
  totalImported: number;
  totalSkipped: number;
  failedBatches: number;
}

export interface FieldMappingEntry {
  sourceColumn: string;
  crmField: CrmField | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface FieldMapping {
  entries: FieldMappingEntry[];
  unmappedColumns: string[];
}

export interface ImportResult {
  records: CrmRecord[];
  skipped: SkippedRecord[];
  summary: ImportSummary;
  fieldMapping: FieldMapping;
}

/** Progress events streamed from `POST /api/import/stream`. */
export type ProgressEvent =
  | { type: 'parsed'; totalRows: number; headers: string[] }
  | { type: 'mapping'; mapping: FieldMapping }
  | { type: 'batch'; completed: number; total: number; imported: number; skipped: number }
  | { type: 'retry'; batch: number; attempt: number; maxAttempts: number }
  | { type: 'done'; result: ImportResult }
  | { type: 'error'; code: string; message: string };

/** Locally parsed CSV, shown in the preview step before any AI runs. */
export interface PreviewData {
  fileName: string;
  fileSize: number;
  headers: string[];
  rows: Record<string, string>[];
  /** Rows beyond what we render in the preview. */
  totalRows: number;
}

export type ImportPhase = 'idle' | 'preview' | 'processing' | 'complete' | 'error';
