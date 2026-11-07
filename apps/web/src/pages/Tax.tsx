import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Section } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
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
      <PageHeader
        title="Tax"
        description="What to set aside for income tax, and the dates it is due."
      >
        <div className="w-28">
          <Field
            label="Tax year"
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || year)}
          />
        </div>
      </PageHeader>
      <FormError message={error} />
      {report.unverified && report.supported ? (
        <p role="alert" className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          Unverified rates: the figures below have not been checked against the official
          publications. Treat them as a planning guide only.
        </p>
      ) : null}
      {report.notices.map((n) => (
        <p key={n} role="note" className="text-sm text-muted-foreground">
          {n}
        </p>
      ))}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {report.supported ? (
          <Section label="Estimate" title={<>Estimate for {year}</>}>
            {report.income && est ? (
              <table className="w-full text-left text-sm">
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
                    ...est.lines.map((l) => [
                      l.label,
                      l.cents === null && l.note ? l.note : money(l.cents),
                    ]),
                    ['Set aside in total', money(est.total_set_aside_cents)],
                    ['Quarterly instalment (a quarter)', money(est.instalment_cents)],
                  ].map(([k, v]) => (
                    <tr
                      key={k}
                      className={
                        k === 'Set aside in total'
                          ? 'border-t-2 border-foreground/20 font-semibold'
                          : 'border-t first:border-t-0'
                      }
                    >
                      <th
                        scope="row"
                        className={`py-2 pr-4 font-normal ${k === 'Set aside in total' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                      >
                        {k}
                      </th>
                      <td className="py-2 text-right tabular-nums">{v}</td>
                    </tr>
                  ))}
                  {est.sales_tax ? (
                    <tr className="border-t">
                      <th scope="row" className="py-2 pr-4 font-normal text-muted-foreground">
                        Sales tax owing (collected − credits)
                      </th>
                      <td className="py-2 text-right tabular-nums">
                        {money(est.sales_tax.owing_cents)}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            ) : null}
            <div className="flex flex-wrap items-end gap-4 border-t pt-4">
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
                  className="size-4 accent-primary"
                  checked={report.sales_tax_registered}
                  onChange={(e) => void putYear({ sales_tax_registered: e.target.checked })}
                />
                Registered for {report.sales_tax_name ?? 'sales tax'}
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
          </Section>
        ) : (
          <div />
        )}
        <div className="space-y-6">
          {report.supported ? (
            <>
              {report.slip_alerts.length > 0 ? (
                <Section label="Slip alerts" title="Information slips">
                  {report.slip_alerts.map((a) => (
                    <p key={a.platform} className="text-sm">
                      {a.platform}: {money(a.total_cents)} is above {money(a.threshold_cents)}, so
                      expect a {a.slip}.
                    </p>
                  ))}
                </Section>
              ) : null}

              <Section label="Deadlines" title="Deadlines">
                <ul className="divide-y text-sm">
                  {report.deadlines.map((d) => (
                    <li key={d.date} className="flex gap-4 py-2 first:pt-0 last:pb-0">
                      <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                        {d.date}
                      </span>
                      <span>{d.label}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            </>
          ) : null}

          <Section label="Tax jar" title="Tax jar">
            <p className="text-sm text-muted-foreground">
              Your own record of what you set aside. Nothing here moves money.
            </p>
            {jar ? (
              <div className="space-y-2">
                <p className="text-lg font-medium tabular-nums">
                  Set aside {money(jar.balance_cents)}
                  {jar.target_cents === null ? '' : ` of ${money(jar.target_cents)} target`}
                </p>
                {jar.target_cents ? (
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{
                        width: `${Math.min(100, (jar.balance_cents / jar.target_cents) * 100)}%`,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              {[1000, 5000, 10000].map((c) => (
                <UiButton
                  key={c}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void addJar(c)}
                >
                  + {money(c)}
                </UiButton>
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
            <ul className="divide-y text-sm">
              {jar?.entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-1.5">
                  <span className="tabular-nums">{e.entered_on}</span>
                  <span>{money(e.amount_cents)}</span>
                  <span className="text-muted-foreground">{e.note}</span>
                  <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete jar entry ${e.entered_on} ${money(e.amount_cents)}`}
                    onClick={() =>
                      void act(() =>
                        unwrap(api.DELETE('/tax/jar/{id}', { params: { path: { id: e.id } } })),
                      )
                    }
                  >
                    Delete
                  </UiButton>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </section>
  );
}
