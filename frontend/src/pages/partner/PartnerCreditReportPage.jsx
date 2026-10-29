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
import { formatNaira, formatDate, formatNumber, formatScore, initials, sumAmounts } from '@/lib/utils';

const TONNE_KG = 1000;

// Canonical value -> label maps, kept in step with the field app's
// mobile/src/core/api/domainConstants.ts so a farmer's soil type reads the same
// in the dashboard as in the app that captured it. The API returns the stored
// value (snake_case); an unknown value falls through to `cap()` rather than
// being replaced with an invented label, because soil_type and water_source are
// free TEXT server-side (the validator accepts any label so a slightly
// different option never 422s a farmer onboarding).
const SOIL_LABELS = {
  sandy: 'Sandy',
  lateritic_red_brown: 'Lateritic (Red/Brown)',
  forest: 'Forest',
  alluvial: 'Alluvial',
  hydromorphic_fadama: 'Hydromorphic (Fadama)',
};
const WATER_LABELS = {
  rain_fed: 'Rain-fed',
  river_stream: 'River / Stream',
  well: 'Well',
  borehole: 'Borehole',
  artificial_irrigation: 'Irrigation Canal',
  dam_reservoir: 'Dam / Reservoir',
  pond: 'Pond',
  other: 'Other',
};
const PRICE_CONTEXT_LABELS = {
  distress: 'Distress',
  market: 'Market',
  confirmed: 'Confirmed',
  pre_agreed: 'Pre-agreed',
};

export default function PartnerCreditReportPage({ type }) {
  const params = useParams();
  const navigate = useNavigate();
  const id = type === 'farmer' ? params.farmerId : params.cooperativeId;

  const { data: report, isLoading, isError, error } = useQuery({
    queryKey: ['partner-report', type, id],
    queryFn: () => api.get(`/partner/credit/${type === 'farmer' ? 'farmers' : 'cooperatives'}/${id}/report`),
    enabled: !!id,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  // FIXED — a load failure rendered a bare "Report not available." with no
  // reason and no way back, and the farmer branch then dereferenced
  // report.subject on a partial response.
  const missing = type === 'farmer' ? !report?.subject : !report?.cooperative;
  if (isError || missing) {
    return (
      <Card padded>
        <p className="py-10 text-center text-smoke">
          {isError
            ? `Could not load this credit report${error?.message ? `: ${error.message}` : ''}.`
            : 'This credit report is not available to your organization.'}
        </p>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </Card>
    );
  }

  return type === 'farmer'
    ? <FarmerProfile report={report} onBack={() => navigate(-1)} />
    : <CooperativeReport report={report} onBack={() => navigate(-1)} />;
}

/* ===========================================================================
 * FARMER PROFILE — rich, tabbed (design: Heabron_FarmerProfile_DesignFlow)
 * =========================================================================== */
export function FarmerProfile({ report, onBack, extraActions, backLabel = 'All farmers' }) {
  const f = report?.subject || {};
  const farm = Array.isArray(f.farm_profiles) ? f.farm_profiles[0] : f.farm_profiles;
  const score = report?.score || {};
  const tier = score.credit_tier;

  const loans = Array.isArray(report?.financingHistory) ? report.financingHistory : [];
  // FIXED — repaymentHistory already excludes voided rows server-side, but the
  // filter is cheap and makes the intent explicit if that ever changes.
  const repayments = (Array.isArray(report?.repaymentHistory) ? report.repaymentHistory : []).filter((r) => !r.voided);

  const finishedLoans = loans.filter((l) => ['disbursed', 'completed'].includes(l.status));
  // FIXED — money was summed with float addition over NUMERIC(12,2) values,
  // which drifts (e.g. 150000.00000000003). sumAmounts accumulates in kobo.
  const totalDisbursed = sumAmounts(loans, 'disbursed_amount');
  const totalRepaid = sumAmounts(repayments, 'amount_paid');
  const repaymentRate = totalDisbursed > 0 ? Math.round((totalRepaid / totalDisbursed) * 100) : null;

  const [tab, setTab] = useState('cycles');

  return (
    <>
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> {backLabel}
      </button>

      <PageHeader
        eyebrow="Borrower profile"
        title={f.full_name || 'Farmer'}
        description={[f.cooperatives?.name || 'Independent', [f.lga, f.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
        actions={<>{extraActions}<Button variant="secondary" className="no-print" onClick={() => window.print()}><Download className="size-4" /> Export PDF</Button></>}
      />

      {(report?.riskFlags?.length || 0) > 0 && (
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
              {/* bvn_verification_status defaults to 'pending' for every
                  farmer, so this row claimed "Pending" even when no BVN was
                  ever collected. Show whether one is on file first. */}
              <Row
                label="BVN linked"
                value={
                  f.bvn
                    ? <VerifyMark ok={f.bvn_verification_status === 'verified'} pending={f.bvn_verification_status === 'pending'} label="Linked" />
                    : <span className="text-smoke">Not provided</span>
                }
              />
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
              <Row label="Total acreage" value={farm?.farm_size_acres ? `${formatScore(farm.farm_size_acres, 2)} acres` : '—'} />
              <Row label="Primary crop" value={cap(farm?.crop_type) || cap(f.cooperatives?.primary_crop)} />
              <Row label="Secondary crops" value={(farm?.secondary_crops || []).map(cap).join(', ') || '—'} />
              <Row label="GPS mapped" value={<VerifyMark ok={!!farm?.gps_mapped} label="Mapped" />} />
              <Row label="Plot count" value={farm?.plot_count ? `${farm.plot_count} plot${farm.plot_count > 1 ? 's' : ''}` : '—'} />
              {/* FIXED — printed the stored value verbatim, so
                  'hydromorphic_fadama' / 'rain_fed' leaked to the screen.
                  Mapped value -> label, falling back to a title-cased value
                  because these two columns are free text server-side. */}
              <Row label="Soil type" value={SOIL_LABELS[farm?.soil_type] || cap(farm?.soil_type)} />
              <Row label="Water source" value={WATER_LABELS[farm?.water_source] || cap(farm?.water_source)} />
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
              <QualityChip ok={(Array.isArray(report?.seasonalProductions) ? report.seasonalProductions : []).some((p) => p.verification_status === 'verified')} label="Yield verified" />
              <QualityChip ok={finishedLoans.length > 0} label={`${finishedLoans.length} cycles done`} />
              <span className="pill-neutral text-[11px]">Updated: {formatDate(f.updated_at)}</span>
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
                <button type="button"
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
              {tab === 'cycles' && <CyclesTab loans={loans} repayments={repayments} />}
              {tab === 'yield' && <YieldTab productions={Array.isArray(report?.seasonalProductions) ? report.seasonalProductions : []} />}
              {tab === 'market' && <MarketTab records={Array.isArray(report?.marketAccess) ? report.marketAccess : []} />}
              {tab === 'notes' && <NotesTab notes={Array.isArray(report?.fieldNotes) ? report.fieldNotes : []} />}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ---------- score card (Yield 60 / Repayment 40) ---------- */
function CreditScoreCard({ score = {} }) {
  // FIXED — an unscored farmer has no credit_scores row at all, so this card
  // drew a confident "0 out of 100" ring. Distinguish "no score yet" from a
  // genuine zero.
  const hasScore = score.final_credit_score != null && Number.isFinite(Number(score.final_credit_score));
  const final = Number(score.final_credit_score || 0);
  const yieldPts = Number(score.production_score || 0);
  const repayPts = Number(score.repayment_score || 0);
  const pct = Math.max(0, Math.min(final, 100));
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
              <div className="font-display text-2xl font-bold text-forest-700 leading-none">{hasScore ? final.toFixed(0) : '—'}</div>
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
        {hasScore ? tierLabel(score.credit_tier) : 'Not yet scored'}{score.is_first_cycle ? ' · First cycle' : ''}
      </p>
    </Card>
  );
}

function FinancingSummaryCard({ totalDisbursed, totalRepaid, repaymentRate, cyclesCompleted, score = {} }) {
  return (
    <Card>
      <p className="eyebrow mb-1">Financing summary</p>
      <div className="grid grid-cols-2 gap-3 mt-2">
        <StatBox label="Total disbursed" value={formatNaira(totalDisbursed)} />
        <StatBox label="Total repaid" value={formatNaira(totalRepaid)} />
        <StatBox label="Repayment rate" value={repaymentRate != null ? `${repaymentRate}%` : '—'} tone={repaymentRate === 100 ? 'green' : 'default'} />
        <StatBox label="Cycles completed" value={formatNumber(cyclesCompleted)} />
      </div>
      {Number(score.recommended_loan_max || 0) > 0 && (
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
function CyclesTab({ loans = [], repayments = [] }) {
  if (loans.length === 0) return <Empty>No financing cycles yet.</Empty>;
  // Sum in integer kobo so repeated additions of NUMERIC(12,2) don't drift.
  const repaidByLoan = repayments.reduce((m, r) => {
    const kobo = Math.round((Number(r.amount_paid) || 0) * 100);
    m[r.financing_request_id] = (m[r.financing_request_id] || 0) + kobo;
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
            const repaid = (repaidByLoan[l.id] || 0) / 100;
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

function YieldTab({ productions = [] }) {
  if (productions.length === 0) return <Empty>No seasonal yield records yet.</Empty>;
  const withYield = productions.filter((p) => p.actual_yield_tonnes != null);
  // FIXED — `Math.max(...list, 1)` spread an unbounded array (a farmer with
  // hundreds of seasons can blow the argument limit) and a NaN entry poisoned
  // the max, making every bar width NaN%. Reduce and filter instead.
  const maxKg = withYield.reduce((max, p) => {
    const kg = Number(p.actual_yield_tonnes) * TONNE_KG;
    return Number.isFinite(kg) && kg > max ? kg : max;
  }, 1);
  const avgAch = withYield.length
    ? (withYield.reduce((s, p) => s + (Number(p.yield_achievement_rate) || 0), 0) / withYield.length) * 100
    : null;
  // The API orders seasons newest-first (expected_harvest_date desc), so the
  // "latest season" is the FIRST row, not the last.
  const latest = productions[0];
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
                  <div className="h-full bg-forest-500" style={{ width: `${Math.max(0, Math.min(100, (kg / maxKg) * 100))}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl bg-bone/70 p-3 text-sm space-y-1">
          <KV label="Seasons reported" value={withYield.length} />
          <KV label="Avg achievement" value={avgAch != null ? `${avgAch.toFixed(0)}%` : '—'} tone={avgAch != null && avgAch >= 90 ? 'green' : 'default'} />
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
            <Row label="Est. farm income" value={latest.estimated_farm_income != null ? formatNaira(latest.estimated_farm_income) : '—'} />
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

function MarketTab({ records = [] }) {
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
              <td className="py-2.5 pr-4">{m.buyer_name || '—'}</td>
              <td className="py-2.5 pr-4 font-semibold">{m.price_per_ton != null ? formatNaira(m.price_per_ton) : '—'}</td>
              {/* FIXED — printed the raw enum, and only replaced the first
                  underscore ('pre_agreed' -> 'pre agreed'). */}
              <td className="py-2.5 pr-4 text-smoke">{PRICE_CONTEXT_LABELS[m.price_context] || cap(m.price_context) || '—'}</td>
              <td className="py-2.5 pr-4">{m.is_confirmed ? <span className="text-forest-600 font-medium">✓ Yes</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotesTab({ notes = [] }) {
  if (notes.length === 0) return <Empty>No field notes yet.</Empty>;
  return (
    <ol className="relative border-l-2 border-whisper/70 ml-2 space-y-5">
      {notes.map((n) => (
        <li key={n.id} className="ml-5 relative">
          {/* FIXED — these used bg-gold-500 / bg-gold-50 / text-gold-700, but
              there is no `gold` colour in tailwind.config.js (the accent scale
              is `harvest`). Tailwind emitted nothing for them, so an "amber"
              field note rendered with no dot colour and an unstyled tag.
              field_notes.tag_variant is 'green' | 'amber' | 'neutral'. */}
          <span className={`absolute -left-[27px] top-1 size-3 rounded-full ${
            n.tag_variant === 'amber' ? 'bg-harvest-400' : n.tag_variant === 'neutral' ? 'bg-smoke' : 'bg-forest-500'
          }`} />
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-ink text-sm">{n.title || cap(n.note_type)}</p>
            {n.tag_label && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                n.tag_variant === 'amber' ? 'bg-harvest-50 text-harvest-700'
                  : n.tag_variant === 'neutral' ? 'bg-bone text-smoke'
                  : 'bg-forest-50 text-forest-700'
              }`}>{n.tag_label}</span>
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
      {/* FIXED — printed a hard "0" for a missing sub-score, which reads as a
          real zero rather than "no data". */}
      <div className="font-semibold text-ink text-sm tabular">{formatScore(value, 0)}</div>
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
  if (pending) return <span className="text-harvest-700 inline-flex items-center gap-1"><Clock className="size-3.5" /> Pending</span>;
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
  if (s === null || s === undefined || s === '') return '';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function tierLabel(t) {
  return { A: 'Excellent — Tier A', B: 'Good — Tier B', C: 'Moderate — Tier C', D: 'At risk — Tier D' }[t] || 'Unscored';
}
function maskPhone(p) {
  // FIXED — assumed a string; a numeric phone from an import threw on .slice.
  if (!p) return '—';
  const s = String(p);
  return s.length > 6 ? `${s.slice(0, 6)} *** ${s.slice(-4)}` : s;
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
  const c = report?.cooperative || {};
  const score = report?.score;
  const members = Array.isArray(report?.members) ? report.members : [];
  // Drop non-numeric points — a null final_score produced a NaN datum that
  // silently broke the whole recharts line.
  const trend = (Array.isArray(report?.scoreTrend) ? report.scoreTrend : [])
    .map((h, i) => ({ idx: i + 1, score: Number(h.final_score) }))
    .filter((p) => Number.isFinite(p.score));

  return (
    <>
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> Back
      </button>
      <PageHeader
        eyebrow="Cooperative credit report"
        title={c.name || 'Cooperative'}
        description={[c.lga, c.state].filter(Boolean).join(', ')}
        actions={<Button variant="secondary" className="no-print" onClick={() => window.print()}><Download className="size-4" /> Print / PDF</Button>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* FIXED — `score.average_score.toFixed(1)` threw when Postgres
            returned the NUMERIC as a string, and `|| '—'` turned a real 0 into
            an em-dash. */}
        <MetricCard label="Average score" value={formatScore(score?.average_score)} sub={score?.cooperative_tier ? `Tier ${score.cooperative_tier}` : 'Unscored'} tone="primary" />
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
        <p className="text-sm text-smoke mb-4">
          {members.length === 0
            ? 'No farmers are registered to this cooperative yet.'
            : `${formatNumber(members.length)} member${members.length === 1 ? '' : 's'} — select any row to open their full borrower profile.`}
          {members.length > 100 && ' Showing the first 100.'}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60">
              <th className="py-2 px-3">Farmer</th><th className="py-2 px-3">Crop</th><th className="py-2 px-3">Farm size</th>
              <th className="py-2 px-3">NIN</th><th className="py-2 px-3">Tier</th><th className="py-2 px-3">Score</th><th className="py-2 px-3"></th>
            </tr></thead>
            <tbody>
              {members.slice(0, 100).map((m) => {
                const s = Array.isArray(m.credit_scores) ? m.credit_scores[0] : m.credit_scores;
                const farm = Array.isArray(m.farm_profiles) ? m.farm_profiles[0] : m.farm_profiles;
                return (
                  <tr
                    key={m.id}
                    onClick={() => navigate(`/partner/reports/farmer/${m.id}`)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/partner/reports/farmer/${m.id}`); }
                    }}
                    className="border-b border-whisper/40 last:border-0 hover:bg-bone/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-bone"
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
                    <td className="py-2.5 px-3">{farm?.farm_size_acres ? `${formatScore(farm.farm_size_acres, 2)} ac` : '—'}</td>
                    <td className="py-2.5 px-3"><StatusPill status={m.nin_verification_status || 'pending'} /></td>
                    <td className="py-2.5 px-3"><TierPill tier={s?.credit_tier} /></td>
                    <td className="py-2.5 px-3 tabular font-semibold">{formatScore(s?.final_credit_score, 0)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <ChevronRight className="size-4 text-smoke inline" aria-hidden="true" />
                      <span className="sr-only">Open borrower profile</span>
                    </td>
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
