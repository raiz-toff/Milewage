/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require */
// Native animation modules have no native side under Jest.

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));

// Reanimated 4.7's own mock initialises its native module and throws under Jest
// (`setCSSEventHandler is not available in JSReanimated`). The app uses only these calls; they
// render the final state, which is all the tests look at.
jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');
  const value = (v: unknown) => v;
  return {
    __esModule: true,
    default: { View, Text, createAnimatedComponent: (c: unknown) => c },
    createAnimatedComponent: (c: unknown) => c,
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (f: () => object) => f(),
    withTiming: value,
    withSpring: value,
    withDelay: (_ms: number, v: unknown) => v,
    withRepeat: value,
    withSequence: (...v: unknown[]) => v[v.length - 1],
  };
});
