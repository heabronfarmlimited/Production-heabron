/**
 * Field-note queries and mutations — replaces `FieldNotesController`, which
 * had the same three defects as `MarketAccessController`: a fetch in the
 * constructor, no `finally` around add/update so the loading state stuck after
 * a successful save, and a delete path reachable only from commented-out UI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import {
  createFieldNote,
  deleteFieldNote,
  fetchFieldNotes,
  updateFieldNote,
} from '../api/farmersApi';
import type { FieldNote, FieldNoteFormInput } from '../model/fieldNote';

/** `GET /agent/farmers/:farmerId/field-notes` — newest event date first. */
export function useFieldNotes(farmerId: string) {
  const query = useQuery<FieldNote[]>({
    queryKey: qk.farmerFieldNotes(farmerId),
    queryFn: () => fetchFieldNotes(farmerId),
    enabled: farmerId.length > 0,
  });

  return {
    notes: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

function useFieldNoteInvalidation(farmerId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.farmerFieldNotes(farmerId) });
  };
}

/** `POST /agent/field-notes` */
export function useCreateFieldNote(farmerId: string) {
  const invalidate = useFieldNoteInvalidation(farmerId);

  const mutation = useMutation<FieldNote, unknown, FieldNoteFormInput>({
    mutationFn: createFieldNote,
    onSuccess: () => {
      invalidate();
      showSuccess('Field note added successfully');
    },
  });

  return {
    create: mutation.mutate,
    createAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** `PATCH /agent/field-notes/:noteId` */
export function useUpdateFieldNote(farmerId: string, noteId: string) {
  const invalidate = useFieldNoteInvalidation(farmerId);

  const mutation = useMutation<FieldNote, unknown, FieldNoteFormInput>({
    mutationFn: (input) => updateFieldNote(noteId, input),
    onSuccess: () => {
      invalidate();
      showSuccess('Field note updated successfully');
    },
  });

  return {
    update: mutation.mutate,
    updateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** `DELETE /agent/field-notes/:noteId` — re-enabled. */
export function useDeleteFieldNote(farmerId: string) {
  const invalidate = useFieldNoteInvalidation(farmerId);

  const mutation = useMutation<void, unknown, string>({
    mutationFn: deleteFieldNote,
    onSuccess: () => {
      invalidate();
      showSuccess('Note deleted');
    },
    onError: (err) => showApiError(err, 'Could not delete this note'),
  });

  return {
    remove: mutation.mutate,
    removeAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
