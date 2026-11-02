import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Search } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatDate, formatNaira, formatScore } from '@/lib/utils';

/**
 * Produce deliveries.
 *
 * `/admin/deliveries` was served with nothing calling it, so an administrator
 * could not see deliveries at all — and a delivery is the evidence that a
 * recorded harvest actually reached a buyer or a warehouse. Repayment
 * timeliness is measured against them, and a yield with no corresponding
 * delivery is exactly the kind of thing yield verification exists to catch.
 * Without this list an admin verifying a season had no way to check it.
 *
 * Read-only on purpose: deliveries are recorded in the field by the agent who
 * witnessed them. Correcting one is a change request, which has its own
 * screen, rather than an admin editing a record they were not present for.
 */
export default function DeliveriesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['admin-deliveries', { search, page }],
    queryFn: () =>
      api.list('/admin/deliveries', {
        params: { search: search || undefined, page, pageSize: 20 },
      }),
  });

  const columns = [
    {
      key: 'farmer',
      label: 'Farmer',
      render: (r) => (
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{r.farmers?.full_name || '—'}</p>
          <p className="text-xs text-smoke truncate">{r.cooperatives?.name || '—'}</p>
        </div>
      ),
    },
    {
      key: 'crop',
      label: 'Crop',
      render: (r) => <span className="capitalize text-ink">{r.crop || '—'}</span>,
    },
    {
      key: 'quantity',
      label: 'Quantity',
      render: (r) => (
        <span className="tabular text-ink font-medium">
          {r.quantity_kg != null ? `${formatScore(r.quantity_kg, 0)} kg` : '—'}
        </span>
      ),
    },
    {
      key: 'grade',
      label: 'Grade',
      render: (r) =>
        r.quality_grade ? (
          <span className="inline-flex items-center justify-center size-6 rounded-md bg-forest-100 text-forest-700 text-xs font-bold">
            {r.quality_grade}
          </span>
        ) : (
          <span className="text-smoke">—</span>
        ),
    },
    {
      key: 'value',
      label: 'Value',
      render: (r) => {
        // Derived, not stored: the row carries a unit price, and the figure
        // an admin wants is what the load was worth.
        const kg = Number(r.quantity_kg);
        const price = Number(r.price_per_kg);
        const value =
          Number.isFinite(kg) && Number.isFinite(price) && kg > 0 && price > 0
            ? kg * price
            : null;
        return (
          <span className="tabular text-smoke">
            {value != null ? formatNaira(value) : '—'}
          </span>
        );
      },
    },
    {
      key: 'buyer',
      label: 'Buyer / warehouse',
      render: (r) => (
        <span className="text-smoke text-xs">
          {[r.buyer_name, r.warehouse].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'date',
      label: 'Delivered',
      render: (r) => <span className="text-smoke text-xs">{formatDate(r.date_delivered)}</span>,
    },
    {
      key: 'receipt',
      label: 'Receipt',
      render: (r) => (
        <span className="text-xs font-mono text-smoke">
          {r.receipt_number || (r.proof_photo_urls?.length ? `${r.proof_photo_urls.length} photo(s)` : '—')}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Produce Deliveries"
        description="What actually reached buyers and warehouses. Repayment timeliness is measured against these."
      />

      {/* Same search shape as the other admin lists: `Input` takes no icon
          prop, so the glyph is positioned over it. */}
      <Card padded={false} className="mb-4">
        <div className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-smoke" />
            <Input
              placeholder="Search by farmer, crop or buyer…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-10"
            />
          </div>
        </div>
      </Card>

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Could not load deliveries{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data}
        empty={
          <EmptyState
            icon={Truck}
            title={search ? 'No matching deliveries' : 'No deliveries recorded'}
            description={
              search
                ? 'Try a different farmer, crop or buyer.'
                : 'Deliveries logged by field agents appear here. Correcting one goes through a change request.'
            }
          />
        }
      />
      <Pagination
        page={page}
        pageSize={list?.meta?.pageSize || 20}
        total={list?.meta?.total || 0}
        onPageChange={setPage}
      />

      <p className="text-xs text-smoke mt-4">
        Read only — deliveries are recorded in the field by the agent who
        witnessed them. To correct one, the agent submits a change request.
      </p>
    </>
  );
}
