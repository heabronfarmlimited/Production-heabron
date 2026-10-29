import { create } from 'zustand';
import api, { clearTokens, setTokens } from './api';

const ADMIN_ROLES = ['super_admin', 'ops_admin', 'finance_admin'];
const PARTNER_ROLES = ['partner_admin', 'partner_analyst'];

/**
 * Normalise the partner object so the UI can always read camelCase fields,
 * regardless of whether the backend returned camelCase (login) or the raw
 * snake_case row (/auth/me).
 */
function normalizePartner(p) {
  if (!p) return null;
  const organizationName = p.organizationName ?? p.organization_name ?? null;
  const organizationEmail = p.organizationEmail ?? p.organization_email ?? null;
  const logoUrl = p.logoUrl ?? p.logo_url ?? null;
  const contactPhone = p.contactPhone ?? p.contact_phone ?? null;
  const contactName = p.contactName ?? p.contact_name ?? null;
  const taxId = p.taxId ?? p.tax_id ?? null;
  return {
    id: p.id,
    organizationName,
    organizationEmail,
    logoUrl,
    contactPhone,
    contactName,
    address: p.address ?? null,
    state: p.state ?? null,
    website: p.website ?? null,
    taxId,
    status: p.status ?? null,
    stats: p.stats ?? null,
    // snake_case aliases so any page reading either convention works
    organization_name: organizationName,
    organization_email: organizationEmail,
    logo_url: logoUrl,
    contact_phone: contactPhone,
    contact_name: contactName,
    tax_id: taxId,
    raw: p,
  };
}

const initial = {
  user: null,
  partner: null,
  loading: true,
  isAdmin: false,
  isPartner: false,
  mustChangePassword: false,
};

/**
 * FIXED — role flags were computed inline at three call sites with slightly
 * different inputs, and `refreshMe` didn't recompute them at all: a role
 * revoked server-side stayed effective in the UI until a full reload. One
 * helper now derives them everywhere, from the role the server just returned.
 */
function roleFlags(user) {
  const role = user?.role || null;
  return {
    isAdmin: ADMIN_ROLES.includes(role),
    isPartner: PARTNER_ROLES.includes(role),
  };
}

export const useAuth = create((set) => ({
  ...initial,

  /** Resolve the current user from /auth/me using the stored token */
  hydrate: async () => {
    // Nothing stored means "signed out" — don't fire a request that can only 401.
    if (!localStorage.getItem('coopscore.accessToken')) {
      set({ ...initial, loading: false });
      return;
    }
    try {
      const data = await api.get('/auth/me', { silentError: true });
      if (!data?.user) throw new Error('No user on /auth/me');
      set({
        user: data.user,
        partner: normalizePartner(data.partner),
        ...roleFlags(data.user),
        mustChangePassword: !!data.user?.mustChangePassword,
        loading: false,
      });
    } catch {
      clearTokens();
      set({ ...initial, loading: false });
    }
  },

  login: async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    // FIXED — `setTokens(data)` was called without checking that the envelope
    // actually carried tokens. With the old `call()` a `success:false` body
    // resolved to `undefined` and this threw a bare TypeError on destructuring,
    // which the login screen reported as "Sign in failed".
    if (!data?.accessToken || !data?.refreshToken) {
      throw new Error('Sign-in did not return a session. Please try again.');
    }
    setTokens(data);
    set({
      user: data.user,
      partner: normalizePartner(data.partner),
      ...roleFlags(data.user),
      mustChangePassword: !!data.user?.mustChangePassword,
      loading: false,
    });
    return data;
  },

  logout: async () => {
    // A failed logout call must not keep the user signed in locally: the
    // tokens are cleared regardless, so the error is deliberately ignored.
    try {
      await api.post('/auth/logout', {}, { silentError: true });
    } catch {
      // ignored on purpose — see above
    }
    clearTokens();
    set({ ...initial, loading: false });
  },

  refreshMe: async () => {
    const data = await api.get('/auth/me');
    if (!data?.user) return;
    set({
      user: data.user,
      partner: normalizePartner(data.partner),
      // Re-derive the role flags: a suspended or re-roled account must lose
      // access on the next refresh, not on the next full page load.
      ...roleFlags(data.user),
      mustChangePassword: !!data.user?.mustChangePassword,
    });
  },
}));

export { ADMIN_ROLES, PARTNER_ROLES };
