import { useEffect, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, InfoIcon } from '@/ui/icons';
import { PageHeader, Section } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { errorText, useApiQuery, useChange } from '../api/query';
import { dateLocale, formatDay, todayIn } from '../days';
import { formatMoney, parseMoney } from '../format';
import { useSettings } from '../session';
import { Button, CheckField, Field, FormError } from '../ui/form';
import { MoreCard } from '../ui/MoreCard';
import { TaxJar } from '../ui/TaxJar';
import { usePlatformOf } from '../platforms/usePlatforms';

/** A line of the working: label, figure, and whether it is muted ($0.00 or not estimated). */
type Line = [string, string, boolean];
const line = (label: string, value: string, quiet = false): Line => [label, value, quiet];
const TOTAL = 'Set aside in total';

/**
 * Tax Center (module `tax`, 18 section 7). An estimate to bring to an accountant: it shows its
 * working, says when the rates are unverified, files nothing, and shows the mileage deduction as
 * a deduction, never as cash. Three cards first: what to set aside with the next date, the tax
 * jar as a jar that fills, and the deadlines as a list; the working, the settings and the jar's
 * entries are folded below them (progressive disclosure).
 */
export function TaxPage() {
  const { currency, timezone, country } = useSettings();
  const today = todayIn(timezone);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [collected, setCollected] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  // The figures shown stay while another year or another collected amount is read.
  const query = collected.trim() === '' ? {} : { collected_cents: parseMoney(collected, currency) };
  const asked = useApiQuery(
    '/tax/{year}',
    { params: { path: { year }, query } },
    { placeholderData: keepPreviousData },
  );
  const report = asked.data ?? null;
  const jarQuery = useApiQuery(
    '/tax/{year}/jar',
    { params: { path: { year } } },
    { placeholderData: keepPreviousData },
  );
  const jar = jarQuery.data ?? null;
  useEffect(() => {
    if (report) setRate(String(report.set_aside_bp / 100));
  }, [report]);
  const change = useChange();
  const error = errorText(change, asked, jarQuery);
  const money = (c: number | null | undefined) => (c == null ? '—' : formatMoney(c, currency));
  const day = (iso: string | undefined) => formatDay(iso ?? '', dateLocale(country));
  const platformOf = usePlatformOf();

  const putYear = (body: { set_aside_bp?: number; sales_tax_registered?: boolean }) =>
    change.run((api) => api.PUT('/tax/{year}', { params: { path: { year } }, body }));
  const addJar = (cents: number) =>
    change.run((api) =>
      api.POST('/tax/{year}/jar', { params: { path: { year } }, body: { amount_cents: cents } }),
    );

  if (!report) return <FormError message={error} />;
  const est = report.estimate;
  const income = report.income;
  const salesTax = report.sales_tax_name ?? 'sales tax';
  const deadlines = [...report.deadlines].sort((a, b) =>
    (a.date ?? '').localeCompare(b.date ?? ''),
  );
  const next = deadlines.find((d) => (d.date ?? '') >= today);
  const daysTo = (iso: string | undefined) =>
    Math.round((Date.parse(iso ?? today) - Date.parse(today)) / 86_400_000);
  // One quiet note instead of three banners: the server's notices (unverified rates for this
  // country, an estimate and not advice, nothing filed) together, by the figure.
  const note = (
    <p
      role="note"
      className="flex gap-3 rounded-medium bg-surface-container-high p-3 text-body-medium text-on-surface-variant"
    >
      <InfoIcon className="size-5 shrink-0" />
      <span>{report.notices.join(' ')}</span>
    </p>
  );

  // Every figure the API returns stays here; a $0.00 or not-estimated line is muted, not hidden.
  const working: Line[] =
    income && est
      ? [
          line('Earnings (base, tips, bonus)', money(income.total_cents)),
          // Shown only when entered (plan 22), so nothing changes for other drivers.
          ...(income.fees_cents
            ? [line('Platform fees (already taken off)', money(income.fees_cents))]
            : []),
          ...(income.tax_withheld_cents
            ? [
                line(
                  'Tax withheld by platforms (not counted below)',
                  money(-income.tax_withheld_cents),
                ),
              ]
            : []),
          line('Expenses you can deduct', `− ${money(report.deductions?.expenses_cents)}`),
          line(
            // Your rate is always called yours, never official (Q5, ADR 0007).
            report.deductions?.mileage_rate === 'yours'
              ? 'Mileage deduction at your rate (a deduction, not cash)'
              : report.deductions?.mileage_rate === 'mixed'
                ? 'Mileage deduction, country rate then your rate (a deduction, not cash)'
                : 'Mileage deduction (a deduction, not cash)',
            `− ${money(report.deductions?.mileage_cents)}`,
          ),
          line('Taxable income', money(est.taxable_income_cents)),
          ...est.lines.map((l) =>
            line(l.label, l.cents === null && l.note ? l.note : money(l.cents), !l.cents),
          ),
          line(TOTAL, money(est.total_set_aside_cents)),
          line('Quarterly instalment (a quarter)', money(est.instalment_cents)),
          ...(est.sales_tax
            ? [line('Sales tax owing (collected − credits)', money(est.sales_tax.owing_cents))]
            : []),
        ]
      : [];

  const details = [
    ...(working.length && est
      ? [
          {
            key: 'working',
            title: 'How this is worked out',
            hint: `Taxable income ${money(est.taxable_income_cents)}, then each amount to set aside`,
            body: (
              <table className="w-full text-left text-body-medium">
                <caption className="sr-only">How this is worked out</caption>
                <tbody>
                  {working.map(([k, v, quiet]) => (
                    <tr
                      key={k}
                      className={cn(
                        k === TOTAL
                          ? 'border-t-2 border-outline font-medium'
                          : 'border-t border-outline-variant first:border-t-0',
                        quiet && 'text-muted-foreground',
                      )}
                    >
                      <th
                        scope="row"
                        className={cn(
                          'py-2 pr-4 font-normal',
                          k === TOTAL ? 'font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {k}
                      </th>
                      <td className="py-2 text-right tabular-nums">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
        ]
      : []),
    ...(report.supported
      ? [
          {
            key: 'settings',
            title: 'Tax settings',
            hint: `Set aside ${report.set_aside_bp / 100}%; ${report.sales_tax_registered ? '' : 'not '}registered for ${salesTax}`,
            body: (
              <div className="flex flex-wrap items-end gap-4">
                <Field
                  label="Set-aside rate (%)"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                <Button
                  type="button"
                  variant="tonal"
                  busy={!(Number(rate) >= 0 && Number(rate) <= 100)}
                  onClick={() => void putYear({ set_aside_bp: Math.round(Number(rate) * 100) })}
                >
                  Save rate
                </Button>
                <CheckField
                  label={`Registered for ${salesTax}`}
                  checked={report.sales_tax_registered}
                  onChange={(on) => void putYear({ sales_tax_registered: on })}
                />
                {report.sales_tax_registered ? (
                  <Field
                    label="Sales tax you collected"
                    inputMode="decimal"
                    value={collected}
                    onChange={(e) => setCollected(e.target.value)}
                  />
                ) : null}
              </div>
            ),
          },
        ]
      : []),
    ...(jar?.entries.length
      ? [
          {
            key: 'jar',
            title: 'Tax jar entries',
            hint: `${jar.entries.length} added for ${year}`,
            body: (
              <ul className="divide-y divide-outline-variant text-body-medium">
                {jar.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-1.5">
                    <span className="tabular-nums">{day(e.entered_on)}</span>
                    <span className="tabular-nums">{money(e.amount_cents)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.note}</span>
                    <UiButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-error"
                      aria-label={`Delete jar entry ${day(e.entered_on)} ${money(e.amount_cents)}`}
                      onClick={() =>
                        void change.run((api) =>
                          api.DELETE('/tax/jar/{id}', { params: { path: { id: e.id } } }),
                        )
                      }
                    >
                      Delete
                    </UiButton>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="space-y-6">
      <PageHeader title="Tax" description="What to set aside for income tax, and when it is due.">
        <div role="group" aria-label="Tax year" className="flex items-center gap-1">
          <UiButton
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous tax year"
            disabled={year <= 2000}
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeftIcon />
          </UiButton>
          <span aria-live="polite" className="w-16 text-center text-title-large tabular-nums">
            {year}
          </span>
          <UiButton
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next tax year"
            disabled={year >= thisYear + 1}
            onClick={() => setYear(year + 1)}
          >
            <ChevronRightIcon />
          </UiButton>
        </div>
      </PageHeader>
      <FormError message={error} />

      <div className="grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-3">
        {report.supported ? (
          <Section
            label="Estimate"
            title={`Set aside for ${year}`}
            className="md:col-span-2 xl:col-span-1"
          >
            {est ? (
              <>
                <p className="text-display-medium font-medium tabular-nums">
                  {money(est.total_set_aside_cents)}
                </p>
                {next ? (
                  <p className="flex w-fit items-center gap-2 rounded-small bg-secondary-container px-3 py-1.5 text-body-medium text-on-secondary-container">
                    <CalendarIcon className="size-[18px] shrink-0" />
                    <span>
                      Next: <span className="font-medium">{next.label}</span>, {day(next.date)}
                      {next.kind === 'instalment' ? `, ${money(est.instalment_cents)}` : ''}
                    </span>
                  </p>
                ) : null}
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-display-medium font-medium text-on-surface-variant">—</p>
                <p className="text-title-small text-on-surface">No estimate yet</p>
              </div>
            )}
            {note}
          </Section>
        ) : (
          <Section title={`Tax for ${year}`} className="md:col-span-2 xl:col-span-1">
            {note}
          </Section>
        )}

        {jar ? (
          <Section
            label="Tax jar"
            title="Tax jar"
            description="Your own record of what you set aside; no money moves."
          >
            <div className="flex items-center gap-5">
              <TaxJar
                label="Tax jar"
                balanceCents={jar.balance_cents}
                targetCents={jar.target_cents}
              />
              <div className="min-w-0 space-y-1">
                <p className="text-headline-medium font-medium tabular-nums">
                  {money(jar.balance_cents)}
                </p>
                <p className="text-body-medium text-on-surface-variant tabular-nums">
                  {jar.target_cents === null ? 'set aside so far' : `of ${money(jar.target_cents)}`}
                </p>
                {jar.target_cents ? (
                  <p className="text-body-small text-on-surface-variant tabular-nums">
                    {jar.balance_cents >= jar.target_cents
                      ? 'The jar is full'
                      : `${money(jar.target_cents - jar.balance_cents)} to go`}
                  </p>
                ) : null}
              </div>
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addJar(parseMoney(amount, currency));
                setAmount('');
              }}
            >
              <div className="min-w-0 flex-1">
                <Field
                  label="Amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                busy={
                  !Number.isFinite(parseMoney(amount, currency)) ||
                  parseMoney(amount, currency) === 0
                }
              >
                Add to jar
              </Button>
            </form>
          </Section>
        ) : null}

        {deadlines.length > 0 || report.slip_alerts.length > 0 ? (
          <Section label="Deadlines" title="Deadlines">
            {/* A Material list: a leading mark, the deadline over its date, "Next" trailing. */}
            <ul className="-mx-2">
              {deadlines.map((d) => {
                const past = (d.date ?? '') < today;
                const isNext = d === next;
                const left = daysTo(d.date);
                return (
                  <li
                    key={d.date}
                    className={cn(
                      'flex min-h-14 items-center gap-3 rounded-medium px-2 py-2',
                      past && 'text-muted-foreground',
                      isNext && 'bg-secondary-container text-on-secondary-container',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-full',
                        isNext
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-high text-on-surface-variant',
                      )}
                    >
                      {past ? (
                        <CheckIcon className="size-5" />
                      ) : (
                        <CalendarIcon className="size-5" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col-reverse">
                      <time
                        dateTime={d.date}
                        className={cn(
                          'text-body-medium tabular-nums',
                          !isNext && 'text-on-surface-variant',
                        )}
                      >
                        {day(d.date)}
                      </time>
                      <span className="text-body-large">
                        {d.label}
                        {past ? <span className="sr-only"> (past)</span> : null}
                      </span>
                    </span>
                    {isNext ? (
                      <span className="shrink-0 text-right">
                        <span className="block text-label-large">Next</span>
                        <span aria-hidden="true" className="block text-body-small tabular-nums">
                          {left === 0 ? 'today' : `in ${left} ${left === 1 ? 'day' : 'days'}`}
                        </span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {report.slip_alerts.map((a) => (
              <p key={a.platform} className="border-t border-outline-variant pt-3 text-body-medium">
                {a.platform ? `${platformOf(a.platform).label}: ` : ''}
                {money(a.total_cents)} is above {money(a.threshold_cents)}, so expect a {a.slip}.
              </p>
            ))}
          </Section>
        ) : null}
      </div>

      {details.length > 0 ? <MoreCard label="Details" title="Details" rows={details} /> : null}
    </section>
  );
}
