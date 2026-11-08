import { useId } from 'react';
import Svg, { Circle, ClipPath, G, Path } from 'react-native-svg';
import { BRAND } from '../theme/colors';

const ROAD = 'M-10 86 L36 68 L64 32 L110 14';

/**
 * The MileWage mark (branding/coin-thin): a coin with a road climbing across it. Below 24 dp use
 * `small` (branding/coin-small): no lane dashes and a wider road.
 */
export function Logo({ size = 32, small = false }: { size?: number; small?: boolean }) {
  const clip = useId();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden>
      <Circle cx={50} cy={50} r={46} fill={BRAND.laneYellow} />
      <ClipPath id={clip}>
        <Circle cx={50} cy={50} r={46} />
      </ClipPath>
      <G clipPath={`url(#${clip})`}>
        <Path
          d={ROAD}
          fill="none"
          stroke={BRAND.asphalt}
          strokeWidth={small ? 24 : 19}
          strokeLinejoin="miter"
        />
        {!small && (
          <Path
            d={ROAD}
            fill="none"
            stroke={BRAND.laneYellow}
            strokeWidth={3}
            strokeDasharray="7 7"
          />
        )}
      </G>
    </Svg>
  );
}
