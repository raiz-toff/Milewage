// Allowlist schema DSL for diagnostics events (16 section 4.2). A field that is not declared is
// rejected; strings must match a pattern or be an enum. Rejection reasons name the field path and
// never the offending value, so a rejected event cannot leak through a log line.

export type Field =
  | { t: 'int'; min: number; max: number; opt?: true }
  | { t: 'bool'; opt?: true }
  | { t: 'enum'; values: readonly string[]; opt?: true }
  | { t: 'str'; re: RegExp; opt?: true }
  | { t: 'ints'; len: number; min: number; max: number; opt?: true }
  | { t: 'strs'; re: RegExp; maxLen: number; opt?: true }
  | { t: 'obj'; fields: Shape; opt?: true }
  | { t: 'objs'; fields: Shape; maxLen: number; opt?: true };

export type Shape = Readonly<Record<string, Field>>;

/** Patterns of 16 section 4.2. */
export const PATTERNS = {
  // Spec pattern plus: no leading street number ("123 Main St" is not a device model).
  deviceName: /^(?!\d+ )[A-Za-z0-9 ._+-]{1,40}$/,
  identifier: /^[A-Za-z0-9_.$<>@/:-]{1,120}$/,
  version: /^[0-9A-Za-z._+-]{1,40}$/,
  code: /^[a-z0-9_]{1,40}$/,
  clientId: /^[0-9a-f-]{36}$/,
  stopKey: /^[0-9a-f-]{36}:[0-9]{10,13}:stop$/,
  printable: /^[\x20-\x7e]{1,120}$/,
} as const;

// Coordinate belt and braces: a decimal with 4+ places, or a standalone 9+ digit token
// (an E7 coordinate). Checked on every string, whatever its field.
const COORDINATE_LIKE = /-?\d{1,3}\.\d{4,}|(?<![0-9A-Za-z])\d{9,}(?![0-9A-Za-z])/;

// Credentials and addressing never appear in diagnostics (16 section 4.1): token prefixes and
// tailnet hostnames are refused in every string too.
const CREDENTIAL_LIKE = /(?<![A-Za-z0-9])mw[dp]_|mw_session|\.ts\.net/i;

/** True for text that must never be recorded: coordinate-like numbers, token prefixes, hostnames. */
export const looksLikeCoordinate = (s: string): boolean =>
  COORDINATE_LIKE.test(s) || CREDENTIAL_LIKE.test(s);

export const int = (min: number, max: number, opt?: true): Field => ({ t: 'int', min, max, opt });
export const bool = (opt?: true): Field => ({ t: 'bool', opt });
export const oneOf = (values: readonly string[], opt?: true): Field => ({ t: 'enum', values, opt });
export const str = (re: RegExp, opt?: true): Field => ({ t: 'str', re, opt });
export const ints = (len: number, min: number, max: number): Field => ({
  t: 'ints',
  len,
  min,
  max,
});
export const strs = (re: RegExp, maxLen: number): Field => ({ t: 'strs', re, maxLen });
export const obj = (fields: Shape, opt?: true): Field => ({ t: 'obj', fields, opt });
export const objs = (fields: Shape, maxLen: number): Field => ({ t: 'objs', fields, maxLen });

const isInt = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function checkString(v: unknown, re: RegExp): boolean {
  if (typeof v !== 'string' || !re.test(v)) return false;
  // A stop key carries the epoch ms of its first fix (a time of 10 to 13 numerals): not a coordinate.
  const text = re === PATTERNS.stopKey ? v.replace(/:[0-9]{10,13}:/, ':t:') : v;
  return !looksLikeCoordinate(text);
}

/** Returns an error naming the path, or null when the value fits the field. */
export function checkField(field: Field, value: unknown, path: string): string | null {
  const bad = (why: string) => `${path}: ${why}`;
  switch (field.t) {
    case 'int':
      return isInt(value, field.min, field.max) ? null : bad('not an integer in range');
    case 'bool':
      return typeof value === 'boolean' ? null : bad('not a boolean');
    case 'enum':
      return typeof value === 'string' && field.values.includes(value) ? null : bad('not allowed');
    case 'str':
      return checkString(value, field.re) ? null : bad('does not match its pattern');
    case 'ints':
      return Array.isArray(value) &&
        value.length === field.len &&
        value.every((v) => isInt(v, field.min, field.max))
        ? null
        : bad('not a fixed-length integer array');
    case 'strs':
      return Array.isArray(value) &&
        value.length <= field.maxLen &&
        value.every((v) => checkString(v, field.re))
        ? null
        : bad('not an allowed string array');
    case 'obj':
      return checkShape(field.fields, value, path);
    case 'objs': {
      if (!Array.isArray(value) || value.length > field.maxLen)
        return bad('not an allowed object array');
      for (const [i, item] of value.entries()) {
        const error = checkShape(field.fields, item, `${path}[${i}]`);
        if (error) return error;
      }
      return null;
    }
  }
}

/** Every declared field is checked, required ones must be present, undeclared ones are rejected. */
export function checkShape(shape: Shape, value: unknown, path: string): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${path}: not an object`;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(shape, key)) return `${path}.${key}: field not allowed`;
  }
  for (const [key, field] of Object.entries(shape)) {
    if (record[key] === undefined) {
      if (!field.opt) return `${path}.${key}: missing`;
      continue;
    }
    const error = checkField(field, record[key], `${path}.${key}`);
    if (error) return error;
  }
  return null;
}
