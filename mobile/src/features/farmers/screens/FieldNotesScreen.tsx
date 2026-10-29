/**
 * Field Notes — ported from
 * modules/farmers/presentation/view/field_notes_view.dart
 *
 * A card per note: the title (when present), the note type upper-cased in
 * primary, the event date on the right, the body, then the tag pill coloured
 * by variant and the edit / delete actions. 'Add Note' at the bottom. Empty:
 * 'No field notes found.'
 *
 * Fixes:
 *  - The title rendered twice (AppSkeleton + an in-body Row).
 *  - The delete button was commented out while `onDelete` stayed a *required*
 *    prop wired to a live `deleteNote`. Restored behind a confirm sheet.
 *  - `_getTagColor` mapped only 'green' and 'amber', defaulting everything
 *    else — including the valid 'neutral' — to grey. Still grey for neutral,
 *    but now deliberately rather than by fallthrough.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { EmptyState } from '../components/EmptyState';
import { useDeleteFieldNote, useFieldNotes } from '../hooks/useFieldNotes';
import type { FieldNote } from '../model/fieldNote';
import { farmersRoutes } from '../navigation';

import { useRouteParams } from './routeParams';

export interface FieldNotesScreenProps {
  /** Optional override; normally the `/farmers/[id]/field-notes` route param. */
  farmerId?: string;
}

export function FieldNotesScreen(props: FieldNotesScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';

  const { notes, isLoading, isRefetching, refresh } = useFieldNotes(farmerId);
  const { remove, isPending: isDeleting } = useDeleteFieldNote(farmerId);

  const [pendingDelete, setPendingDelete] = useState<FieldNote | null>(null);

  return (
    <>
      <AppSkeleton
        appBarTitle="Field Notes"
        isBusy={isLoading && notes.length === 0}
        bottomBar={
          <View style={styles.bottomBar}>
            <AppButton
              text="Add Note"
              onPress={() => router.push(farmersRoutes.fieldNoteAdd(farmerId))}
              testID="field-notes-add"
            />
          </View>
        }
      >
        <View style={{ height: h(24) }} />

        <FlashList
          data={notes}
          keyExtractor={(item) => item.id}
          estimatedItemSize={170}
          ItemSeparatorComponent={() => <View style={{ height: h(12) }} />}
          renderItem={({ item }) => (
            <FieldNoteCard
              note={item}
              onEdit={() => router.push(farmersRoutes.fieldNoteEdit(farmerId, item.id))}
              onDelete={() => setPendingDelete(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            !isLoading ? <EmptyState text="No field notes found." /> : null
          }
        />
      </AppSkeleton>

      {/* Copy verbatim from the commented-out Dart sheet. */}
      <ConfirmSheet
        visible={pendingDelete != null}
        title="Delete Note"
        message="Are you sure you want to delete this field note?"
        confirmText="Delete"
        destructive
        loading={isDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          remove(target.id, { onSuccess: () => setPendingDelete(null) });
        }}
      />
    </>
  );
}

/** `_getTagColor` */
function tagColor(variant?: string | null): string {
  switch ((variant ?? '').toLowerCase()) {
    case 'green':
      return colors.success;
    case 'amber':
      return colors.warning;
    default:
      return colors.grey;
  }
}

/** `DateFormat('MMM dd, yyyy')` */
function formatEventDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${month} ${day}, ${d.getFullYear()}`;
}

/** `_FieldNoteCard` */
function FieldNoteCard({
  note,
  onEdit,
  onDelete,
}: {
  note: FieldNote;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const date = formatEventDate(note.eventDate);
  const variantColor = tagColor(note.tagVariant);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          {note.title && note.title.length > 0 ? (
            <Text style={styles.title} numberOfLines={2}>
              {note.title}
            </Text>
          ) : null}
          <View style={{ height: h(4) }} />
          <Text style={styles.noteType}>{note.noteType.toUpperCase()}</Text>
        </View>

        {date.length > 0 ? <Text style={styles.date}>{date}</Text> : null}
      </View>

      <View style={{ height: h(12) }} />

      <Text style={styles.body}>{note.body}</Text>

      <View style={{ height: h(12) }} />

      <View style={styles.footer}>
        {note.tagLabel && note.tagLabel.length > 0 ? (
          <View
            style={[
              styles.tagPill,
              // The variant colour at 10%, as in Dart.
              { backgroundColor: `${variantColor}1A` },
            ]}
          >
            <Text style={[styles.tagText, { color: variantColor }]}>
              {note.tagLabel}
            </Text>
          </View>
        ) : (
          <View />
        )}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit note"
            hitSlop={8}
            onPress={onEdit}
          >
            <Text style={styles.editGlyph}>✎</Text>
          </Pressable>

          <View style={{ width: r(16) }} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete note"
            hitSlop={8}
            onPress={onDelete}
          >
            <Text style={styles.deleteGlyph}>🗑</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: r(16),
    backgroundColor: colors.white,
    borderRadius: r(16),
    borderWidth: 1,
    // AppColors.grey @ 20%
    borderColor: 'rgba(107, 114, 128, 0.2)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardHeaderText: {
    flex: 1,
    marginRight: r(8),
  },
  title: {
    ...textTheme.titleMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  noteType: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
  date: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  body: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tagPill: {
    paddingHorizontal: r(8),
    paddingVertical: r(4),
    borderRadius: r(16),
  },
  tagText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editGlyph: {
    fontSize: spMin(18),
    color: colors.primary,
  },
  deleteGlyph: {
    fontSize: spMin(16),
  },
  bottomBar: {
    paddingHorizontal: r(16),
    paddingVertical: r(16),
    backgroundColor: colors.background,
  },
});
