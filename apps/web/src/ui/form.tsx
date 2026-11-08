import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card as UiCard, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { dateLocale, dateToIso, formatDay, isoToDate, todayIn } from '../dateText';
import { useSession } from '../session';

/** A labelled input. The label wraps the control, so it is the accessible name; the hint is its description. */
export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = useId();
  return (
    <div className="grid content-start gap-2">
      <label className="grid gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Input aria-describedby={hint ? hintId : undefined} {...input} />
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A labelled day: the shadcn Date Picker (a button showing the day, opening a Calendar with month
 * and year dropdowns), as the owner chose on 2026-11-08. `value` is `YYYY-MM-DD` or '' (none).
 * The button's name is the label and the day, so a screen reader hears both.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  hint?: string;
}) {
  const { state } = useSession();
  const s = state.status === 'ready' ? state.settings : null;
  const locale = dateLocale(s?.country ?? 'CA');
  const today = todayIn(s?.timezone ?? 'UTC');
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);
  // The year dropdown runs from ten years back to five ahead, widened to the bounds and the day.
  const year = Number(today.slice(0, 4));
  const first = [min ?? `${year - 10}-01-01`, value].filter(Boolean).sort()[0]!;
  const last = [max ?? `${year + 5}-12-31`, value].filter(Boolean).sort().at(-1)!;
  const labelId = `${id}-label`;
  const textId = `${id}-text`;
  const hintId = `${id}-hint`;
  return (
    <div className="grid min-w-0 content-start gap-2">
      <label id={labelId} htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <UiButton
            id={id}
            type="button"
            variant="outline"
            data-empty={!selected}
            aria-labelledby={`${labelId} ${textId}`}
            aria-describedby={hint ? hintId : undefined}
            className="w-full min-w-0 justify-between font-normal data-[empty=true]:text-muted-foreground"
          >
            <span id={textId} className="truncate">
              {selected ? formatDay(value, locale) : 'Pick a date'}
            </span>
            <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
          </UiButton>
        </PopoverTrigger>
        <PopoverContent aria-label={label} align="start" className="w-auto overflow-hidden p-0">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            autoFocus
            selected={selected}
            defaultMonth={selected ?? isoToDate(today)}
            startMonth={isoToDate(first)}
            endMonth={isoToDate(last)}
            today={isoToDate(today)}
            weekStartsOn={s?.week_start ?? 1}
            disabled={[
              ...(min ? [{ before: isoToDate(min)! }] : []),
              ...(max ? [{ after: isoToDate(max)! }] : []),
            ]}
            onSelect={(d) => {
              if (d) onChange(dateToIso(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface PickOption {
  value: string;
  label: string;
  /** Shown before the label, in the list and the closed select (a platform's badge). */
  icon?: ReactNode;
}

/** Radix Select cannot hold an empty value, so "" (none, any, all) travels under this name. */
const EMPTY = '__empty__';

/** A dropdown for choosing one value (shadcn Select). "" is a normal choice, as with a native select. */
export function Picker({
  value,
  onChange,
  options,
  id,
  label,
  size,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  id?: string;
  /** Accessible name when no visible label points at `id`. */
  label?: string;
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value === '' ? EMPTY : value}
      onValueChange={(v) => onChange(v === EMPTY ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        size={size}
        className={cn('w-full min-w-0', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value === '' ? EMPTY : o.value} data-value={o.value}>
            {o.icon}
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A labelled dropdown. The label points at the trigger, so it is the accessible name. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  disabled?: boolean;
}) {
  const id = useId();
  // min-w-0 lets the field shrink inside a grid column, so a long choice is cut off with an
  // ellipsis instead of spilling over the next field.
  return (
    <div className="grid min-w-0 content-start gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Picker id={id} value={value} onChange={onChange} options={options} disabled={disabled} />
    </div>
  );
}

export function Button({
  busy,
  children,
  ...rest
}: { busy?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <UiButton disabled={busy || rest.disabled} {...rest}>
      {children}
    </UiButton>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

/** A centred card for screens shown before sign-in. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <UiCard className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </UiCard>
    </div>
  );
}
