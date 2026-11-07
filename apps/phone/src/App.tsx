import { NavigationContainer, DarkTheme, type Theme } from '@react-navigation/native';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation';
import { ServicesProvider, type Services } from './services';
import { PALETTE } from './theme/colors';

/** React Navigation's theme from the MileWage palette, so transitions show the same canvas. */
const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: PALETTE.primary,
    background: PALETTE.background,
    card: PALETTE.card,
    text: PALETTE.foreground,
    border: PALETTE.border,
  },
};

export function App({ services }: { services?: Services }) {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
  });
  // Until Geist is in, show the bare canvas (the splash colour) rather than a system-font flash.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: PALETTE.background }} />;
  }
  return (
    <SafeAreaProvider>
      <ServicesProvider value={services}>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
        </NavigationContainer>
      </ServicesProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
