import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useChange, type Change } from '../api/query';
import { FormError } from './form';

/** What one confirmation asks and does. */
export interface Ask {
  /** A question that names the thing: "Delete this expense?". */
  title: string;
  /** What is lost, in plain words (and what stays). Say when it cannot be undone. */
  description: ReactNode;
  /** The destructive button, a verb and the thing: "Delete expense". */
  confirmLabel: string;
  /**
   * Sends the change with `run` and returns its answer; a failed change (null) keeps the dialog
   * open and shows the server's sentence under the text. After a successful one the dialog closes.
   */
  action: (run: Change['run']) => Promise<unknown>;
}

/**
 * The one confirmation for anything the driver cannot undo (a delete, a revoke): a Dialog with
 * the consequence spelled out, a `ghost` Cancel and a `destructive` confirm. Render `dialog` once
 * in the page and call `ask(...)` from a button or a `RowMenu` action.
 */
export function useConfirm() {
  const [asking, setAsking] = useState<Ask | null>(null);
  const change = useChange();
  const { busy, error, setError } = change;

  const close = () => {
    setError(null);
    setAsking(null);
  };

  async function confirm() {
    if (!asking) return;
    const done = await asking.action(change.run);
    if (done) close();
  }

  const dialog = asking ? (
    <Dialog open onOpenChange={(open) => (open || busy ? null : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asking.title}</DialogTitle>
          <DialogDescription>{asking.description}</DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {asking.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return {
    ask: (request: Ask) => {
      setError(null);
      setAsking(request);
    },
    dialog,
  };
}
