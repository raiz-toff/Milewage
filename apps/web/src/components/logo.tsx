import { useId } from 'react';

const ROAD = 'M-10 86 L36 68 L64 32 L110 14';

/**
 * The MileWage mark (branding/coin-thin): a coin with a road climbing across it. It follows the
 * theme, like the tab icon: on light pages an Asphalt coin with a yellow road (yellow alone is
 * too faint on white, branding/README), on dark pages the yellow coin with an Asphalt road.
 * Below 24 px use `small`, the cut with no lane dashes and a wider road (branding/coin-small).
 */
export function LogoMark({
  size = 32,
  small = false,
  className,
}: {
  size?: number;
  small?: boolean;
  className?: string;
}) {
  const clip = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="50" cy="50" r="46" className="fill-[#101214] dark:fill-[#FFC21F]" />
      <clipPath id={clip}>
        <circle cx="50" cy="50" r="46" />
      </clipPath>
      <g clipPath={`url(#${clip})`} fill="none">
        <path
          d={ROAD}
          className="stroke-[#FFC21F] dark:stroke-[#101214]"
          strokeWidth={small ? 24 : 19}
          strokeLinejoin="miter"
        />
        {!small && (
          <path
            d={ROAD}
            className="stroke-[#101214] dark:stroke-[#FFC21F]"
            strokeWidth="3"
            strokeDasharray="7 7"
          />
        )}
      </g>
    </svg>
  );
}
