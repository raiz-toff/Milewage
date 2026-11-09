import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createTaxRepository, createVehicleRepository, type Db } from '../db';
import { ProblemError } from '../errors';
import type { DeductionMethods, MileageDeduction } from '../mileage-deduction';
import { taxReport } from '../tax-report';
import type { DriverContexts } from '../driver-context';
import { idParams, strictObject } from './util';

const yearParam = { type: 'integer', minimum: 2000, maximum: 2100 };
const yearParams = strictObject({ year: yearParam }, ['year']);
const yearBody = strictObject(
  {
    set_aside_bp: { type: 'integer', minimum: 0, maximum: 10000 },
    sales_tax_registered: { type: 'boolean' },
  },
  [],
  { minProperties: 1 },
);
const reportQuery = strictObject({ collected_cents: { type: 'integer', minimum: 0 } }, []);
const jarBody = strictObject(
  {
    amount_cents: { type: 'integer', minimum: -1_000_000_000, maximum: 1_000_000_000 },
    entered_on: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    note: { type: ['string', 'null'], maxLength: 200 },
  },
  ['amount_cents'],
);
const vehicleParams = strictObject({ id: { type: 'integer', minimum: 1 }, year: yearParam }, [
  'id',
  'year',
]);
const vehicleBody = strictObject(
  {
    method: { enum: ['standard_mileage', 'actual_expenses'] },
    rate1_milli: { type: ['integer', 'null'], minimum: 0 },
    rate2_milli: { type: ['integer', 'null'], minimum: 0 },
    threshold_m: { type: ['integer', 'null'], minimum: 0 },
  },
  ['method'],
);

/** The deduction method the driver saved for each vehicle in a year (`PUT /vehicles/{id}/tax-years/{year}`). */
export const taxDeductionMethods =
  (db: Db): DeductionMethods =>
  (userId, year) =>
    new Map(
      createTaxRepository(db)
        .vehicleYears(userId, year)
        .map((v) => [v.vehicleId, v.method]),
    );

/**
 * Module `tax` (18 section 7): the Tax Center. It estimates, never files. Its saved deduction
 * methods (`taxDeductionMethods`) are what the mileage deduction reads while the module is on, so a
 * vehicle set to actual expenses has no mileage deduction value in the summary and the exports.
 */
export function taxRoutes({
  db,
  deduction,
  drivers,
  authn,
  countries,
  override,
}: {
  db: Db;
  deduction: MileageDeduction;
  drivers: DriverContexts;
  authn: Authenticator;
  countries: readonly string[];
  override?: 'replace' | 'sum';
}) {
  return ({ app, registry }: ServerRouteHost) => {
    const repo = createTaxRepository(db);
    const vehicles = createVehicleRepository(db);
    const report = (userId: number, year: number, collected = 0) =>
      taxReport({ db, drivers, deduction, registry, countries, override }, userId, year, collected);
    const jarView = (userId: number, year: number) => {
      const entries = repo.jar(userId, year);
      return {
        year,
        balance_cents: entries.reduce((a, e) => a + e.amountCents, 0),
        target_cents: report(userId, year).jar.target_cents,
        entries: entries.map((e) => ({
          id: e.id,
          amount_cents: e.amountCents,
          entered_on: e.enteredOn,
          note: e.note,
        })),
      };
    };
    const vehicleView = (userId: number, vehicleId: number, year: number) => {
      const row = repo.vehicleYear(userId, vehicleId, year);
      return {
        vehicle_id: vehicleId,
        tax_year: year,
        method: row?.method ?? 'standard_mileage',
        source: row ? 'saved' : 'default',
        rate1_milli: row?.rate1Milli ?? null,
        rate2_milli: row?.rate2Milli ?? null,
        threshold_m: row?.thresholdM ?? null,
      };
    };
    const ownVehicle = (userId: number, id: number) => {
      if (!vehicles.find(userId, id)) throw new ProblemError('not_found', 'No such vehicle.');
    };

    app.get(
      '/tax/:year',
      { schema: { params: yearParams, querystring: reportQuery } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const year = (req.params as { year: number }).year;
        return report(
          userId,
          year,
          (req.query as { collected_cents?: number }).collected_cents ?? 0,
        );
      },
    );

    app.put('/tax/:year', { schema: { params: yearParams, body: yearBody } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const year = (req.params as { year: number }).year;
      const b = req.body as { set_aside_bp?: number; sales_tax_registered?: boolean };
      const old = repo.year(userId, year);
      repo.putYear(userId, year, {
        setAsideBp: b.set_aside_bp ?? old.setAsideBp,
        salesTaxRegistered:
          b.sales_tax_registered === undefined
            ? old.salesTaxRegistered
            : b.sales_tax_registered
              ? 1
              : 0,
      });
      return report(userId, year);
    });

    app.get('/tax/:year/jar', { schema: { params: yearParams } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      return jarView(userId, (req.params as { year: number }).year);
    });

    app.post(
      '/tax/:year/jar',
      { schema: { params: yearParams, body: jarBody } },
      async (req, reply) => {
        const { userId } = authn.authenticate(req, 'S');
        const year = (req.params as { year: number }).year;
        const b = req.body as { amount_cents: number; entered_on?: string; note?: string | null };
        if (b.amount_cents === 0) {
          throw new ProblemError('validation_failed', 'The entry is not valid.', [
            { path: '/amount_cents', message: 'must not be zero' },
          ]);
        }
        const on = b.entered_on ?? drivers.of(userId).today();
        repo.addJar(userId, year, b.amount_cents, on, b.note ?? null);
        return reply.status(201).send(jarView(userId, year));
      },
    );

    app.delete('/tax/jar/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      if (!repo.deleteJar(userId, (req.params as { id: number }).id)) {
        throw new ProblemError('not_found', 'No such jar entry.');
      }
      return reply.status(204).send();
    });

    app.get('/vehicles/:id/tax-years/:year', { schema: { params: vehicleParams } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const p = req.params as { id: number; year: number };
      ownVehicle(userId, p.id);
      return vehicleView(userId, p.id, p.year);
    });

    app.put(
      '/vehicles/:id/tax-years/:year',
      { schema: { params: vehicleParams, body: vehicleBody } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const p = req.params as { id: number; year: number };
        ownVehicle(userId, p.id);
        const b = req.body as {
          method: 'standard_mileage' | 'actual_expenses';
          rate1_milli?: number | null;
          rate2_milli?: number | null;
          threshold_m?: number | null;
        };
        repo.putVehicleYear(userId, {
          vehicleId: p.id,
          taxYear: p.year,
          method: b.method,
          rate1Milli: b.rate1_milli ?? null,
          rate2Milli: b.rate2_milli ?? null,
          thresholdM: b.threshold_m ?? null,
        });
        return vehicleView(userId, p.id, p.year);
      },
    );

    app.delete(
      '/vehicles/:id/tax-years/:year',
      { schema: { params: vehicleParams } },
      async (req, reply) => {
        const { userId } = authn.authenticate(req, 'S');
        const p = req.params as { id: number; year: number };
        ownVehicle(userId, p.id);
        repo.deleteVehicleYear(userId, p.id, p.year);
        return reply.status(204).send();
      },
    );
  };
}
