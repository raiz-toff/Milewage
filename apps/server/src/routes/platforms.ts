import { builtinPlatform, CUSTOM_SLUG, resolvePlace } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createPlatformRepository, type Db } from '../db';
import type { DriverContexts } from '../driver-context';
import { ProblemError } from '../errors';
import { strictObject } from './util';

const slugParams = strictObject({ slug: { type: 'string', pattern: '^[a-z0-9_]{1,32}$' } }, [
  'slug',
]);
const query = strictObject({ include_inactive: { type: 'boolean' } }, []);
const putBody = strictObject(
  {
    label: { type: 'string', minLength: 1, maxLength: 40 },
    color: { type: ['string', 'null'], pattern: '^#[0-9a-f]{6}$' },
    emoji: { type: ['string', 'null'], maxLength: 8 },
    active: { type: 'boolean' },
    sort: { type: 'integer', minimum: 0, maximum: 10000 },
    hourly_target_cents: { type: ['integer', 'null'], minimum: 0 },
  },
  [],
);

/** A platform slug the driver may use on a label or an earnings row: a built-in or one of their own. */
export function platformKnown(db: Db, userId: number, slug: string): boolean {
  return (
    builtinPlatform(slug) !== undefined ||
    createPlatformRepository(db).find(userId, slug) !== undefined
  );
}

/** Module `platforms` (18 section 4.2): the registry merged with the driver's overrides. */
export function platformsRoutes({
  db,
  drivers,
  authn,
}: {
  db: Db;
  drivers: DriverContexts;
  authn: Authenticator;
}) {
  return ({ app }: ServerRouteHost) => {
    const repo = createPlatformRepository(db);

    const view = (slug: string, userId: number, order: number) => {
      const built = builtinPlatform(slug);
      const row = repo.find(userId, slug);
      if (!built && !row) return undefined;
      return {
        slug,
        label: row?.custom ? row.label : (built?.label ?? row!.label),
        custom: !built,
        color: row?.color ?? null,
        emoji: row?.emoji ?? null,
        active: (row?.active ?? 1) === 1,
        sort: row?.sort ?? order * 10,
        hourly_target_cents: row?.hourlyTargetCents ?? null,
      };
    };

    app.get('/platforms', { schema: { querystring: query } }, async (req) => {
      const { userId } = authn.authenticate(req, 'SD');
      const driver = drivers.of(userId);
      const all = (req.query as { include_inactive?: boolean }).include_inactive === true;
      // The country's list for the driver's region (a region may add or remove an app), then their own.
      const offered = driver.pack
        ? (resolvePlace(driver.pack, driver.region).data.platforms ?? [])
        : [];
      const slugs = [...offered.map((p) => p.slug), ...repo.list(userId).map((r) => r.slug)];
      return [...new Set(slugs)]
        .map((s, i) => view(s, userId, i))
        .filter((p): p is NonNullable<typeof p> => p !== undefined && (all || p.active))
        .sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug));
    });

    app.put('/platforms/:slug', { schema: { params: slugParams, body: putBody } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const slug = (req.params as { slug: string }).slug;
      const b = req.body as {
        label?: string;
        color?: string | null;
        emoji?: string | null;
        active?: boolean;
        sort?: number;
        hourly_target_cents?: number | null;
      };
      const built = builtinPlatform(slug);
      const old = repo.find(userId, slug);
      if (built && b.label !== undefined) {
        throw new ProblemError('validation_failed', 'The platform is not valid.', [
          { path: '/label', message: 'a built-in platform keeps its name' },
        ]);
      }
      if (!built && !old && b.label === undefined) {
        throw new ProblemError('validation_failed', 'The platform is not valid.', [
          { path: '/label', message: 'a new platform needs a name' },
        ]);
      }
      if (!built && !CUSTOM_SLUG.test(slug)) {
        throw new ProblemError('validation_failed', 'The platform is not valid.', [
          { path: '/slug', message: 'use lower-case letters, digits and underscores' },
        ]);
      }
      repo.put({
        userId,
        slug,
        label: b.label ?? old?.label ?? built!.label,
        custom: built ? 0 : 1,
        color: b.color === undefined ? (old?.color ?? null) : b.color,
        emoji: b.emoji === undefined ? (old?.emoji ?? null) : b.emoji,
        active: b.active === undefined ? (old?.active ?? 1) : b.active ? 1 : 0,
        sort: b.sort ?? old?.sort ?? 0,
        hourlyTargetCents:
          b.hourly_target_cents === undefined
            ? (old?.hourlyTargetCents ?? null)
            : b.hourly_target_cents,
      });
      return view(slug, userId, 0);
    });

    app.delete('/platforms/:slug', { schema: { params: slugParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const slug = (req.params as { slug: string }).slug;
      const built = builtinPlatform(slug);
      const row = repo.find(userId, slug);
      if (!built && !row) throw new ProblemError('not_found', 'No such platform.');
      if (!built && repo.inUse(userId, slug)) {
        throw new ProblemError(
          'platform_in_use',
          'Labels or earnings use this platform. Deactivate it instead.',
        );
      }
      repo.delete(userId, slug); // a built-in override is reset to its defaults
      return reply.status(204).send();
    });
  };
}
