import { cn } from '@/lib/utils';

/** A placeholder in the shape of what is loading: surface-container-highest, gently pulsing. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-small bg-surface-container-highest', className)}
      {...props}
    />
  );
}

export { Skeleton };
