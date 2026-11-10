import * as React from 'react';
import { DayPicker, getDefaultClassNames, type DayButton, type Locale } from 'react-day-picker';
import { ArrowDropDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@/ui/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/*
 * react-day-picker drawn as the Material 3 docked date picker (m3.material.io/components/
 * date-pickers): 40 px round days in body-large, today ringed in primary, the chosen day filled
 * primary, weekday initials in body-large on-surface, month and year menus in label-large
 * on-surface-variant, round previous and next buttons. The container (`bg-popover`,
 * large corners) is the popover that holds it.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        'group/calendar bg-popover p-3 text-on-surface [--cell-radius:var(--md-sys-shape-corner-full)] [--cell-size:--spacing(10)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent',
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString(locale?.code, { month: 'short' }),
        // Material's date picker heads each column with one letter (S M T W T F S); the header
        // cell keeps the full name as its accessible label (react-day-picker's labelWeekday).
        formatWeekdayName: (date) => date.toLocaleString(locale?.code, { weekday: 'narrow' }),
        ...formatters,
      }}
      classNames={{
        root: cn('w-fit', defaultClassNames.root),
        months: cn('relative flex flex-col gap-4 md:flex-row', defaultClassNames.months),
        month: cn('flex w-full flex-col gap-4', defaultClassNames.month),
        nav: cn(
          'absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 text-on-surface-variant select-none aria-disabled:opacity-[0.38]',
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 text-on-surface-variant select-none aria-disabled:opacity-[0.38]',
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          'flex h-(--cell-size) w-full items-center justify-center gap-1 text-label-large text-on-surface-variant',
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          'relative rounded-full px-2 py-1.5 state-layer has-focus-visible:outline-3 has-focus-visible:outline-ring',
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn('absolute inset-0 bg-popover opacity-0', defaultClassNames.dropdown),
        caption_label: cn(
          'text-label-large select-none',
          captionLayout === 'label'
            ? 'text-on-surface'
            : 'flex items-center gap-1 rounded-(--cell-radius) [&>svg]:size-[18px] [&>svg]:text-on-surface-variant',
          defaultClassNames.caption_label,
        ),
        month_grid: cn('w-full border-collapse', defaultClassNames.month_grid),
        weekdays: cn('flex', defaultClassNames.weekdays),
        weekday: cn(
          'flex-1 rounded-(--cell-radius) text-body-large text-on-surface select-none',
          defaultClassNames.weekday,
        ),
        week: cn('mt-1 flex w-full', defaultClassNames.week),
        week_number_header: cn('w-(--cell-size) select-none', defaultClassNames.week_number_header),
        week_number: cn(
          'text-body-small text-on-surface-variant select-none',
          defaultClassNames.week_number,
        ),
        day: cn(
          'group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)',
          props.showWeekNumber
            ? '[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)'
            : '[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)',
          defaultClassNames.day,
        ),
        range_start: cn(
          'relative isolate z-0 rounded-l-(--cell-radius) bg-secondary-container after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-secondary-container',
          defaultClassNames.range_start,
        ),
        range_middle: cn('rounded-none', defaultClassNames.range_middle),
        range_end: cn(
          'relative isolate z-0 rounded-r-(--cell-radius) bg-secondary-container after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-secondary-container',
          defaultClassNames.range_end,
        ),
        today: cn(
          'rounded-(--cell-radius) text-primary [&>button]:border [&>button]:border-primary data-[selected=true]:rounded-none',
          defaultClassNames.today,
        ),
        outside: cn(
          'text-on-surface-variant aria-selected:text-on-surface-variant',
          defaultClassNames.outside,
        ),
        disabled: cn('text-on-surface opacity-[0.38]', defaultClassNames.disabled),
        hidden: cn('invisible', defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === 'left') {
            return <ChevronLeftIcon className={cn('size-6', className)} {...props} />;
          }

          if (orientation === 'right') {
            return <ChevronRightIcon className={cn('size-6', className)} {...props} />;
          }

          return <ArrowDropDownIcon className={cn('size-5', className)} {...props} />;
        },
        DayButton: ({ ...props }) => <CalendarDayButton locale={locale} {...props} />,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-full border-0 text-body-large leading-none text-current group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:outline-3 group-data-[focused=true]/day:outline-ring data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-on-primary data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-secondary-container data-[range-middle=true]:text-on-secondary-container data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-on-primary data-[selected-single=true]:bg-primary data-[selected-single=true]:text-on-primary [&>span]:text-label-small [&>span]:opacity-70',
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
