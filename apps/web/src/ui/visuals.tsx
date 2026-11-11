import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  BackupsIcon,
  CarIcon,
  CarWashIcon,
  CategoryIcon,
  CodeIcon,
  DevicesIcon,
  ExpensesIcon,
  FileIcon,
  FuelIcon,
  KeyIcon,
  MaintenanceIcon,
  MealsIcon,
  ParkingIcon,
  PaymentsIcon,
  ShieldIcon,
  TagIcon,
  TollIcon,
} from '@/ui/icons';
import type { IconComponent } from '@/ui/icons';

/**
 * The pictures that keep a page from being a blank slate: an icon in a tonal tile before a row or
 * a figure, and a ring that fills toward a target. Colours are roles only: the neutral tile, the
 * selection tile, and the chart series for things that come in kinds (never Lane yellow).
 */

// Literal class names, so the stylesheet holds every one.
const SERIES = [
  'bg-chart-series-1/15 text-chart-series-1',
  'bg-chart-series-2/15 text-chart-series-2',
  'bg-chart-series-3/15 text-chart-series-3',
  'bg-chart-series-4/15 text-chart-series-4',
  'bg-chart-series-5/15 text-chart-series-5',
  'bg-chart-series-6/15 text-chart-series-6',
  'bg-chart-series-7/15 text-chart-series-7',
  'bg-chart-series-8/15 text-chart-series-8',
] as const;

export type TileTone = 'neutral' | 'selected' | number;

/** An icon in a 40 px tonal tile. A number picks a chart series colour, for things in kinds. */
export function IconTile({
  icon: Icon,
  tone = 'neutral',
  round,
  className,
}: {
  icon: IconComponent;
  tone?: TileTone;
  round?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center',
        round ? 'rounded-full' : 'rounded-medium',
        tone === 'neutral'
          ? 'bg-surface-container-high text-on-surface-variant'
          : tone === 'selected'
            ? 'bg-secondary-container text-on-secondary-container'
            : SERIES[tone % SERIES.length],
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** An expense category's picture and colour, by its slug; anything unknown is a tag. */
const CATEGORY: Record<string, [IconComponent, number]> = {
  fuel: [FuelIcon, 0],
  maintenance: [MaintenanceIcon, 1],
  bike_maintenance: [MaintenanceIcon, 1],
  parking: [ParkingIcon, 2],
  tolls: [TollIcon, 3],
  insurance: [ShieldIcon, 4],
  licensing: [KeyIcon, 4],
  interest: [PaymentsIcon, 5],
  leasing: [CarIcon, 5],
  vehicle_rental: [CarIcon, 5],
  vehicle_finance: [PaymentsIcon, 5],
  fees: [PaymentsIcon, 6],
  bank_fees: [PaymentsIcon, 6],
  phone: [DevicesIcon, 7],
  data_plan: [DevicesIcon, 7],
  wash: [CarWashIcon, 0],
  supplies: [CategoryIcon, 1],
  meals: [MealsIcon, 2],
  software: [CodeIcon, 3],
  accounting: [FileIcon, 4],
  out_of_pocket: [ExpensesIcon, 6],
  backup: [BackupsIcon, 0],
};
export function CategoryTile({ slug, className }: { slug: string; className?: string }) {
  const [icon, tone] = CATEGORY[slug] ?? [TagIcon, 6];
  return <IconTile icon={icon} tone={tone} className={className} />;
}

/**
 * A ring that fills clockwise toward a target, with its content (a percentage, a tick) in the
 * middle. It is a picture: the page says the figures in words beside it, and the element that
 * holds the ring carries the progress role when one is wanted.
 */
export function ProgressRing({
  value,
  size = 72,
  done,
  children,
  className,
}: {
  /** 0 to 100. */
  value: number;
  size?: number;
  /** Reached: the ring turns to the earned green. */
  done?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-secondary-container"
        />
        {pct > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(c * pct) / 100} ${c}`}
            className={cn(
              'transition-[stroke-dasharray] duration-500 ease-standard motion-reduce:transition-none',
              done ? 'stroke-chart-earned' : 'stroke-primary',
            )}
          />
        ) : null}
      </svg>
      <span className="absolute text-label-large text-on-surface tabular-nums">{children}</span>
    </span>
  );
}
