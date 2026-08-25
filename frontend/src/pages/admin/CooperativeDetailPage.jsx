import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, MapPin, Users, Phone } from 'lucide-react';
import api from '@/lib/api';
import { Card, MetricCard, TierPill, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { formatDate, formatNaira, formatNumber } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function CooperativeDetailPage() {
  const { cooperativeId } = useParams();
  const navigate = useNavigate();

  const { data: report, isLoading, refetch } = useQuery({
    queryKey: ['admin-coop-report', cooperativeId],
    queryFn: () => api.get(`/admin/credit/cooperatives/${cooperativeId}/report`),
  });

  const recalc = useMutation({
    mutationFn: () => api.post(`/admin/credit/cooperatives/${cooperativeId}/recalculate`),
    onSuccess: () => { toast.success('Aggregate score recalculated'); refetch(); },
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!report?.cooperative) return <Card><p className="text-center py-12">Cooperative not found.</p></Card>;

  const c = report.cooperative;
  const s = report.score;
  const trend = (report.scoreTrend || []).map((h, i) => ({ idx: i + 1, score: Number(h.final_score) }));

  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> Back
      </button>

      <PageHeader
        eyebrow="Cooperative"
        title={c.name}
        description={[c.lga, c.state].filter(Boolean).join(', ')}
        actions={
          <Button onClick={() => recalc.mutate()} loading={recalc.isPending}>
            <RefreshCw className="size-4" /> Recalculate average
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Average score" value={s?.average_score?.toFixed(1) || '—'} sub={s?.cooperative_tier ? `Tier ${s.cooperative_tier}` : ''} tone="primary" />
        <MetricCard label="Total members" value={formatNumber(s?.total_farmers || c.total_members || 0)} icon={Users} />
        <MetricCard label="Scored" value={formatNumber(s?.scored_farmers || 0)} />
        <MetricCard label="Tier D members" value={formatNumber(s?.tier_d_count || 0)} sub="At-risk" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <p className="eyebrow mb-1">Member distribution</p>
          <h3 className="font-display text-xl font-semibold mb-5">By tier</h3>
          <div className="space-y-3">
            {['A','B','C','D'].map((t) => (
              <div key={t} className="flex items-center justify-between">
                <TierPill tier={t} />
                <span className="tabular font-semibold text-lg">{formatNumber(s?.[`tier_${t.toLowerCase()}_count`] || 0)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="eyebrow mb-1">Trend</p>
          <h3 className="font-display text-xl font-semibold mb-5">Member score average</h3>
          {trend.length === 0 ? (
            <p className="text-sm text-smoke py-12 text-center">No score history yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend}>
                <XAxis dataKey="idx" tick={{ fontSize: 11, fill: '#6B7370' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B7370' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#2C6B47" strokeWidth={2.5} dot={{ r: 3, fill: '#2C6B47' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card padded className="mb-6">
        <p className="eyebrow mb-1">Profile</p>
        <h3 className="font-display text-xl font-semibold mb-4">Cooperative details</h3>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <KV label="Leader" value={c.leader_name || '—'} />
          <KV label="Leader phone" value={c.leader_phone || '—'} icon={Phone} />
          <KV label="Registration #" value={c.registration_number || '—'} />
          <KV label="Crops" value={(c.crops_supported || []).join(', ') || '—'} />
          <KV label="Estimated land" value={c.estimated_land_size ? `${c.estimated_land_size} acres` : '—'} />
          <KV label="Created" value={formatDate(c.created_at)} />
          <KV label="State" value={c.state} icon={MapPin} />
          <KV label="LGA" value={c.lga} />
          <KV label="Address" value={c.address || '—'} />
        </dl>
      </Card>

      <Card padded className="mb-6">
        <p className="eyebrow mb-1">Members</p>
        <h3 className="font-display text-xl font-semibold mb-4">{formatNumber((report.members || []).length)} farmers</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60">
              <th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Tier</th><th className="py-2 pr-4 text-right">Score</th>
            </tr></thead>
            <tbody>
              {(report.members || []).map((m) => {
                const score = Array.isArray(m.credit_scores) ? m.credit_scores[0] : m.credit_scores;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-whisper/40 last:border-0 cursor-pointer hover:bg-bone"
                    onClick={() => navigate(`/admin/farmers/${m.id}`)}
                  >
                    <td className="py-2 pr-4 font-medium">{m.full_name}</td>
                    <td className="py-2 pr-4"><TierPill tier={score?.credit_tier} /></td>
                    <td className="py-2 pr-4 tabular text-right">{score?.final_credit_score != null ? Number(score.final_credit_score).toFixed(1) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padded>
        <p className="eyebrow mb-1">Loans</p>
        <h3 className="font-display text-xl font-semibold mb-4">Financing history</h3>
        {(report.financingHistory || []).length === 0 ? (
          <p className="text-sm text-smoke py-6 text-center">No financing history yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60">
              <th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Amount</th><th className="py-2 pr-4">Purpose</th><th className="py-2 pr-4">Status</th>
            </tr></thead>
            <tbody>
              {report.financingHistory.map((f) => (
                <tr key={f.id} className="border-b border-whisper/40 last:border-0">
                  <td className="py-2 pr-4">{formatDate(f.created_at)}</td>
                  <td className="py-2 pr-4 font-semibold">{formatNaira(f.loan_amount)}</td>
                  <td className="py-2 pr-4">{f.purpose}</td>
                  <td className="py-2 pr-4 capitalize">{f.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function KV({ label, value, icon: Icon }) {
  return (
    <div>
      <p className="text-xs text-smoke uppercase tracking-wider mb-0.5 flex items-center gap-1">
        {Icon && <Icon className="size-3" />}{label}
      </p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}
