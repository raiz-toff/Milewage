import { Button } from '@/components/ui/button';

/** The end of a paged list: "Show more" while the server has more rows, nothing after the last. */
export function ShowMore({
  more,
  busy,
  onClick,
}: {
  more: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  if (!more) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button type="button" variant="outline" disabled={busy} onClick={onClick}>
        {busy ? 'Loading' : 'Show more'}
      </Button>
    </div>
  );
}
