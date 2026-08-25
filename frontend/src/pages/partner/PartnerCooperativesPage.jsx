import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Users, Eye } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState, Skeleton } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatNumber } from '@/lib/utils';

export default function PartnerCooperativesPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [agentId, setAgentId] = useState('');

  const { data: agents } = useQuery({
    queryKey: ['partner-field-agents'],
    queryFn: () => api.raw.get('/partner/field-agents').then((r) => r.data?.data || []),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['partner-cooperatives', term, agentId],
    queryFn: () =>
      api.raw
        .get('/partner/cooperatives', { params: { search: term, agentId: agentId || undefined, pageSize: 60 } })
        .then((r) => r.data?.data || []),
  });

  return (
    <>
      <PageHeader
        eyebrow="Borrower network"
        title="All cooperatives"
        description="Browse every cooperative in the network — including those not yet sent to you — and open a full credit report."
      />

      <Card padded className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search cooperatives..."
              className="pl-10"
            />
          </div>
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="sm:w-64">
            <option value="">All field agents</option>
            {(agents || []).map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.full_name}{a.state ? ` · ${a.state}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : (data || []).length === 0 ? (
        <EmptyState title="No cooperatives found" description="Try a different search or field-agent filter." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((c) => {
            const dist = {
              A: c.tier_a_count, B: c.tier_b_count, C: c.tier_c_count, D: c.tier_d_count,
            };
            return (
              <Card key={c.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="size-10 rounded-xl bg-forest-50 grid place-items-center text-forest-600">
                    <Users className="size-5" />
                  </div>
                  <TierPill tier={c.cooperative_tier} />
                </div>
                <h3 className="font-display text-lg font-semibold text-ink mt-3 leading-snug">{c.name}</h3>
                <p className="text-xs text-smoke flex items-center gap-1 mt-1">
                  <MapPin className="size-3" /> {[c.lga, c.state].filter(Boolean).join(', ') || '—'}
                </p>
                <div className="flex items-center gap-3 text-xs text-smoke mt-1">
                  <span>{formatNumber(c.total_farmers || 0)} members</span>
                  <span>·</span>
                  <span>{formatNumber(c.scored_farmers || 0)} scored</span>
                </div>

                <div className="mt-3 rounded-xl bg-bone/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-smoke">Avg credit score</span>
                    <span className="font-display text-lg font-bold text-forest-700">
                      {Number(c.average_score || 0).toFixed(0)}<span className="text-xs text-smoke">/100</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 mt-2">
                    {['A', 'B', 'C', 'D'].map((t) => (
                      <div key={t} className="text-center rounded-md bg-white py-1">
                        <div className="text-[11px] font-semibold text-ink">{dist[t] ?? 0}</div>
                        <div className="text-[9px] text-smoke">{t}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => navigate(`/partner/reports/cooperative/${c.id}`)}
                >
                  <Eye className="size-4" /> View details
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
