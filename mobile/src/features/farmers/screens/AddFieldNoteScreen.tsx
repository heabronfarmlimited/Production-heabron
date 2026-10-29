/**
 * Add / Edit Field Note — ported from
 * modules/farmers/presentation/view/add_field_note_view.dart
 *
 * Fields in Dart order: Note Type *, Title, Body *, Tag Label, Tag Colour,
 * Event Date. Button 'Save Note' / 'Update Note'.
 *
 * Fixes:
 *  - Note Type and Tag Colour round-tripped through `toTitleCase()` for display
 *    and `toLowerCase()` on submit, so the dropdown's selected value only
 *    matched by coincidence of the labels being single words. Both use
 *    `NOTE_TYPES` / `TAG_VARIANTS` values directly.
 *  - 'Please select a note type' was a toast; it is inline.
 *  - `addFieldNote` / `updateFieldNote` had no `finally`, leaving the screen
 *    stuck in its loading state after a successful save.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { DateField } from '../../../components/DateField';
import {
  DEFAULT_NOTE_TYPE,
  DEFAULT_TAG_VARIANT,
  NOTE_TYPES,
  TAG_VARIANTS,
} from '../../../core/api/domainConstants';
import { h } from '../../../core/theme/responsive';
import { showError } from '../../../core/utils/toast';
import {
  useCreateFieldNote,
  useFieldNotes,
  useUpdateFieldNote,
} from '../hooks/useFieldNotes';
import { orUndefined, toDateOnly } from '../model/primitives';
import { fieldNoteFormSchema, type FieldNoteForm } from '../model/validation';

import { useRouteParams } from './routeParams';

/** `lastDate: DateTime.now().add(const Duration(days: 365))` */
function oneYearFromNow(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

export interface AddFieldNoteScreenProps {
  /** Optional overrides; normally the route param plus query values. */
  farmerId?: string;
  cooperativeId?: string;
  /** Present when editing. */
  noteId?: string;
}

export function AddFieldNoteScreen(props: AddFieldNoteScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';
  const cooperativeId = props.cooperativeId ?? params.cooperativeId;
  const noteId = props.noteId ?? params.noteId;
  const isEditing = Boolean(noteId);

  // The list is cached when arriving from Field Notes; the backend exposes no
  // by-id note endpoint.
  const { notes } = useFieldNotes(farmerId);
  const note = useMemo(() => notes.find((n) => n.id === noteId) ?? null, [notes, noteId]);

  const { createAsync, isPending: isCreating } = useCreateFieldNote(farmerId);
  const { updateAsync, isPending: isUpdating } = useUpdateFieldNote(
    farmerId,
    noteId ?? '',
  );

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FieldNoteForm>({
    resolver: zodResolver(fieldNoteFormSchema),
    mode: 'onTouched',
    defaultValues: {
      noteType: DEFAULT_NOTE_TYPE,
      title: '',
      body: '',
      tagLabel: '',
      tagVariant: DEFAULT_TAG_VARIANT,
      // Dart defaulted the event date to now.
      eventDate: toDateOnly(new Date()) ?? '',
    },
  });

  const prefilled = useRef(false);
  useEffect(() => {
    if (!note || prefilled.current) return;
    prefilled.current = true;
    reset({
      noteType: note.noteType,
      title: note.title ?? '',
      body: note.body,
      tagLabel: note.tagLabel ?? '',
      tagVariant: note.tagVariant ?? DEFAULT_TAG_VARIANT,
      eventDate: (note.eventDate ?? '').slice(0, 10),
    });
  }, [note, reset]);

  const values = watch();
  const isPending = isCreating || isUpdating;

  const onSubmit = async (form: FieldNoteForm) => {
    const input = {
      farmerId,
      cooperativeId: orUndefined(cooperativeId),
      noteType: form.noteType,
      title: orUndefined(form.title),
      body: form.body,
      tagLabel: orUndefined(form.tagLabel),
      tagVariant: form.tagVariant,
      // Dart sent `.toUtc().toIso8601String()`; the validator takes any ISO date.
      eventDate: form.eventDate
        ? new Date(form.eventDate).toISOString()
        : undefined,
    };

    try {
      if (isEditing) {
        await updateAsync(input);
      } else {
        await createAsync(input);
      }
      router.back();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save this note.');
    }
  };

  return (
    <AppSkeleton
      appBarTitle={isEditing ? 'Edit Field Note' : 'Add Field Note'}
      isBusy={isPending}
      scrollable
    >
      <View style={{ height: h(24) }} />

      <AppDropdown
        title="Note Type *"
        label="Select type"
        options={NOTE_TYPES}
        value={values.noteType.length > 0 ? values.noteType : null}
        error={errors.noteType?.message}
        onChange={(next) => setValue('noteType', next, { shouldValidate: true })}
        testID="field-note-type"
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <AppTextField
            title="Title"
            hintText="e.g. Mid-season assessment"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.title?.message}
            testID="field-note-title"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="body"
        render={({ field }) => (
          <AppTextField
            title="Body *"
            hintText="Enter observation or note details"
            maxLines={4}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.body?.message}
            testID="field-note-body"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="tagLabel"
        render={({ field }) => (
          <AppTextField
            title="Tag Label"
            hintText="e.g. Season 3 on track"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.tagLabel?.message}
            testID="field-note-tag-label"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <AppDropdown
        title="Tag Colour"
        label="Select colour"
        options={TAG_VARIANTS}
        value={values.tagVariant.length > 0 ? values.tagVariant : null}
        error={errors.tagVariant?.message}
        onChange={(next) => setValue('tagVariant', next, { shouldValidate: true })}
        testID="field-note-tag-variant"
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="eventDate"
        render={({ field }) => (
          <DateField
            title="Event Date"
            hintText="Select date"
            // Dart displayed `MMM dd, yyyy` here.
            displayFormat="MMM dd, yyyy"
            value={field.value}
            onChange={field.onChange}
            error={errors.eventDate?.message}
            minimumDate={new Date(2020, 0, 1)}
            maximumDate={oneYearFromNow()}
            testID="field-note-event-date"
          />
        )}
      />

      <View style={{ height: h(32) }} />

      <AppButton
        text={isEditing ? 'Update Note' : 'Save Note'}
        loading={isPending}
        onPress={handleSubmit(onSubmit)}
        testID="field-note-submit"
      />

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}
