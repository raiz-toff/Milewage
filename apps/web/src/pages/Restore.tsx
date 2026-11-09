import { useState } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import type { FormEvent } from 'react';
import { useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { useSession } from '../session';
import { Button, Card, Field, FormError } from '../ui/form';

type Verification = Schemas['RestoreVerification'];

/**
 * Restore onto a fresh instance (`POST /setup/restore`, 10 section 7). Offered only while no
 * owner exists; the server refuses it otherwise. The result is shown as the server counted it, so
 * the driver can compare it with what they remember before signing in.
 */
export function Restore({ onBack }: { onBack: () => void }) {
  const { refresh } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('');
  const { run, busy, error } = useChange();
  const [done, setDone] = useState<Verification | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('recovery_key', key.trim());
    const restored = await run((api) =>
      api.POST('/setup/restore', {
        // The generated body type models the file as a string; a multipart body is sent as is.
        body: form as never,
        bodySerializer: (b: unknown) => b as FormData,
      }),
    );
    if (restored) setDone(restored.data);
  }

  if (done) {
    return (
      <Card title="Backup restored">
        <ul className="space-y-1 text-sm">
          <li>Integrity check: {done.integrity_ok ? 'passed' : 'FAILED'}</li>
          <li>Shifts: {done.shift_count}</li>
          <li>Stop labels: {done.stop_label_count}</li>
          <li>Recorded points: {done.point_count}</li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Sign in with the account from the backup. Paired phones keep their pairing and will catch
          up on their own.
        </p>
        <Button type="button" onClick={() => void refresh()}>
          Continue to sign in
        </Button>
      </Card>
    );
  }

  return (
    <Card title="Restore from a backup">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">Backup file (.db.gz.age)</span>
          <input
            type="file"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Field
          label="Recovery key"
          autoComplete="off"
          spellCheck={false}
          hint="The key shown once when the account was created."
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <FormError message={error} />
        <Button type="submit" busy={busy || !file || !key.trim()}>
          Restore
        </Button>
      </form>
      <UiButton type="button" variant="ghost" size="sm" onClick={onBack}>
        Back to setup
      </UiButton>
    </Card>
  );
}
