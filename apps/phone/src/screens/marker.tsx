import { Badge } from '../components/ui/badge';
import { Text } from '../components/ui/text';
import { markerFor } from '../sync/status';

const VARIANT = {
  check: 'secondary',
  check_diff: 'outline',
  hollow: 'outline',
  spinner: 'outline',
  warning: 'destructive',
} as const;

/** A shift's sync state (15 section 4.1) as a badge: on server, on phone only, sending, attention. */
export function SyncBadge({ shift }: { shift: Parameters<typeof markerFor>[0] }) {
  const m = markerFor(shift);
  return (
    <Badge variant={VARIANT[m.icon]}>
      <Text>{m.label}</Text>
    </Badge>
  );
}
