// Progress badges (18 section 8.2): data, 24 of them. Each is earned from what MileWage already
// knows. A badge that needs earnings or deliveries is evaluated only from entered or labelled
// figures and stays locked otherwise. The thresholds are this project's own, not Comma's.

export type BadgeMetric =
  | 'shifts'
  | 'hours'
  | 'distance_km'
  | 'best_streak'
  | 'earnings_cad_units'
  | 'deliveries'
  | 'early_shift';

export interface Badge {
  slug: string;
  label: string;
  metric: BadgeMetric;
  /** Reached when the metric is at least this. */
  at: number;
}

const b = (slug: string, label: string, metric: BadgeMetric, at: number): Badge => ({
  slug,
  label,
  metric,
  at,
});

export const BADGES: readonly Badge[] = [
  b('first_shift', 'First shift', 'shifts', 1),
  b('shifts_10', '10 shifts', 'shifts', 10),
  b('shifts_50', '50 shifts', 'shifts', 50),
  b('shifts_100', '100 shifts', 'shifts', 100),
  b('shifts_250', '250 shifts', 'shifts', 250),
  b('hours_10', '10 hours', 'hours', 10),
  b('hours_50', '50 hours', 'hours', 50),
  b('hours_100', '100 hours', 'hours', 100),
  b('hours_500', '500 hours', 'hours', 500),
  b('distance_100', '100 km', 'distance_km', 100),
  b('distance_500', '500 km', 'distance_km', 500),
  b('distance_1000', '1 000 km', 'distance_km', 1000),
  b('distance_5000', '5 000 km', 'distance_km', 5000),
  b('streak_3', '3-day streak', 'best_streak', 3),
  b('streak_7', '7-day streak', 'best_streak', 7),
  b('streak_14', '14-day streak', 'best_streak', 14),
  b('streak_30', '30-day streak', 'best_streak', 30),
  b('earned_100', '100 earned', 'earnings_cad_units', 100),
  b('earned_1000', '1 000 earned', 'earnings_cad_units', 1000),
  b('earned_5000', '5 000 earned', 'earnings_cad_units', 5000),
  b('earned_10000', '10 000 earned', 'earnings_cad_units', 10000),
  b('deliveries_50', '50 labelled drop-offs', 'deliveries', 50),
  b('deliveries_250', '250 labelled drop-offs', 'deliveries', 250),
  b('early_bird', 'Early bird (a shift before 6:00)', 'early_shift', 1),
];
