import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, BarChart3 } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Input';
import toast from 'react-hot-toast';
import { formatScore } from '@/lib/utils';

export default function BenchmarksPage() {
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const qc = useQueryClient();

  // FIXED — api.raw bypass replaced with the list helper (keeps `meta`).
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-benchmarks', page],
    queryFn: () => api.list('/admin/benchmarks', { params: { page, pageSize: 25 } }),
  });

  const rows = data?.data || [];
  const meta = data?.meta;

  return (
    <>
      <PageHeader
        eyebrow="Calibration"
        title="Regional Yield Benchmarks"
        description="Locally-calibrated yield targets feed directly into the Production Score component of every farmer's credit score."
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="size-4" /> Add benchmark
          </Button>
        }
      />

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">Could not load benchmarks{error?.message ? `: ${error.message}` : ''}.</p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        empty={
          <EmptyState
            icon={BarChart3}
            title="No benchmarks yet"
            description="Add benchmarks for each crop in each state so the credit engine can calculate accurate production scores."
            action={<Button onClick={() => setModalOpen(true)}>Add the first benchmark</Button>}
          />
        }
        columns={[
          { key: 'crop', label: 'Crop', render: (r) => <span className="capitalize font-semibold">{r.crop}</span> },
          { key: 'state', label: 'State' },
          { key: 'lga', label: 'LGA', render: (r) => r.lga || '—' },
          { key: 'season', label: 'Season', render: (r) => r.season || 'All' },
          // FIXED — Number(null).toFixed(2) printed "NaN".
          { key: 'benchmark_yield_tonnes_per_hectare', label: 'Benchmark (t/ha)', align: 'right', render: (r) => formatScore(r.benchmark_yield_tonnes_per_hectare, 2) },
          { key: 'source', label: 'Source', render: (r) => <span className="text-smoke text-xs">{r.source || 'extension'}</span> },
        ]}
        rows={rows}
      />
      <Pagination page={meta?.page || page} pageSize={meta?.pageSize || 25} total={meta?.total || 0} onPageChange={setPage} />

      <BenchmarkModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['admin-benchmarks'] });
          setModalOpen(false);
        }}
      />
    </>
  );
}

function BenchmarkModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState({
    crop: '',
    state: '',
    lga: '',
    season: '',
    benchmarkYieldTonnesPerHectare: '',
    source: 'extension',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const mutate = useMutation({
    mutationFn: (body) => api.post('/admin/benchmarks', body),
    onSuccess: () => {
      toast.success('Benchmark saved');
      onSaved();
      setForm({ crop: '', state: '', lga: '', season: '', benchmarkYieldTonnesPerHectare: '', source: 'extension' });
    },
    // FIXED — no error handler, so a rejected upsert (e.g. a duplicate
    // crop/state/lga/season key) left the modal open with no explanation.
    onError: (e) => toast.error(e?.response?.data?.error?.message || e?.message || 'Could not save benchmark'),
  });

  const yieldValue = Number(form.benchmarkYieldTonnesPerHectare);
  const canSave = form.crop.trim() && form.state.trim() && Number.isFinite(yieldValue) && yieldValue > 0;

  function submit(e) {
    e?.preventDefault?.();
    // FIXED — the footer button submitted whatever was typed, so a blank crop
    // or a non-numeric benchmark produced a confusing server-side failure.
    if (!canSave) {
      toast.error('Crop, state and a positive benchmark yield are all required');
      return;
    }
    mutate.mutate({
      crop: form.crop.trim().toLowerCase(),
      state: form.state.trim(),
      benchmarkYieldTonnesPerHectare: yieldValue,
      lga: form.lga.trim() || undefined,
      // Season is free text on regional_benchmarks; 'wet' | 'dry' matches the
      // values the scoring engine looks up, and blank means "all seasons".
      season: form.season || undefined,
      source: form.source || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add benchmark"
      description="Crop × state × optional LGA + season. Existing rows are upserted."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={mutate.isPending} disabled={!canSave}>Save</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Crop" required>
            <Input value={form.crop} onChange={(e) => set('crop', e.target.value.toLowerCase())} placeholder="maize" required />
          </Field>
          <Field label="State" required>
            <Input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="Oyo" required />
          </Field>
          <Field label="LGA" hint="Optional — leave blank for state-wide">
            <Input value={form.lga} onChange={(e) => set('lga', e.target.value)} placeholder="Akinyele" />
          </Field>
          <Field label="Season">
            <Select value={form.season} onChange={(e) => set('season', e.target.value)}>
              <option value="">All seasons</option>
              <option value="wet">Wet</option>
              <option value="dry">Dry</option>
            </Select>
          </Field>
          <Field label="Benchmark yield (t/ha)" required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.benchmarkYieldTonnesPerHectare}
              onChange={(e) => set('benchmarkYieldTonnesPerHectare', e.target.value)}
              required
            />
          </Field>
          <Field label="Source">
            <Select value={form.source} onChange={(e) => set('source', e.target.value)}>
              <option value="extension">Extension</option>
              <option value="ifpri">IFPRI</option>
              <option value="iita">IITA</option>
              <option value="ministry">State Ministry</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
