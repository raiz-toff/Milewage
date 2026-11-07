import { useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import { useSession } from '../session';
import { Button, Field, FormError } from '../ui/form';

const MIN = 10;

/** Password change (08 section 2.5). The server ends the owner's other sessions; this one stays. */
export function Account() {
  const { api } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    if (next.length < MIN) return setError(`The new password needs at least ${MIN} characters.`);
    if (next !== again) return setError('The two new passwords differ.');
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/auth/password', { body: { current_password: current, new_password: next } }),
      );
      setCurrent('');
      setNext('');
      setAgain('');
      setNote('Password changed. Other signed-in browsers were signed out.');
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Account" className="space-y-3">
      <h3 className="text-base leading-snug font-medium">Change password</h3>
      <p className="text-sm text-muted-foreground">
        The new password needs at least {MIN} characters.
      </p>
      <form onSubmit={(e) => void save(e)} className="space-y-3">
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Field
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
        <FormError message={error} />
        {note ? (
          <p role="status" className="text-sm font-medium">
            {note}
          </p>
        ) : null}
        <Button type="submit" busy={busy || current === '' || next === ''}>
          Change password
        </Button>
      </form>
    </section>
  );
}
