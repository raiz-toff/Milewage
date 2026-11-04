import type { Flag, Trip, TripEdit } from './types';

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The order edits are applied in, the same one the digest uses, so input order cannot matter. */
export function sortEdits(edits: readonly TripEdit[]): TripEdit[] {
  return [...edits].sort(
    (a, b) =>
      cmp(a.tripKey, b.tripKey) ||
      cmp(a.kind ?? '', b.kind ?? '') ||
      cmp(a.purpose ?? '', b.purpose ?? ''),
  );
}

/**
 * Stage 7 (14 section 6.7). Re-applies the driver's trip edits by `tripKey`.
 * An edit changes `kind` and/or `purpose`; `originalKind`, times and distance are never
 * touched (07 section 3 rule 8). An edit whose key matches no trip is NOT applied, NOT
 * dropped and NOT re-attached to a "nearby" trip: it is returned as an `override_orphaned`
 * flag (detail = the tripKey), once per key. Two edits for one key merge field by field in
 * the fixed edit order, the later one winning.
 */
export function applyEdits(
  trips: readonly Trip[],
  edits: readonly TripEdit[] | undefined,
): { trips: Trip[]; flags: Flag[] } {
  const out = trips.map((t) => ({ ...t }));
  const flags: Flag[] = [];
  if (!edits || edits.length === 0) return { trips: out, flags };

  const byKey = new Map<string, Trip>();
  for (const t of out) byKey.set(t.tripKey, t);
  const orphaned = new Set<string>();
  for (const e of sortEdits(edits)) {
    const t = byKey.get(e.tripKey);
    if (t === undefined) {
      if (!orphaned.has(e.tripKey)) {
        orphaned.add(e.tripKey);
        flags.push({ code: 'override_orphaned', detail: e.tripKey });
      }
      continue;
    }
    if (e.kind !== undefined) t.kind = e.kind;
    if (e.purpose !== undefined) t.purpose = e.purpose;
  }
  return { trips: out, flags };
}
