/**
 * Response-envelope unwrapping and error mapping.
 *
 * These guard two behaviours that would otherwise fail silently:
 *  - the backend returns HTTP 200 with `success: false` on some paths, so a
 *    successful transport does not mean a successful operation
 *  - a 422's field-level `details` must survive onto `AppError.fieldErrors`,
 *    so a validation failure can land on the offending input instead of a
 *    generic toast (the Dart `AppException` discarded them)
 */
import { AppError } from '../AppError';
import { hasNextPage, parseError, parseMeta } from '../types';

describe('parseMeta', () => {
  it('reads pagination metadata', () => {
    expect(parseMeta({ page: 2, pageSize: 20, total: 55, totalPages: 3 })).toEqual({
      page: 2,
      pageSize: 20,
      total: 55,
      totalPages: 3,
    });
  });

  it('applies the same fallbacks the Dart factory used', () => {
    expect(parseMeta({})).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('coerces numeric strings, which some endpoints return', () => {
    expect(parseMeta({ page: '3', totalPages: '4' })).toMatchObject({
      page: 3,
      totalPages: 4,
    });
  });

  it('returns undefined when there is no meta block', () => {
    expect(parseMeta(null)).toBeUndefined();
    expect(parseMeta('nonsense')).toBeUndefined();
  });
});

describe('hasNextPage', () => {
  it('is true while pages remain', () => {
    expect(
      hasNextPage({ page: 1, pageSize: 20, total: 50, totalPages: 3 }),
    ).toBe(true);
  });

  it('is false on the final page', () => {
    expect(
      hasNextPage({ page: 3, pageSize: 20, total: 50, totalPages: 3 }),
    ).toBe(false);
  });

  it('is false with no metadata', () => {
    expect(hasNextPage(undefined)).toBe(false);
  });
});

describe('parseError', () => {
  it('reads code, message and field details', () => {
    const error = parseError({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: [
        { field: 'nin', message: 'NIN must be 11 digits' },
        { field: 'phone', message: 'Invalid phone' },
      ],
    });

    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(error?.details).toHaveLength(2);
    expect(error?.details[0]).toEqual({
      field: 'nin',
      message: 'NIN must be 11 digits',
    });
  });

  it('tolerates a missing or non-array details block', () => {
    expect(parseError({ code: 'X', message: 'y' })?.details).toEqual([]);
    expect(parseError({ details: 'oops' })?.details).toEqual([]);
  });
});

describe('AppError', () => {
  it('maps field details to a form-friendly record', () => {
    const err = new AppError('Validation failed', {
      code: 'VALIDATION_ERROR',
      details: [
        { field: 'accountNumber', message: 'Must be exactly 10 digits' },
        { field: 'bankName', message: 'Bank name is required' },
      ],
      status: 422,
    });

    expect(err.fieldErrors).toEqual({
      accountNumber: 'Must be exactly 10 digits',
      bankName: 'Bank name is required',
    });
  });

  it('drops details with no field name', () => {
    const err = new AppError('bad', {
      details: [{ field: '', message: 'orphaned' }],
    });
    expect(err.fieldErrors).toEqual({});
  });

  it('passes an existing AppError through unchanged', () => {
    const original = new AppError('already wrapped', { status: 400 });
    expect(AppError.from(original)).toBe(original);
  });

  it('keeps a plain Error message', () => {
    expect(AppError.from(new Error('boom')).message).toBe('boom');
  });

  it('falls back for a non-Error throw', () => {
    expect(AppError.from('a string').message).toBe(
      'Oops! Something went wrong, please try again later.',
    );
  });

  it('is an Error, so it survives a throw/catch boundary', () => {
    expect(new AppError('x')).toBeInstanceOf(Error);
    expect(new AppError('x').name).toBe('AppError');
  });
});
