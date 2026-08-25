import { useState } from 'react';
import { Upload, X, Loader2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

/**
 * Reusable image/PDF uploader. Uploads to the given backend kind endpoint
 * (e.g. /admin/uploads/payment_proof) and returns public URLs.
 *
 * Props:
 *   value     : string[]   current URLs
 *   onChange  : (urls)=>void
 *   endpoint  : string     e.g. '/admin/uploads/payment_proof'  (kind in the path)
 *   multiple  : bool        allow several files (default true)
 *   label     : string
 *   accept    : string     default 'image/*,application/pdf'
 */
export function ImageUpload({ value = [], onChange, endpoint, multiple = true, label = 'Upload proof', accept = 'image/*,application/pdf' }) {
  const [busy, setBusy] = useState(false);

  async function handleFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true);
    try {
      const urls = [];
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await api.raw.post(endpoint, fd);
        const url = data?.data?.url;
        if (url) urls.push(url);
      }
      onChange(multiple ? [...value, ...urls] : urls.slice(0, 1));
      if (urls.length) toast.success(`${urls.length} file${urls.length > 1 ? 's' : ''} uploaded`);
    } catch (e) {
      toast.error(e.response?.data?.error?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  function isPdf(url) { return /\.pdf($|\?)/i.test(url); }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {value.map((url, i) => (
          <div key={i} className="relative size-20 rounded-xl overflow-hidden border border-whisper bg-bone group">
            {isPdf(url) ? (
              <a href={url} target="_blank" rel="noreferrer" className="size-full flex flex-col items-center justify-center text-smoke">
                <FileText className="size-6" />
                <span className="text-[10px] mt-1">PDF</span>
              </a>
            ) : (
              <a href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={`proof ${i + 1}`} className="size-full object-cover" />
              </a>
            )}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute top-0.5 right-0.5 size-5 rounded-full bg-ink/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}

        {(multiple || value.length === 0) && (
          <label className="size-20 rounded-xl border-2 border-dashed border-whisper hover:border-forest-400 flex flex-col items-center justify-center cursor-pointer text-smoke hover:text-forest-600 transition">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
            <span className="text-[10px] mt-1">{busy ? 'Uploading' : label}</span>
            <input type="file" accept={accept} multiple={multiple} className="hidden" disabled={busy}
              onChange={(e) => handleFiles(e.target.files)} />
          </label>
        )}
      </div>
    </div>
  );
}
