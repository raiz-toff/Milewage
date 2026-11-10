import { useState } from 'react';
import type { FormEvent } from 'react';
import { useChange } from '../api/query';
import { Button, Field, FormError } from '../ui/form';

const MIN = 10;

/** Password change (08 section 2.5). The server ends the owner's other sessions; this one stays. */
export function Account() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { run, busy, error, setError } = useChange();
  const [note, setNote] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    if (next.length < MIN) return setError(`The new password needs at least ${MIN} characters.`);
    if (next !== again) return setError('The two new passwords differ.');
    const body = { current_password: current, new_password: next };
    if (!(await run((api) => api.POST('/auth/password', { body })))) return;
    setCurrent('');
    setNext('');
    setAgain('');
    setNote('Password changed. Other signed-in browsers were signed out.');
  }

  return (
    <section aria-label="Account" className="space-y-3">
      <h3 className="text-title-medium">Change password</h3>
      <p className="text-body-medium text-muted-foreground">
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
          <p role="status" className="text-body-medium">
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
