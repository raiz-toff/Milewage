// Small numeric helpers shared by the load generator and the runner.

/** Percentile `p` (0..1) of `values`, rounded to 0.1, or null when empty. */
export function pct(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10;
}

/** /proc kB figures to MB with one decimal. */
export const mb = (kb) => Math.round(kb / 102.4) / 10;

export const avg = (values) => values.reduce((a, b) => a + b, 0) / values.length;

/** Free-form `--key value` / `--flag` arguments to an object. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : next;
  }
  return out;
}
