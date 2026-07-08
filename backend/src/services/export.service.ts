import { CRM_FIELDS, type CrmRecord } from '../domain/crm.js';

/** Serialize normalized CRM records back to RFC 4180 CSV. */

/** Quote a cell only when it must be quoted, doubling any embedded quote. */
function encodeCell(value: string): string {
  if (value === '') return '';
  const needsQuotes = /[",\r\n]/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(records: CrmRecord[]): string {
  const header = CRM_FIELDS.join(',');
  const rows = records.map((record) => CRM_FIELDS.map((f) => encodeCell(record[f])).join(','));

  // Leading BOM so Excel opens UTF-8 names ("Priyá") without mangling them.
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}
