import type { DiagKind } from './kinds';

/**
 * How hosts report diagnostics (16 section 3.3). The engine never imports this: the host calls
 * `record` after the engine returns. Nothing else in the codebase depends on the diagnostics module.
 */
export interface DiagnosticsPort {
  record(kind: DiagKind, data: Record<string, unknown>): void;
}

/** Used when the diagnostics module is off (and as the default until M2.11). */
export const noopDiagnostics: DiagnosticsPort = Object.freeze({
  record() {},
});
