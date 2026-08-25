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

module.exports = { parsePagination };
