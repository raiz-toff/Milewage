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
import { PlatformBadge, PlatformName } from '../platforms/PlatformBadge';
import type { PlatformLike } from '../platforms/PlatformBadge';
import { builtinPlatform } from '@milewage/shared';

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

  const known: PlatformLike[] =
    platforms.length > 0 ? platforms : [{ slug: 'other', label: 'Other' }];
  const options = known.map((p) => ({
    value: p.slug,
    label: p.label,
    icon: <PlatformBadge platform={p} />,
  }));
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

  /** A platform by slug: the driver's list, else the built-in name, else the slug itself. */
  const platformOf = (slug: string): PlatformLike =>
    known.find((p) => p.slug === slug) ?? { slug, label: builtinPlatform(slug)?.label ?? slug };
  const label = (slug: string) => platformOf(slug).label;
  const shown = JSON.stringify(data?.effective.map((r) => platformOf(r.platform)));
  useEffect(() => {
    if (!data) return;
    onSummary?.({
      cents: data.effective.length ? data.effective.reduce((t, r) => t + r.total_cents, 0) : null,
      platforms: JSON.parse(shown) as PlatformLike[],
    });
  }, [data, shown, onSummary]);

  return (
    <Section label="Earnings" title="Earnings">
      <FormError message={error} />
      {data === null ? null : data.effective.length === 0 ? (
        <p className="text-muted-foreground">No earnings entered or labelled for this shift.</p>
      ) : (
        <ul className="space-y-1">
          {data.effective.map((r) => (
            <li key={r.platform} className="flex items-center gap-3">
              <PlatformName platform={platformOf(r.platform)}>
                {label(r.platform)}: {formatMoney(r.total_cents, currency)}
                {r.orders !== null ? `, ${r.orders} orders` : ''}
              </PlatformName>
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
      <p className="text-xs text-muted-foreground">
        Type the figure the platform shows for this shift. It replaces that platform&apos;s stop
        labels in your totals.
      </p>
      {data === null ? null : (
        <EarningLedger shiftId={shift.id} data={data} options={options} onChange={setData} />
      )}
    </Section>
  );
}
