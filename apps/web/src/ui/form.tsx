import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { CalendarIcon } from 'lucide-react';
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

/** Input types that always show something (a format, a picker), so their label never rests inside. */
const ALWAYS_UP = new Set([
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'file',
  'color',
  'range',
]);

/**
 * The outline of a Material outlined text field, with the notch its floated label sits in (the
 * legend's text comes from CSS, so it is neither read out nor matched as text). index.css draws it.
 */
function Outline({ label }: { label: string }) {
  return (
    <fieldset aria-hidden data-slot="text-field-outline">
      <legend>
        <span data-label={label} />
      </legend>
    </fieldset>
  );
}

/** Supporting text under a field (Material: body-small, on-surface-variant, 16 px in). */
function Hint({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="px-4 text-body-small text-on-surface-variant">
      {children}
    </p>
  );
}

/**
 * A labelled input: a Material 3 outlined text field whose label rests inside and floats onto the
 * outline when the field has focus or a value. The label wraps the control, so it is the
 * accessible name; the hint is its description (supporting text).
 */
export function Field({
  label,
  hint,
  className,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = useId();
  const always = Boolean(input.placeholder) || ALWAYS_UP.has(input.type ?? 'text');
  return (
    <div className="grid content-start gap-1">
      <label data-slot="text-field" data-float={always ? 'always' : undefined}>
        <Input
          aria-describedby={hint ? hintId : undefined}
          {...input}
          // A blank placeholder lets CSS see an empty field (:placeholder-shown), so the label rests.
          placeholder={input.placeholder ?? ' '}
          className={cn('h-12 border-0 focus-visible:shadow-none', className)}
        />
        <span data-slot="text-field-label">{label}</span>
        <Outline label={label} />
      </label>
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
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
    <div className="grid min-w-0 content-start gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <div data-slot="text-field" data-float="always">
          <PopoverTrigger asChild>
            <UiButton
              id={id}
              type="button"
              variant="outline"
              data-empty={!selected}
              data-ripple="off"
              aria-labelledby={`${labelId} ${textId}`}
              aria-describedby={hint ? hintId : undefined}
              className={textFieldControl}
            >
              <span id={textId} className="truncate">
                {selected ? formatDay(value, locale) : 'Pick a date'}
              </span>
              <CalendarIcon data-icon="inline-end" className="size-5! text-on-surface-variant" />
            </UiButton>
          </PopoverTrigger>
          <label id={labelId} htmlFor={id} data-slot="text-field-label">
            {label}
          </label>
          <Outline label={label} />
        </div>
        <PopoverContent
          aria-label={label}
          align="start"
          className="w-auto overflow-hidden rounded-large bg-surface-container-high p-0 shadow-elevation-3"
        >
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
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

/** A button or select trigger drawn as the inside of an outlined text field (no own outline). */
const textFieldControl =
  'h-12 w-full min-w-0 justify-between rounded-extra-small border-0 data-[size=default]:h-12 bg-transparent pr-3 pl-4 text-body-large font-normal text-on-surface before:hidden focus-visible:shadow-none focus-visible:outline-none data-[empty=true]:text-on-surface-variant data-[state=open]:shadow-none';

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
    <div role="group" aria-label={label} className="grid content-start gap-1">
      <span className="px-1 text-body-small text-on-surface-variant">{label}</span>
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
    <div className="grid min-w-0 content-start gap-1">
      <div data-slot="text-field" data-float="always" className="min-w-0">
        <Picker
          id={id}
          label={name}
          describedBy={hint ? hintId : undefined}
          value={value}
          onChange={onChange}
          options={options}
          disabled={disabled}
          className={textFieldControl}
        />
        <label htmlFor={id} data-slot="text-field-label">
          {label}
        </label>
        <Outline label={label} />
      </div>
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
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
    <p role="alert" className="text-body-medium text-destructive">
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
      className={cn(
        'rounded-extra-small underline-offset-4 focus-ring hover:text-foreground hover:underline',
        className,
      )}
    >
      Privacy
    </a>
  );
}

/**
 * A centred card for screens shown before sign-in, with the privacy link under it: a Material
 * filled card with large corners on the page's surface, the mark and a headline-small title.
 */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 sm:p-6">
      <UiCard className="w-full max-w-[400px] rounded-large [--card-spacing:--spacing(6)]">
        <CardHeader className="gap-4">
          <LogoMark size={40} />
          <h1 className="text-headline-small text-on-surface">{title}</h1>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </UiCard>
      <footer className="text-body-small text-on-surface-variant">
        <PrivacyLink />
      </footer>
    </div>
  );
}
