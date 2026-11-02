import { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { downloadCsv, exportFilename, exportPayloadToCsv } from '@/lib/exportCsv';

/**
 * Downloads one of the admin export endpoints as a CSV.
 *
 * Fetched on click rather than with the page: an export is a few hundred rows
 * an admin wants occasionally, and loading it alongside every farmer detail
 * view would be a wasted query on every visit.
 */
export function ExportButton({ url, kind, label, title, variant = 'secondary', children }) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const payload = await api.get(url);
      const csv = exportPayloadToCsv(payload, { title: title || label });
      // An empty payload would download a file with a heading and nothing
      // else, which reads as a broken export rather than an empty one.
      if (!csv.trim()) {
        toast.error('There is nothing to export yet.');
        return;
      }
      downloadCsv(exportFilename(kind, label), csv);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err?.message || 'Could not build the export.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} loading={busy} onClick={run}>
      <Download className="size-4" /> {children || 'Export CSV'}
    </Button>
  );
}
