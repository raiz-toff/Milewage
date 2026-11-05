import { useCallback, useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError } from '../ui/form';
import { localDate } from './Dashboard';
import { toCents } from './ShiftEarnings';

type TaxYear = Schemas['TaxYear'];
type Jar = Schemas['TaxJar'];

/**
 * Tax Center (module `tax`, 18 section 7). An estimate to bring to an accountant: it shows its
 * working, says when the rates are unverified, files nothing, and shows the mileage deduction as
 * a deduction, never as cash.
 */
export function TaxPage() {
  const { api } = useSession();
  const { currency, timezone } = useSettings();
  const [year, setYear] = useState(() => Number(localDate(Date.now(), timezone).slice(0, 4)));
  const [report, setReport] = useState<TaxYear | null>(null);
  const [jar, setJar] = useState<Jar | null>(null);
  const [collected, setCollected] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const money = (c: number | null | undefined) => (c == null ? '—' : formatMoney(c, currency));

  const load = useCallback(async () => {
    try {
      const query = collected.trim() === '' ? {} : { collected_cents: toCents(collected) };
      const r = await unwrap<TaxYear>(
        api.GET('/tax/{year}', { params: { path: { year }, query } }),
      );
      setReport(r);
      setRate(String(r.set_aside_bp / 100));
      setJar(await unwrap<Jar>(api.GET('/tax/{year}/jar', { params: { path: { year } } })));
    } catch (e) {
      setError(describe(e));
    }
  }, [api, year, collected]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(describe(e));
    }
  }
  const putYear = (body: { set_aside_bp?: number; sales_tax_registered?: boolean }) =>
    act(() => unwrap(api.PUT('/tax/{year}', { params: { path: { year } }, body })));
  const addJar = (cents: number) =>
    act(() =>
      unwrap(
        api.POST('/tax/{year}/jar', { params: { path: { year } }, body: { amount_cents: cents } }),
      ),
    );

  if (!report) return <FormError message={error} />;
  const est = report.estimate;
  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Tax</h1>
      <FormError message={error} />
      <div className="flex items-end gap-3">
        <Field
          label="Tax year"
          type="number"
          min={2000}
          max={2100}
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || year)}
        />
      </div>
      {report.unverified && report.supported ? (
        <p role="alert" className="rounded border border-line bg-card p-3 text-sm">
          Unverified rates: the figures below have not been checked against the official
          publications. Treat them as a planning guide only.
        </p>
      ) : null}
      {report.notices.map((n) => (
        <p key={n} role="note" className="text-sm text-muted">
          {n}
        </p>
      ))}

      {report.supported ? (
        <>
          <section aria-label="Estimate" className="space-y-2">
            <h2 className="font-heading text-lg">Estimate for {year}</h2>
            {report.income && est ? (
              <table className="w-full max-w-xl text-left">
                <caption className="sr-only">Estimate</caption>
                <tbody>
                  {[
                    ['Earnings (base, tips, bonus)', money(report.income.total_cents)],
                    ['Expenses you can deduct', `− ${money(report.deductions?.expenses_cents)}`],
                    [
                      'Mileage deduction (a deduction, not cash)',
                      `− ${money(report.deductions?.mileage_cents)}`,
                    ],
                    ['Taxable income', money(est.taxable_income_cents)],
                    [
                      'Pension contribution (self-employed)',
                      est.cpp_cents === null ? (est.pension_note ?? '—') : money(est.cpp_cents),
                    ],
                    ['Pension, second band', money(est.cpp2_cents)],
                    [`Income tax at ${report.set_aside_bp / 100}%`, money(est.income_tax_cents)],
                    ['Set aside in total', money(est.total_set_aside_cents)],
                    ['Quarterly instalment (a quarter)', money(est.instalment_cents)],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-t border-line">
                      <th scope="row" className="py-1 pr-4 font-normal text-muted">
                        {k}
                      </th>
                      <td className="text-right">{v}</td>
                    </tr>
                  ))}
                  {est.sales_tax ? (
                    <tr className="border-t border-line">
                      <th scope="row" className="py-1 pr-4 font-normal text-muted">
                        Sales tax owing (collected − credits)
                      </th>
                      <td className="text-right">{money(est.sales_tax.owing_cents)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            ) : null}
            <div className="flex flex-wrap items-end gap-4">
              <Field
                label="Set-aside rate (%)"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <Button
                type="button"
                busy={!(Number(rate) >= 0 && Number(rate) <= 100)}
                onClick={() => void putYear({ set_aside_bp: Math.round(Number(rate) * 100) })}
              >
                Save rate
              </Button>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--mw-accent)]"
                  checked={report.sales_tax_registered}
                  onChange={(e) => void putYear({ sales_tax_registered: e.target.checked })}
                />
                Registered for GST/HST
              </label>
              {report.sales_tax_registered ? (
                <Field
                  label="Sales tax you collected"
                  inputMode="decimal"
                  value={collected}
                  onChange={(e) => setCollected(e.target.value)}
                />
              ) : null}
            </div>
          </section>

          {report.slip_alerts.length > 0 ? (
            <section aria-label="Slip alerts" className="space-y-1">
              <h2 className="font-heading text-lg">Information slips</h2>
              {report.slip_alerts.map((a) => (
                <p key={a.platform} className="text-sm">
                  {a.platform}: {money(a.total_cents)} is above {money(a.threshold_cents)}, so
                  expect a {a.slip}.
                </p>
              ))}
            </section>
          ) : null}

          <section aria-label="Deadlines" className="space-y-1">
            <h2 className="font-heading text-lg">Deadlines</h2>
            <ul className="text-sm">
              {report.deadlines.map((d) => (
                <li key={d.date}>
                  <span className="font-mono">{d.date}</span> {d.label}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <section aria-label="Tax jar" className="space-y-2">
        <h2 className="font-heading text-lg">Tax jar</h2>
        <p className="text-sm text-muted">
          Your own record of what you set aside. Nothing here moves money.
        </p>
        {jar ? (
          <p>
            Set aside {money(jar.balance_cents)}
            {jar.target_cents === null ? '' : ` of ${money(jar.target_cents)} target`}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          {[1000, 5000, 10000].map((c) => (
            <button
              key={c}
              type="button"
              className="rounded border border-line px-3 py-2 text-sm"
              onClick={() => void addJar(c)}
            >
              + {money(c)}
            </button>
          ))}
          <Field
            label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            type="button"
            busy={!Number.isFinite(toCents(amount)) || toCents(amount) === 0}
            onClick={() => {
              void addJar(toCents(amount));
              setAmount('');
            }}
          >
            Add to jar
          </Button>
        </div>
        <ul className="text-sm">
          {jar?.entries.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="font-mono">{e.entered_on}</span>
              <span>{money(e.amount_cents)}</span>
              <span className="text-muted">{e.note}</span>
              <button
                type="button"
                className="text-muted hover:text-ink"
                aria-label={`Delete jar entry ${e.entered_on} ${money(e.amount_cents)}`}
                onClick={() =>
                  void act(() =>
                    unwrap(api.DELETE('/tax/jar/{id}', { params: { path: { id: e.id } } })),
                  )
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
      <p className="max-w-xl text-sm text-muted">
        Estimates to bring to an accountant, not tax advice. MileWage does not file anything.
      </p>
    </section>
  );
}
