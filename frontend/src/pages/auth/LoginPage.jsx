import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, X, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth, ADMIN_ROLES, PARTNER_ROLES } from '@/lib/auth';
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
        {/* FIXED — the sign-in hero hot-linked an Unsplash stock photo, so the
            login screen made a third-party request before authentication and
            showed a bare gradient band whenever that CDN was unreachable (and
            the image carried no licence record). Brand gradient instead. */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(135deg, #1B4029 0%, #235638 35%, #2C6B47 62%, #B98724 115%)',
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
      const data = await login(email.trim(), password);
      if (data?.user?.mustChangePassword) {
        navigate('/change-password');
        return;
      }
      // FIXED — role was only tested with startsWith('partner'), so any role
      // that is neither admin nor partner (a field_agent signing in to the web
      // dashboard, or a user with no role row) was sent to /admin and bounced
      // back and forth. Route explicitly and let App's guards show the
      // no-access screen for anything else.
      const role = data?.user?.role;
      const dest = PARTNER_ROLES.includes(role) ? '/partner' : ADMIN_ROLES.includes(role) ? '/admin' : '/';
      // Only honour a redirect that stays inside the portal the role can use.
      const from = location.state?.from?.pathname;
      const allowed = typeof from === 'string' && from.startsWith(dest) ? from : dest;
      navigate(allowed, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Sign in failed');
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
            {/* This Input sits inside a wrapper div, so Field can't label it
                automatically — give it an explicit accessible name. */}
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              aria-label="Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
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
    // FIXED — for a one- or two-character local part `slice(0,1)+…+slice(-2)`
    // echoed the whole thing back, defeating the mask.
    if (!e || typeof e !== 'string' || !e.includes('@')) return e || '';
    const at = e.lastIndexOf('@');
    const name = e.slice(0, at);
    const domain = e.slice(at + 1);
    if (name.length <= 3) return `${name[0] || ''}*****@${domain}`;
    return `${name.slice(0, 1)}*****${name.slice(-2)}@${domain}`;
  }

  async function sendLink() {
    const addr = email.trim();
    // FIXED — only checked for a non-empty string, so a typo'd address 422'd
    // with an unreadable validation error.
    if (!/\S+@\S+\.\S+/.test(addr)) return toast.error('Enter a valid email address');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email: addr });
      toast.success('Reset code sent');
      navigate('/forgot-password', { state: { email: addr, step: 2 } });
    } catch {
      /* api interceptor toasts the error */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 animate-fade-in">
      <div role="dialog" aria-modal="true" aria-labelledby="reset-pw-title" className="w-full max-w-sm bg-white rounded-2xl shadow-elev p-7 relative">
        <button type="button" onClick={onClose} aria-label="Close dialog" className="absolute right-4 top-4 text-smoke hover:text-ink">
          <X className="size-5" />
        </button>

        <div className="size-14 rounded-full bg-forest-50 flex items-center justify-center mx-auto mb-4">
          <KeyRound className="size-6 text-forest-500" />
        </div>
        <h3 id="reset-pw-title" className="font-display text-xl font-semibold text-center text-ink">Reset Your password?</h3>

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

        {/* The endpoint sends a 6-digit code, not a link. */}
        <Button onClick={sendLink} loading={busy} className="w-full mt-6">
          Send code
        </Button>
      </div>
    </div>
  );
}
