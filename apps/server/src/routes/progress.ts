import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { type Db } from '../db';
import { evaluateProgress } from '../progress-engine';
import type { DriverContexts } from '../driver-context';

/** Module `progress` (18 section 8.2), off by default. `GET /progress` evaluates and records new unlocks (idempotent). */
export function progressRoutes({
  db,
  now,
  authn,
  drivers,
  override,
  challengeTargetCents,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  drivers: DriverContexts;
  override?: 'replace' | 'sum';
  challengeTargetCents: number;
}) {
  return ({ app, registry, bus }: ServerRouteHost) => {
    app.get('/progress', async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      return evaluateProgress(
        { db, now, drivers, registry, override, challengeTargetCents, emit: bus.emit },
        userId,
      );
    });
  };
}
