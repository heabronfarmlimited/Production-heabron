import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { Card, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FarmerProfile } from '@/pages/partner/PartnerCreditReportPage';

export default function FarmerDetailPage() {
  const { farmerId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: report, isLoading } = useQuery({
    queryKey: ['admin-farmer-report', farmerId],
    queryFn: () => api.get(`/admin/credit/farmers/${farmerId}/report`),
  });

  const recalc = useMutation({
    mutationFn: () => api.post(`/admin/credit/farmers/${farmerId}/recalculate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-farmer-report', farmerId] }),
  });

  if (isLoading) return <Skeleton className="h-72" />;
  if (!report) return <Card padded><p className="py-12 text-center">Farmer not found.</p></Card>;

  return (
    <FarmerProfile
      report={report}
      backLabel="All farmers"
      onBack={() => navigate('/admin/farmers')}
      extraActions={
        <Button variant="secondary" onClick={() => recalc.mutate()} disabled={recalc.isPending}>
          <RefreshCw className={`size-4 ${recalc.isPending ? 'animate-spin' : ''}`} /> Recalculate
        </Button>
      }
    />
  );
}
