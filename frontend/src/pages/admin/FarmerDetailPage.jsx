import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Card, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
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

  return (
    <FarmerProfile
      report={report}
      backLabel="All farmers"
      onBack={() => navigate('/admin/farmers')}
      extraActions={
        <Button variant="secondary" onClick={() => recalc.mutate()} disabled={recalc.isPending} className="no-print">
          <RefreshCw className={`size-4 ${recalc.isPending ? 'animate-spin' : ''}`} /> Recalculate
        </Button>
      }
    />
  );
}
