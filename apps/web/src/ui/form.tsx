import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import { Card as UiCard, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

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

export interface PickOption {
  value: string;
  label: string;
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
      <SelectTrigger id={id} aria-label={label} size={size} className={cn('w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value === '' ? EMPTY : o.value} data-value={o.value}>
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
  return (
    <div className="grid content-start gap-2">
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
