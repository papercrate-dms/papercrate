import type { Identifier } from '../types/identifiers';
import type { Document, Correspondent } from '../types/documents';

export const resolveCorrespondents = (
  doc?: Document | null,
  lookup?: Map<Identifier, Correspondent> | null
): Correspondent[] => {
  if (!doc || !Array.isArray(doc.correspondents)) {
    return [];
  }

  const seen = new Set<Identifier>();
  const results: Correspondent[] = [];

  doc.correspondents.forEach((id) => {
    if (!id) return;
    if (seen.has(id)) return;
    seen.add(id);

    const resolved = lookup?.get(id);
    if (resolved) {
      results.push(resolved);
    }
  });

  return results.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
};
