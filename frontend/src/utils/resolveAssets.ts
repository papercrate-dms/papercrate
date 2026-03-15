import type { Identifier } from '../types/identifiers';
import type { Tag, Correspondent } from '../types/documents';

/**
 * Resolve tag IDs to Tag objects, sorted by label (case-insensitive).
 */
export function resolveTags(
  tagIds: Identifier[] | null | undefined,
  tagLookupById: Map<Identifier, Tag> | null | undefined,
): Tag[] {
  if (!tagIds || !tagLookupById) return [];
  return tagIds
    .map((id) => tagLookupById.get(id))
    .filter((tag): tag is Tag => Boolean(tag))
    .sort((a, b) => (a.label || '').toLowerCase().localeCompare((b.label || '').toLowerCase()));
}

/**
 * Resolve correspondent IDs to Correspondent objects, sorted by name (case-insensitive).
 */
export function resolveCorrespondentIds(
  correspondentIds: Identifier[] | null | undefined,
  correspondentLookupById: Map<Identifier, Correspondent> | null | undefined,
): Correspondent[] {
  if (!correspondentIds || !correspondentLookupById) return [];
  return correspondentIds
    .map((id) => correspondentLookupById.get(id))
    .filter((c): c is Correspondent => Boolean(c))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
