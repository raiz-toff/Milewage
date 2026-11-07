import { useCallback, useEffect, useState } from 'react';
import { Section } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatMoney, toCents } from '../format';
import { EarningLedger } from './EarningLedger';
import type { EarnedSummary } from './ShiftFacts';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';

type Earnings = Schemas['ShiftEarnings'];
type Platform = Schemas['Platform'];

export { toCents };

/**
 * The driver's own total per platform for one shift (module `earnings`, 18 section 4.3). One
 * figure typed after the fact, never a tap per delivery. It replaces the sum of that platform's
 * stop labels, which stay visible below as the breakdown.
 */
export function ShiftEarnings({
  shift,
  onSummary,
}: {
  shift: Schemas['Shift'];
  /** Told the shift's earned total and platform names whenever they change. */
  onSummary?: (s: EarnedSummary) => void;
}) {
  const { api } = useSession();
  const { currency, modules } = useSettings();
  const [data, setData] = useState<Earnings | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState(false);
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
  const names = data?.effective.map((r) => label(r.platform)).join('\n');
  useEffect(() => {
    if (!data || names === undefined) return;
    onSummary?.({
      cents: data.effective.length ? data.effective.reduce((t, r) => t + r.total_cents, 0) : null,
      platforms: names === '' ? [] : names.split('\n'),
    });
  }, [data, names, onSummary]);

  // Nothing yet: one line says so and how, and the less common lines wait behind a button.
  const none = data?.effective.length === 0;
  return (
    <Section
      label="Earnings"
      title="Earnings"
      // The form follows the card's width, not the window's (the card can sit in a column).
      className="@container"
      description={
        none
          ? 'No earnings entered or labelled for this shift. Type the total the platform shows.'
          : undefined
      }
    >
      <FormError message={error} />
      {data === null || none ? null : (
        <ul className="space-y-1">
          {data.effective.map((r) => (
            <li key={r.platform} className="flex items-center gap-3">
              <span>
                {label(r.platform)}: {formatMoney(r.total_cents, currency)}
                {r.orders !== null ? `, ${r.orders} orders` : ''}
              </span>
              <span className="text-sm text-muted-foreground">
                {r.source === 'labels' ? 'from stop labels' : 'entered by you'}
              </span>
              {data.entries.some((x) => x.platform === r.platform) ? (
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove entered total for ${label(r.platform)}`}
                  onClick={() => void remove(r.platform)}
                >
                  Remove
                </UiButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form
        // Two fields a row when narrow (platform and the button across), five when wide.
        className="grid max-w-2xl grid-cols-2 gap-3 *:first:col-span-2 @xl:grid-cols-5 @xl:*:first:col-span-1 [&>button]:col-span-2 @xl:[&>button]:col-span-1"
        onSubmit={(e) => void save(e)}
      >
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
      {none ? null : (
        <p className="text-xs text-muted-foreground">
          Type the figure the platform shows for this shift. It replaces that platform&apos;s stop
          labels in your totals.
        </p>
      )}
      {data === null ? null : none && !ledger ? (
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 self-start text-muted-foreground"
          onClick={() => setLedger(true)}
        >
          Add a cash trip, fee or payout line
        </UiButton>
      ) : (
        <EarningLedger shiftId={shift.id} data={data} options={options} onChange={setData} />
      )}
    </Section>
  );
}
