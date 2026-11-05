import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { toCents } from './ShiftEarnings';

type Expense = Schemas['Expense'];
type Category = Schemas['ExpenseCategory'];

const DAY = 86_400_000;
const PICKS = [25, 50, 75, 100];
const blank = (today: string) => ({
  spent_on: today,
  category: 'fuel',
  amount: '',
  merchant: '',
  deductible: true,
  business_pct: 100,
  vehicle_id: '',
  shift_id: '',
  notes: '',
  recurrence: '',
  next_due: '',
});
type Draft = ReturnType<typeof blank>;

const draftOf = (e: Expense): Draft => ({
  spent_on: e.spent_on,
  category: e.category,
  amount: (e.amount_cents / 100).toFixed(2),
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
export function bodyOf(d: Draft): Schemas['ExpenseCreate'] {
  return {
    spent_on: d.spent_on,
    category: d.category,
    amount_cents: toCents(d.amount),
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
  const { currency, modules } = useSettings();
  const [items, setItems] = useState<Expense[] | null>(null);
  const [totals, setTotals] = useState<Schemas['ExpenseTotals'] | null>(null);
  const [due, setDue] = useState<Expense[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [vehicles, setVehicles] = useState<Schemas['Vehicle'][]>([]);
  const [shifts, setShifts] = useState<Schemas['Shift'][]>([]);
  const [filter, setFilter] = useState({ category: '', deductible: '' });
  const [merchants, setMerchants] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query: Record<string, string | boolean> = {};
      if (filter.category) query.category = filter.category;
      if (filter.deductible) query.deductible = filter.deductible === 'yes';
      const [page, t, d] = await Promise.all([
        unwrap<Schemas['ExpensePage']>(api.GET('/expenses', { params: { query: query as never } })),
        unwrap<Schemas['ExpenseTotals']>(api.GET('/expenses/totals')),
        unwrap<Expense[]>(api.GET('/expenses/due')),
      ]);
      setItems(page.items);
      setTotals(t);
      setDue(d);
    } catch (e) {
      setError(describe(e));
    }
  }, [api, filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void (async () => {
      try {
        setCats(await unwrap<Category[]>(api.GET('/expenses/categories')));
        setVehicles(await unwrap<Schemas['Vehicle'][]>(api.GET('/vehicles')));
      } catch (e) {
        setError(describe(e));
      }
    })();
  }, [api]);

  // Shifts within 7 days of the expense date are offered as a link (Comma behaviour).
  const date = draft?.spent_on;
  useEffect(() => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return setShifts([]);
    const t = Date.parse(`${date}T00:00:00Z`);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    void unwrap<Schemas['ShiftPage']>(
      api.GET('/shifts', { params: { query: { from: day(t - 7 * DAY), to: day(t + 7 * DAY) } } }),
    )
      .then((p) => setShifts(p.items))
      .catch(() => setShifts([]));
  }, [api, date]);

  const typed = draft?.merchant;
  useEffect(() => {
    if (typed === undefined) return;
    void unwrap<string[]>(api.GET('/expenses/merchants', { params: { query: { q: typed } } }))
      .then(setMerchants)
      .catch(() => setMerchants([]));
  }, [api, typed]);

  const cat = (slug: string) => cats.find((c) => c.slug === slug);
  const pick = (slug: string) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          category: slug,
          deductible: cat(slug)?.default_deductible ?? true,
          business_pct: cat(slug)?.default_business_pct ?? 100,
        },
    );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const body = bodyOf(draft);
    if (!Number.isFinite(body.amount_cents) || body.amount_cents < 1) {
      return setError('Enter an amount above zero.');
    }
    setError(null);
    try {
      if (editing === null) await unwrap(api.POST('/expenses', { body }));
      else await unwrap(api.PATCH('/expenses/{id}', { params: { path: { id: editing } }, body }));
      setDraft(null);
      setEditing(null);
      await load();
    } catch (err) {
      setError(describe(err));
    }
  }

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await load();
    } catch (err) {
      setError(describe(err));
    }
  }
  async function attach(id: number, file: File) {
    if (file.size > 10 * 1024 * 1024) return setError('A receipt can be 10 MB at most.');
    await act(() =>
      unwrap(
        api.PUT('/expenses/{id}/receipt', {
          params: { path: { id } },
          body: file as never,
          bodySerializer: (b: unknown) => b as never,
          headers: { 'Content-Type': file.type },
        } as never),
      ),
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const money = (c: number) => formatMoney(c, currency);

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Expenses</h1>
      <FormError message={error} />
      {totals ? (
        <div className="grid max-w-xl grid-cols-2 gap-4" aria-label="Year to date">
          <div className="rounded border border-line bg-card p-4">
            <div className="text-sm text-muted">Deductible {totals.year}</div>
            <div className="text-xl">{money(totals.deductible_cents)}</div>
          </div>
          <div className="rounded border border-line bg-card p-4">
            <div className="text-sm text-muted">Total spend {totals.year}</div>
            <div className="text-xl">{money(totals.total_cents)}</div>
          </div>
        </div>
      ) : null}
      {due.length > 0 ? (
        <section aria-label="Due" className="space-y-2 rounded border border-line bg-card p-4">
          <h2 className="font-heading text-lg">Due now</h2>
          {due.map((d) => (
            <div key={d.id} className="flex items-center gap-3">
              <span>
                {d.merchant || cat(d.category)?.label} {money(d.amount_cents)} (due {d.next_due})
              </span>
              <button
                type="button"
                className="text-accent"
                onClick={() =>
                  void act(() =>
                    unwrap(
                      api.POST('/expenses/{id}/occurrences', {
                        params: { path: { id: d.id } },
                        body: { spent_on: d.next_due ?? today },
                      }),
                    ),
                  )
                }
              >
                Add it
              </button>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() =>
                  void act(() =>
                    unwrap(
                      api.PUT('/expenses/{id}/snooze', {
                        params: { path: { id: d.id } },
                        body: { until: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10) },
                      }),
                    ),
                  )
                }
              >
                Remind me in a week
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {draft === null ? (
        <Button type="button" onClick={() => setDraft(blank(today))}>
          Add expense
        </Button>
      ) : (
        <form className="max-w-2xl space-y-3" onSubmit={(e) => void save(e)}>
          <div role="group" aria-label="Category" className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <button
                key={c.slug}
                type="button"
                aria-pressed={draft.category === c.slug}
                className={`rounded border px-2 py-1 text-sm ${draft.category === c.slug ? 'border-accent text-accent' : 'border-line text-muted'}`}
                onClick={() => pick(c.slug)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Date"
              type="date"
              value={draft.spent_on}
              onChange={(e) => setDraft({ ...draft, spent_on: e.target.value })}
            />
            <Field
              label="Amount"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            />
            <Field
              label="Merchant"
              list="merchants"
              maxLength={120}
              value={draft.merchant}
              onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--mw-accent)]"
                checked={draft.deductible}
                onChange={(e) => setDraft({ ...draft, deductible: e.target.checked })}
              />
              Deductible
            </label>
            <span className="text-sm text-muted">Business use</span>
            {PICKS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={draft.business_pct === p}
                className={`rounded border px-2 py-1 text-sm ${draft.business_pct === p ? 'border-accent text-accent' : 'border-line text-muted'}`}
                onClick={() => setDraft({ ...draft, business_pct: p })}
              >
                {p}%
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Vehicle"
              value={draft.vehicle_id}
              onChange={(v) => setDraft({ ...draft, vehicle_id: v })}
              options={[
                { value: '', label: 'None' },
                ...vehicles.map((v) => ({ value: String(v.id), label: v.name })),
              ]}
            />
            <SelectField
              label="Shift"
              value={draft.shift_id}
              onChange={(v) => setDraft({ ...draft, shift_id: v })}
              options={[
                { value: '', label: 'None' },
                ...shifts.map((s) => ({ value: String(s.id), label: s.local_date })),
              ]}
            />
            <SelectField
              label="Repeats"
              value={draft.recurrence}
              onChange={(v) =>
                setDraft({ ...draft, recurrence: v, next_due: draft.next_due || draft.spent_on })
              }
              options={[
                { value: '', label: 'No' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
            {draft.recurrence ? (
              <Field
                label="Next due"
                type="date"
                value={draft.next_due}
                onChange={(e) => setDraft({ ...draft, next_due: e.target.value })}
              />
            ) : null}
          </div>
          <datalist id="merchants">
            {merchants.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <Field
            label="Notes"
            maxLength={2000}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
          {cat(draft.category)?.covered_by_standard_rate && draft.vehicle_id ? (
            <p role="note" className="text-sm text-muted">
              If this vehicle uses the standard mileage rate, the rate already covers this cost: it
              is saved but not deducted.
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit">{editing === null ? 'Save expense' : 'Save changes'}</Button>
            <button
              type="button"
              className="text-muted"
              onClick={() => {
                setDraft(null);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-3">
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
        <p className="text-muted">Loading</p>
      ) : items.length === 0 ? (
        <p className="text-muted">No expenses yet.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Expenses</caption>
          <thead className="text-sm text-muted">
            <tr>
              <th className="pb-2 font-normal">Date</th>
              <th className="font-normal">Category</th>
              <th className="font-normal">Merchant</th>
              <th className="font-normal">Amount</th>
              <th className="font-normal">Deductible</th>
              {modules.receipts ? <th className="font-normal">Receipt</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className="border-t border-line">
                <td className="py-2 pr-3 font-mono text-sm">{x.spent_on}</td>
                <td className="pr-3">{cat(x.category)?.label ?? x.category}</td>
                <td className="pr-3">{x.merchant}</td>
                <td className="pr-3">{money(x.amount_cents)}</td>
                <td className="pr-3">
                  {x.double_counts ? 'covered by the mileage rate' : money(x.deductible_cents)}
                </td>
                {modules.receipts ? (
                  <td className="pr-3">
                    {x.has_receipt ? (
                      <span className="space-x-2">
                        <a
                          className="text-accent"
                          href={`/api/v1/expenses/${x.id}/receipt`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View receipt
                        </a>
                        <button
                          type="button"
                          className="text-muted hover:text-ink"
                          aria-label={`Remove receipt of ${x.merchant || x.category} ${x.spent_on}`}
                          onClick={() =>
                            void act(() =>
                              unwrap(
                                api.DELETE('/expenses/{id}/receipt', {
                                  params: { path: { id: x.id } },
                                }),
                              ),
                            )
                          }
                        >
                          Remove
                        </button>
                      </span>
                    ) : (
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        aria-label={`Attach receipt to ${x.merchant || x.category} ${x.spent_on}`}
                        className="max-w-48 text-sm"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void attach(x.id, f);
                        }}
                      />
                    )}
                  </td>
                ) : null}
                <td className="space-x-3 text-right">
                  <button
                    type="button"
                    className="text-muted hover:text-ink"
                    aria-label={`Edit ${x.merchant || x.category} ${x.spent_on}`}
                    onClick={() => {
                      setDraft(draftOf(x));
                      setEditing(x.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-muted hover:text-ink"
                    aria-label={`Delete ${x.merchant || x.category} ${x.spent_on}`}
                    onClick={() =>
                      void act(() =>
                        unwrap(api.DELETE('/expenses/{id}', { params: { path: { id: x.id } } })),
                      )
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="max-w-xl text-sm text-muted">
        {modules.receipts ? 'Photos lose their location data when they are stored. ' : ''}
        Deductible amounts are estimates to bring to an accountant, not tax advice.
      </p>
    </section>
  );
}
