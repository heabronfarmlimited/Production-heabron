import { useEffect, useRef, useState } from 'react';
// FIXED — useNavigate was imported but never used on this page.
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { AuthLayout, BrandMark } from './LoginPage';

/** 6-box OTP input matching the mockup. */
function CodeInput({ value, onChange }) {
  const refs = useRef([]);
  const digits = value.padEnd(6).split('').slice(0, 6);

  function setDigit(i, d) {
    const next = value.split('');
    next[i] = d.replace(/\D/g, '').slice(-1) || '';
    const joined = next.join('').slice(0, 6);
    onChange(joined);
    if (d && i < 5) refs.current[i + 1]?.focus();
  }

  function onKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i].trim() && i > 0) refs.current[i - 1]?.focus();
  }

  function onPaste(e) {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (text) { onChange(text); e.preventDefault(); refs.current[Math.min(text.length, 5)]?.focus(); }
  }

  return (
    <div className="flex gap-2 justify-between" onPaste={onPaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Verification code digit ${i + 1} of 6`}
          maxLength={1}
          value={digits[i].trim()}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          className="size-12 md:size-14 text-center text-xl font-semibold tabular rounded-xl border border-whisper bg-forest-50/40 focus:border-forest-500 focus:ring-2 focus:ring-forest-500/20 outline-none transition"
        />
      ))}
    </div>
  );
}

export default function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState(location.state?.step || 1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function requestReset(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      toast.success('Code sent to your email');
      setStep(2);
    } catch {
      /* toasted by the api interceptor */
    } finally {
      setSubmitting(false);
    }
  }

  async function doReset(e) {
    e.preventDefault();
    // The validator requires exactly 6 digits and a password of at least 6
    // characters; check both before posting so the user gets a plain message.
    if (!/^\d{6}$/.test(code)) return toast.error('Enter the 6-digit code');
    if (newPassword.length < 6) return toast.error('Use at least 6 characters');
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { email: email.trim(), code, newPassword });
      setDone(true);
    } catch {
      // FIXED — a rejected OTP left the button spinning state cleared but no
      // feedback beyond the toast, and `setDone(true)` had been unreachable
      // only by luck: an exception here used to propagate out of the handler.
    } finally {
      setSubmitting(false);
    }
  }

  // FIXED — "Resend" could be hammered; the backend rate-limits OTPs, so a
  // short cooldown avoids locking the user out of their own reset.
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    if (cooldown > 0) return;
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      toast.success('New code sent');
      setCooldown(30);
    } catch { /* toasted by interceptor */ }
  }

  return (
    <AuthLayout>
      <BrandMark />

      {done ? (
        <div className="text-center">
          <CheckCircle2 className="size-14 text-forest-500 mx-auto mb-4" />
          <h2 className="font-display text-3xl font-semibold text-ink">Password reset</h2>
          <p className="text-smoke mt-2">You can now sign in with your new password.</p>
          <Link to="/login" className="btn-primary mt-6 inline-flex">Back to sign in</Link>
        </div>
      ) : step === 1 ? (
        <form onSubmit={requestReset} className="space-y-5">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-smoke hover:text-ink mb-2">
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink">Reset Password</h2>
            <p className="text-smoke mt-1.5 text-sm">Enter your email and we&apos;ll send a 6-digit code.</p>
          </div>
          <Field label="Email" required>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organization.com" />
          </Field>
          <Button type="submit" loading={submitting} disabled={!/\S+@\S+\.\S+/.test(email.trim())} className="w-full">Send code</Button>
        </form>
      ) : (
        <form onSubmit={doReset} className="space-y-6">
          <div className="text-center">
            <h2 className="font-display text-3xl font-semibold text-ink">Reset Password</h2>
            <p className="text-smoke mt-1.5 text-sm">Enter the 6 digit code sent to your email</p>
          </div>

          <CodeInput value={code} onChange={setCode} />

          <Field label="New password" required hint="At least 6 characters">
            <Input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Choose a new password"
            />
          </Field>

          <Button type="submit" loading={submitting} disabled={!/^\d{6}$/.test(code) || newPassword.length < 6} className="w-full">Verify</Button>

          <p className="text-center text-sm text-smoke">
            Didn&apos;t get code?{' '}
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className="text-forest-600 font-medium hover:text-forest-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
            </button>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
