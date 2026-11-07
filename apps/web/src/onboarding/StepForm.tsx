import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { describe } from '../api/client';
import { FormError } from '../ui/form';

/**
 * The body of a step: its question, then Continue (saves, then goes on) and, for an optional
 * step, "Skip this step" (goes on without saving). An error keeps the driver on the step.
 */
export function StepForm({
  children,
  save,
  next,
  skip = 'Skip this step',
}: {
  children: ReactNode;
  /** Saves the answer; resolves when the server has it. */
  save: () => Promise<void>;
  next: () => void;
  /** Label of the skip button, or null for a step that cannot be skipped. */
  skip?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save();
      next();
    } catch (err) {
      setError(describe(err));
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
          Continue
        </Button>
        {skip ? (
          <Button type="button" variant="ghost" onClick={next} disabled={busy}>
            {skip}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
