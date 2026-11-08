import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatMoney, parseMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import type { PickOption } from '../ui/form';

type Earnings = Schemas['ShiftEarnings'];
type EntryType = Schemas['EarningEntryType'];

/** Words for each entry type (plan 22 section 3.2). */
export const ENTRY_LABELS: Record<EntryType, string> = {
  fare: 'Fare',
  tip: 'Tip',
  bonus: 'Bonus',
  cash_collected: 'Cash collected',
  commission: 'Commission',
  platform_fee: 'Platform fee',
  tax_withheld: 'Tax withheld',
  top_up: 'Top-up',
  payout: 'Payout',
  adjustment: 'Correction to pay',
};
const PLUS: EntryType[] = ['fare', 'tip', 'bonus', 'top_up'];
const PAY: EntryType[] = ['fare', 'tip', 'bonus'];

/**
 * The entries of each platform's row: cash trips, commission, fees, withheld tax, top-ups and
 * payouts (plan 22 section 6). The driver types a positive amount; the type gives the sign.
 */
export function EarningLedger({
  shiftId,
  data,
  options,
  onChange,
}: {
  shiftId: number;
  data: Earnings;
  options: PickOption[];
  onChange: (d: Earnings) => void;
}) {
  const { api } = useSession();
  const { currency } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    platform: '',
    type: 'commission' as EntryType,
    amount: '',
    adds: 'yes',
    note: '',
  });
  const money = (c: number) => formatMoney(c, currency);
  const label = (slug: string) => options.find((o) => o.value === slug)?.label ?? slug;
  const platform = options.some((o) => o.value === form.platform)
    ? form.platform
    : options[0]!.value;

  async function call(run: () => Promise<Earnings>) {
    setError(null);
    try {
      onChange(await run());
      return true;
    } catch (err) {
      setError(describe(err));
      return false;
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoney(form.amount, currency);
    if (!Number.isFinite(cents) || cents <= 0) return setError('Type an amount above zero.');
    const plus = form.type === 'adjustment' ? form.adds === 'yes' : PLUS.includes(form.type);
    const ok = await call(() =>
      unwrap<Earnings>(
        api.POST('/shifts/{ref}/earnings/{platform}/entries', {
          params: { path: { ref: String(shiftId), platform } },
          body: {
            type: form.type,
            amount_cents: plus ? cents : -cents,
            ...(form.note.trim() === '' ? {} : { note: form.note.trim() }),
          },
        }),
      ),
    );
    if (ok) setForm({ ...form, amount: '', note: '' });
  }
  const remove = (p: string, id: number) =>
    void call(() =>
      unwrap<Earnings>(
        api.DELETE('/shifts/{ref}/earnings/{platform}/entries/{id}', {
          params: { path: { ref: String(shiftId), platform: p, id } },
        }),
      ),
    );

  const rows = data.entries.filter((r) => r.ledger.some((x) => !PAY.includes(x.type)));
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.platform} className="space-y-1">
          <p className="flex items-start gap-2 text-sm">
            {options.find((o) => o.value === r.platform)?.icon}
            <span>
              {label(r.platform)}: fees {money(-r.fees_cents)}, tax withheld{' '}
              {money(-r.tax_withheld_cents)}, cash collected {money(-r.cash_collected_cents)}.{' '}
              {r.balance_cents < 0
                ? `You owe the app ${money(-r.balance_cents)}.`
                : `Balance with the app: ${money(r.balance_cents)}.`}
            </span>
          </p>
          <ul className="text-sm text-muted-foreground">
            {r.ledger.map((x) => {
              const text = `${ENTRY_LABELS[x.type]} ${money(x.amount_cents)}`;
              return (
                <li key={x.id} className="flex items-center gap-2">
                  {text}
                  {x.note ? ` (${x.note})` : ''}
                  <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${text}`}
                    onClick={() => remove(r.platform, x.id)}
                  >
                    Remove
                  </UiButton>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <FormError message={error} />
      <form className="grid max-w-2xl gap-3 sm:grid-cols-5" onSubmit={(e) => void add(e)}>
        <SelectField
          label="Line platform"
          value={platform}
          onChange={(v) => setForm({ ...form, platform: v })}
          options={options}
        />
        <SelectField
          label="Kind"
          value={form.type}
          onChange={(v) => setForm({ ...form, type: v as EntryType })}
          options={Object.entries(ENTRY_LABELS).map(([value, text]) => ({ value, label: text }))}
        />
        {form.type === 'adjustment' ? (
          <SelectField
            label="Direction"
            value={form.adds}
            onChange={(v) => setForm({ ...form, adds: v })}
            options={[
              { value: 'yes', label: 'Adds to pay' },
              { value: 'no', label: 'Takes off pay' },
            ]}
          />
        ) : null}
        <Field
          label="Amount"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <Field
          label="Note"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
        <Button type="submit" busy={form.amount === ''}>
          Add line
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        For cash trips, commission, fees, tax the app kept, top-ups and payouts. Type the amount
        without a sign. A cash trip is a fare plus the cash you collected.
      </p>
    </div>
  );
}
