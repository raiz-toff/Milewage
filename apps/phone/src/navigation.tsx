import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { ServerSetupScreen } from './firstrun/ServerSetupScreen';
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
  Home: undefined;
  /** `pairLink`: a `milewage://pair` link that opened the app, to pair from after asking. */
  Settings: { pairLink?: string } | undefined;
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
        </Stack.Group>
      )}
      {/* In both sets; Settings holds the pairing form until the Connect screen (PO2). */}
      <Stack.Group navigationKey={key}>
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Permissions" component={PermissionsScreen} />
        <Stack.Screen name="Conformance" component={ConformanceScreen} />
      </Stack.Group>
    </Stack.Navigator>
  );
}
