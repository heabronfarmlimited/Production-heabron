import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, X, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';

/** Shared split-screen auth layout: green hero on the left, content on the right. */
export function AuthLayout({ children }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Left — green hero */}
      <div className="relative hidden lg:flex flex-col justify-end overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(135deg, rgba(27,64,41,0.92), rgba(44,107,71,0.78) 55%, rgba(224,168,46,0.55)), url('https://images.unsplash.com/photo-1625246333195-78d9c38ad449?q=80&w=1200&auto=format&fit=crop')",
          }}
        />
        <svg className="absolute inset-0 size-full text-white/5" preserveAspectRatio="none" viewBox="0 0 100 100">
          <defs>
            <pattern id="auth-dots" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.4" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#auth-dots)" />
        </svg>
        <div className="relative z-10 p-12 text-white">
          <h1 className="font-display text-5xl xl:text-6xl font-semibold leading-[1.04]">
            CoopScore<br />Partners
          </h1>
          <p className="mt-6 text-white/85 max-w-md text-base leading-relaxed">
            Join a trusted agricultural financing network that connects partners with verified
            farmers and high-potential crop projects. Track investments, monitor impact, and
            support food security while generating long-term value.
          </p>
        </div>
      </div>

      {/* Right — content */}
      <div className="flex items-center justify-center px-6 py-12 md:px-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 mb-8">
      <img src={BRAND.logoUrl} alt={BRAND.name} className="size-9 object-contain" />
      <div>
        <p className="font-display text-lg font-semibold leading-none text-ink">CoopScore</p>
        <p className="text-[10px] uppercase tracking-[0.2em] text-smoke mt-0.5">by Heabron</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await login(email, password);
      if (data.user?.mustChangePassword) {
        navigate('/change-password');
        return;
      }
      const dest = data.user?.role?.startsWith('partner') ? '/partner' : '/admin';
      navigate(location.state?.from?.pathname || dest);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <BrandMark />

      <h2 className="font-display text-3xl font-semibold text-ink">Hello! Welcome</h2>
      <p className="text-smoke mt-1.5 mb-8">Sign in to access your dashboard</p>

      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Email" required>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@organization.com"
          />
        </Field>

        <Field label="Password" required>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-smoke hover:text-ink"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="text-sm text-forest-500 hover:text-forest-700 font-medium"
          >
            Reset Password
          </button>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
            {error}
          </div>
        )}

        <Button type="submit" loading={submitting} className="w-full">
          Sign In <ArrowRight className="size-4" />
        </Button>

        <p className="text-center text-sm text-smoke pt-2">
          Need partner access?{' '}
          <a href={`mailto:${BRAND.supportEmail}`} className="text-forest-600 font-medium hover:text-forest-700">
            Contact your administrator
          </a>
        </p>
      </form>

      {resetOpen && <ResetPasswordModal email={email} onClose={() => setResetOpen(false)} />}
    </AuthLayout>
  );
}

/**
 * "Reset Your password?" modal (matches the mockup). Sends a 6-digit code to
 * the partner's email, then routes to the verify screen.
 */
function ResetPasswordModal({ email: initialEmail, onClose }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState(initialEmail || '');
  const [busy, setBusy] = useState(false);

  function maskEmail(e) {
    if (!e || !e.includes('@')) return e;
    const [name, domain] = e.split('@');
    const shown = name.slice(0, 1) + '*****' + name.slice(-2);
    return `${shown}@${domain}`;
  }

  async function sendLink() {
    if (!email) return toast.error('Enter your email first');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      toast.success('Reset code sent');
      navigate('/forgot-password', { state: { email, step: 2 } });
    } catch {
      /* api interceptor toasts the error */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 animate-fade-in">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-elev p-7 relative">
        <button onClick={onClose} className="absolute right-4 top-4 text-smoke hover:text-ink">
          <X className="size-5" />
        </button>

        <div className="size-14 rounded-full bg-forest-50 flex items-center justify-center mx-auto mb-4">
          <KeyRound className="size-6 text-forest-500" />
        </div>
        <h3 className="font-display text-xl font-semibold text-center text-ink">Reset Your password?</h3>

        {initialEmail ? (
          <p className="text-sm text-smoke text-center mt-1.5">
            Send a code to {maskEmail(email)}
          </p>
        ) : (
          <div className="mt-4">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organization.com" />
            </Field>
          </div>
        )}

        <Button onClick={sendLink} loading={busy} className="w-full mt-6">
          Send link
        </Button>
      </div>
    </div>
  );
}
