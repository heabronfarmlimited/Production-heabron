import { cn } from '@/lib/utils';

export function DataTable({ columns, rows, loading, empty, onRowClick }) {
  return (
    <div className="card overflow-hidden" >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-whisper/70 text-left">
              {columns.map((c) => (
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
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-5 py-8">
                  <div className="space-y-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton h-9" />
                    ))}
                  </div>
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-5 py-12 text-center">{empty || 'No data'}</td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-whisper/40 last:border-0 transition',
                  onRowClick && 'cursor-pointer hover:bg-bone'
                )}
              >
                {columns.map((c) => (
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
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-5 text-sm">
      <span className="text-smoke tabular">
        Page {page} of {totalPages} · {total.toLocaleString()} total
      </span>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          Previous
        </button>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}
