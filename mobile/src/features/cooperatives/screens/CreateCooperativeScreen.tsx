/**
 * "Add Cooperative" — ported from
 * .../view/create_cooperative_view.dart (`/addCooperative`)
 *
 * The form itself is `CooperativeFormScreen`; this supplies the create copy,
 * blank defaults and the mutation.
 *
 * NOTE — `leaderName` / `leaderPhone` are not form fields, matching Dart: they
 * come from the signed-in agent. The Dart controller fell back to the hardcoded
 * `'Dev innov8'` / `'08067543299'` when the cached user was missing, which
 * wrote a developer's name and phone number into production cooperative
 * records. Both are `.optional()` in the validator, so an unknown value is
 * omitted instead.
 *
 * CONSENT GATE (data consent specification, section 3): a cooperative cannot
 * be registered until the leader has given consent. The form collects the
 * details, then this screen routes to the consent flow and submits only once a
 * consent id comes back. The server refuses the create without one regardless,
 * so this is the path to satisfying it rather than the check itself.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { routes } from '../../../core/navigation/routes';
import { newClientRequestId } from '../../../core/utils/clientRequestId';
import { useAuthStore } from '../../auth/model/authStore';
import { useCreateCooperative } from '../hooks/useCooperatives';
import { emptyCooperativeForm, toCooperativeBody } from '../model/cooperative';
import type { CooperativeForm } from '../model/validation';

import { CooperativeFormScreen } from './CooperativeFormScreen';

export function CreateCooperativeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { mutate: create, isPending } = useCreateCooperative();

  // Set by the consent route when it returns.
  const { consentId } = useLocalSearchParams<{ consentId?: string }>();

  // The form values are held while the agent is away collecting consent, so
  // nothing typed is lost on the round trip.
  /**
   * One idempotency key per registration session (v2 "duplicate-safe client
   * UUID"). It matters more here than for farmers: a duplicate cooperative
   * splits its members across two records, so neither one's average credit
   * score is right. Held in a ref so the retry after a consent round trip
   * carries the same value.
   */
  const clientRequestId = useRef(newClientRequestId());

  const pending = useRef<{
    values: CooperativeForm;
    onError: (err: unknown) => void;
  } | null>(null);
  const [submittedConsentId, setSubmittedConsentId] = useState<string | null>(null);

  const submitWithConsent = useCallback(
    (values: CooperativeForm, consent: string, onError: (err: unknown) => void) => {
      create(
        {
          ...toCooperativeBody(values, { name: user?.fullName, phone: user?.phone }),
          consentId: consent,
          clientRequestId: clientRequestId.current,
        },
        {
          onSuccess: () => router.back(),
          onError,
        },
      );
    },
    [create, router, user?.fullName, user?.phone],
  );

  // Returning from the consent flow: submit what was held.
  useEffect(() => {
    if (!consentId || consentId === submittedConsentId) return;
    const held = pending.current;
    if (!held) return;

    // Guard against a re-render submitting the same consent twice, which the
    // server would reject as already attached.
    setSubmittedConsentId(consentId);
    pending.current = null;
    submitWithConsent(held.values, consentId, held.onError);
  }, [consentId, submittedConsentId, submitWithConsent]);

  const submit = (
    values: CooperativeForm,
    handlers: { onError: (err: unknown) => void },
  ) => {
    if (consentId && consentId !== submittedConsentId) {
      setSubmittedConsentId(consentId);
      submitWithConsent(values, consentId, handlers.onError);
      return;
    }

    pending.current = { values, onError: handlers.onError };
    // No signer pre-fill: the cooperative form has no leader fields (the
    // `leaderName`/`leaderPhone` sent to the API are the agent's own details),
    // and pre-filling the agent's name as the person giving consent would
    // record the wrong signer. The consent screen asks for the leader.
    router.push({
      pathname: routes.consent,
      params: { entityType: 'cooperative' },
    });
  };

  return (
    <CooperativeFormScreen
      heading="Add Cooperative"
      submitLabel="Continue to consent"
      defaultValues={emptyCooperativeForm()}
      submitting={isPending}
      onSubmit={submit}
    />
  );
}
