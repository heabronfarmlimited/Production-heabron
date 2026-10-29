'use strict';

/**
 * Parse and clamp pagination params from a request query string.
 *   ?page=1&pageSize=20  →  { page, pageSize, from, to }
 */
function parsePagination(query, defaults = { page: 1, pageSize: 20, maxPageSize: 100 }) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.pageSize || query.limit, 10);

  if (!Number.isFinite(page) || page < 1) page = defaults.page;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaults.pageSize;
  if (pageSize > defaults.maxPageSize) pageSize = defaults.maxPageSize;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return { page, pageSize, from, to };
}

/**
 * PostgREST caps an un-ranged select at `db-max-rows` (1000 by default) and
 * returns the truncated page WITHOUT any error. Several places summed or
 * averaged a whole table with a plain `select(...)`, so every money total and
 * every cooperative average silently stopped being correct past 1000 rows.
 *
 * `fetchAllRows` pages until the table is exhausted (or `maxRows` is reached,
 * which is reported rather than hidden).
 *
 * FIXED — callers previously trusted a single unbounded select.
 */
const PAGE = 1000;

async function fetchAllRows(buildQuery, { pageSize = PAGE, maxRows = 200000 } = {}) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) return { rows, error, truncated: false };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, error: null, truncated: false };
    offset += pageSize;
    if (rows.length >= maxRows) return { rows, error: null, truncated: true };
  }
}

/** Sum one numeric column across every matching row. Non-numeric rows are skipped. */
async function sumColumn(buildQuery, column, opts) {
  const { rows, error, truncated } = await fetchAllRows(buildQuery, opts);
  let total = 0;
  for (const r of rows) {
    const n = Number(r?.[column]);
    if (Number.isFinite(n)) total += n;
  }
  // Money is summed in naira with 2dp precision; round away float drift
  // (0.1 + 0.2 === 0.30000000000000004) before it reaches a dashboard.
  return { total: Math.round(total * 100) / 100, count: rows.length, error, truncated };
}

module.exports = { parsePagination, fetchAllRows, sumColumn };
