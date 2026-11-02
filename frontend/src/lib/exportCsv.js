/**
 * CSV download for the admin export endpoints.
 *
 * `/admin/exports/agent`, `/admin/exports/farmer/:id` and
 * `/admin/exports/cooperative/:id` were served with nothing calling them, so
 * an administrator could not get data out of the platform at all — no
 * spreadsheet for a lender meeting, no figures to reconcile against a
 * cooperative's own records.
 *
 * CSV rather than PDF on purpose. The mobile app already produces a PDF for
 * an agent to hand over in the field, and the partner report page prints. An
 * admin at a desk wants the numbers in a spreadsheet, and a CSV is the one
 * format that needs no library, no server round trip and no fonts.
 *
 * The endpoints return `{ totals, tables: { … } }`, so each table becomes its
 * own labelled block in one file rather than one download per table.
 */

/**
 * Quotes a value for CSV.
 *
 * Every field is quoted rather than only the ones that need it. A farmer's
 * name can contain a comma, a cooperative's address usually does, and notes
 * contain quotes and newlines — and a CSV that breaks on one row silently
 * shifts every column after it, which is worse than an unreadable file
 * because the numbers still look plausible.
 */
function cell(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'boolean') return value ? '"Yes"' : '"No"';
  if (Array.isArray(value)) return `"${value.join('; ').replace(/"/g, '""')}"`;
  if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** A human column heading from a camelCase key. */
function heading(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** One table: a heading row then the data rows. */
function tableToRows(name, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [[heading(name)], ['(no rows)'], []];
  }
  // The union of keys, not just the first row's: a row missing an optional
  // field would otherwise shift every later column.
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];
  return [
    [heading(name)],
    keys.map(heading),
    ...rows.map((row) => keys.map((k) => row?.[k])),
    [],
  ];
}

/**
 * Turns an export payload into CSV text.
 *
 * Exported separately from the download so it can be tested without a DOM.
 */
export function exportPayloadToCsv(payload, { title } = {}) {
  const rows = [];

  if (title) rows.push([title], []);

  if (payload?.generatedAt) rows.push(['Generated', payload.generatedAt], []);

  // Scalars first — the summary an admin reads before the detail.
  for (const groupName of ['totals', 'counts', 'farmer', 'cooperative', 'agent']) {
    const group = payload?.[groupName];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    rows.push([heading(groupName)]);
    for (const [key, value] of Object.entries(group)) {
      // A nested object inside a summary group (financing counts, say) is
      // flattened one level rather than dumped as JSON.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [subKey, subValue] of Object.entries(value)) {
          rows.push([`${heading(key)} — ${heading(subKey)}`, subValue]);
        }
      } else {
        rows.push([heading(key), value]);
      }
    }
    rows.push([]);
  }

  if (Array.isArray(payload?.crops) && payload.crops.length > 0) {
    rows.push(['Crops'], [payload.crops.join('; ')], []);
  }

  for (const [name, table] of Object.entries(payload?.tables ?? {})) {
    rows.push(...tableToRows(name, table));
  }

  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

/**
 * Triggers a browser download of CSV text.
 *
 * A BOM is prepended because Excel on Windows reads a CSV without one as
 * Latin-1, so Yoruba names and the naira sign arrive mangled — which, in a
 * file of Nigerian names and naira figures, is most of it.
 *
 * Written as the escape `\uFEFF` rather than the character itself: a literal
 * BOM in source is invisible, and the linter rightly refuses it.
 */
export function downloadCsv(filename, csv) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoked on the next tick: revoking immediately can cancel the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `heabron-farmer-ada-nwosu-2026-11-02.csv` */
export function exportFilename(kind, label) {
  const slug = String(label || kind)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const date = new Date().toISOString().slice(0, 10);
  return `heabron-${kind}-${slug || 'export'}-${date}.csv`;
}
