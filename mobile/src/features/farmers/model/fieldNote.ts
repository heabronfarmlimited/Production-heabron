/**
 * Field-note (timeline) models — ported from
 * modules/farmers/domain/dto/field_note.dart
 *
 * Reads are snake_case `field_notes` rows; writes are camelCase per
 * `validators/domain.js` `createFieldNote` / `updateFieldNote`.
 */
import {
  compact,
  nullableStr,
  obj,
  orUndefined,
  pick,
  str,
} from './primitives';

export interface FieldNote {
  id: string;
  farmerId: string;
  cooperativeId: string | null;
  noteType: string;
  title: string | null;
  body: string;
  tagLabel: string | null;
  tagVariant: string | null;
  eventDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function parseFieldNote(raw: unknown): FieldNote {
  const n = obj(raw);
  return {
    id: str(n.id),
    farmerId: str(pick(n, 'farmer_id', 'farmerId')),
    cooperativeId: nullableStr(pick(n, 'cooperative_id', 'cooperativeId')),
    noteType: str(pick(n, 'note_type', 'noteType')),
    title: nullableStr(n.title),
    body: str(n.body),
    tagLabel: nullableStr(pick(n, 'tag_label', 'tagLabel')),
    tagVariant: nullableStr(pick(n, 'tag_variant', 'tagVariant')),
    eventDate: nullableStr(pick(n, 'event_date', 'eventDate')),
    createdAt: nullableStr(pick(n, 'created_at', 'createdAt')),
    updatedAt: nullableStr(pick(n, 'updated_at', 'updatedAt')),
  };
}

export interface FieldNoteFormInput {
  farmerId: string;
  cooperativeId?: string | null;
  noteType: string;
  title?: string;
  body: string;
  tagLabel?: string;
  tagVariant?: string;
  /** Full ISO-8601 UTC timestamp — `eventDate: Joi.date().iso()`. */
  eventDate?: string;
}

/** `POST /agent/field-notes` body. */
export function toFieldNoteBody(input: FieldNoteFormInput): Record<string, unknown> {
  return compact({
    farmerId: input.farmerId,
    cooperativeId: orUndefined(input.cooperativeId),
    noteType: input.noteType,
    title: orUndefined(input.title),
    body: input.body.trim(),
    tagLabel: orUndefined(input.tagLabel),
    tagVariant: input.tagVariant,
    eventDate: input.eventDate,
  });
}

/**
 * `PATCH /agent/field-notes/:noteId` body.
 *
 * `updateFieldNote` is a different schema: it rejects `farmerId` /
 * `cooperativeId`, requires `.min(1)` key, and allows `null`/`''` for `title`
 * and `tagLabel` so they can be cleared. Blanks are therefore sent as `null`
 * here rather than omitted — otherwise a cleared title could never be saved.
 */
export function toUpdateFieldNoteBody(
  input: FieldNoteFormInput,
): Record<string, unknown> {
  return compact({
    noteType: input.noteType,
    title: orUndefined(input.title) ?? null,
    body: input.body.trim(),
    tagLabel: orUndefined(input.tagLabel) ?? null,
    tagVariant: input.tagVariant,
    eventDate: input.eventDate,
  });
}
