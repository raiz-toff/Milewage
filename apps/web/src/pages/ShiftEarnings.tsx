import { useState } from 'react';
import { Section } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import type { FormEvent } from 'react';
import type { Schemas } from '../api/client';
import { errorText, put, useApiQuery, useChange } from '../api/query';
import { formatMoney, parseMoney } from '../format';
import type { Read } from '../shift/view';
import { EarningLedger } from './EarningLedger';
import { useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { PlatformBadge, PlatformName } from '../platforms/PlatformBadge';
import type { PlatformLike } from '../platforms/PlatformBadge';
import { builtinPlatform } from '@milewage/shared';

type Earnings = Schemas['ShiftEarnings'];

/**
 * The driver's own total per platform for one shift (module `earnings`, 18 section 4.3). One
 * figure typed after the fact, never a tap per delivery. It replaces the sum of that platform's
 * stop labels, which stay visible below as the breakdown.
 */
export function ShiftEarnings({
  shift,
  earnings,
}: {
  shift: Schemas['Shift'];
  /** The shift's earnings from the shift record. */
  earnings: Read<Earnings>;
}) {
  const { currency, modules } = useSettings();
  const path = { ref: String(shift.id) };
  const data = earnings.data;
  const platforms = useApiQuery('/platforms', undefined, { enabled: modules.platforms }).data ?? [];
  const change = useChange();
  const error = errorText(change, earnings);
  /** A save answers with the shift's earnings: shown at once; every other figure is read again. */
  const answered = (next: Earnings) => [put('/shifts/{ref}/earnings', { path }, next)];
  const [ledger, setLedger] = useState(false);
  const [form, setForm] = useState({
    platform: 'other',
    gross: '',
    tips: '',
    bonus: '',
    orders: '',
  });

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
    const [gross, tips, bonus] = [form.gross, form.tips, form.bonus].map((t) =>
      parseMoney(t, currency),
    );
    if ([gross, tips, bonus].some((n) => !Number.isFinite(n) || n! < 0)) {
      return change.setError('Amounts must be zero or more.');
    }
    const saved = await change.run(
      (api) =>
        api.PUT('/shifts/{ref}/earnings/{platform}', {
          params: { path: { ...path, platform } },
          body: {
            gross_cents: gross!,
            tips_cents: tips!,
            bonus_cents: bonus!,
            orders: form.orders.trim() === '' ? null : Number(form.orders),
          },
        }),
      answered,
    );
    if (saved) setForm({ ...form, gross: '', tips: '', bonus: '', orders: '' });
  }

  const remove = (platform: string) =>
    change.run(
      (api) =>
        api.DELETE('/shifts/{ref}/earnings/{platform}', {
          params: { path: { ...path, platform } },
        }),
      answered,
    );

  /** A platform by slug: the driver's list, else the built-in name, else the slug itself. */
  const platformOf = (slug: string): PlatformLike =>
    known.find((p) => p.slug === slug) ?? { slug, label: builtinPlatform(slug)?.label ?? slug };
  const label = (slug: string) => platformOf(slug).label;

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
                  className="text-error"
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
        // Two fields a row when narrow, four when wide; the platform takes two (it shows a badge
        // and a name, cut short in a narrow field) and the button sits after the last field.
        className="grid max-w-2xl grid-cols-2 gap-3 *:first:col-span-2 @2xl:grid-cols-4 [&>button]:col-span-2 [&>button]:justify-self-start @2xl:[&>button]:col-span-1 @2xl:[&>button]:self-center"
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
        <Button
          type="submit"
          variant="tonal"
          busy={form.gross === '' && form.tips === '' && form.bonus === ''}
        >
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
          Add a cash order, fee or payout line
        </UiButton>
      ) : (
        <EarningLedger shiftId={shift.id} data={data} options={options} />
      )}
    </Section>
  );
}
