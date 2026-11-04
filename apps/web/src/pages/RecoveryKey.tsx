import { useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import { useSession } from '../session';
import { Button, Card, Field, FormError } from '../ui/form';

/**
 * Last step of setup (10 section 5). The key is shown once, here, and never again: the server
 * keeps only the public half. `recoveryKey` is absent when the page was reloaded before
 * confirming; the driver then types the end of the key they saved.
 */
export function RecoveryKey({ recoveryKey }: { recoveryKey?: string }) {
  const { api, refresh } = useSession();
  const [last6, setLast6] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST('/setup/confirm', { body: { last6: last6.trim() } }));
      await refresh();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Save your recovery key">
      {recoveryKey ? (
        <>
          <p className="text-sm text-muted">
            Backups are encrypted. This key is the only way to open them if the server is lost. It
            is shown once and MileWage does not keep it. Store it in a password manager.
          </p>
          <code
            data-testid="recovery-key"
            className="block break-all rounded border border-line bg-bg p-3 font-mono text-sm"
          >
            {recoveryKey}
          </code>
        </>
      ) : (
        <p className="text-sm text-muted">
          Setup is not finished. The key cannot be shown again. Enter the last 6 characters of the
          recovery key you saved.
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field
          label="Last 6 characters of the key"
          maxLength={6}
          autoComplete="off"
          value={last6}
          onChange={(e) => setLast6(e.target.value)}
        />
        <FormError message={error} />
        <Button type="submit" busy={busy || last6.trim().length !== 6}>
          I saved it
        </Button>
      </form>
    </Card>
  );
}
