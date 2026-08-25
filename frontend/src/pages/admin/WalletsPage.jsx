import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Check, X, Send, ShieldCheck, Banknote, Image as ImageIcon } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, StatusPill } from '@/components/ui/Card';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Textarea, Select } from '@/components/ui/Input';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { formatNaira, relativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const TABS = [
  { id: 'settlements', label: 'Settlement Requests' },
  { id: 'disbursements', label: 'Disbursements to Agents' },
  { id: 'purchases', label: 'Purchase Proofs' },
  { id: 'wallets', label: 'Agent Wallets' },
];

export default function WalletsPage() {
  const [tab, setTab] = useState('settlements');
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Wallets & Manual Payments"
        description="Record manual transfers to agents, confirm purchase proofs, approve payouts, and monitor balances. (Manual flow until the live wallet ships.)"
      />
      <div className="flex items-center gap-1 border-b border-whisper/70 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap ${
              tab === t.id ? 'border-forest-500 text-forest-700' : 'border-transparent text-smoke hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'settlements' && <SettlementsTab />}
      {tab === 'disbursements' && <DisbursementsTab />}
      {tab === 'purchases' && <PurchaseProofsTab />}
      {tab === 'wallets' && <WalletsTab />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* SETTLEMENTS                                                         */
/* ------------------------------------------------------------------ */
function SettlementsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-settlements', status, page],
    queryFn: () => api.raw.get('/admin/settlements', { params: { status, page, pageSize: 25 } }).then((r) => r.data),
  });
  const rows = data?.data || [];
  const meta = data?.meta;

  return (
    <>
      <FilterPills options={['pending', 'approved', 'rejected']} value={status} onChange={(s) => { setStatus(s); setPage(1); }} />
      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={Wallet} title="No settlements" description={`No ${status} settlement requests right now.`} />}
        columns={[
          { key: 'agent', label: 'Agent', render: (r) => <AgentCell agent={r.agent} /> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{formatNaira(r.amount)}</span> },
          { key: 'bank_name', label: 'Bank' },
          { key: 'account_number', label: 'Account', render: (r) => <span className="font-mono text-xs">{r.account_number}</span> },
          { key: 'created_at', label: 'Requested', render: (r) => relativeTime(r.created_at) },
          { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          { key: 'actions', label: '', align: 'right', render: (r) => (
            r.status === 'pending' ? <Button variant="secondary" onClick={() => setSelected(r)}>Review</Button> : <span className="text-xs text-smoke">—</span>
          )},
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
      <DecideSettlementModal settlement={selected} onClose={() => setSelected(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['admin-settlements'] }); setSelected(null); }} />
    </>
  );
}

function DecideSettlementModal({ settlement, onClose, onSaved }) {
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState([]);

  const mutate = useMutation({
    mutationFn: ({ decision }) =>
      api.post(`/admin/settlements/${settlement.id}/decision`, {
        decision,
        adminNotes: notes,
        referenceNumber: reference || undefined,
        receiptImageUrl: proof[0] || undefined,
      }),
    onSuccess: () => { toast.success('Decision recorded'); onSaved(); setNotes(''); setReference(''); setProof([]); },
  });

  if (!settlement) return null;
  return (
    <Modal
      open onClose={onClose}
      title="Settlement decision"
      description={`${settlement.agent?.full_name || 'Agent'} — ${formatNaira(settlement.amount)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutate.isPending}>Cancel</Button>
          <Button variant="danger" loading={mutate.isPending && mutate.variables?.decision === 'reject'} onClick={() => mutate.mutate({ decision: 'reject' })}><X className="size-4" /> Reject</Button>
          <Button loading={mutate.isPending && mutate.variables?.decision === 'approve'} onClick={() => mutate.mutate({ decision: 'approve' })}><Check className="size-4" /> Approve & mark paid</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-bone rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-smoke">Bank</p><p className="font-medium">{settlement.bank_name}</p></div>
          <div><p className="text-xs text-smoke">Account number</p><p className="font-mono">{settlement.account_number}</p></div>
          <div className="col-span-2"><p className="text-xs text-smoke">Account name</p><p className="font-medium">{settlement.account_name}</p></div>
        </div>
        <Field label="Transfer reference" hint="Optional — bank/transaction reference for your records">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TXN93838383" />
        </Field>
        <Field label="Proof of payment" hint="Optional — receipt/screenshot the agent will see in their history">
          <ImageUpload value={proof} onChange={setProof} endpoint="/admin/uploads/transaction_receipt" multiple={false} />
        </Field>
        <Field label="Notes" hint="Optional — reason for rejection or extra context">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for rejection, or transfer note…" />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DISBURSEMENTS TO AGENTS                                             */
/* ------------------------------------------------------------------ */
function DisbursementsTab() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-disbursements', page],
    queryFn: () => api.raw.get('/admin/transactions', { params: { source: 'admin_disbursement', page, pageSize: 25 } }).then((r) => r.data),
  });
  const rows = data?.data || [];
  const meta = data?.meta;

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-smoke">Money you've manually transferred to field agents (with proof).</p>
        <Button onClick={() => setOpen(true)}><Banknote className="size-4" /> Record disbursement</Button>
      </div>
      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={Banknote} title="No disbursements yet" description="Record a transfer to a field agent to get started." />}
        columns={[
          { key: 'agent', label: 'Agent', render: (r) => <AgentCell agent={r.agent} /> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{formatNaira(r.amount)}</span> },
          { key: 'reference_number', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.reference_number || '—'}</span> },
          { key: 'created_at', label: 'Sent', render: (r) => relativeTime(r.created_at) },
          { key: 'proof', label: 'Proof', render: (r) => <ProofThumbs urls={proofList(r)} /> },
          { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
      {open && <RecordDisbursementModal onClose={() => setOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['admin-disbursements'] }); setOpen(false); }} />}
    </>
  );
}

function RecordDisbursementModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ agentId: '', amount: '', referenceNumber: '', paymentMethod: 'bank_transfer', description: '' });
  const [proof, setProof] = useState([]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // load agents for the picker
  const { data: agentsData } = useQuery({
    queryKey: ['admin-agents-active-picker'],
    queryFn: () => api.raw.get('/admin/agents', { params: { status: 'active', pageSize: 100 } }).then((r) => r.data?.data || []),
  });
  const agents = agentsData || [];

  const mutate = useMutation({
    mutationFn: () => api.post('/admin/disbursements', {
      agentId: form.agentId,
      amount: Number(form.amount),
      referenceNumber: form.referenceNumber || undefined,
      paymentMethod: form.paymentMethod,
      description: form.description || undefined,
      recipientName: agents.find((a) => a.user_id === form.agentId)?.full_name,
      receiptImageUrl: proof[0] || undefined,
      proofImageUrls: proof.length ? proof : undefined,
    }),
    onSuccess: () => { toast.success('Disbursement recorded — agent notified'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Failed'),
  });

  const canSave = form.agentId && Number(form.amount) > 0;

  return (
    <Modal
      open onClose={onClose}
      title="Record disbursement to agent"
      description="Logs a manual transfer and credits the agent's wallet. Attach the bank receipt as proof."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutate.isPending}>Cancel</Button>
          <Button disabled={!canSave} loading={mutate.isPending} onClick={() => mutate.mutate()}><Send className="size-4" /> Record & notify agent</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Field agent" required>
          <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)} required>
            <option value="">Select an agent…</option>
            {agents.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name} — {a.email}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₦)" required>
            <Input type="number" min="1" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="200000" />
          </Field>
          <Field label="Payment method">
            <Select value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile money</option>
            </Select>
          </Field>
        </div>
        <Field label="Reference number" hint="Optional — bank/transaction reference">
          <Input value={form.referenceNumber} onChange={(e) => set('referenceNumber', e.target.value)} placeholder="TXN93838383" />
        </Field>
        <Field label="Note" hint="Optional — what this transfer is for">
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Funds for Hansel Cooperative input purchases…" />
        </Field>
        <Field label="Proof of transfer" hint="Receipt/screenshot — shown in the agent's transaction history">
          <ImageUpload value={proof} onChange={setProof} endpoint="/admin/uploads/transaction_receipt" />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* PURCHASE PROOFS (agent -> farmer)                                   */
/* ------------------------------------------------------------------ */
function PurchaseProofsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-cash-purchases', status, page],
    queryFn: () => api.raw.get('/admin/cash-purchases', { params: { status, page, pageSize: 25 } }).then((r) => r.data),
  });
  const rows = data?.data || [];
  const meta = data?.meta;

  return (
    <>
      <p className="text-sm text-smoke mb-4">Field agents upload proof of what they purchased for farmers. Confirm or reject each one.</p>
      <FilterPills options={['pending', 'completed', 'failed']} value={status} onChange={(s) => { setStatus(s); setPage(1); }} />
      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={ShieldCheck} title="Nothing here" description={`No ${status} purchase proofs.`} />}
        columns={[
          { key: 'agent', label: 'Agent', render: (r) => <AgentCell agent={r.agent} /> },
          { key: 'recipient_name', label: 'For farmer', render: (r) => r.recipient_name || '—' },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{formatNaira(r.amount)}</span> },
          { key: 'description', label: 'Purchase', render: (r) => <span className="text-sm">{r.description || '—'}</span> },
          { key: 'proof', label: 'Proof', render: (r) => <ProofThumbs urls={proofList(r)} /> },
          { key: 'created_at', label: 'Submitted', render: (r) => relativeTime(r.created_at) },
          { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status === 'completed' ? 'approved' : r.status === 'failed' ? 'rejected' : 'pending'} /> },
          { key: 'actions', label: '', align: 'right', render: (r) => (
            r.status === 'pending' ? <Button variant="secondary" onClick={() => setSelected(r)}>Review</Button> : <span className="text-xs text-smoke">—</span>
          )},
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
      {selected && <ConfirmPurchaseModal purchase={selected} onClose={() => setSelected(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['admin-cash-purchases'] }); setSelected(null); }} />}
    </>
  );
}

function ConfirmPurchaseModal({ purchase, onClose, onSaved }) {
  const [notes, setNotes] = useState('');
  const mutate = useMutation({
    mutationFn: ({ decision }) => api.post(`/admin/cash-purchases/${purchase.id}/confirm`, { decision, adminNotes: notes || undefined }),
    onSuccess: () => { toast.success('Purchase updated — agent notified'); onSaved(); setNotes(''); },
  });
  const urls = proofList(purchase);

  return (
    <Modal
      open onClose={onClose}
      title="Confirm purchase proof"
      description={`${purchase.agent?.full_name || 'Agent'} — ${formatNaira(purchase.amount)} for ${purchase.recipient_name || 'farmer'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutate.isPending}>Cancel</Button>
          <Button variant="danger" loading={mutate.isPending && mutate.variables?.decision === 'reject'} onClick={() => mutate.mutate({ decision: 'reject' })}><X className="size-4" /> Reject</Button>
          <Button loading={mutate.isPending && mutate.variables?.decision === 'confirm'} onClick={() => mutate.mutate({ decision: 'confirm' })}><Check className="size-4" /> Confirm</Button>
        </>
      }
    >
      <div className="space-y-4">
        {purchase.description && (
          <div className="bg-bone rounded-xl p-4 text-sm"><p className="text-xs text-smoke mb-1">Purchase details</p><p>{purchase.description}</p></div>
        )}
        <div>
          <p className="text-xs text-smoke mb-2">Proof images</p>
          {urls.length ? (
            <div className="flex flex-wrap gap-2">
              {urls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer" className="size-24 rounded-lg overflow-hidden border border-whisper">
                  <img src={u} alt={`proof ${i + 1}`} className="size-full object-cover" />
                </a>
              ))}
            </div>
          ) : <p className="text-sm text-smoke flex items-center gap-1"><ImageIcon className="size-4" /> No images attached</p>}
        </div>
        <Field label="Note" hint="Optional — reason if rejecting">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Looks good / receipt unclear, please re-upload…" />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* AGENT WALLETS                                                       */
/* ------------------------------------------------------------------ */
function WalletsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-wallets', page],
    queryFn: () => api.raw.get('/admin/wallets', { params: { page, pageSize: 25 } }).then((r) => r.data),
  });
  const rows = data?.data || [];
  const meta = data?.meta;

  return (
    <>
      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={Wallet} title="No agent wallets" />}
        columns={[
          { key: 'agent', label: 'Agent', render: (r) => <AgentCell agent={r.agent} /> },
          { key: 'balance', label: 'Balance', align: 'right', render: (r) => <span className="font-display text-lg font-semibold">{formatNaira(r.balance)}</span> },
          { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          { key: 'updated_at', label: 'Last activity', render: (r) => relativeTime(r.updated_at) },
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */
function FilterPills({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {options.map((s) => (
        <button key={s} onClick={() => onChange(s)}
          className={`px-3 py-1.5 rounded-lg text-sm capitalize ${value === s ? 'bg-forest-500 text-white' : 'bg-white text-smoke hover:bg-bone'}`}>
          {s}
        </button>
      ))}
    </div>
  );
}

function AgentCell({ agent }) {
  return (
    <div>
      <p className="font-medium">{agent?.full_name || 'Unknown agent'}</p>
      <p className="text-xs text-smoke">{agent?.email || ''}</p>
    </div>
  );
}

function ProofThumbs({ urls }) {
  if (!urls?.length) return <span className="text-xs text-smoke">—</span>;
  return (
    <div className="flex -space-x-2">
      {urls.slice(0, 3).map((u, i) => (
        <a key={i} href={u} target="_blank" rel="noreferrer" className="size-8 rounded-md overflow-hidden border-2 border-white bg-bone">
          <img src={u} alt="proof" className="size-full object-cover" />
        </a>
      ))}
      {urls.length > 3 && <span className="size-8 rounded-md bg-bone border-2 border-white flex items-center justify-center text-[10px] text-smoke">+{urls.length - 3}</span>}
    </div>
  );
}

function proofList(r) {
  const arr = [];
  if (r.receipt_image_url) arr.push(r.receipt_image_url);
  if (Array.isArray(r.proof_image_urls)) arr.push(...r.proof_image_urls);
  return [...new Set(arr)];
}
