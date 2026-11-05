import type { ShiftResult } from '@milewage/track-engine';

export type ReconReason =
  | 'points_missing'
  | 'calc_version'
  | 'edited_on_web'
  | 'late_points'
  | 'engine_disagreement'
  | 'unknown';

export interface PhoneSummary {
  calcVersion: number;
  inputDigest: string;
  totalM: number;
  activeM: number;
  deadheadM: number;
  personalM: number;
}

export interface ReconInput {
  server: Pick<ShiftResult, 'inputDigest' | 'totals' | 'algorithmVersion'>;
  phone: PhoneSummary;
  /** Points the phone says it recorded (manifest) and how many of them the server stores. */
  manifest?: { pointCount: number };
  storedPoints: number;
  /** A stop label, trip override or manual trip was changed on the web after the phone's run. */
  editedOnWeb?: boolean;
  /** Points were stored after the shift ended. */
  latePoints?: boolean;
}

export interface Recon {
  status: 'match' | 'differs';
  diffM: number;
  reasons: ReconReason[];
  /** 1 only for engine_disagreement (14 section 9.4). */
  calcMismatch: boolean;
}

/**
 * Server against phone (14 section 9.4, 15 section 7.3). The comparison is exact, no tolerance.
 * Equal digest and equal calc_version with different numbers is an engine bug, not a data difference.
 * When the digests differ, the shift is `match` when the business total is equal anyway (15 section 7.2),
 * and `differs` with the first explaining reason, in the order of 15 section 7.3, otherwise.
 */
export function reconcile(i: ReconInput): Recon {
  const s = i.server.totals;
  const p = i.phone;
  const diffM = s.totalM - p.totalM;
  const sameNumbers =
    s.totalM === p.totalM &&
    s.activeM === p.activeM &&
    s.deadheadM === p.deadheadM &&
    s.personalM === p.personalM;
  const sameDigest = i.server.inputDigest === p.inputDigest;
  const sameVersion = i.server.algorithmVersion === p.calcVersion;

  if (sameDigest && sameNumbers)
    return { status: 'match', diffM, reasons: [], calcMismatch: false };
  if (sameDigest && sameVersion) {
    return { status: 'differs', diffM, reasons: ['engine_disagreement'], calcMismatch: true };
  }
  if (!sameDigest && diffM === 0)
    return { status: 'match', diffM, reasons: [], calcMismatch: false };

  const reasons: ReconReason[] = [];
  if (i.manifest && i.storedPoints < i.manifest.pointCount) reasons.push('points_missing');
  if (!sameVersion) reasons.push('calc_version');
  if (i.editedOnWeb) reasons.push('edited_on_web');
  if (i.latePoints) reasons.push('late_points');
  if (reasons.length === 0) reasons.push('unknown');
  return { status: 'differs', diffM, reasons, calcMismatch: false };
}

export interface StoredReconInput {
  server: Pick<ShiftResult, 'inputDigest' | 'totals' | 'algorithmVersion'>;
  /** What the phone sent at shift end and the server kept (the split is not kept, only the total). */
  phone: { totalM: number; calcVersion: number; inputDigest: string };
  editedOnWeb: boolean;
  latePoints: boolean;
}

/**
 * The same comparison after a later server recompute (a label, a trip edit, late points, a recalculate),
 * against the phone figures stored at shift end. Only the total is stored, so only the total is compared;
 * the split cannot show a difference here (15 section 7.3).
 */
export function reconFromStored(i: StoredReconInput): Recon {
  const diffM = i.server.totals.totalM - i.phone.totalM;
  if (diffM === 0) return { status: 'match', diffM, reasons: [], calcMismatch: false };
  const sameVersion = i.server.algorithmVersion === i.phone.calcVersion;
  if (i.server.inputDigest === i.phone.inputDigest && sameVersion) {
    return { status: 'differs', diffM, reasons: ['engine_disagreement'], calcMismatch: true };
  }
  const reasons: ReconReason[] = [];
  if (!sameVersion) reasons.push('calc_version');
  if (i.editedOnWeb) reasons.push('edited_on_web');
  if (i.latePoints) reasons.push('late_points');
  if (reasons.length === 0) reasons.push('unknown');
  return { status: 'differs', diffM, reasons, calcMismatch: false };
}
