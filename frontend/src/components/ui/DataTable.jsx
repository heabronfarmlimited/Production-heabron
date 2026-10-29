import { cn } from '@/lib/utils';

export function DataTable({ columns, rows, loading, empty, onRowClick }) {
  // FIXED — every caller passed `rows` straight from a query result, so a
  // failed/pending fetch handed in `undefined` and `rows.length` threw,
  // white-screening the page instead of showing the empty state.
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeColumns = Array.isArray(columns) ? columns : [];
  return (
    <div className="card overflow-hidden" >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-whisper/70 text-left">
              {safeColumns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'py-3.5 px-5 text-[11px] font-semibold uppercase tracking-wider text-smoke',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center'
                  )}
                  style={{ width: c.width }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && safeRows.length === 0 && (
              <tr>
                <td colSpan={safeColumns.length} className="px-5 py-8">
                  <div className="space-y-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton h-9" />
                    ))}
                  </div>
                </td>
              </tr>
            )}
            {!loading && safeRows.length === 0 && (
              <tr>
                <td colSpan={safeColumns.length} className="px-5 py-12 text-center">{empty || 'No data'}</td>
              </tr>
            )}
            {safeRows.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                // FIXED — clickable rows were mouse-only. A tabindex + Enter/Space
                // handler makes them reachable and operable from the keyboard.
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                onKeyDown={onRowClick ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); }
                } : undefined}
                className={cn(
                  'border-b border-whisper/40 last:border-0 transition',
                  onRowClick && 'cursor-pointer hover:bg-bone focus-visible:outline-none focus-visible:bg-bone'
                )}
              >
                {safeColumns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'py-3.5 px-5 text-sm text-ink',
                      c.align === 'right' && 'text-right tabular',
                      c.align === 'center' && 'text-center'
                    )}
                  >
                    {c.render ? c.render(row) : row[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPageChange }) {
  // FIXED — `total.toLocaleString()` threw whenever meta was missing (error or
  // first render), and a missing/zero pageSize made totalPages Infinity.
  const size = Number(pageSize) > 0 ? Number(pageSize) : 20;
  const count = Number.isFinite(Number(total)) ? Number(total) : 0;
  const current = Number(page) > 0 ? Number(page) : 1;
  const totalPages = Math.max(1, Math.ceil(count / size));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-5 text-sm">
      <span className="text-smoke tabular">
        Page {current} of {totalPages} · {count.toLocaleString()} total
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={current >= totalPages}
          onClick={() => onPageChange(current + 1)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}
