import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Material 3 outlined text field, the box (m3.material.io/components/text-fields): extra-small
 * corners, a 1 px outline that turns 2 px primary on focus and error when invalid, body-large
 * text. 48 px high here (Material's 56 less the floating label's room, which `Field` provides
 * where it draws the label in the outline); `h-8` callers keep their dense size.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-12 w-full min-w-0 rounded-extra-small border border-input bg-transparent px-4 py-2 text-body-large text-on-surface caret-primary transition-[border-color,box-shadow] duration-150 ease-standard outline-none placeholder:text-on-surface-variant hover:border-on-surface focus-visible:border-primary focus-visible:shadow-[inset_0_0_0_1px_var(--primary)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[0.38] aria-invalid:border-destructive aria-invalid:focus-visible:shadow-[inset_0_0_0_1px_var(--destructive)]',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
