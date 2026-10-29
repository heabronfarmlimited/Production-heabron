/**
 * "Edit Cooperative" — ported from
 * .../view/edit_cooperative_view.dart (`/editCooperative`)
 *
 * The Dart screen took the whole `Cooperative` through route arguments and
 * force-cast it (`settings.arguments! as Cooperative`). This takes an id and
 * reads the record from the cache or the server, so a deep link works and the
 * form can only ever prefill from a complete record.
 *
 * Three defects from the Dart version are fixed here or in the pieces this
 * screen composes:
 *
 *  1. `latController.text = cooperative.gpsLat.toString()` on a *nullable*
 *     double wrote the literal string `'null'` into Latitude and Longitude
 *     whenever the cooperative had no GPS. `cooperativeToForm` writes `''`.
 *  2. State and LGA were not prefilled at all.
 *  3. `submit` called `fetchMore()` instead of `fetchInitial()`, so the edit
 *     never refreshed anything; `useUpdateCooperative` invalidates
 *     `qk.cooperative(id)` and the list root.
 */
import { useRouter } from 'expo-router';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { useAuthStore } from '../../auth/model/authStore';
import { EmptyState } from '../components/EmptyState';
import { useCooperative, useUpdateCooperative } from '../hooks/useCooperatives';
import {
  cooperativeToForm,
  emptyCooperativeForm,
  toCooperativeBody,
} from '../model/cooperative';
import type { CooperativeForm } from '../model/validation';

import { CooperativeFormScreen } from './CooperativeFormScreen';

export interface EditCooperativeScreenProps {
  id: string;
}

export function EditCooperativeScreen({ id }: EditCooperativeScreenProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const { data: cooperative, isLoading, isError } = useCooperative(id);
  const { mutate: update, isPending } = useUpdateCooperative(id);

  if (isError) {
    return (
      <AppSkeleton appBarTitle="Edit Cooperative">
        <EmptyState text="Could not load this cooperative." />
      </AppSkeleton>
    );
  }

  const submit = (
    values: CooperativeForm,
    handlers: { onError: (err: unknown) => void },
  ) => {
    update(
      toCooperativeBody(values, { name: user?.fullName, phone: user?.phone }),
      {
        // Dart popped with `popUntil(3)`, a magic number that assumed a fixed
        // stack depth. One step back lands on the detail screen, which the
        // mutation has already invalidated.
        onSuccess: () => router.back(),
        onError: handlers.onError,
      },
    );
  };

  return (
    <CooperativeFormScreen
      // `key` remounts the form once the record arrives, so react-hook-form
      // picks up the prefilled `defaultValues` instead of keeping the blanks
      // it was first given.
      key={cooperative?.id ?? 'loading'}
      heading="Edit Cooperative"
      submitLabel="Update Cooperative"
      defaultValues={
        cooperative ? cooperativeToForm(cooperative) : emptyCooperativeForm()
      }
      initialLogoUrl={cooperative?.logoUrl ?? null}
      loading={isLoading}
      submitting={isPending}
      onSubmit={submit}
    />
  );
}
