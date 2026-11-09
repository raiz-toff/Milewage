import { useEffect, useState } from 'react';
import { formatMoney } from '../format';
import { LinkAPhone } from '../pairing/LinkAPhone';
import { PairingCode } from '../pairing/PairingCode';
import { usePairingSession } from '../pairing/session';
import { targetOf } from '../goals';
import { Field } from '../ui/form';
import { StepError, StepForm } from './StepForm';
import type { StepSave } from './StepForm';
import type { StepProps } from './steps';

/** A weekly earnings goal (module `goals`); the dashboard shows the progress. Optional. */
export function GoalStep({ ctx, next }: StepProps) {
  const { currency, distance_unit } = ctx.settings;
  const [amount, setAmount] = useState('');
  const save: StepSave = async (run) => {
    if (!amount.trim()) return; // left empty: the same as skipping
    const target = targetOf('earnings', amount, distance_unit, currency);
    if (!(target > 0)) throw new StepError('Enter an amount above 0, for example 800.');
    const made = await run((api) =>
      api.POST('/goals', {
        body: { label: 'Weekly earnings', metric: 'earnings', period: 'weekly', target },
      }),
    );
    if (!made) return false;
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

/**
 * Pair the phone (module `devices`): the pairing session the Devices page uses too. It shows the
 * code and waits for the phone (a scanned code or a link code on the Wi-Fi); once one appears, the
 * wizard reads its data again and the step says which phone is paired.
 */
export function PairStep({ ctx, next }: StepProps) {
  const paired = ctx.devices;
  const { reload } = ctx;
  const session = usePairingSession({ start: paired.length === 0 });
  const found = session.state === 'paired';

  useEffect(() => {
    if (found) void reload();
  }, [found, reload]);

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
          <LinkAPhone />
          <p className="text-sm font-medium">Or scan a code</p>
          <PairingCode session={session} />
          <p role="status" className="text-sm text-muted-foreground">
            Waiting for your phone…
          </p>
        </>
      )}
    </StepForm>
  );
}
