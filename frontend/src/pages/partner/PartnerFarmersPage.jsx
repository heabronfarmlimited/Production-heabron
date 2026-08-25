import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Eye } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState, Skeleton, StatusPill } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { initials } from '@/lib/utils';

export default function PartnerFarmersPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [agentId, setAgentId] = useState('');
  const [tier, setTier] = useState('');

  const { data: agents } = useQuery({
    queryKey: ['partner-field-agents'],
    queryFn: () => api.raw.get('/partner/field-agents').then((r) => r.data?.data || []),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['partner-farmers', term, agentId, tier],
    queryFn: () =>
      api.raw
        .get('/partner/farmers', {
          params: { search: term, agentId: agentId || undefined, tier: tier || undefined, pageSize: 60 },
        })
        .then((r) => r.data?.data || []),
  });

  return (
    <>
      <PageHeader
        eyebrow="Borrower network"
        title="All farmers"
        description="Complete farmer directory with credit scores — open any profile for the full picture, even before a request reaches you."
      />

      <Card padded className="mb-6">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search farmers by name..." className="pl-10" />
          </div>
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="lg:w-56">
            <option value="">All field agents</option>
            {(agents || []).map((a) => (
              <option key={a.user_id} value={a.user_id}>{a.full_name}</option>
            ))}
          </Select>
          <Select value={tier} onChange={(e) => setTier(e.target.value)} className="lg:w-40">
            <option value="">All grades</option>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
            <option value="D">Grade D</option>
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (data || []).length === 0 ? (
        <EmptyState title="No farmers found" description="Try a different search, grade, or field-agent filter." />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60 bg-bone/40">
                  <th className="py-3 px-4">Farmer</th>
                  <th className="py-3 px-4">Crop</th>
                  <th className="py-3 px-4">Cooperative</th>
                  <th className="py-3 px-4">NIN</th>
                  <th className="py-3 px-4">Grade</th>
                  <th className="py-3 px-4">Score</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((f) => {
                  const farm = Array.isArray(f.farm_profiles) ? f.farm_profiles[0] : f.farm_profiles;
                  const score = Array.isArray(f.credit_scores) ? f.credit_scores[0] : f.credit_scores;
                  return (
                    <tr
                      key={f.id}
                      className="border-b border-whisper/40 last:border-0 hover:bg-bone/40 cursor-pointer"
                      onClick={() => navigate(`/partner/reports/farmer/${f.id}`)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="size-9 rounded-full bg-forest-50 grid place-items-center text-forest-700 text-xs font-semibold">
                            {initials(f.full_name)}
                          </div>
                          <div>
                            <div className="font-medium text-ink">{f.full_name}</div>
                            <div className="text-[11px] text-smoke capitalize">{f.gender || ''}{f.lga ? ` · ${f.lga}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 capitalize">{farm?.crop_type || '—'}</td>
                      <td className="py-3 px-4 text-smoke">{f.cooperatives?.name || '—'}</td>
                      <td className="py-3 px-4">
                        <StatusPill status={f.nin_verification_status || 'pending'} />
                      </td>
                      <td className="py-3 px-4"><TierPill tier={score?.credit_tier} /></td>
                      <td className="py-3 px-4 font-semibold text-ink tabular">
                        {score?.final_credit_score != null ? Number(score.final_credit_score).toFixed(0) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Eye className="size-4 text-smoke inline" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
