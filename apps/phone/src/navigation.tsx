import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { ConnectScreen } from './firstrun/ConnectScreen';
import { ServerSetupScreen } from './firstrun/ServerSetupScreen';
import { TailscaleScreen } from './firstrun/TailscaleScreen';
import { WelcomeScreen } from './firstrun/WelcomeScreen';
import type { PairingStatus } from './pairing/pairing';
import { HomeScreen } from './screens/HomeScreen';
import { ConformanceScreen } from './screens/ConformanceScreen';
import { PermissionsScreen } from './screens/PermissionsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ShiftDetailScreen } from './screens/ShiftDetailScreen';
import { ShiftsScreen } from './screens/ShiftsScreen';

export type RootStackParamList = {
  /** `revoked`: the server disconnected this phone; Welcome says so. */
  Welcome: { revoked?: boolean } | undefined;
  ServerSetup: undefined;
  Tailscale: undefined;
  /** `pairLink`: a `milewage://pair` link that opened the app, to pair from after asking. */
  Connect: { pairLink?: string } | undefined;
  Home: undefined;
  Settings: undefined;
  Shifts: undefined;
  ShiftDetail: { clientId: string };
  Permissions: undefined;
  Conformance: undefined;
};

export type ScreenProps<K extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  K
>;

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The navigation shell. Screens exist only in the state they belong to (React Navigation's
 * auth flow): a phone that is not connected has only the first-run screens, a connected one the
 * app. When the state changes, the navigator shows the first screen of the new set by itself.
 */
export function RootNavigator({ gate }: { gate: PairingStatus }) {
  const paired = gate === 'paired';
  const key = paired ? 'app' : 'first-run';
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {paired ? (
        <Stack.Group key="app">
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Shifts" component={ShiftsScreen} />
          <Stack.Screen name="ShiftDetail" component={ShiftDetailScreen} />
        </Stack.Group>
      ) : (
        <Stack.Group key="first-run">
          <Stack.Screen
            name="Welcome"
            component={WelcomeScreen}
            initialParams={{ revoked: gate === 'revoked' }}
          />
          <Stack.Screen name="ServerSetup" component={ServerSetupScreen} />
          <Stack.Screen name="Tailscale" component={TailscaleScreen} />
        </Stack.Group>
      )}
      {/* In both sets. Connect also takes a pairing link that arrives when already connected. */}
      <Stack.Group navigationKey={key}>
        <Stack.Screen name="Connect" component={ConnectScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Permissions" component={PermissionsScreen} />
        <Stack.Screen name="Conformance" component={ConformanceScreen} />
      </Stack.Group>
    </Stack.Navigator>
  );
}
