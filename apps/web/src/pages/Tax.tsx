import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { PageHeader, Section } from '../ui/layout';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { dateLocale, formatDay, todayIn } from '../dateText';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError } from '../ui/form';
import { toCents } from './ShiftEarnings';

type TaxYear = Schemas['TaxYear'];
type Jar = Schemas['TaxJar'];

/**
 * Tax Center (module `tax`, 18 section 7). An estimate to bring to an accountant: it shows its
 * working, says when the rates are unverified, files nothing, and shows the mileage deduction as
 * a deduction, never as cash. Summary first (what to set aside, the next date, the jar), then
 * the working and the dates.
 */
export function TaxPage() {
  const { api } = useSession();
  const { currency, timezone, country } = useSettings();
  const today = todayIn(timezone);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<TaxYear | null>(null);
  const [jar, setJar] = useState<Jar | null>(null);
  const [collected, setCollected] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const money = (c: number | null | undefined) => (c == null ? '—' : formatMoney(c, currency));
  const day = (iso: string | undefined) => formatDay(iso ?? '', dateLocale(country));

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
  const salesTax = report.sales_tax_name ?? 'sales tax';
  const deadlines = [...report.deadlines].sort((a, b) =>
    (a.date ?? '').localeCompare(b.date ?? ''),
  );
  const next = deadlines.find((d) => (d.date ?? '') >= today);
  const filled = jar?.target_cents
    ? Math.min(100, (jar.balance_cents / jar.target_cents) * 100)
    : 0;

  return (
    <section className="space-y-6">
      <PageHeader title="Tax" description="What to set aside for income tax, and when it is due.">
        <div role="group" aria-label="Tax year" className="flex items-center gap-1">
          <UiButton
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous tax year"
            disabled={year <= 2000}
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft />
          </UiButton>
          <span aria-live="polite" className="w-14 text-center font-medium tabular-nums">
            {year}
          </span>
          <UiButton
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next tax year"
            disabled={year >= thisYear + 1}
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight />
          </UiButton>
        </div>
      </PageHeader>
      <FormError message={error} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section
          label={report.supported ? 'Estimate' : 'Tax jar'}
          title={report.supported ? `Set aside for ${year}` : `Tax jar for ${year}`}
        >
          {est ? (
            <div className="space-y-1">
              <p className="text-4xl font-semibold tracking-tight tabular-nums">
                {money(est.total_set_aside_cents)}
              </p>
              {next ? (
                <p className="text-sm text-muted-foreground">
                  Next: <span className="font-medium text-foreground">{next.label}</span>,{' '}
                  {day(next.date)}
                  {next.kind === 'instalment' ? `, ${money(est.instalment_cents)}` : ''}
                </p>
              ) : null}
            </div>
          ) : null}
          {/* One quiet note instead of three banners: the server's notices (unverified rates for
              this country, an estimate and not advice, nothing filed) together, by the figure. */}
          <p role="note" className="flex gap-2 text-sm text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{report.notices.join(' ')}</span>
          </p>
          {jar ? (
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm">
                <span className="font-medium">Tax jar:</span>{' '}
                <span className="tabular-nums">
                  {money(jar.balance_cents)}
                  {jar.target_cents === null ? '' : ` of ${money(jar.target_cents)}`}
                </span>
              </p>
              {jar.target_cents ? (
                <div
                  role="progressbar"
                  aria-label="Tax jar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(filled)}
                  className="h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${filled}%` }} />
                </div>
              ) : null}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addJar(toCents(amount));
                  setAmount('');
                }}
              >
                <div className="w-36 min-w-0">
                  <Field
                    label="Amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  busy={!Number.isFinite(toCents(amount)) || toCents(amount) === 0}
                >
                  Add to jar
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Your own record of what you set aside; no money moves.
              </p>
              <ul className="divide-y text-sm">
                {jar?.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-1.5">
                    <span className="tabular-nums">{day(e.entered_on)}</span>
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
            </div>
          ) : null}
        </Section>

        {deadlines.length > 0 || report.slip_alerts.length > 0 ? (
          <Section label="Deadlines" title="Deadlines">
            <ul className="divide-y text-sm">
              {deadlines.map((d) => {
                const past = (d.date ?? '') < today;
                return (
                  <li
                    key={d.date}
                    className={cn(
                      'flex items-center gap-3 py-2 first:pt-0 last:pb-0',
                      past && 'text-muted-foreground',
                    )}
                  >
                    <time dateTime={d.date} className="w-28 shrink-0 tabular-nums">
                      {day(d.date)}
                    </time>
                    <span className="min-w-0 flex-1">
                      {d.label}
                      {past ? <span className="sr-only"> (past)</span> : null}
                    </span>
                    {d === next ? <Badge>Next</Badge> : null}
                  </li>
                );
              })}
            </ul>
            {report.slip_alerts.map((a) => (
              <p key={a.platform} className="border-t pt-3 text-sm">
                {a.platform}: {money(a.total_cents)} is above {money(a.threshold_cents)}, so expect
                a {a.slip}.
              </p>
            ))}
          </Section>
        ) : null}
        {report.supported ? (
          <Section label="Working" title="How this is worked out">
            {report.income && est ? (
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Estimate</caption>
                <tbody>
                  {[
                    ['Earnings (base, tips, bonus)', money(report.income.total_cents)],
                    // Shown only when entered (plan 22), so nothing changes for other drivers.
                    ...(report.income.fees_cents
                      ? [['Platform fees (already taken off)', money(report.income.fees_cents)]]
                      : []),
                    ...(report.income.tax_withheld_cents
                      ? [
                          [
                            'Tax withheld by platforms (not counted below)',
                            money(-report.income.tax_withheld_cents),
                          ],
                        ]
                      : []),
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
                Registered for {salesTax}
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
        ) : null}
      </div>
    </section>
  );
}
