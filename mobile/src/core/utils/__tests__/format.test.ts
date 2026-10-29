/**
 * Formatting helpers — ported from helper.dart, so these pin the output
 * format against the Dart `intl` patterns the screens were designed around.
 */
import { colors } from '../../theme/colors';
import {
  capitalize,
  formatNaira,
  formatRelativeTime,
  isEmpty,
  maskEmail,
  resolveCoopScoreColor,
  resolveCoopTierColor,
  resolveStatusColor,
  titleCase,
} from '../format';

describe('maskEmail', () => {
  it('keeps the first and last two characters of the username', () => {
    expect(maskEmail('adaagent@example.com')).toBe('a****nt@example.com');
  });

  it('keeps only the first character for a short username', () => {
    expect(maskEmail('ab@example.com')).toBe('a****@example.com');
    expect(maskEmail('a@example.com')).toBe('a****@example.com');
  });

  it('returns the input unchanged when it is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
    expect(maskEmail('')).toBe('');
  });
});

describe('formatNaira', () => {
  it('formats with a thousands separator and two decimals', () => {
    expect(formatNaira(168000)).toBe('₦168,000.00');
  });

  it('can drop the decimals', () => {
    expect(formatNaira(25000, { decimals: false })).toBe('₦25,000');
  });

  it('accepts a numeric string, as the API sometimes returns', () => {
    expect(formatNaira('4500.5')).toBe('₦4,500.50');
  });

  it('returns a zero amount rather than NaN for bad input', () => {
    expect(formatNaira(null)).toBe('₦0.00');
    expect(formatNaira(undefined)).toBe('₦0.00');
    expect(formatNaira('not a number')).toBe('₦0.00');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('says "Just now" under a minute', () => {
    expect(formatRelativeTime('2026-06-15T11:59:30Z')).toBe('Just now');
  });

  it('pluralises minutes correctly', () => {
    expect(formatRelativeTime('2026-06-15T11:59:00Z')).toBe('1 minute ago');
    expect(formatRelativeTime('2026-06-15T11:45:00Z')).toBe('15 minutes ago');
  });

  it('pluralises hours correctly', () => {
    expect(formatRelativeTime('2026-06-15T11:00:00Z')).toBe('1 hour ago');
    expect(formatRelativeTime('2026-06-15T07:00:00Z')).toBe('5 hours ago');
  });

  it('pluralises days correctly', () => {
    expect(formatRelativeTime('2026-06-14T12:00:00Z')).toBe('1 day ago');
    expect(formatRelativeTime('2026-06-12T12:00:00Z')).toBe('3 days ago');
  });

  it('falls back to a date past a week', () => {
    expect(formatRelativeTime('2026-05-20T12:00:00Z')).toBe('20 May, 2026');
  });

  it('returns a dash for a missing or unparseable value', () => {
    expect(formatRelativeTime(null)).toBe('-');
    expect(formatRelativeTime('')).toBe('-');
    expect(formatRelativeTime('garbage')).toBe('-');
  });
});

describe('status colours', () => {
  it('maps approved / rejected / pending', () => {
    expect(resolveStatusColor('approved')).toBe(colors.success);
    expect(resolveStatusColor('rejected')).toBe(colors.failure);
    expect(resolveStatusColor('denied')).toBe(colors.failure);
    expect(resolveStatusColor('pending')).toBe(colors.orange700);
  });

  it('is case-insensitive, since statuses arrive in mixed case', () => {
    expect(resolveStatusColor('APPROVED')).toBe(colors.success);
  });

  it('maps cooperative tiers a / b / other', () => {
    expect(resolveCoopTierColor('a')).toBe(colors.success);
    expect(resolveCoopTierColor('A')).toBe(colors.success);
    expect(resolveCoopTierColor('b')).toBe(colors.orange);
    expect(resolveCoopTierColor('d')).toBe(colors.red);
  });

  it('bands credit scores', () => {
    expect(resolveCoopScoreColor(95)).toBe(colors.green);
    expect(resolveCoopScoreColor(70)).toBe(colors.orange);
    expect(resolveCoopScoreColor(50)).toBe(colors.yellow);
    expect(resolveCoopScoreColor(10)).toBe(colors.red);
  });

  it('keeps the Dart special case for a score of exactly 5', () => {
    // Preserved deliberately so scores render as they did before; see the
    // note on resolveCoopScoreColor.
    expect(resolveCoopScoreColor(5)).toBe(colors.success);
  });
});

describe('text helpers', () => {
  it('capitalises the first letter', () => {
    expect(capitalize('verified')).toBe('Verified');
    expect(capitalize('')).toBe('');
    expect(capitalize(null)).toBe('');
  });

  it('title-cases snake_case and kebab-case values', () => {
    // Used for `action` on activity rows and `role` on the profile.
    expect(titleCase('farmer_created')).toBe('Farmer Created');
    expect(titleCase('field_agent')).toBe('Field Agent');
    expect(titleCase('bank-transfer')).toBe('Bank Transfer');
    expect(titleCase(null)).toBe('');
  });

  it('detects empty values the way isObjectEmpty did', () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty([])).toBe(true);
    expect(isEmpty({})).toBe(true);
    expect(isEmpty([1])).toBe(false);
    expect(isEmpty({ a: 1 })).toBe(false);
    expect(isEmpty('text')).toBe(false);
  });
});
