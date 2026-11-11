import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { describe } from '../api/client';
import { useChange } from '../api/query';
import type { Change } from '../api/query';
import { FormError } from '../ui/form';

/** A problem with the driver's answer, shown as it is. */
export class StepError extends Error {}

/** A step's save: sends its changes with `run`; false (a change failed) keeps the step open. */
export type StepSave = (run: Change['run']) => Promise<boolean | void>;

/**
 * The body of a step: its question, then Continue (saves, then goes on) and, for an optional
 * step, "Skip this step" (goes on without saving). An error keeps the driver on the step: a
 * `StepError` the step throws, or a change sent with `run` that failed (`save` then returns false).
 */
export function StepForm({
  children,
  save,
  next,
  skip = 'Skip this step',
  submit: label = 'Continue',
}: {
  children: ReactNode;
  /** Saves the answer with `run` (the write path); resolves when the server has it. */
  save: StepSave;
  next: () => void | Promise<void>;
  submit?: string;
  /** Label of the skip button, or null for a step that cannot be skipped. */
  skip?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const { run, error, setError } = useChange();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if ((await save(run)) !== false) await next();
    } catch (err) {
      setError(err instanceof StepError ? err.message : describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-6">
      {children}
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {label}
        </Button>
        {skip ? (
          <Button type="button" variant="ghost" onClick={() => void next()} disabled={busy}>
            {skip}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
