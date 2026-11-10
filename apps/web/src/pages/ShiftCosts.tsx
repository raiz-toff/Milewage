import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button as UiButton } from '@/components/ui/button';
import { DeleteIcon } from '@/ui/icons';
import type { Schemas } from '../api/client';
import { errorText, useApiQuery, useChange } from '../api/query';
import { formatMoney, parseMoney } from '../format';
import { useSettings } from '../session';
import { SegmentedButtons } from '../ui/chips';
import { Button, Field, FormError } from '../ui/form';
import { Section } from '../ui/layout';

type Shift = Schemas['Shift'];
type Expense = Schemas['Expense'];
type Kind = 'parking' | 'tolls';

/** The two quick categories; both already exist in the expense list (`expense-categories.ts`). */
const KINDS: readonly { value: Kind; label: string; one: string }[] = [
  { value: 'parking', label: 'Parking', one: 'parking' },
  { value: 'tolls', label: 'Toll', one: 'toll' },
];
const isCost = (e: Expense) => e.category === 'parking' || e.category === 'tolls';

/** The shift's parking and tolls: its linked expenses of those two categories. */
export function useShiftCosts(shiftId: number | undefined, enabled: boolean) {
  const query = useApiQuery(
    '/expenses',
    { params: { query: { shift_id: shiftId ?? 0, limit: 200 } } },
    { enabled: enabled && shiftId !== undefined },
  );
  const items = query.data?.items.filter(isCost) ?? null;
  return {
    query,
    items,
    totalCents: items ? items.reduce((a, e) => a + e.amount_cents, 0) : null,
  };
}

/**
 * Parking and tolls paid during a shift (module `expenses`): a quick form that saves a normal
 * expense linked to the shift and its vehicle, on the shift's day, and the shift's total. Each
 * entry is in Expenses like any other, with a receipt if one is added there.
 */
export function ShiftCosts({ shift, bare }: { shift: Shift; bare?: boolean }) {
  const { currency } = useSettings();
  const { query, items, totalCents } = useShiftCosts(shift.id, true);
  const change = useChange();
  const error = errorText(change, query);
  const [kind, setKind] = useState<Kind>('parking');
  const [amount, setAmount] = useState('');
  const [where, setWhere] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoney(amount, currency);
    if (!Number.isFinite(cents) || cents <= 0) {
      return change.setError('Enter the amount you paid, for example 6.50.');
    }
    const done = await change.run((api) =>
      api.POST('/expenses', {
        body: {
          spent_on: shift.local_date,
          category: kind,
          amount_cents: cents,
          merchant: where.trim(),
          vehicle_id: shift.vehicle_id,
          shift_id: shift.id,
        },
      }),
    );
    if (done) {
      setAmount('');
      setWhere('');
    }
  }

  const remove = (x: Expense) =>
    change.run((api) => api.DELETE('/expenses/{id}', { params: { path: { id: x.id } } }));
  const word = (x: Expense) => KINDS.find((k) => k.value === x.category)?.label ?? x.category;

  const body = (
    <div className="space-y-4">
      {items && items.length > 0 ? (
        <ul className="divide-y divide-outline-variant">
          {items.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-body-medium">
                {word(x)}
                {x.merchant ? ` · ${x.merchant}` : ''}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="text-body-medium tabular-nums">
                  {formatMoney(x.amount_cents, currency)}
                </span>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${word(x).toLowerCase()} ${formatMoney(x.amount_cents, currency)}`}
                  disabled={change.busy}
                  onClick={() => void remove(x)}
                >
                  <DeleteIcon />
                </UiButton>
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-2 text-title-small">
            <span>Total</span>
            <span className="pr-9 tabular-nums">{formatMoney(totalCents, currency)}</span>
          </li>
        </ul>
      ) : null}
      <form onSubmit={(e) => void add(e)} aria-label="Add parking or a toll" className="space-y-3">
        <SegmentedButtons
          label="What you paid for"
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
        />
        <div className="grid gap-3 @md:grid-cols-2">
          <Field
            label={`Amount (${currency})`}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field
            label="Where (optional)"
            maxLength={120}
            value={where}
            onChange={(e) => setWhere(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="tonal" busy={change.busy}>
            {`Add ${KINDS.find((k) => k.value === kind)!.one}`}
          </Button>
          <Link
            to="/expenses"
            className="text-body-medium text-on-surface-variant underline underline-offset-4"
          >
            All expenses
          </Link>
        </div>
      </form>
    </div>
  );
  return bare ? (
    <div className="@container">{body}</div>
  ) : (
    <Section
      label="Parking and tolls"
      title="Parking and tolls"
      className="@container"
      description={
        items && items.length === 0
          ? 'Paid for parking or a toll on this shift? Add it here. It is saved as an expense.'
          : undefined
      }
    >
      {body}
    </Section>
  );
}
