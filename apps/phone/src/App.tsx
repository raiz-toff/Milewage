import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation';
import { ServicesProvider, type Services } from './services';

export function App({ services }: { services?: Services }) {
  const light = useColorScheme() === 'light';
  return (
    <SafeAreaProvider>
      <ServicesProvider value={services}>
        <NavigationContainer theme={light ? DefaultTheme : DarkTheme}>
          <RootNavigator />
        </NavigationContainer>
      </ServicesProvider>
      <StatusBar style={light ? 'dark' : 'light'} />
    </SafeAreaProvider>
  );
}
