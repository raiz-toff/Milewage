import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
  type Theme,
} from '@react-navigation/native';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useGate } from './firstrun/gate';
import { PairingLinks } from './pairing/PairingLinks';
import { RootNavigator, type RootStackParamList } from './navigation';
import { ServicesProvider, useServices, type Services } from './services';
import { PALETTE } from './theme/colors';
import { ConfirmProvider } from './ui/Dialog';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ToastProvider } from './ui/Toast';

const navRef = createNavigationContainerRef<RootStackParamList>();

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
  const [navReady, setNavReady] = useState(false);
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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: PALETTE.background }}>
      <SafeAreaProvider>
        <ServicesProvider value={services}>
          <ToastProvider>
            <ConfirmProvider>
              <NavigationContainer ref={navRef} theme={navTheme} onReady={() => setNavReady(true)}>
                <Guarded />
                {navReady && (
                  <PairingLinks onLink={(url) => navRef.navigate('Connect', { pairLink: url })} />
                )}
              </NavigationContainer>
            </ConfirmProvider>
          </ToastProvider>
        </ServicesProvider>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** The screens inside the crash guard; a caught crash goes to diagnostics like any other. */
function Guarded() {
  const { diagnostics } = useServices();
  const gate = useGate();
  // Until the pairing is read, the bare canvas, so the wrong first screen never flashes.
  if (gate === 'loading') return <View style={{ flex: 1, backgroundColor: PALETTE.background }} />;
  const first = gate === 'paired' ? 'Home' : gate === 'setup' ? 'Connected' : 'Welcome';
  return (
    <ErrorBoundary
      onError={(e) => {
        diagnostics.recordCrash(e, false);
        void diagnostics.persist();
      }}
      onHome={() => navRef.isReady() && navRef.reset({ index: 0, routes: [{ name: first }] })}
    >
      <RootNavigator gate={gate} />
    </ErrorBoundary>
  );
}
