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

export const useAuth = create((set, get) => ({
  ...initial,

  /** Resolve the current user from /auth/me using the stored token */
  hydrate: async () => {
    try {
      const data = await api.get('/auth/me', { silentError: true });
      set({
        user: data.user,
        partner: normalizePartner(data.partner),
        isAdmin: ADMIN_ROLES.includes(data.user?.role),
        isPartner: PARTNER_ROLES.includes(data.user?.role),
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
    setTokens(data);
    set({
      user: data.user,
      partner: normalizePartner(data.partner),
      isAdmin: ADMIN_ROLES.includes(data.user?.role),
      isPartner: PARTNER_ROLES.includes(data.user?.role),
      mustChangePassword: !!data.user?.mustChangePassword,
      loading: false,
    });
    return data;
  },

  logout: async () => {
    try { await api.post('/auth/logout', {}, { silentError: true }); } catch {}
    clearTokens();
    set({ ...initial, loading: false });
  },

  refreshMe: async () => {
    const data = await api.get('/auth/me');
    set({
      user: data.user,
      partner: normalizePartner(data.partner),
      mustChangePassword: !!data.user?.mustChangePassword,
    });
  },
}));

export { ADMIN_ROLES, PARTNER_ROLES };
