/**
 * Session routing — the decision that was split between `SplashView` and
 * `LoginController` in Flutter and disagreed between them.
 *
 * These cases pin the behaviour so the rejected-agent dead end cannot return.
 */
import { resolveSessionRoute } from '../authStore';
import type { User } from '../user';

const user = (over: Partial<User> = {}): User => ({
  id: 'u1',
  email: 'agent@example.com',
  fullName: 'Ada Agent',
  role: 'field_agent',
  status: 'active',
  mustChangePassword: false,
  ...over,
});

describe('resolveSessionRoute', () => {
  it('sends a signed-out visitor to pre-auth', () => {
    expect(resolveSessionRoute(null, false)).toBe('pre-auth');
    // A cached profile is irrelevant without a token.
    expect(resolveSessionRoute(user(), false)).toBe('pre-auth');
  });

  it('sends an active agent home', () => {
    expect(resolveSessionRoute(user({ status: 'active' }), true)).toBe('home');
  });

  it('holds a pending agent at the review screen', () => {
    expect(resolveSessionRoute(user({ status: 'pending' }), true)).toBe(
      'under-review',
    );
  });

  /**
   * The Flutter splash screen only tested `status != 'active'`, so this case
   * landed on 'under-review' and the agent could never reach the NIN screen
   * without logging out and back in.
   */
  it('sends a rejected agent to NIN correction, not the review screen', () => {
    expect(resolveSessionRoute(user({ status: 'rejected' }), true)).toBe(
      'nin-update',
    );
  });

  it.each(['failed', 'mismatch'])(
    'sends an agent with nin_verification_status "%s" to NIN correction',
    (ninStatus) => {
      const withNin = user({
        status: 'pending',
        nin: {
          id: 'v1',
          userId: 'u1',
          fullName: 'Ada Agent',
          email: 'agent@example.com',
          phone: '08012345678',
          nin: '12345678901',
          state: 'Oyo',
          lga: 'Akinyele',
          selfieUrl: '',
          ninVerificationStatus: ninStatus,
          selfieVerified: false,
          status: 'pending',
        },
      });

      expect(resolveSessionRoute(withNin, true)).toBe('nin-update');
    },
  );

  it('holds a token with no cached profile at the review screen', () => {
    // Happens mid-onboarding: tokens are stored right after OTP, before
    // the profile is fetched.
    expect(resolveSessionRoute(null, true)).toBe('under-review');
  });

  it('holds an unrecognised status at the review screen rather than letting it in', () => {
    expect(resolveSessionRoute(user({ status: 'suspended' }), true)).toBe(
      'under-review',
    );
    expect(resolveSessionRoute(user({ status: '' }), true)).toBe('under-review');
  });
});
