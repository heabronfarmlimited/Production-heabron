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
 */
import { useRouter } from 'expo-router';

import { useAuthStore } from '../../auth/model/authStore';
import { useCreateCooperative } from '../hooks/useCooperatives';
import { emptyCooperativeForm, toCooperativeBody } from '../model/cooperative';
import type { CooperativeForm } from '../model/validation';

import { CooperativeFormScreen } from './CooperativeFormScreen';

export function CreateCooperativeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { mutate: create, isPending } = useCreateCooperative();

  const submit = (
    values: CooperativeForm,
    handlers: { onError: (err: unknown) => void },
  ) => {
    create(
      toCooperativeBody(values, { name: user?.fullName, phone: user?.phone }),
      {
        onSuccess: () => router.back(),
        onError: handlers.onError,
      },
    );
  };

  return (
    <CooperativeFormScreen
      heading="Add Cooperative"
      submitLabel="Create Cooperative"
      defaultValues={emptyCooperativeForm()}
      submitting={isPending}
      onSubmit={submit}
    />
  );
}
