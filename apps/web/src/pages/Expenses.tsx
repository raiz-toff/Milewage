import { useId, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  AddIcon,
  AttachIcon,
  DeleteIcon,
  EditIcon,
  ExpandMoreIcon,
  RemoveReceiptIcon,
} from '@/ui/icons';
import { RowMenu } from '../ui/RowMenu';
import { ShowMore } from '../ui/ShowMore';
import { EmptyState, PageHeader, Section, StatCard, TableBox, tableClass } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FormEvent } from 'react';
import { fileBody, unwrap } from '../api/client';
import { usePagedList } from '../api/paged';
import { errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { addDays, dateLocale, formatDay, todayIn } from '../days';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { FilterChip } from '../ui/chips';
import { Button, CheckField, DateField, Field, FormError, SelectField } from '../ui/form';
import { moneyInput, parseMoney } from '../format';

type Expense = Schemas['Expense'];
type Category = Schemas['ExpenseCategory'];

const PICKS = [25, 50, 75, 100];
/** Common driving costs, offered as one tap until the driver's own most used take their place. */
const COMMON = ['fuel', 'parking', 'tolls', 'phone', 'wash'];
/** The five categories offered first: the most used in `rows`, topped up with common ones, in list order. */
export function quickCategories(cats: Category[], rows: Expense[]): string[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.category, (count.get(r.category) ?? 0) + 1);
  const used = [...count].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  const known = new Set(cats.map((c) => c.slug));
  const chosen = [...new Set([...used, ...COMMON])].filter((s) => known.has(s)).slice(0, 5);
  return cats.map((c) => c.slug).filter((s) => chosen.includes(s));
}

/** A new expense: today, fuel, deductible in full, on the default vehicle (fuel is a vehicle cost). */
const blank = (today: string, vehicle = '') => ({
  spent_on: today,
  category: 'fuel',
  amount: '',
  merchant: '',
  deductible: true,
  business_pct: 100,
  vehicle_id: vehicle,
  shift_id: '',
  notes: '',
  recurrence: '',
  next_due: '',
});
type Draft = ReturnType<typeof blank>;

const draftOf = (e: Expense, currency: string): Draft => ({
  spent_on: e.spent_on,
  category: e.category,
  amount: moneyInput(e.amount_cents, currency),
  merchant: e.merchant,
  deductible: e.deductible,
  business_pct: e.business_pct,
  vehicle_id: e.vehicle_id === null ? '' : String(e.vehicle_id),
  shift_id: e.shift_id === null ? '' : String(e.shift_id),
  notes: e.notes ?? '',
  recurrence: e.recurrence ?? '',
  next_due: e.next_due ?? '',
});

/** Request body from the form: only a recurring row carries a recurrence and a next due date. */
export function bodyOf(d: Draft, currency: string): Schemas['ExpenseCreate'] {
  return {
    spent_on: d.spent_on,
    category: d.category,
    amount_cents: parseMoney(d.amount, currency),
    merchant: d.merchant.trim(),
    deductible: d.deductible,
    business_pct: d.business_pct,
    vehicle_id: d.vehicle_id === '' ? null : Number(d.vehicle_id),
    shift_id: d.shift_id === '' ? null : Number(d.shift_id),
    notes: d.notes.trim() === '' ? null : d.notes.trim(),
    recurrence: d.recurrence === '' ? null : (d.recurrence as 'weekly' | 'monthly' | 'yearly'),
    next_due: d.recurrence === '' ? null : d.next_due,
  };
}

/**
 * Expenses (module `expenses`, 18 section 5): the driver's costs, how much of each is deductible,
 * and the reminders for the ones that repeat. Estimates only; it files nothing.
 */
export function ExpensesPage() {
  const { api } = useSession();
  const { currency, modules, default_vehicle_id, timezone, country } = useSettings();
  const today = todayIn(timezone);
  // Vehicle costs go on the driver's default vehicle unless they choose another.
  const auto = default_vehicle_id === null ? '' : String(default_vehicle_id);
  const [filter, setFilter] = useState({ category: '', deductible: '' });
  const query: { category?: string; deductible?: boolean } = {};
  if (filter.category) query.category = filter.category;
  if (filter.deductible) query.deductible = filter.deductible === 'yes';
  // Read 50 at a time; the list shown stays while a new filter or the next page is read.
  const list = usePagedList(['/expenses', { query }], ({ limit, cursor }, signal) =>
    unwrap(
      api.GET('/expenses', {
        params: { query: { ...query, limit, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    ),
  );
  const items = list.items;
  const totalsQuery = useApiQuery('/expenses/totals');
  const totals = totalsQuery.data ?? null;
  const dueQuery = useApiQuery('/expenses/due');
  const due = dueQuery.data ?? [];
  const catsQuery = useApiQuery('/expenses/categories');
  const cats = catsQuery.data ?? [];
  const vehiclesQuery = useApiQuery('/vehicles');
  const vehicles = vehiclesQuery.data ?? [];
  // `?new` (the dashboard's Add expense) opens the form at once.
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<Draft | null>(() =>
    params.has('new') ? blank(today, auto) : null,
  );
  // Merchant, deductible share, vehicle, shift, repeats and notes wait behind "More details".
  const [more, setMore] = useState(false);
  const ids = useId();
  const [editing, setEditing] = useState<number | null>(null);
  const change = useChange();
  const error = errorText(change, list, totalsQuery, dueQuery, catsQuery, vehiclesQuery);

  // Shifts within 7 days of the expense date are offered as a link (Comma behaviour).
  const date = draft?.spent_on;
  const dated = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const near = useApiQuery(
    '/shifts',
    {
      params: {
        query: { from: dated ? addDays(date, -7) : '', to: dated ? addDays(date, 7) : '' },
      },
    },
    { enabled: dated },
  ).data;
  const shifts = (dated && near?.items) || [];

  const typed = draft?.merchant;
  const merchants =
    useApiQuery(
      '/expenses/merchants',
      { params: { query: { q: typed ?? '' } } },
      { enabled: typed !== undefined, placeholderData: keepPreviousData },
    ).data ?? [];

  const cat = (slug: string) => cats.find((c) => c.slug === slug);
  const quick = quickCategories(cats, items ?? []);
  // The rest, in two short groups instead of one long list.
  const rest = cats.filter((c) => !quick.includes(c.slug));
  const groups = (
    [
      ['Vehicle', rest.filter((c) => c.vehicle_related)],
      ['Work and other', rest.filter((c) => !c.vehicle_related)],
    ] as const
  ).filter(([, list]) => list.length > 0);
  const pick = (slug: string) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          category: slug,
          deductible: cat(slug)?.default_deductible ?? true,
          business_pct: cat(slug)?.default_business_pct ?? 100,
          vehicle_id:
            d.vehicle_id !== '' && d.vehicle_id !== auto
              ? d.vehicle_id
              : cat(slug)?.vehicle_related
                ? auto
                : '',
        },
    );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const body = bodyOf(draft, currency);
    if (!Number.isFinite(body.amount_cents) || body.amount_cents < 1) {
      return change.setError('Enter an amount above zero.');
    }
    const saved = await change.run((api) =>
      editing === null
        ? api.POST('/expenses', { body })
        : api.PATCH('/expenses/{id}', { params: { path: { id: editing } }, body }),
    );
    if (saved) {
      setDraft(null);
      setEditing(null);
    }
  }

  async function attach(id: number, file: File) {
    if (file.size > 10 * 1024 * 1024) return change.setError('A receipt can be 10 MB at most.');
    await change.run((api) =>
      api.PUT('/expenses/{id}/receipt', { params: { path: { id } }, ...fileBody(file) }),
    );
  }
  const money = (c: number) => formatMoney(c, currency);
  const day = (iso: string) => formatDay(iso, dateLocale(country)) || iso;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Expenses"
        description={
          <>
            {modules.receipts ? 'Photos lose their location data when they are stored. ' : ''}
            Deductible amounts are estimates to bring to an accountant, not tax advice.
          </>
        }
      >
        {draft === null ? (
          <Button
            type="button"
            onClick={() => {
              setDraft(blank(today, auto));
              setMore(false);
            }}
          >
            <AddIcon />
            Add expense
          </Button>
        ) : null}
      </PageHeader>
      <FormError message={error} />
      {totals ? (
        <div className="grid grid-cols-2 gap-3 sm:max-w-xl" aria-label="Year to date">
          <StatCard label={`Deductible ${totals.year}`} value={money(totals.deductible_cents)} />
          <StatCard
            label={`Total spend ${totals.year}`}
            value={money(totals.total_cents)}
            tone="spent"
          />
        </div>
      ) : null}
      {due.length > 0 ? (
        <Section label="Due" title="Due now">
          {due.map((d) => (
            <div key={d.id} className="flex items-center gap-3">
              <span>
                {d.merchant || cat(d.category)?.label} {money(d.amount_cents)} (due{' '}
                {day(d.next_due ?? '')})
              </span>
              <UiButton
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() =>
                  void change.run((api) =>
                    api.POST('/expenses/{id}/occurrences', {
                      params: { path: { id: d.id } },
                      body: { spent_on: d.next_due ?? today },
                    }),
                  )
                }
              >
                Add it
              </UiButton>
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void change.run((api) =>
                    api.PUT('/expenses/{id}/snooze', {
                      params: { path: { id: d.id } },
                      body: { until: addDays(today, 7) },
                    }),
                  )
                }
              >
                Remind me in a week
              </UiButton>
            </div>
          ))}
        </Section>
      ) : null}

      {draft === null ? null : (
        <Section title={editing === null ? 'New expense' : 'Edit expense'} className="max-w-2xl">
          <form className="space-y-4" onSubmit={(e) => void save(e)}>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Amount"
                inputMode="decimal"
                autoFocus
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
              <DateField
                label="Date"
                value={draft.spent_on}
                onChange={(spent_on) => setDraft({ ...draft, spent_on })}
              />
            </div>
            <div role="group" aria-labelledby={`${ids}-cat`} className="space-y-2">
              <div id={`${ids}-cat`} className="text-title-small text-on-surface">
                Category
              </div>
              <div className="flex flex-wrap gap-2">
                {quick.map((slug) => (
                  <FilterChip
                    key={slug}
                    selected={draft.category === slug}
                    onClick={() => pick(slug)}
                  >
                    {cat(slug)?.label ?? slug}
                  </FilterChip>
                ))}
                <Select
                  value={quick.includes(draft.category) ? '' : draft.category}
                  onValueChange={pick}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="More categories"
                    className={`h-8! min-w-0 rounded-small text-label-large ${quick.includes(draft.category) ? 'border-outline-variant text-on-surface-variant' : 'border-transparent bg-secondary-container text-on-secondary-container'}`}
                  >
                    <SelectValue placeholder="More…" />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {groups.map(([name, list]) => (
                      <SelectGroup key={name}>
                        <SelectLabel>{name}</SelectLabel>
                        {list.map((c) => (
                          <SelectItem key={c.slug} value={c.slug} data-value={c.slug}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-body-small text-muted-foreground">
                {!draft.deductible
                  ? 'Not deductible.'
                  : draft.business_pct === 100
                    ? 'Deductible in full.'
                    : `Deductible: ${draft.business_pct} % business use.`}
                {cat(draft.category)?.covered_by_standard_rate && draft.vehicle_id ? (
                  <span role="note">
                    {' '}
                    If this vehicle uses the standard mileage rate, the rate already covers this
                    cost: it is saved but not deducted.
                  </span>
                ) : null}
              </p>
            </div>
            <div className="space-y-1">
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore(!more)}
                className="flex items-center gap-1 rounded-small text-label-large text-muted-foreground focus-ring hover:text-foreground"
              >
                <ExpandMoreIcon
                  aria-hidden="true"
                  className={`size-4 transition-transform motion-reduce:transition-none ${more ? '' : '-rotate-90'}`}
                />
                More details
              </button>
              {more ? null : (
                <p className="pl-5 text-body-small text-muted-foreground">
                  Merchant, deductible share, vehicle, shift, repeats, notes
                </p>
              )}
            </div>
            {more ? (
              <div className="space-y-4">
                <Field
                  label="Merchant"
                  list="merchants"
                  maxLength={120}
                  value={draft.merchant}
                  onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
                />
                <datalist id="merchants">
                  {merchants.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <div className="flex flex-wrap items-center gap-3">
                  <CheckField
                    label="Deductible"
                    checked={draft.deductible}
                    onChange={(deductible) => setDraft({ ...draft, deductible })}
                  />
                  {draft.deductible ? (
                    <div role="group" aria-label="Business use" className="flex flex-wrap gap-2">
                      <span className="self-center text-body-medium text-muted-foreground">
                        Business use
                      </span>
                      {PICKS.map((p) => (
                        <FilterChip
                          key={p}
                          selected={draft.business_pct === p}
                          onClick={() => setDraft({ ...draft, business_pct: p })}
                        >
                          {p}%
                        </FilterChip>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {vehicles.length > 0 || draft.vehicle_id ? (
                    <SelectField
                      label="Vehicle"
                      value={draft.vehicle_id}
                      onChange={(v) => setDraft({ ...draft, vehicle_id: v })}
                      options={[
                        { value: '', label: 'None' },
                        ...vehicles.map((v) => ({ value: String(v.id), label: v.name })),
                      ]}
                    />
                  ) : null}
                  {shifts.length > 0 || draft.shift_id ? (
                    <SelectField
                      label="Shift"
                      value={draft.shift_id}
                      onChange={(v) => setDraft({ ...draft, shift_id: v })}
                      options={[
                        { value: '', label: 'None' },
                        ...shifts.map((s) => ({ value: String(s.id), label: s.local_date })),
                      ]}
                    />
                  ) : null}
                  <SelectField
                    label="Repeats"
                    value={draft.recurrence}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        recurrence: v,
                        next_due: draft.next_due || draft.spent_on,
                      })
                    }
                    options={[
                      { value: '', label: 'No' },
                      { value: 'weekly', label: 'Weekly' },
                      { value: 'monthly', label: 'Monthly' },
                      { value: 'yearly', label: 'Yearly' },
                    ]}
                  />
                  {draft.recurrence ? (
                    <DateField
                      label="Next due"
                      value={draft.next_due}
                      onChange={(next_due) => setDraft({ ...draft, next_due })}
                    />
                  ) : null}
                </div>
                <Field
                  label="Notes"
                  maxLength={2000}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
            ) : null}
            <div className="flex gap-3">
              <Button type="submit">{editing === null ? 'Save expense' : 'Save changes'}</Button>
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(null);
                  setEditing(null);
                }}
              >
                Cancel
              </UiButton>
            </div>
          </form>
        </Section>
      )}

      <Section title="All expenses">
        <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
          <SelectField
            label="Show category"
            value={filter.category}
            onChange={(v) => setFilter({ ...filter, category: v })}
            options={[
              { value: '', label: 'All' },
              ...cats.map((c) => ({ value: c.slug, label: c.label })),
            ]}
          />
          <SelectField
            label="Deductible"
            value={filter.deductible}
            onChange={(v) => setFilter({ ...filter, deductible: v })}
            options={[
              { value: '', label: 'Any' },
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
          />
        </div>
        {items === null ? (
          <p className="text-body-medium text-muted-foreground">Loading</p>
        ) : items.length === 0 ? (
          <EmptyState>No expenses yet.</EmptyState>
        ) : (
          <TableBox>
            <table className={tableClass}>
              <caption className="sr-only">Expenses</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Merchant</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Deductible</th>
                  {modules.receipts ? <th>Receipt</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap tabular-nums">{day(x.spent_on)}</td>
                    <td className="pr-3">{cat(x.category)?.label ?? x.category}</td>
                    <td className="pr-3">{x.merchant}</td>
                    <td className="text-right tabular-nums">{money(x.amount_cents)}</td>
                    <td className="text-right tabular-nums">
                      {x.double_counts ? 'covered by the mileage rate' : money(x.deductible_cents)}
                    </td>
                    {modules.receipts ? (
                      <td className="pr-3">
                        {x.has_receipt ? (
                          <a
                            className="font-medium underline decoration-primary decoration-2 underline-offset-4"
                            href={`/api/v1/expenses/${x.id}/receipt`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View receipt
                          </a>
                        ) : (
                          // A text button that opens the file picker: the file input itself is
                          // kept for the keyboard and screen readers, out of sight.
                          <label className="relative -ml-3 inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-label-large text-primary state-layer has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,application/pdf"
                              aria-label={`Attach receipt to ${x.merchant || x.category} ${day(x.spent_on)}`}
                              className="sr-only"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void attach(x.id, f);
                              }}
                            />
                            <AttachIcon className="size-5" />
                            Attach
                          </label>
                        )}
                      </td>
                    ) : null}
                    <td className="text-right whitespace-nowrap">
                      <RowMenu
                        name={`${x.merchant || cat(x.category)?.label || x.category} ${day(x.spent_on)}`}
                        actions={[
                          {
                            label: 'Edit',
                            icon: EditIcon,
                            onSelect: () => {
                              setDraft(draftOf(x, currency));
                              setEditing(x.id);
                              setMore(true);
                            },
                          },
                          ...(modules.receipts && x.has_receipt
                            ? [
                                {
                                  label: 'Remove receipt',
                                  icon: RemoveReceiptIcon,
                                  destructive: true,
                                  onSelect: () =>
                                    void change.run((api) =>
                                      api.DELETE('/expenses/{id}/receipt', {
                                        params: { path: { id: x.id } },
                                      }),
                                    ),
                                },
                              ]
                            : []),
                          {
                            label: 'Delete',
                            icon: DeleteIcon,
                            destructive: true,
                            onSelect: () =>
                              void change.run((api) =>
                                api.DELETE('/expenses/{id}', { params: { path: { id: x.id } } }),
                              ),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        )}
        <ShowMore more={list.more} busy={list.loadingMore} onClick={list.showMore} />
      </Section>
    </section>
  );
}
