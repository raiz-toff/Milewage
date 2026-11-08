// Timing for the performance budget of 14 section 10.3 ("5,000 fixes under 50 ms on Node").
//
// The budget is about the engine's speed, so it is measured in CPU time of the calling thread
// (process.threadCpuUsage, user plus system, microsecond resolution; present in Node 22.22, which
// package.json requires): the time the engine actually ran. Wall-clock time (performance.now)
// also counts the time spent waiting for a CPU, so on a machine shared with other test runs it
// measured the load, not the engine, and the test failed at a load average of 30 on 8 cores with
// the engine unchanged. The thread's time, not the process's (process.cpuUsage), so test files
// running in other worker threads of the same process (vitest --pool=threads) are not counted.

/**
 * True in `npm run test:coverage`. V8's coverage counters slow the engine many times over (3.5 s
 * for one budget test), so the budget, which is about plain Node, is not checked there; `npm test`
 * and `npm run verify` always check it.
 */
export const instrumented = process.env.MILEWAGE_COVERAGE === '1';

/** CPU milliseconds `fn` took. */
export function cpuMs(fn: () => void): number {
  const start = process.threadCpuUsage();
  fn();
  const used = process.threadCpuUsage(start);
  return (used.user + used.system) / 1000;
}

/** The median CPU time of `runs` calls to `fn`, after `warm` calls to warm up the JIT. */
export function medianCpuMs(fn: () => void, runs = 9, warm = 3): number {
  for (let i = 0; i < warm; i++) fn();
  const times = Array.from({ length: runs }, () => cpuMs(fn)).sort((a, b) => a - b);
  return times[Math.floor(runs / 2)]!;
}
