import { useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { describe, unwrap } from '../api/client';
import { useInvalidate } from '../api/query';
import { useSession } from '../session';
import { Button, Field, FormError } from '../ui/form';
import { Section } from '../ui/layout';

type Step =
  { name: 'password' } | { name: 'show'; key: string } | { name: 'done'; backedUp: boolean };

/**
 * "Lost your recovery key?" on the Backups page (10 section 9 "Rotation"). The old key cannot be
 * recovered: the server never had it. A new key protects backups from now on; older backups still
 * need the old key. Same steps as at setup: the key is shown once, then confirmed by its last 6
 * characters. Until then the server keeps using the old key.
 */
export function NewRecoveryKey() {
  const [open, setOpen] = useState(false);
  return (
    <Section
      label="Lost your recovery key?"
      title="Lost your recovery key?"
      description="The old key cannot be recovered. MileWage never kept it. You can make a new key: it protects the backups made from now on."
    >
      <div>
        <UiButton type="button" variant="outline" onClick={() => setOpen(true)}>
          <KeyRound />
          Make a new recovery key
        </UiButton>
      </div>
      {open ? <NewKeyDialog onClose={() => setOpen(false)} /> : null}
    </Section>
  );
}

function NewKeyDialog({ onClose }: { onClose: () => void }) {
  const { api } = useSession();
  const invalidate = useInvalidate();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [password, setPassword] = useState('');
  const [last6, setLast6] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await unwrap(api.POST('/backups/recovery-key', { body: { password } }));
      setPassword('');
      setStep({ name: 'show', key: made.recovery_key });
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const done = await unwrap(
        api.POST('/backups/recovery-key/confirm', { body: { last6: last6.trim() } }),
      );
      setStep({ name: 'done', backedUp: done.backup !== null });
      void invalidate('/backups', '/system/status');
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent
        // While the key is on screen a stray click outside must not throw it away.
        onInteractOutside={(e) => (step.name === 'show' ? e.preventDefault() : undefined)}
      >
        <DialogHeader>
          <DialogTitle>
            {step.name === 'done' ? 'New recovery key in use' : 'Make a new recovery key'}
          </DialogTitle>
          <DialogDescription>
            {step.name === 'password'
              ? 'Backups made before today still need the old key. Without it they cannot be opened. The new key opens only the backups made after this change.'
              : step.name === 'show'
                ? 'This key is shown once and MileWage does not keep it. Store it in a password manager. Until you confirm it, backups keep using the old key.'
                : step.backedUp
                  ? 'New backups use the new key. A backup with it was made just now.'
                  : 'New backups use the new key, but the first backup with it failed. Use Back up now.'}
          </DialogDescription>
        </DialogHeader>
        {step.name === 'password' ? (
          <form onSubmit={(e) => void make(e)} className="space-y-4">
            <Field
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FormError message={error} />
            <Button type="submit" busy={busy || password === ''}>
              Make the new key
            </Button>
          </form>
        ) : step.name === 'show' ? (
          <form onSubmit={(e) => void confirm(e)} className="space-y-4">
            <div className="space-y-2">
              <code
                data-testid="new-recovery-key"
                className="block break-all rounded-lg border bg-muted/40 p-3 font-mono text-sm"
              >
                {step.key}
              </code>
              <UiButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigator.clipboard?.writeText(step.key).then(() => setCopied(true))
                }
              >
                {copied ? 'Copied' : 'Copy'}
              </UiButton>
            </div>
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
        ) : (
          <DialogFooter>
            <UiButton type="button" onClick={onClose}>
              Close
            </UiButton>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
