import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';

type Earnings = Schemas['ShiftEarnings'];
type Platform = Schemas['Platform'];

/** Dollars typed by the driver to whole cents; blank is 0, anything else invalid is NaN. */
export const toCents = (text: string): number =>
  text.trim() === '' ? 0 : Math.round(Number(text.replace(',', '.')) * 100);

/**
 * The driver's own total per platform for one shift (module `earnings`, 18 section 4.3). One
 * figure typed after the fact, never a tap per delivery. It replaces the sum of that platform's
 * stop labels, which stay visible below as the breakdown.
 */
export function ShiftEarnings({ shift }: { shift: Schemas['Shift'] }) {
  const { api } = useSession();
  const { currency, modules } = useSettings();
  const [data, setData] = useState<Earnings | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    platform: 'other',
    gross: '',
    tips: '',
    bonus: '',
    orders: '',
  });
  const path = { ref: String(shift.id) };

  const load = useCallback(async () => {
    try {
      setData(await unwrap<Earnings>(api.GET('/shifts/{ref}/earnings', { params: { path } })));
      if (modules.platforms) setPlatforms(await unwrap<Platform[]>(api.GET('/platforms')));
    } catch (e) {
      setError(describe(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, shift.id, modules.platforms]);
  useEffect(() => {
    void load();
  }, [load]);

  const options =
    platforms.length > 0
      ? platforms.map((p) => ({ value: p.slug, label: p.label }))
      : [{ value: 'other', label: 'Other' }];
  async function save(e: FormEvent) {
    e.preventDefault();
    const platform = options.some((o) => o.value === form.platform)
      ? form.platform
      : options[0]!.value;
    const [gross, tips, bonus] = [form.gross, form.tips, form.bonus].map(toCents);
    if ([gross, tips, bonus].some((n) => !Number.isFinite(n) || n! < 0)) {
      return setError('Amounts must be zero or more.');
    }
    setError(null);
    try {
      setData(
        await unwrap<Earnings>(
          api.PUT('/shifts/{ref}/earnings/{platform}', {
            params: { path: { ...path, platform } },
            body: {
              gross_cents: gross!,
              tips_cents: tips!,
              bonus_cents: bonus!,
              orders: form.orders.trim() === '' ? null : Number(form.orders),
            },
          }),
        ),
      );
      setForm({ ...form, gross: '', tips: '', bonus: '', orders: '' });
    } catch (err) {
      setError(describe(err));
    }
  }

  async function remove(platform: string) {
    setError(null);
    try {
      setData(
        await unwrap<Earnings>(
          api.DELETE('/shifts/{ref}/earnings/{platform}', {
            params: { path: { ...path, platform } },
          }),
        ),
      );
    } catch (err) {
      setError(describe(err));
    }
  }

  const label = (slug: string) => options.find((o) => o.value === slug)?.label ?? slug;

  return (
    <section aria-label="Earnings" className="space-y-3">
      <h2 className="font-heading text-lg">Earnings</h2>
      <FormError message={error} />
      {data === null ? null : data.effective.length === 0 ? (
        <p className="text-muted">No earnings entered or labelled for this shift.</p>
      ) : (
        <ul className="space-y-1">
          {data.effective.map((r) => (
            <li key={r.platform} className="flex items-center gap-3">
              <span>
                {label(r.platform)}: {formatMoney(r.total_cents, currency)}
                {r.orders !== null ? `, ${r.orders} orders` : ''}
              </span>
              <span className="text-sm text-muted">
                {r.source === 'labels' ? 'from stop labels' : 'entered by you'}
              </span>
              {data.entries.some((x) => x.platform === r.platform) ? (
                <button
                  type="button"
                  className="text-sm text-muted hover:text-ink"
                  aria-label={`Remove entered total for ${label(r.platform)}`}
                  onClick={() => void remove(r.platform)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form className="grid max-w-2xl gap-3 sm:grid-cols-5" onSubmit={(e) => void save(e)}>
        <SelectField
          label="Platform"
          value={options.some((o) => o.value === form.platform) ? form.platform : options[0]!.value}
          onChange={(v) => setForm({ ...form, platform: v })}
          options={options}
        />
        {(
          [
            ['gross', 'Base pay'],
            ['tips', 'Gratuities'],
            ['bonus', 'Bonus'],
            ['orders', 'Orders'],
          ] as const
        ).map(([k, text]) => (
          <Field
            key={k}
            label={text}
            inputMode="decimal"
            value={form[k]}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          />
        ))}
        <Button type="submit" busy={form.gross === '' && form.tips === '' && form.bonus === ''}>
          Save total
        </Button>
      </form>
      <p className="text-xs text-muted">
        Type the figure the platform shows for this shift. It replaces that platform&apos;s stop
        labels in your totals.
      </p>
    </section>
  );
}
