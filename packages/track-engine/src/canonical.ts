/**
 * Canonical JSON for engine results (14 section 10.1): keys sorted by UTF-16 code unit,
 * no whitespace, `undefined` object members omitted, integers only. Two engines that agree
 * on a result produce the same bytes, so a byte comparison is the conformance test.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new RangeError(`canonicalJson: ${String(value)} is not a safe integer`);
      }
      return Object.is(value, -0) ? '0' : String(value);
    case 'object': {
      if (Array.isArray(value))
        return '[' + value.map((v) => canonicalJson(v ?? null)).join(',') + ']';
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
    }
    default:
      throw new TypeError(`canonicalJson: cannot encode ${typeof value}`);
  }
}
