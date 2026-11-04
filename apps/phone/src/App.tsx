import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation';

export function App() {
  const light = useColorScheme() === 'light';
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={light ? DefaultTheme : DarkTheme}>
        <RootNavigator />
      </NavigationContainer>
      <StatusBar style={light ? 'dark' : 'light'} />
    </SafeAreaProvider>
  );
}
