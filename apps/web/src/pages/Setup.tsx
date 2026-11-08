import { useState } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import { useCountries } from '../countries';
import { useSession } from '../session';
import { Button, Card, Field, FormError, SelectField } from '../ui/form';
import { RecoveryKey } from './RecoveryKey';

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** First run: create the owner, then show the recovery key once and ask for its last 6. */
export function Setup({ onRestore }: { onRestore?: () => void } = {}) {
  const { api } = useSession();
  const countries = useCountries();
  const [form, setForm] = useState({
    username: '',
    password: '',
    country: 'CA',
    distance_unit: 'km' as 'km' | 'mi',
    currency: 'CAD',
    timezone: browserZone(),
  });
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  if (key) return <RecoveryKey recoveryKey={key} />;

  function pickCountry(code: string) {
    const c = countries.find((x) => x.code === code);
    set(c ? { country: code, currency: c.currency, distance_unit: c.unit } : { country: code });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const done = await unwrap(api.POST('/setup', { body: form }));
      setKey(done.recovery_key);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Set up MileWage">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field
          label="Username"
          autoComplete="username"
          minLength={3}
          value={form.username}
          onChange={(e) => set({ username: e.target.value })}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          hint="At least 10 characters."
          value={form.password}
          onChange={(e) => set({ password: e.target.value })}
        />
        <SelectField
          label="Country"
          value={form.country}
          onChange={pickCountry}
          options={
            countries.length
              ? countries.map((c) => ({ value: c.code, label: c.name }))
              : [{ value: form.country, label: form.country }]
          }
        />
        <SelectField
          label="Distance unit"
          value={form.distance_unit}
          onChange={(v) => set({ distance_unit: v === 'mi' ? 'mi' : 'km' })}
          options={[
            { value: 'km', label: 'Kilometres' },
            { value: 'mi', label: 'Miles' },
          ]}
        />
        <Field
          label="Currency"
          maxLength={3}
          value={form.currency}
          onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
        />
        <Field
          label="Time zone"
          value={form.timezone}
          onChange={(e) => set({ timezone: e.target.value })}
        />
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          Create account
        </Button>
      </form>
      {onRestore ? (
        <UiButton type="button" variant="ghost" size="sm" onClick={onRestore}>
          Restore from a backup instead
        </UiButton>
      ) : null}
    </Card>
  );
}
