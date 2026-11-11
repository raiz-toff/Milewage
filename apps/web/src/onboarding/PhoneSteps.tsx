import { useEffect } from 'react';
import { PairingCode } from '../pairing/PairingCode';
import { usePairingSession } from '../pairing/session';
import { StepForm } from './StepForm';
import type { StepProps } from './steps';

/**
 * Pair the phone (module `devices`): the pairing session the Devices page uses too. It shows the
 * code and waits for the phone (a scanned or pasted code); once one appears, the
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
        <p role="status" className="text-body-medium">
          Paired: {paired.map((d) => d.name).join(', ')}.
        </p>
      ) : (
        <>
          <p className="text-body-medium text-muted-foreground">
            Pair your phone with this server. The phone records your shifts and sends them here.
          </p>
          <PairingCode session={session} />
          <p role="status" className="text-body-medium text-muted-foreground">
            Waiting for your phone…
          </p>
        </>
      )}
    </StepForm>
  );
}
