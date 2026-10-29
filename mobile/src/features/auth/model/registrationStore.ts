/**
 * Registration draft — replaces the long-lived `RegisterController`.
 *
 * The Dart controller was a non-autoDispose `ChangeNotifierProvider` holding
 * the current step, seven TextEditingControllers and the picked selfie, which
 * is why a half-finished signup survived leaving the screen.
 *
 * A small store is still needed because the selfie is captured on a separate
 * route (`/register/selfie`) and must come back to step 3. Everything else
 * lives in the step's own form. `reset()` is called when registration
 * completes or is abandoned, so nothing leaks between attempts.
 */
import { create } from 'zustand';

import type { PickedAsset } from '../../../core/hooks/useMediaPicker';

interface RegistrationState {
  /** 0 = credentials, 1 = OTP, 2 = personal info. */
  step: number;

  /** Needed across steps: step 2 logs in with these after verifying the OTP. */
  email: string;
  password: string;

  /** Captured on the selfie route, uploaded during step 3. */
  selfie: PickedAsset | null;
  /** Set once the selfie has been uploaded to `/auth/uploads/avatar`. */
  selfieUrl: string | null;

  setStep: (step: number) => void;
  next: () => void;
  back: () => void;
  setCredentials: (email: string, password: string) => void;
  setSelfie: (asset: PickedAsset | null) => void;
  setSelfieUrl: (url: string | null) => void;
  reset: () => void;
}

const TOTAL_STEPS = 3;

export const useRegistrationStore = create<RegistrationState>((set) => ({
  step: 0,
  email: '',
  password: '',
  selfie: null,
  selfieUrl: null,

  setStep: (step) => set({ step: clamp(step) }),
  next: () => set((s) => ({ step: clamp(s.step + 1) })),
  back: () => set((s) => ({ step: clamp(s.step - 1) })),

  setCredentials: (email, password) => set({ email, password }),
  setSelfie: (selfie) => set({ selfie, selfieUrl: null }),
  setSelfieUrl: (selfieUrl) => set({ selfieUrl }),

  reset: () =>
    set({ step: 0, email: '', password: '', selfie: null, selfieUrl: null }),
}));

const clamp = (step: number): number => Math.max(0, Math.min(TOTAL_STEPS - 1, step));

export const REGISTRATION_STEPS = TOTAL_STEPS;
