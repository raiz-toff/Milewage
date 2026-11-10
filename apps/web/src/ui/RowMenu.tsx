import { MoreVertIcon } from '@/ui/icons';
import type { IconComponent } from '@/ui/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RowAction {
  label: string;
  onSelect: () => void;
  icon?: IconComponent;
  /** Red, and placed last after a separator (delete, revoke, archive). */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The "..." menu of a list row (shadcn DropdownMenu). Use it when a row has two or more actions;
 * a single action stays a plain button. `name` says what the row is ("Actions for <name>").
 */
export function RowMenu({ name, actions }: { name: string; actions: RowAction[] }) {
  const safe = actions.filter((a) => !a.destructive);
  const risky = actions.filter((a) => a.destructive);
  const item = (a: RowAction) => (
    <DropdownMenuItem
      key={a.label}
      variant={a.destructive ? 'destructive' : 'default'}
      disabled={a.disabled}
      onSelect={a.onSelect}
    >
      {a.icon ? <a.icon /> : null}
      {a.label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
          <MoreVertIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="max-w-56 truncate">{name}</DropdownMenuLabel>
          {safe.map(item)}
        </DropdownMenuGroup>
        {risky.length > 0 ? (
          <>
            {safe.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>{risky.map(item)}</DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
