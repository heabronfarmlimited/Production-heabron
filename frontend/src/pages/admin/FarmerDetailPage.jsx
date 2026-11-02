import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Card, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ExportButton } from '@/components/shared/ExportButton';
import { formatDate, formatNaira, formatScore } from '@/lib/utils';
import { FarmerProfile } from '@/pages/partner/PartnerCreditReportPage';

export default function FarmerDetailPage() {
  const { farmerId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: report, isLoading, isError, error } = useQuery({
    queryKey: ['admin-farmer-report', farmerId],
    queryFn: () => api.get(`/admin/credit/farmers/${farmerId}/report`),
  });

  const recalc = useMutation({
    mutationFn: () => api.post(`/admin/credit/farmers/${farmerId}/recalculate`),
    // FIXED — no success/error feedback at all: the button spun and stopped,
    // with nothing to say whether the score had been recomputed.
    onSuccess: () => {
      toast.success('Credit score recalculated');
      qc.invalidateQueries({ queryKey: ['admin-farmer-report', farmerId] });
    },
  });

  if (isLoading) return <Skeleton className="h-72" />;
  if (isError || !report?.subject) {
    return (
      <Card padded>
        <p className="py-10 text-center text-smoke">
          {isError
            ? `Could not load this farmer${error?.message ? `: ${error.message}` : ''}.`
            : 'This farmer no longer exists.'}
        </p>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => navigate('/admin/farmers')}>Back to farmers</Button>
        </div>
      </Card>
    );
  }

  const farmerName = report.subject?.full_name;

  return (
    <>
      <FarmerProfile
        report={report}
        backLabel="All farmers"
        onBack={() => navigate('/admin/farmers')}
        extraActions={
          <>
            <ExportButton
              url={`/admin/exports/farmer/${farmerId}`}
              kind="farmer"
              label={farmerName}
              title={`Farmer export — ${farmerName || farmerId}`}
            />
            <Button variant="secondary" onClick={() => recalc.mutate()} disabled={recalc.isPending} className="no-print">
              <RefreshCw className={`size-4 ${recalc.isPending ? 'animate-spin' : ''}`} /> Recalculate
            </Button>
          </>
        }
      />

      {/*
        Admin-only field records.
        Deliberately NOT added to `FarmerProfile`, which partners also render:
        field notes are a field agent's own observations about a farmer and a
        lender has no business reading them. The endpoints existed with
        nothing calling them, so an admin reviewing a farmer could see the
        score but none of the evidence behind it.
      */}
      <FieldRecords farmerId={farmerId} />
    </>
  );
}

/**
 * Seasonal yield, offtake history and field notes for one farmer.
 *
 * Three separate endpoints, fetched together because they answer one
 * question: does the recorded production hold up? A yield with no offtake and
 * a field note about a failed harvest is the pattern verification is meant to
 * catch, and seeing them side by side is the whole point.
 */
function FieldRecords({ farmerId }) {
  const yieldQuery = useQuery({
    queryKey: ['admin-farmer-yield', farmerId],
    queryFn: () => api.get(`/admin/farmers/${farmerId}/seasonal-yield`),
  });
  const marketQuery = useQuery({
    queryKey: ['admin-farmer-market', farmerId],
    queryFn: () => api.get(`/admin/farmers/${farmerId}/market-access`),
  });
  const notesQuery = useQuery({
    queryKey: ['admin-farmer-notes', farmerId],
    queryFn: () => api.get(`/admin/farmers/${farmerId}/field-notes`),
  });

  const market = asRows(marketQuery.data);
  const notes = asRows(notesQuery.data);
  const seasons = asRows(yieldQuery.data?.seasons ?? yieldQuery.data);

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3 no-print">
      <Card padded>
        <p className="eyebrow mb-3">Seasonal yield</p>
        {yieldQuery.isLoading ? (
          <Skeleton className="h-20" />
        ) : seasons.length === 0 ? (
          <p className="text-sm text-smoke">No seasons recorded.</p>
        ) : (
          <ul className="space-y-2.5">
            {seasons.slice(0, 6).map((s, i) => (
              <li key={s.id || i} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink capitalize truncate">
                  {[s.season, s.crop].filter(Boolean).join(' · ') || '—'}
                </span>
                <span className="tabular text-smoke shrink-0">
                  {s.actual_yield_tonnes != null
                    ? `${formatScore(s.actual_yield_tonnes, 2)} t`
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded>
        <p className="eyebrow mb-3">Market access</p>
        {marketQuery.isLoading ? (
          <Skeleton className="h-20" />
        ) : market.length === 0 ? (
          <p className="text-sm text-smoke">No offtake recorded.</p>
        ) : (
          <ul className="space-y-2.5">
            {market.slice(0, 6).map((m, i) => (
              <li key={m.id || i} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-ink truncate">{m.buyer_name || '—'}</span>
                  <span className="tabular text-smoke shrink-0">
                    {m.price_per_ton != null ? formatNaira(m.price_per_ton) : '—'}
                  </span>
                </div>
                <p className="text-xs text-smoke">
                  {m.confirmed_buyer ? 'Confirmed buyer' : 'Not confirmed'}
                  {m.season_year ? ` · ${m.season_year}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded>
        <p className="eyebrow mb-3">Field notes</p>
        {notesQuery.isLoading ? (
          <Skeleton className="h-20" />
        ) : notes.length === 0 ? (
          <p className="text-sm text-smoke">No notes from the field.</p>
        ) : (
          <ul className="space-y-3">
            {notes.slice(0, 5).map((n, i) => (
              <li key={n.id || i} className="text-sm">
                <p className="text-ink">{n.note || n.title || '—'}</p>
                <p className="text-xs text-smoke">{formatDate(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * These three endpoints are not uniformly shaped — one returns a bare array,
 * another a paginated `{ data }`, another a wrapper. Normalised here rather
 * than three `Array.isArray` checks inline, so a shape change shows up as an
 * empty card instead of a crash on `.slice` of undefined.
 */
function asRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.records)) return value.records;
  return [];
}
