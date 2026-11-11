import { diagKinds, type DiagKind, type DiagLevel, type DiagSrc, type KindSpec } from './kinds';
import { PATTERNS, checkShape, looksLikeCoordinate } from './schema';

export interface DiagEvent {
  kind: DiagKind;
  at: number;
  level: DiagLevel;
  src: DiagSrc;
  seq?: number;
  /** Shift client id. */
  shift?: string;
  /** App version. */
  v: string;
  data: Record<string, unknown>;
}

export type DiagResult = { ok: true; event: DiagEvent } | { ok: false; reason: string };

/** Our own typed error classes, SQLite error codes and network error classes (16 section 4.3). */
export const CRASH_MSG_CLASS =
  /^(Milewage[A-Za-z]*Error|SQLITE_[A-Z_]+|[A-Za-z]*(Network|Timeout)Error|ECONN[A-Z]+|ETIMEDOUT)$/;

/** The message that may be recorded for a crash class: undefined unless allowlisted, then redacted. */
export function crashMessage(errorClass: string, message: string): string | undefined {
  if (!CRASH_MSG_CLASS.test(errorClass)) return undefined;
  const printable = message.replace(/[^\x20-\x7e]/g, ' ').slice(0, 120);
  return printable
    .split(/(\s+)/)
    .map((word) => (looksLikeCoordinate(word) ? '[redacted]' : word))
    .join('');
}

const ENVELOPE_KEYS = ['kind', 'at', 'level', 'src', 'seq', 'shift', 'v', 'data'];

/**
 * The single check used by the producer, the ingest endpoint and the bundle exporter. The reason
 * names a field path only, never a value.
 */
export function validateEvent(input: unknown): DiagResult {
  const fail = (reason: string): DiagResult => ({ ok: false, reason });
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('event: not an object');
  }
  const e = input as Record<string, unknown>;
  const extra = Object.keys(e).find((k) => !ENVELOPE_KEYS.includes(k));
  if (extra !== undefined) return fail(`event.${extra}: field not allowed`);

  if (typeof e.kind !== 'string' || !Object.hasOwn(diagKinds, e.kind)) {
    return fail('event.kind: unknown kind');
  }
  const spec: KindSpec = diagKinds[e.kind as DiagKind];
  if (typeof e.at !== 'number' || !Number.isInteger(e.at) || e.at < 0 || e.at > 2 ** 53 - 1) {
    return fail('event.at: not an epoch ms integer');
  }
  if (e.level !== 'basic' && e.level !== 'verbose') return fail('event.level: not allowed');
  if (spec.level === 'verbose' && e.level !== 'verbose') {
    return fail('event.level: kind is verbose only');
  }
  if (typeof e.src !== 'string' || !(spec.src as readonly string[]).includes(e.src)) {
    return fail('event.src: not allowed for this kind');
  }
  if (e.seq !== undefined && (!Number.isInteger(e.seq) || (e.seq as number) < 0)) {
    return fail('event.seq: not a non-negative integer');
  }
  if (e.shift !== undefined && !(typeof e.shift === 'string' && PATTERNS.clientId.test(e.shift))) {
    return fail('event.shift: not an id');
  }
  if (typeof e.v !== 'string' || !PATTERNS.version.test(e.v) || looksLikeCoordinate(e.v)) {
    return fail('event.v: not a version');
  }
  const shapeError = checkShape(spec.data, e.data, 'data');
  if (shapeError) return fail(shapeError);

  const data = e.data as Record<string, unknown>;
  if (e.kind === 'crash' && data.msg !== undefined && !CRASH_MSG_CLASS.test(String(data.class))) {
    return fail('data.msg: not allowed for this class');
  }
  return { ok: true, event: e as unknown as DiagEvent };
}
