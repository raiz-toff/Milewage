import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { CalendarIcon } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card as UiCard, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { dateLocale, dateToIso, formatDay, isoToDate, parseDay, todayIn } from '../dateText';
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
 * A labelled day (shadcn Date Picker with input): type it, or pick it on the calendar button.
 * `value` is `YYYY-MM-DD` or '' (none, or what was typed is not a date).
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
  const [text, setText] = useState(() => formatDay(value, locale));
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(value);
  useEffect(() => {
    // A new value from the form (a reset, a default) replaces the text; our own does not.
    if (value !== sent.current) {
      sent.current = value;
      setText(formatDay(value, locale));
      setError(null);
    }
  }, [value, locale]);

  const send = (v: string) => {
    sent.current = v;
    onChange(v);
  };
  const outside = (iso: string) => (min && iso < min) || (max && iso > max);
  const pick = (iso: string) => {
    send(iso);
    setText(formatDay(iso, locale));
    setError(null);
  };
  /** When the driver leaves the field: tidy a valid day, explain anything else. */
  const commit = (): boolean => {
    const iso = parseDay(text, locale);
    if (text.trim() === '') send('');
    else if (iso === null || outside(iso)) {
      setError(
        iso === null
          ? `Not a date. Type it like ${formatDay(today, locale)} or ${today}.`
          : `Choose a day ${[min && `from ${formatDay(min, locale)}`, max && `to ${formatDay(max, locale)}`].filter(Boolean).join(' ')}.`,
      );
      send('');
      return false;
    } else pick(iso);
    return true;
  };

  const selected = isoToDate(value);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="grid content-start gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              id={id}
              value={text}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={
                [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined
              }
              className="pr-8"
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
                const iso = parseDay(e.target.value, locale);
                if (iso !== null && !outside(iso)) send(iso);
              }}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !commit()) e.preventDefault();
                if (e.key === 'ArrowDown' && e.altKey) {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
            />
            <PopoverTrigger asChild>
              <UiButton
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Open calendar: ${label}`}
                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
              >
                <CalendarIcon />
              </UiButton>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          aria-label={label}
          align="start"
          className="w-auto overflow-hidden p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            mode="single"
            autoFocus
            selected={selected}
            defaultMonth={selected ?? isoToDate(today)}
            today={isoToDate(today)}
            weekStartsOn={s?.week_start ?? 1}
            disabled={[
              ...(min ? [{ before: isoToDate(min)! }] : []),
              ...(max ? [{ after: isoToDate(max)! }] : []),
            ]}
            onSelect={(d) => {
              if (d) pick(dateToIso(d));
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
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
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
