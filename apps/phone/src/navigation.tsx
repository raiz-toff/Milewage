import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { HomeScreen } from './screens/HomeScreen';
import { ConformanceScreen } from './screens/ConformanceScreen';
import { PermissionsScreen } from './screens/PermissionsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ShiftDetailScreen } from './screens/ShiftDetailScreen';
import { ShiftsScreen } from './screens/ShiftsScreen';

export type RootStackParamList = {
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

/** The navigation shell. Later PRs add screens here and nowhere else. */
export function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Shifts" component={ShiftsScreen} />
      <Stack.Screen name="ShiftDetail" component={ShiftDetailScreen} />
      <Stack.Screen name="Permissions" component={PermissionsScreen} />
      <Stack.Screen name="Conformance" component={ConformanceScreen} />
    </Stack.Navigator>
  );
}
