import { useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import { useSession } from '../session';
import { Button, Card, Field, FormError } from '../ui/form';

export function Login() {
  const { api, refresh } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST('/auth/login', { body: { username, password } }));
      await refresh();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Sign in">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field
          label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          Sign in
        </Button>
      </form>
    </Card>
  );
}
