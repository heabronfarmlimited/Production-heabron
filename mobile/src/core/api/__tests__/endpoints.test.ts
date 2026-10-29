/**
 * Upload-kind and endpoint-shape contract.
 *
 * The upload kinds are asserted against the `BUCKETS` map in
 * `backend/src/controllers/uploads.controller.js`. An unlisted kind is
 * rejected with `Unknown upload kind: <kind>`, and the pre-activation route
 * rejects anything outside `PRE_ACTIVATION_KINDS`.
 */
import {
  endpoints,
  PRE_AUTH_UPLOAD_KINDS,
  PUBLIC_UPLOAD_KINDS,
  UPLOAD_KINDS,
} from '../endpoints';

describe('upload kinds match the backend BUCKETS map', () => {
  it('lists all fourteen buckets', () => {
    expect([...UPLOAD_KINDS].sort()).toEqual(
      [
        'agent_signature',
        'avatar',
        'buyer_receipt',
        'cooperative_logo',
        'delivery_proof',
        'farm_photo',
        'farmer_id',
        'farmer_photo',
        'harvest_photo',
        'land_doc',
        'partner_logo',
        'selfie',
        'transaction_receipt',
        'warehouse_receipt',
      ].sort(),
    );
  });

  it('includes the four yield-verification kinds', () => {
    // RecordYieldsView uploaded to these in Flutter, but the Dart
    // UploadService doc comment never listed them.
    (
      ['harvest_photo', 'warehouse_receipt', 'buyer_receipt', 'agent_signature'] as const
    ).forEach((kind) => {
      expect(UPLOAD_KINDS).toContain(kind);
    });
  });

  it('allows only avatar and selfie before activation', () => {
    expect([...PRE_AUTH_UPLOAD_KINDS].sort()).toEqual(['avatar', 'selfie']);
  });

  it('marks only the logo buckets public', () => {
    // Everything else is private and needs a signed URL to display.
    expect([...PUBLIC_UPLOAD_KINDS].sort()).toEqual([
      'cooperative_logo',
      'partner_logo',
    ]);
  });

  it('keeps cooperative_logo distinct from avatar', () => {
    // Flutter uploaded cooperative logos as `avatar`, which routes to the
    // private agent-documents bucket, so the saved URL was not readable.
    expect(PUBLIC_UPLOAD_KINDS).toContain('cooperative_logo');
    expect(PUBLIC_UPLOAD_KINDS).not.toContain('avatar');
  });
});

describe('endpoint paths', () => {
  it('builds the agent upload path', () => {
    expect(endpoints.upload('farmer_photo')).toBe('/agent/uploads/farmer_photo');
  });

  it('builds the pre-approval upload path', () => {
    expect(endpoints.uploadWithoutAuth('avatar')).toBe('/auth/uploads/avatar');
  });

  it('builds the per-farmer sub-resource paths', () => {
    const id = 'f1';
    expect(endpoints.farmerById(id)).toBe('/agent/farmers/f1');
    expect(endpoints.verifyFarmerNin(id)).toBe('/agent/farmers/f1/verify-nin');
    expect(endpoints.mapFarm(id)).toBe('/agent/farmers/f1/map-farm');
    expect(endpoints.farmerCreditScore(id)).toBe('/agent/farmers/f1/credit-score');
    expect(endpoints.farmerSeasonalYield(id)).toBe('/agent/farmers/f1/seasonal-yield');
    expect(endpoints.farmerMarketAccess(id)).toBe('/agent/farmers/f1/market-access');
    expect(endpoints.farmerFieldNotes(id)).toBe('/agent/farmers/f1/field-notes');
  });

  it('keeps auth paths under /auth and agent paths under /agent', () => {
    expect(endpoints.login).toBe('/auth/login');
    expect(endpoints.userProfile).toBe('/auth/me');
    expect(endpoints.resubmitNin).toBe('/auth/resubmit-nin');
    expect(endpoints.dashboard).toBe('/agent/dashboard');
    expect(endpoints.walletSettlements).toBe('/agent/wallet/settlements');
  });

  it('points financing requests at the single shared path', () => {
    // Dart had two constants with the identical value.
    expect(endpoints.financingRequests).toBe('/agent/financing-requests');
  });
});
