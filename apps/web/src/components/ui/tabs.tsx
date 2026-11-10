'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { withRipple } from '@/components/ui/ripple';

/**
 * Material 3 tabs (m3.material.io/components/tabs). `default` is primary tabs: a 48 px row over a
 * divider, title-small labels, the active one in primary with a 3 px indicator as wide as its
 * label. `line` is secondary tabs: the indicator runs the tab's full width, 2 px.
 */
function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'group/tabs-list relative inline-flex w-fit max-w-full items-stretch overflow-x-auto text-on-surface-variant [scrollbar-width:none] group-data-horizontal/tabs:h-12 group-data-horizontal/tabs:shadow-[inset_0_-1px_0_var(--border)] group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
  {
    variants: {
      variant: {
        default: '',
        line: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  children,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "group/tab relative inline-flex min-w-12 flex-1 items-center justify-center gap-1.5 px-4 text-title-small whitespace-nowrap state-layer transition-colors duration-200 ease-standard outline-none group-data-vertical/tabs:h-12 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-[0.38] data-active:text-primary hover:text-on-surface data-active:hover:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
        // Secondary tabs: a 2 px indicator across the whole tab.
        'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary after:opacity-0 group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
        className,
      )}
      onPointerDown={withRipple(onPointerDown)}
      {...props}
    >
      <span className="relative inline-flex h-full items-center gap-1.5">
        {children}
        {/* Primary tabs: a 3 px indicator as wide as the label, rounded on top. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-primary opacity-0 transition-opacity duration-200 group-data-[variant=default]/tabs-list:group-data-[state=active]/tab:opacity-100"
        />
      </span>
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 text-body-medium outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
