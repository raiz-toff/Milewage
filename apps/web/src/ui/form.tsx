import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { LogoMark } from '@/components/logo';
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
import { dateLocale, dateToIso, formatDay, isoToDate, todayIn } from '../days';
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
  describedBy,
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
  /** Id of a hint that describes the choice. */
  describedBy?: string;
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
        aria-describedby={describedBy}
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

/**
 * A labelled time of day. `value` is "HH:MM" (24 hours, what the server stores) or ''. The browser's
 * own time input follows the browser language, so this one shows hours and minutes in the format
 * of Settings > Time format: 24 hours, or 12 hours with AM and PM.
 */
export function TimeField({
  label,
  value,
  onChange,
  timeFormat,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  timeFormat: '12h' | '24h';
}) {
  const [h = 0, m = 0] = (value || '00:00').split(':').map(Number);
  const two = (n: number) => String(n).padStart(2, '0');
  const set = (hour: number, minute: number) => onChange(`${two(hour)}:${two(minute)}`);
  const twelve = timeFormat === '12h';
  const hours = twelve
    ? Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i))
    : Array.from({ length: 24 }, (_, i) => i);
  const shownHour = twelve ? (h % 12 === 0 ? 12 : h % 12) : h;
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort(
    (a, b) => a - b,
  );
  return (
    <div role="group" aria-label={label} className="grid content-start gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <Picker
          label={`${label} hour`}
          className="w-auto min-w-16"
          value={String(shownHour)}
          onChange={(v) => set(twelve ? (Number(v) % 12) + (h >= 12 ? 12 : 0) : Number(v), m)}
          options={hours.map((n) => ({ value: String(n), label: twelve ? String(n) : two(n) }))}
        />
        <span aria-hidden>:</span>
        <Picker
          label={`${label} minute`}
          className="w-auto min-w-16"
          value={String(m)}
          onChange={(v) => set(h, Number(v))}
          options={minutes.map((n) => ({ value: String(n), label: two(n) }))}
        />
        {twelve ? (
          <Picker
            label={`${label} AM or PM`}
            className="w-auto min-w-20"
            value={h < 12 ? 'am' : 'pm'}
            onChange={(v) => set((h % 12) + (v === 'pm' ? 12 : 0), m)}
            options={[
              { value: 'am', label: 'AM' },
              { value: 'pm', label: 'PM' },
            ]}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * A labelled dropdown. The label points at the trigger, so it is the accessible name, unless
 * `name` gives a fuller one (it should start with the label); the hint is its description.
 */
export function SelectField({
  label,
  name,
  hint,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  name?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  // min-w-0 lets the field shrink inside a grid column, so a long choice is cut off with an
  // ellipsis instead of spilling over the next field.
  return (
    <div className="grid min-w-0 content-start gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Picker
        id={id}
        label={name}
        describedBy={hint ? hintId : undefined}
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
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

/**
 * A link to the public privacy page (/privacy). A plain link, not a router one: that page lives
 * outside the router and the session (publicPages.tsx), so it needs a full page load.
 */
export function PrivacyLink({ className }: { className?: string }) {
  return (
    <a
      href="/privacy"
      className={cn('underline-offset-4 hover:text-foreground hover:underline', className)}
    >
      Privacy
    </a>
  );
}

/** A centred card for screens shown before sign-in, with the privacy link under it. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <UiCard className="w-full max-w-sm">
        <CardHeader className="gap-3">
          <LogoMark size={40} />
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </UiCard>
      <footer className="text-xs text-muted-foreground">
        <PrivacyLink />
      </footer>
    </div>
  );
}
