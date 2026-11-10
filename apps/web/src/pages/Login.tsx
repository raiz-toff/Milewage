import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import { useChange } from '../api/query';
import { useSession } from '../session';
import { Button, Card, Field, FormError } from '../ui/form';

export function Login() {
  const [forgot, setForgot] = useState(false);
  return forgot ? (
    <ResetPassword onBack={() => setForgot(false)} />
  ) : (
    <SignIn onForgot={() => setForgot(true)} />
  );
}

function SignIn({ onForgot }: { onForgot: () => void }) {
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
      <UiButton type="button" variant="link" className="h-auto px-0" onClick={onForgot}>
        Forgot your password?
      </UiButton>
    </Card>
  );
}

/**
 * Forgot the password: the recovery key from setup proves it is the owner. The server checks it
 * against the public half it keeps, sets the new password and signs this browser in.
 */
function ResetPassword({ onBack }: { onBack: () => void }) {
  const { refresh } = useSession();
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const { run, busy, error } = useChange();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { recovery_key: key.trim(), new_password: password };
    if (await run((api) => api.POST('/auth/reset-password', { body }))) await refresh();
  }

  return (
    <Card title="Choose a new password">
      <p className="text-body-medium text-muted-foreground">
        Enter the recovery key you saved when you set up MileWage. It starts with AGE-SECRET-KEY-1.
        Every other browser is signed out. Your data and the key stay as they are.
      </p>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field
          label="Recovery key"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          hint="At least 10 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy} disabled={!key.trim() || password.length < 10}>
            Set new password
          </Button>
          <UiButton type="button" variant="ghost" onClick={onBack}>
            Back to sign in
          </UiButton>
        </div>
      </form>
      <p className="text-body-small text-muted-foreground">
        Lost the recovery key too? On the server machine, stop the api service and run{' '}
        <span className="font-mono">milewage-cli reset-password</span>. It prints a new password.
      </p>
    </Card>
  );
}
