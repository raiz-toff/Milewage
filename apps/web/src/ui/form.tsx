import type { InputHTMLAttributes, ReactNode } from 'react';

/** A labelled input. The label wraps the control, so it is the accessible name. */
export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted">{label}</span>
      <input
        className="w-full rounded border border-line bg-bg px-3 py-2 text-ink focus:border-accent focus:outline-none"
        {...input}
      />
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted">{label}</span>
      <select
        className="w-full rounded border border-line bg-bg px-3 py-2 text-ink focus:border-accent focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Button({
  busy,
  children,
  ...rest
}: { busy?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="min-h-12 rounded bg-accent px-4 font-medium text-bg disabled:opacity-50"
      disabled={busy || rest.disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-red-400">
      {message}
    </p>
  ) : null;
}

/** A centred card for screens shown before sign-in. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md space-y-4 rounded border border-line bg-card p-6">
      <h1 className="font-heading text-2xl">{title}</h1>
      {children}
    </div>
  );
}
