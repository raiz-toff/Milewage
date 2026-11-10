import { Component } from 'react';
import type { ReactNode } from 'react';
import { WarningIcon } from '@/ui/icons';
import { QueryErrorResetBoundary, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

interface Props {
  /** Clears what may have caused the failure before the page is drawn again. */
  onReset: () => void;
  /** A new value (another page) clears the failure. */
  resetKey: string;
  children: ReactNode;
}

class Boundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(before: Props) {
    if (this.state.failed && before.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center">
        <WarningIcon aria-hidden className="size-6 text-on-surface-variant" />
        <h1 className="text-headline-small text-on-surface">This page could not be shown</h1>
        <p className="max-w-sm text-body-medium text-on-surface-variant">
          Something went wrong while drawing it. Your data is safe on the server.
        </p>
        <Button
          onClick={() => {
            this.props.onReset();
            this.setState({ failed: false });
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
}

/**
 * Catches a page that fails to draw, so the sidebar stays usable. "Try again" drops the cached
 * answers and draws the page again, which asks the server afresh.
 */
export function PageErrorBoundary({ resetKey, children }: Omit<Props, 'onReset'>) {
  const queries = useQueryClient();
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Boundary
          resetKey={resetKey}
          onReset={() => {
            reset();
            void queries.resetQueries();
          }}
        >
          {children}
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}
