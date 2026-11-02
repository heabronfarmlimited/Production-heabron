/**
 * `/consent` — data consent capture, used as a gate before registering a
 * cooperative or submitting a farmer.
 *
 * Params:
 *   entityType      'cooperative' | 'farmer'
 *   cooperativeId   required for a farmer
 *   signerName      optional pre-fill
 *   signerPhone     optional pre-fill
 *
 * On success it routes back with `consentId` so the calling form can submit.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { ConsentEntityType } from '../features/consent/model/consent';
import { ConsentFlowScreen } from '../features/consent/screens/ConsentFlowScreen';

export default function ConsentRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    entityType?: string;
    cooperativeId?: string;
    signerName?: string;
    signerPhone?: string;
  }>();

  const entityType: ConsentEntityType =
    params.entityType === 'farmer' ? 'farmer' : 'cooperative';

  return (
    <ConsentFlowScreen
      entityType={entityType}
      cooperativeId={params.cooperativeId}
      defaultSignerName={params.signerName ?? ''}
      defaultSignerPhone={params.signerPhone ?? ''}
      onComplete={(consent) => {
        // Hand the id back to the form that sent us here. `setParams` on the
        // previous route would be lost if it remounted, so it goes through
        // navigation params instead.
        router.back();
        router.setParams({ consentId: consent.id });
      }}
      onCancel={() => router.back()}
    />
  );
}
