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

export default function BenchmarksPage() {
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-benchmarks', page],
    queryFn: () => api.raw.get('/admin/benchmarks', { params: { page, pageSize: 25 } }).then((r) => r.data),
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
          { key: 'benchmark_yield_tonnes_per_hectare', label: 'Benchmark (t/ha)', align: 'right', render: (r) => Number(r.benchmark_yield_tonnes_per_hectare).toFixed(2) },
          { key: 'source', label: 'Source', render: (r) => <span className="text-smoke text-xs">{r.source || 'extension'}</span> },
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}

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
  });

  function submit(e) {
    e.preventDefault();
    mutate.mutate({
      ...form,
      benchmarkYieldTonnesPerHectare: Number(form.benchmarkYieldTonnesPerHectare),
      lga: form.lga || undefined,
      season: form.season || undefined,
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
          <Button onClick={submit} loading={mutate.isPending}>Save</Button>
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
