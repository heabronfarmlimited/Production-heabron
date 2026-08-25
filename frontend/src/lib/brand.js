export const BRAND = {
  name: 'Heabron CoopScore',
  shortName: 'CoopScore',
  tagline: 'Cooperative credit. Done right.',
  logoUrl: 'https://i.imgur.com/RIpNqJw.png',
  supportEmail: 'info@heabron.com',
  website: 'https://www.heabron.com',
  primary: '#2C6B47',
  accent: '#E0A82E',
};

export const NAV_ADMIN = [
  { to: '/admin', label: 'Dashboard', icon: 'LayoutDashboard', end: true },
  { to: '/admin/agents', label: 'Field Agents', icon: 'UserCheck' },
  { to: '/admin/applications', label: 'Applications', icon: 'FileCheck', badge: 'applications' },
  { to: '/admin/cooperatives', label: 'Cooperatives', icon: 'Users' },
  { to: '/admin/farmers', label: 'Farmers', icon: 'Sprout' },
  { to: '/admin/credit', label: 'Credit Scoring', icon: 'Gauge' },
  { to: '/admin/financing', label: 'Financing', icon: 'Banknote', badge: 'financing' },
  { to: '/admin/partners', label: 'Partners', icon: 'Building2' },
  { to: '/admin/benchmarks', label: 'Benchmarks', icon: 'BarChart3' },
  { to: '/admin/wallets', label: 'Wallets & Settlements', icon: 'Wallet' },
  { to: '/admin/activity', label: 'Activity Log', icon: 'History' },
  { to: '/admin/settings', label: 'Settings', icon: 'Settings' },
];

export const NAV_PARTNER = [
  { to: '/partner', label: 'Dashboard', icon: 'LayoutDashboard', end: true },
  { to: '/partner/cooperatives', label: 'Cooperatives', icon: 'Users' },
  { to: '/partner/farmers', label: 'Farmers', icon: 'Sprout' },
  { to: '/partner/search', label: 'Borrower Search', icon: 'Search' },
  { to: '/partner/financing', label: 'Financing Requests', icon: 'Banknote', badge: 'financing' },
  { to: '/partner/portfolio', label: 'Portfolio', icon: 'PieChart' },
  { to: '/partner/watchlist', label: 'Risk Watchlist', icon: 'AlertTriangle' },
  { to: '/partner/settings', label: 'Profile settings', icon: 'Settings' },
];
