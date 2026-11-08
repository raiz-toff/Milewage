import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import { formatMoney } from '../format';
import { PairingCode } from '../pages/Devices';
import type { Pairing } from '../pages/Devices';
import { targetOf } from '../pages/Goals';
import { useSession } from '../session';
import { Field, FormError } from '../ui/form';
import { StepError, StepForm } from './StepForm';
import type { StepProps } from './steps';

/** A weekly earnings goal (module `goals`); the dashboard shows the progress. Optional. */
export function GoalStep({ ctx, next }: StepProps) {
  const { api } = useSession();
  const { currency, distance_unit } = ctx.settings;
  const [amount, setAmount] = useState('');
  const save = async () => {
    if (!amount.trim()) return; // left empty: the same as skipping
    const target = targetOf('earnings', amount, distance_unit);
    if (!(target > 0)) throw new StepError('Enter an amount above 0, for example 800.');
    await unwrap(
      api.POST('/goals', {
        body: { label: 'Weekly earnings', metric: 'earnings', period: 'weekly', target },
      }),
    );
    await ctx.reload();
  };
  const goal = ctx.goals[0];
  return (
    <StepForm save={save} next={next}>
      {goal ? (
        <p className="text-sm text-muted-foreground">
          You have a weekly goal: {goal.label}
          {goal.metric === 'earnings' ? `, ${formatMoney(goal.target, currency)}` : ''}.
        </p>
      ) : null}
      <Field
        label={`How much do you want to earn each week? (${currency})`}
        hint="The dashboard shows how close you are. Other goals can be added on the Goals page."
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
    </StepForm>
  );
}

/** How often the step asks whether the phone has paired. */
export const PAIR_POLL_MS = 1500;

/**
 * Pair the phone (module `devices`): the Devices page's pairing code, then the step waits for the
 * phone to appear in `GET /devices`. Kept thin so the pairing code has one home (Devices page).
 */
export function PairStep({ ctx, next }: StepProps) {
  const { api } = useSession();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paired = ctx.devices;
  const { reload } = ctx;

  useEffect(() => {
    if (paired.length) return;
    let live = true;
    unwrap(api.POST('/pairing-tokens')).then(
      (p) => live && setPairing(p),
      (e: unknown) => live && setError(describe(e)),
    );
    const timer = setInterval(() => {
      unwrap(api.GET('/devices'))
        .then((list) => {
          if (live && list.some((d) => d.revoked_at === null)) void reload();
        })
        .catch(() => {}); // try again on the next tick
    }, PAIR_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, paired.length, reload]);

  return (
    <StepForm save={async () => {}} next={next} skip={paired.length ? null : 'Pair later'}>
      {paired.length ? (
        <p role="status" className="text-sm">
          Paired: {paired.map((d) => d.name).join(', ')}.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Pair your phone with this server. The phone records your shifts and sends them here.
          </p>
          {pairing ? (
            <PairingCode
              pairing={pairing}
              remake={async (base_url) =>
                setPairing(await unwrap(api.POST('/pairing-tokens', { body: { base_url } })))
              }
            />
          ) : null}
          <FormError message={error} />
          <p role="status" className="text-sm text-muted-foreground">
            Waiting for your phone…
          </p>
        </>
      )}
    </StepForm>
  );
}
