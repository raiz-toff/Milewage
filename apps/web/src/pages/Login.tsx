import { useState } from 'react';
import type { FormEvent } from 'react';
import { useChange } from '../api/query';
import { useSession } from '../session';
import { Button, Card, Field, FormError } from '../ui/form';

export function Login() {
  const { refresh } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { run, busy, error } = useChange();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { username, password };
    if (await run((api) => api.POST('/auth/login', { body }))) await refresh();
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
