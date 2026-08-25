import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, AlertTriangle, Download, MapPin, Sprout,
  CheckCircle2, Clock, Wallet, ChevronRight,
} from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, MetricCard, TierPill, Skeleton, StatusPill } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FarmMap } from '@/components/ui/FarmMap';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { formatNaira, formatDate, formatNumber, initials } from '@/lib/utils';

const TONNE_KG = 1000;

export default function PartnerCreditReportPage({ type }) {
  const params = useParams();
  const navigate = useNavigate();
  const id = type === 'farmer' ? params.farmerId : params.cooperativeId;

  const { data: report, isLoading } = useQuery({
    queryKey: ['partner-report', type, id],
    queryFn: () => api.get(`/partner/credit/${type === 'farmer' ? 'farmers' : 'cooperatives'}/${id}/report`),
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!report) return <Card padded><p className="py-12 text-center">Report not available.</p></Card>;

  return type === 'farmer'
    ? <FarmerProfile report={report} onBack={() => navigate(-1)} />
    : <CooperativeReport report={report} onBack={() => navigate(-1)} />;
}

/* ===========================================================================
 * FARMER PROFILE — rich, tabbed (design: Heabron_FarmerProfile_DesignFlow)
 * =========================================================================== */
export function FarmerProfile({ report, onBack, extraActions, backLabel = 'All farmers' }) {
  const f = report.subject || {};
  const farm = Array.isArray(f.farm_profiles) ? f.farm_profiles[0] : f.farm_profiles;
  const score = report.score || {};
  const tier = score.credit_tier;

  const finishedLoans = (report.financingHistory || []).filter((l) => ['disbursed', 'completed'].includes(l.status));
  const totalDisbursed = (report.financingHistory || []).reduce((s, l) => s + Number(l.disbursed_amount || 0), 0);
  const totalRepaid = (report.repaymentHistory || []).reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  const repaymentRate = totalDisbursed > 0 ? Math.round((totalRepaid / totalDisbursed) * 100) : null;

  const [tab, setTab] = useState('cycles');

  return (
    <>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> {backLabel}
      </button>

      <PageHeader
        eyebrow="Borrower profile"
        title={f.full_name}
        description={`${f.cooperatives?.name || 'Independent'} · ${[f.lga, f.state].filter(Boolean).join(', ')}`}
        actions={<>{extraActions}<Button variant="secondary" onClick={() => window.print()}><Download className="size-4" /> Export PDF</Button></>}
      />

      {(report.riskFlags?.length || 0) > 0 && (
        <Card padded className="bg-red-50 border-red-200 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-red-900 mb-2">Risk indicators</p>
              <ul className="space-y-1 text-sm text-red-800">
                {report.riskFlags.map((r, i) => <li key={i}>• {r.message}</li>)}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        {/* LEFT COLUMN — identity / farm / data quality */}
        <div className="space-y-5">
          <Card>
            <div className="flex flex-col items-center text-center pb-4 border-b border-whisper/60">
              {f.farmer_photo_url ? (
                <img
                  src={f.farmer_photo_url}
                  alt={f.full_name}
                  className="size-[70px] rounded-full object-cover border-[3px] border-forest-500"
                  onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'grid'; }}
                />
              ) : null}
              <div
                className="size-[70px] rounded-full bg-forest-50 border-[3px] border-forest-500 grid place-items-center text-forest-700 font-display text-xl font-semibold"
                style={{ display: f.farmer_photo_url ? 'none' : 'grid' }}
              >
                {initials(f.full_name)}
              </div>
              <h2 className="mt-3 font-semibold text-ink">{f.full_name}</h2>
              {f.id && <p className="text-[11px] text-smoke font-mono">{f.id.slice(0, 8).toUpperCase()}</p>}
              {tier && <span className="mt-2"><TierPill tier={tier} /></span>}
            </div>
            <dl className="text-sm divide-y divide-whisper/50">
              <Row label="NIN verified" value={<VerifyMark ok={f.nin_verification_status === 'verified'} pending={f.nin_verification_status === 'pending'} />} />
              <Row label="BVN linked" value={<VerifyMark ok={f.bvn_verification_status === 'verified'} pending={f.bvn_verification_status === 'pending'} label="Linked" />} />
              <Row label="Phone" value={maskPhone(f.phone)} />
              <Row label="Gender" value={cap(f.gender)} />
              <Row label="Age" value={ageFromDob(f.date_of_birth)} />
              <Row label="State" value={f.state} />
              <Row label="LGA" value={f.lga} />
              <Row label="Cooperative" value={f.cooperatives?.name} />
              <Row label="Member since" value={f.member_since ? formatDate(f.member_since) : '—'} />
              <Row label="Seasons farmed" value={farm?.years_experience ? `${farm.years_experience} yrs` : '—'} />
            </dl>
          </Card>

          <Card>
            <h3 className="font-semibold text-ink mb-3 flex items-center gap-2"><Sprout className="size-4 text-forest-500" /> Farm details</h3>
            <dl className="text-sm divide-y divide-whisper/50">
              <Row label="Total acreage" value={farm?.farm_size_acres ? `${farm.farm_size_acres} acres` : '—'} />
              <Row label="Primary crop" value={cap(farm?.crop_type) || cap(f.cooperatives?.primary_crop)} />
              <Row label="Secondary crops" value={(farm?.secondary_crops || []).map(cap).join(', ') || '—'} />
              <Row label="GPS mapped" value={<VerifyMark ok={!!farm?.gps_mapped} label="Mapped" />} />
              <Row label="Plot count" value={farm?.plot_count ? `${farm.plot_count} plot${farm.plot_count > 1 ? 's' : ''}` : '—'} />
              <Row label="Soil type" value={cap(farm?.soil_type)} />
              <Row label="Water source" value={cap(farm?.water_source)} />
            </dl>
            <div className="mt-4 rounded-xl overflow-hidden border border-whisper bg-bone/60">
              {farm?.gps_lat && farm?.gps_lng ? (
                <FarmMap lat={Number(farm.gps_lat)} lng={Number(farm.gps_lng)} label={[f.lga, f.state].filter(Boolean).join(', ')} />
              ) : (
                <div className="h-[140px] grid place-items-center text-center">
                  <div className="text-smoke text-xs">
                    <MapPin className="size-5 mx-auto mb-1 text-forest-400" />
                    Farm not yet GPS-mapped
                    {f.lga && <div>{[f.lga, f.state].filter(Boolean).join(', ')}</div>}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h3 className="font-semibold text-ink mb-3">Data quality</h3>
            <div className="flex flex-wrap gap-2">
              <QualityChip ok={f.nin_verification_status === 'verified'} label="NIN verified" />
              <QualityChip ok={!!farm?.gps_mapped} label="GPS mapped" />
              <QualityChip ok={(report.seasonalProductions || []).some((p) => p.verification_status === 'verified')} label="Yield verified" />
              <QualityChip ok={finishedLoans.length > 0} label={`${finishedLoans.length} cycles done`} />
              <span className="pill-neutral text-[11px]">Updated: {formatDate(f.updated_at)}</span>
              <span className="pill-neutral text-[11px]">Source: Field agent</span>
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN — score + financing + tabs */}
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <CreditScoreCard score={score} />
            <FinancingSummaryCard
              totalDisbursed={totalDisbursed}
              totalRepaid={totalRepaid}
              repaymentRate={repaymentRate}
              cyclesCompleted={finishedLoans.length}
              score={score}
            />
          </div>

          <Card padded={false}>
            <div className="flex border-b border-whisper/60 px-2 overflow-x-auto">
              {[
                ['cycles', 'Financing cycles'],
                ['yield', 'Yield history'],
                ['market', 'Market access'],
                ['notes', 'Field notes'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    tab === key ? 'border-forest-500 text-forest-700 font-semibold' : 'border-transparent text-smoke hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {tab === 'cycles' && <CyclesTab loans={report.financingHistory || []} repayments={report.repaymentHistory || []} />}
              {tab === 'yield' && <YieldTab productions={report.seasonalProductions || []} />}
              {tab === 'market' && <MarketTab records={report.marketAccess || []} />}
              {tab === 'notes' && <NotesTab notes={report.fieldNotes || []} />}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ---------- score card (Yield 60 / Repayment 40) ---------- */
function CreditScoreCard({ score }) {
  const final = Number(score.final_credit_score || 0);
  const yieldPts = Number(score.production_score || 0);
  const repayPts = Number(score.repayment_score || 0);
  const pct = Math.min(final, 100);
  const dash = 2 * Math.PI * 42;
  return (
    <Card>
      <p className="eyebrow mb-1">Heabron credit score</p>
      <div className="flex items-center gap-5">
        <div className="relative size-[96px] shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#F0EDE6" strokeWidth="9" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="#2C6B47" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={dash} strokeDashoffset={dash - (dash * pct) / 100} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="font-display text-2xl font-bold text-forest-700 leading-none">{final.toFixed(0)}</div>
              <div className="text-[9px] text-smoke">out of 100</div>
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-2.5">
          <BreakdownRow label="Yield performance" value={yieldPts} max={60} />
          <BreakdownRow label="Repayment" value={repayPts} max={40} />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <MiniStat label="Rate /25" value={score.repayment_rate_score} />
            <MiniStat label="Time /10" value={score.timeliness_score} />
            <MiniStat label="Def /5" value={score.default_history_score} />
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold text-forest-700">
        {tierLabel(score.credit_tier)}{score.is_first_cycle ? ' · First cycle' : ''}
      </p>
    </Card>
  );
}

function FinancingSummaryCard({ totalDisbursed, totalRepaid, repaymentRate, cyclesCompleted, score }) {
  return (
    <Card>
      <p className="eyebrow mb-1">Financing summary</p>
      <div className="grid grid-cols-2 gap-3 mt-2">
        <StatBox label="Total disbursed" value={formatNaira(totalDisbursed)} />
        <StatBox label="Total repaid" value={formatNaira(totalRepaid)} />
        <StatBox label="Repayment rate" value={repaymentRate != null ? `${repaymentRate}%` : '—'} tone={repaymentRate === 100 ? 'green' : 'default'} />
        <StatBox label="Cycles completed" value={formatNumber(cyclesCompleted)} />
      </div>
      {(score.recommended_loan_max || 0) > 0 && (
        <div className="mt-3 rounded-xl bg-forest-50 border border-forest-100 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-forest-700 flex items-center gap-1.5">
            <Wallet className="size-3.5" /> Recommended loan limit
          </p>
          <p className="font-display text-lg font-bold text-forest-800 mt-0.5">
            {formatNaira(score.recommended_loan_min)} — {formatNaira(score.recommended_loan_max)}
          </p>
          {score.recommended_loan_reason && <p className="text-[11px] text-smoke mt-0.5">{score.recommended_loan_reason}</p>}
        </div>
      )}
    </Card>
  );
}

/* ---------- tabs ---------- */
function CyclesTab({ loans, repayments }) {
  if (loans.length === 0) return <Empty>No financing cycles yet.</Empty>;
  const repaidByLoan = repayments.reduce((m, r) => {
    m[r.financing_request_id] = (m[r.financing_request_id] || 0) + Number(r.amount_paid || 0);
    return m;
  }, {});
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60">
          <th className="py-2 pr-4">Cycle</th><th className="py-2 pr-4">Season</th><th className="py-2 pr-4">Disbursed</th>
          <th className="py-2 pr-4">Repaid</th><th className="py-2 pr-4">Rate</th><th className="py-2 pr-4">Status</th>
        </tr></thead>
        <tbody>
          {loans.slice().reverse().map((l, i) => {
            const disbursed = Number(l.disbursed_amount || l.approved_amount || 0);
            const repaid = repaidByLoan[l.id] || 0;
            const rate = disbursed > 0 ? Math.round((repaid / disbursed) * 100) : 0;
            return (
              <tr key={l.id} className="border-b border-whisper/40 last:border-0">
                <td className="py-2.5 pr-4 font-medium">Cycle {l.cycle_number || i + 1}</td>
                <td className="py-2.5 pr-4 text-smoke">{cap(l.season) || formatDate(l.created_at)}</td>
                <td className="py-2.5 pr-4 font-semibold">{disbursed ? formatNaira(disbursed) : '—'}</td>
                <td className="py-2.5 pr-4">{repaid ? formatNaira(repaid) : '—'}</td>
                <td className="py-2.5 pr-4 font-semibold text-forest-700">{disbursed ? `${rate}%` : '—'}</td>
                <td className="py-2.5 pr-4"><StatusPill status={l.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function YieldTab({ productions }) {
  if (productions.length === 0) return <Empty>No seasonal yield records yet.</Empty>;
  const withYield = productions.filter((p) => p.actual_yield_tonnes != null);
  const maxKg = Math.max(...withYield.map((p) => Number(p.actual_yield_tonnes) * TONNE_KG), 1);
  const avgAch = withYield.length
    ? (withYield.reduce((s, p) => s + (Number(p.yield_achievement_rate) || 0), 0) / withYield.length) * 100
    : null;
  const latest = productions[productions.length - 1];
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <p className="text-xs uppercase text-smoke mb-3">Actual yield per season</p>
        <div className="space-y-3">
          {productions.map((p) => {
            const kg = Number(p.actual_yield_tonnes || 0) * TONNE_KG;
            return (
              <div key={p.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{p.season || formatDate(p.expected_harvest_date)}</span>
                  <span className="tabular text-smoke">{p.actual_yield_tonnes != null ? `${formatNumber(kg)} kg` : 'pending'}</span>
                </div>
                <div className="h-2.5 bg-bone rounded-full overflow-hidden">
                  <div className="h-full bg-forest-500" style={{ width: `${(kg / maxKg) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl bg-bone/70 p-3 text-sm space-y-1">
          <KV label="Seasons reported" value={withYield.length} />
          <KV label="Avg achievement" value={avgAch != null ? `${avgAch.toFixed(0)}%` : '—'} tone={avgAch >= 90 ? 'green' : 'default'} />
          <KV label="Verified seasons" value={productions.filter((p) => p.verification_status === 'verified').length} />
        </div>
      </div>
      <div>
        <p className="text-xs uppercase text-smoke mb-3">Latest season inputs</p>
        {!latest ? <Empty>No data.</Empty> : (
          <dl className="text-sm divide-y divide-whisper/50">
            <Row label="Crop" value={cap(latest.crop)} />
            <Row label="Seed type" value={latest.seed_type || '—'} />
            <Row label="Fertilizer" value={latest.fertilizer_used || '—'} />
            <Row label="Herbicide" value={latest.herbicide_used == null ? '—' : latest.herbicide_used ? 'Yes' : 'No'} />
            <Row label="Post-harvest storage" value={latest.post_harvest_storage || '—'} />
            <Row label="Est. farm income" value={latest.estimated_farm_income ? formatNaira(latest.estimated_farm_income) : '—'} />
            <Row label="Verification" value={<StatusPill status={latest.verification_status} />} />
          </dl>
        )}
        {latest && <EvidenceGallery production={latest} />}
      </div>
    </div>
  );
}

function EvidenceGallery({ production }) {
  const imgs = [
    ...(Array.isArray(production.harvest_photo_urls) ? production.harvest_photo_urls.map((u) => ({ u, label: 'Harvest' })) : []),
    ...(production.warehouse_receipt_url ? [{ u: production.warehouse_receipt_url, label: 'Warehouse receipt' }] : []),
    ...(production.buyer_receipt_url ? [{ u: production.buyer_receipt_url, label: 'Buyer receipt' }] : []),
    ...(production.agent_signature_url ? [{ u: production.agent_signature_url, label: 'Agent signature' }] : []),
  ].filter((x) => x.u);
  if (imgs.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs uppercase text-smoke mb-2">Verification evidence</p>
      <div className="grid grid-cols-3 gap-2">
        {imgs.map((img, i) => (
          <a key={i} href={img.u} target="_blank" rel="noreferrer" className="block group" title={img.label}>
            <img
              src={img.u}
              alt={img.label}
              className="w-full h-20 object-cover rounded-lg border border-whisper group-hover:opacity-90"
              onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
            />
            <span className="block text-[10px] text-smoke mt-0.5 truncate">{img.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function MarketTab({ records }) {
  if (records.length === 0) return <Empty>No offtake history recorded yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60">
          <th className="py-2 pr-4">Year</th><th className="py-2 pr-4">Buyer</th><th className="py-2 pr-4">Price / ton</th>
          <th className="py-2 pr-4">Context</th><th className="py-2 pr-4">Confirmed</th>
        </tr></thead>
        <tbody>
          {records.map((m) => (
            <tr key={m.id} className="border-b border-whisper/40 last:border-0">
              <td className="py-2.5 pr-4 font-medium">{m.season_year || '—'}</td>
              <td className="py-2.5 pr-4">{m.buyer_name}</td>
              <td className="py-2.5 pr-4 font-semibold">{m.price_per_ton ? formatNaira(m.price_per_ton) : '—'}</td>
              <td className="py-2.5 pr-4 capitalize text-smoke">{(m.price_context || '').replace('_', ' ') || '—'}</td>
              <td className="py-2.5 pr-4">{m.is_confirmed ? <span className="text-forest-600 font-medium">✓ Yes</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotesTab({ notes }) {
  if (notes.length === 0) return <Empty>No field notes yet.</Empty>;
  return (
    <ol className="relative border-l-2 border-whisper/70 ml-2 space-y-5">
      {notes.map((n) => (
        <li key={n.id} className="ml-5 relative">
          <span className={`absolute -left-[27px] top-1 size-3 rounded-full ${n.tag_variant === 'amber' ? 'bg-gold-500' : 'bg-forest-500'}`} />
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-ink text-sm">{n.title || cap(n.note_type)}</p>
            {n.tag_label && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${n.tag_variant === 'amber' ? 'bg-gold-50 text-gold-700' : 'bg-forest-50 text-forest-700'}`}>{n.tag_label}</span>
            )}
          </div>
          <p className="text-[11px] text-smoke">{formatDate(n.event_date)}</p>
          {n.body && <p className="text-sm text-ink/80 mt-1 leading-relaxed">{n.body}</p>}
        </li>
      ))}
    </ol>
  );
}

/* ---------- small shared bits ---------- */
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 gap-3">
      <dt className="text-smoke">{label}</dt>
      <dd className="font-medium text-ink text-right">{value || '—'}</dd>
    </div>
  );
}
function KV({ label, value, tone }) {
  return (
    <div className="flex justify-between">
      <span className="text-smoke">{label}</span>
      <span className={`font-semibold ${tone === 'green' ? 'text-forest-600' : 'text-ink'}`}>{value}</span>
    </div>
  );
}
function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-bone/70 py-1.5 text-center">
      <div className="font-semibold text-ink text-sm tabular">{value != null ? Number(value).toFixed(0) : '0'}</div>
      <div className="text-[10px] text-smoke">{label}</div>
    </div>
  );
}
function StatBox({ label, value, tone }) {
  return (
    <div className={`rounded-xl p-3 text-center ${tone === 'green' ? 'bg-forest-50' : 'bg-bone/70'}`}>
      <div className={`font-display text-base font-bold ${tone === 'green' ? 'text-forest-700' : 'text-ink'}`}>{value}</div>
      <div className="text-[11px] text-smoke mt-0.5">{label}</div>
    </div>
  );
}
function VerifyMark({ ok, pending, label }) {
  if (ok) return <span className="text-forest-600 font-medium inline-flex items-center gap-1"><CheckCircle2 className="size-3.5" /> {label || 'Verified'}</span>;
  if (pending) return <span className="text-gold-700 inline-flex items-center gap-1"><Clock className="size-3.5" /> Pending</span>;
  return <span className="text-smoke">—</span>;
}
function QualityChip({ ok, label }) {
  return (
    <span className={`text-[11px] px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${ok ? 'bg-forest-50 text-forest-700' : 'bg-bone text-smoke'}`}>
      {ok && <CheckCircle2 className="size-3" />} {label}
    </span>
  );
}
function BreakdownRow({ label, value, max }) {
  const v = Number(value || 0);
  const pct = (v / max) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-smoke text-xs">{label}</span>
        <span className="tabular font-semibold text-ink">{v.toFixed(0)} / {max}</span>
      </div>
      <div className="h-1.5 bg-bone rounded-full overflow-hidden">
        <div className="h-full bg-forest-500" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
function Empty({ children }) {
  return <p className="text-sm text-smoke py-8 text-center">{children}</p>;
}
function cap(s) {
  if (!s) return '';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function tierLabel(t) {
  return { A: 'Excellent — Tier A', B: 'Good — Tier B', C: 'Moderate — Tier C', D: 'At risk — Tier D' }[t] || 'Unscored';
}
function maskPhone(p) {
  if (!p) return '—';
  return p.length > 6 ? `${p.slice(0, 6)} *** ${p.slice(-4)}` : p;
}
function ageFromDob(dob) {
  if (!dob) return '—';
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age > 0 && age < 130 ? `${age}` : '—';
}

/* ===========================================================================
 * COOPERATIVE REPORT (kept intact)
 * =========================================================================== */
function CooperativeReport({ report, onBack }) {
  const navigate = useNavigate();
  const c = report.cooperative;
  const score = report.score;
  const trend = (report.scoreTrend || []).map((h, i) => ({ idx: i + 1, score: Number(h.final_score) }));

  return (
    <>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> Back
      </button>
      <PageHeader
        eyebrow="Cooperative credit report"
        title={c.name}
        description={[c.lga, c.state].filter(Boolean).join(', ')}
        actions={<Button variant="secondary" onClick={() => window.print()}><Download className="size-4" /> Print / PDF</Button>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Average score" value={score?.average_score?.toFixed(1) || '—'} sub={score?.cooperative_tier ? `Tier ${score.cooperative_tier}` : ''} tone="primary" />
        <MetricCard label="Total members" value={formatNumber(score?.total_farmers || 0)} />
        <MetricCard label="Scored members" value={formatNumber(score?.scored_farmers || 0)} />
        <MetricCard label="Tier D" value={formatNumber(score?.tier_d_count || 0)} sub="At-risk members" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <p className="eyebrow mb-1">Member distribution</p>
          <h3 className="font-display text-xl font-semibold mb-5">By tier</h3>
          <div className="space-y-2">
            {['A', 'B', 'C', 'D'].map((t) => (
              <div key={t} className="flex items-center justify-between text-sm">
                <TierPill tier={t} />
                <span className="tabular font-semibold">{formatNumber(score?.[`tier_${t.toLowerCase()}_count`] || 0)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <p className="eyebrow mb-1">Score history</p>
          <h3 className="font-display text-xl font-semibold mb-5">Member score average</h3>
          {trend.length === 0 ? (
            <p className="text-sm text-smoke py-12 text-center">No history yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend}>
                <XAxis dataKey="idx" tick={{ fontSize: 11, fill: '#6B7370' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B7370' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#2C6B47" strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
      <Card padded className="mb-6">
        <p className="eyebrow mb-1">Members</p>
        <h3 className="font-display text-xl font-semibold mb-1">Cooperative members</h3>
        <p className="text-sm text-smoke mb-4">Tap any member to open their full borrower profile.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60">
              <th className="py-2 px-3">Farmer</th><th className="py-2 px-3">Crop</th><th className="py-2 px-3">Farm size</th>
              <th className="py-2 px-3">NIN</th><th className="py-2 px-3">Tier</th><th className="py-2 px-3">Score</th><th className="py-2 px-3"></th>
            </tr></thead>
            <tbody>
              {(report.members || []).slice(0, 100).map((m) => {
                const s = Array.isArray(m.credit_scores) ? m.credit_scores[0] : m.credit_scores;
                const farm = Array.isArray(m.farm_profiles) ? m.farm_profiles[0] : m.farm_profiles;
                return (
                  <tr
                    key={m.id}
                    onClick={() => navigate(`/partner/reports/farmer/${m.id}`)}
                    className="border-b border-whisper/40 last:border-0 hover:bg-bone/50 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="size-8 rounded-full bg-forest-50 grid place-items-center text-forest-700 text-[11px] font-semibold">
                          {initials(m.full_name)}
                        </div>
                        <div>
                          <div className="font-medium text-ink">{m.full_name}</div>
                          <div className="text-[11px] text-smoke capitalize">{m.gender || ''}{m.lga ? ` · ${m.lga}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 capitalize">{farm?.crop_type || '—'}</td>
                    <td className="py-2.5 px-3">{farm?.farm_size_acres ? `${farm.farm_size_acres} ac` : '—'}</td>
                    <td className="py-2.5 px-3"><StatusPill status={m.nin_verification_status || 'pending'} /></td>
                    <td className="py-2.5 px-3"><TierPill tier={s?.credit_tier} /></td>
                    <td className="py-2.5 px-3 tabular font-semibold">{s?.final_credit_score != null ? Number(s.final_credit_score).toFixed(0) : '—'}</td>
                    <td className="py-2.5 px-3 text-right"><ChevronRight className="size-4 text-smoke inline" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
